import math
import struct
import subprocess
import wave
from pathlib import Path

from contracts import RenderJob
from fastapi.testclient import TestClient

from agent.theory import midi_span
from api.audio import bar_frames
from api.main import create_app
from api.renderer import MockRenderer


def test_render_uses_edited_prompt_text(tmp_path: Path) -> None:
    app = create_app(tmp_path / "data")
    seen: list[tuple[str, str, str]] = []
    inner = app.state.renderer

    class Recording:
        def render(self, job: RenderJob, chords: list[str]):
            seen.append((job.layer, job.prompt, job.negative))
            return inner.render(job, chords)

    app.state.renderer = Recording()
    with TestClient(app) as client:
        turn = client.post(
            "/turn",
            json={
                "session_id": "edited",
                "text": "I feel sad in the rain",
                "output": ["drums"],
                "overrides": {"key": "D minor", "style": "a piano ballad"},
            },
        )
        assert turn.status_code == 200
        assert turn.json()["status"] == "ready"
        rendered = client.post(
            "/render",
            json={
                "session_id": "edited",
                "prompts": [{"layer": "drums", "prompt": "edited drums prompt", "negative": "no hats"}],
            },
        )
    assert rendered.status_code == 200
    drums = [item for item in seen if item[0] == "drums"]
    assert drums
    assert {item[1] for item in drums} == {"edited drums prompt"}
    assert {item[2] for item in drums} == {"no hats"}


def test_turn_render_and_export_match_the_bar_length(tmp_path: Path) -> None:
    data = tmp_path / "data"
    with TestClient(create_app(data)) as client:
        turn = client.post(
            "/turn",
            json={
                "session_id": "phase2",
                "text": "I feel sad in the rain",
                "output": ["drums", "chords", "bass", "texture"],
                "overrides": {"key": "D minor", "style": "a piano ballad"},
            },
        )
        assert turn.status_code == 200
        body = turn.json()
        assert body["status"] == "ready"
        assert body["progression"]["chords"] == ["Dm", "Bb", "F", "C"]

        rendered = client.post("/render", json={"session_id": "phase2"})
        assert rendered.status_code == 200
        results = rendered.json()
        assert [(item["layer"], item["variant"]) for item in results] == [
            (layer, variant) for layer in ("drums", "chords", "bass", "texture") for variant in (1, 2, 3)
        ]
        expected_seconds = 8 * 4 * 60 / 76
        expected_frames = round(expected_seconds * 44100)
        for item in results:
            assert math.isclose(item["seconds"], expected_seconds, abs_tol=1e-9)
            assert item["bpm"] == 76
            _assert_wav(Path(item["path"]), expected_frames)
        drums = [item for item in results if item["layer"] == "drums"]
        assert Path(drums[0]["path"]).read_bytes() != Path(drums[1]["path"]).read_bytes()
        assert Path(drums[0]["path"]).parent.name == "renders"
        assert Path(drums[0]["path"]).name == "verse_drums_76bpm_8bars_v1.wav"

        session = data / "sessions" / "phase2"
        for kind in ("chords", "bass"):
            midi = session / "midi" / f"verse_{kind}_76bpm_8bars.mid"
            assert midi_span(midi.read_bytes()) == (round(60_000_000 / 76), 8 * 4 * 480)

        served = client.get("/files/phase2/renders/verse_drums_76bpm_8bars_v1.wav")
        assert served.status_code == 200
        assert served.content == Path(drums[0]["path"]).read_bytes()

        exported = client.post("/export", json={"session_id": "phase2"})
        assert exported.status_code == 200
        names = sorted(Path(path).name for path in exported.json()["files"])
        assert names == [
            "verse_bass_76bpm_8bars.mid",
            "verse_bass_76bpm_8bars_v1.wav",
            "verse_chords_76bpm_8bars.mid",
            "verse_chords_76bpm_8bars_v1.wav",
            "verse_drums_76bpm_8bars_v1.wav",
            "verse_texture_76bpm_8bars_v1.wav",
        ]
        export_dir = session / "export"
        assert (export_dir / "verse_drums_76bpm_8bars_v1.wav").read_bytes() == Path(drums[0]["path"]).read_bytes()
        _assert_wav(export_dir / "verse_chords_76bpm_8bars_v1.wav", expected_frames)

        before = Path(drums[0]["path"]).read_bytes()
        again = client.post("/regenerate", json={"session_id": "phase2", "layer": "drums"})
        assert again.status_code == 200
        assert [item["variant"] for item in again.json()] == [1, 2, 3]
        _assert_wav(Path(drums[0]["path"]), expected_frames)
        assert Path(drums[0]["path"]).read_bytes() != before

        picked = client.post("/export", json={"session_id": "phase2", "picks": {"drums": 2}})
        assert picked.status_code == 200
        picked_drums = export_dir / "verse_drums_76bpm_8bars_v2.wav"
        assert picked_drums.read_bytes() == Path(drums[1]["path"]).read_bytes()
        assert (export_dir / "verse_bass_76bpm_8bars_v1.wav").read_bytes() == Path(
            next(item["path"] for item in results if item["layer"] == "bass" and item["variant"] == 1)
        ).read_bytes()


def test_melody_and_full_mix_use_the_same_length(tmp_path: Path) -> None:
    renderer = MockRenderer(tmp_path)
    frames = bar_frames(120, 1)
    for layer in ("melody", "full_mix"):
        result = renderer.render(
            RenderJob(
                session_id="tones",
                layer=layer,
                prompt="TrackType: Instrument",
                negative="vocals",
                bpm=120,
                bars=1,
                seed=7,
                variant=1,
            ),
            ["C", "G", "Am", "F"],
        )
        assert result.seconds == 2
        assert Path(result.path).parent.name == "renders"
        _assert_wav(Path(result.path), frames)


def test_full_mix_peak_stays_below_full_scale(tmp_path: Path) -> None:
    renderer = MockRenderer(tmp_path)
    result = renderer.render(
        RenderJob(
            session_id="mix",
            layer="full_mix",
            prompt="TrackType: Music",
            negative="vocals",
            bpm=120,
            bars=2,
            seed=3,
            variant=1,
        ),
        ["C", "G", "Am", "F"],
    )
    path = Path(result.path)
    assert path.parent.name == "renders"
    with wave.open(str(path)) as handle:
        raw = handle.readframes(handle.getnframes())
    peak = max(max(abs(left), abs(right)) for left, right in struct.iter_unpack("<hh", raw))
    assert peak > 1000
    assert peak < 32767


def test_cors_allows_the_web_app(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path)) as client:
        response = client.get("/files/phase2/missing.wav", headers={"Origin": "http://localhost:5173"})
        assert response.status_code == 404
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_midi_upload_skips_audio_analysis(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "data")) as client:
        response = client.post(
            "/upload",
            data={"session_id": "phase4", "input_type": "midi"},
            files={"file": ("idea.mid", b"MThd", "audio/midi")},
        )
    assert response.status_code == 200
    features = response.json()
    assert features["input_type"] == "midi"
    assert features["confidence"] == 0.8
    assert (tmp_path / "data" / "sessions" / "phase4" / "audio" / "idea.mid").is_file()


def test_upload_converts_opus_and_returns_features(tmp_path: Path) -> None:
    source = tmp_path / "phrase.wav"
    _write_tone(source)
    opus = tmp_path / "phrase.opus"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(source), "-c:a", "libopus", str(opus)],
        check=True,
        capture_output=True,
    )
    with TestClient(create_app(tmp_path / "data")) as client:
        response = client.post(
            "/upload",
            data={"session_id": "phase2", "input_type": "instrument_loop"},
            files={"file": ("phrase.opus", opus.read_bytes(), "audio/ogg")},
        )
    assert response.status_code == 200
    features = response.json()
    assert features["input_type"] == "instrument_loop"
    assert features["key"]
    assert features["mode"] in {"major", "minor"}
    assert 0 <= features["confidence"] <= 1
    assert features["bpm"] is None or isinstance(features["bpm"], int | float)
    stored = tmp_path / "data" / "sessions" / "phase2" / "audio" / "phrase.wav"
    with wave.open(str(stored)) as handle:
        assert handle.getframerate() == 44100
        assert handle.getnchannels() == 2
        assert handle.getsampwidth() == 2


def _assert_wav(path: Path, frames: int) -> None:
    with wave.open(str(path)) as handle:
        assert handle.getframerate() == 44100
        assert handle.getnchannels() == 2
        assert handle.getsampwidth() == 2
        assert handle.getnframes() == frames
        raw = handle.readframes(frames)
    peak = max(max(abs(left), abs(right)) for left, right in struct.iter_unpack("<hh", raw))
    assert peak > 1000


def _write_tone(path: Path) -> None:
    rate = 44100
    count = rate
    frames = bytearray()
    for index in range(count):
        value = int(12000 * math.sin(2 * math.pi * 440 * index / rate))
        frames += struct.pack("<hh", value, value)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(frames)
