import json
import math
import struct
import subprocess
import wave
from pathlib import Path

from contracts import RenderJob, RenderResult
from fastapi.testclient import TestClient

from agent.theory import midi_span
from api.audio import analyse, bar_frames
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
                "answer": {"slot": "mood", "action": "skip_all"},
            },
        )
        assert turn.status_code == 200
        assert turn.json()["status"] == "review"
        written = client.post("/turn", json={"session_id": "edited", "write_prompts": True})
        assert written.json()["status"] == "ready"
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
                "answer": {"slot": "mood", "action": "skip_all"},
            },
        )
        assert turn.status_code == 200
        assert turn.json()["status"] == "review"
        written = client.post("/turn", json={"session_id": "phase2", "write_prompts": True})
        body = written.json()
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


def test_render_stream_reports_each_variation_and_keeps_other_layers(tmp_path: Path) -> None:
    app = create_app(tmp_path / "data")

    class FailBass:
        def __init__(self) -> None:
            self.failed = False

        def render(self, job: RenderJob, chords: list[str]) -> RenderResult:
            if job.layer == "bass" and not self.failed:
                self.failed = True
                raise RuntimeError("bass failed")
            path = tmp_path / f"{job.layer}-v{job.variant}-t{job.take}.wav"
            path.write_bytes(b"stub")
            return RenderResult(layer=job.layer, variant=job.variant, path=str(path), seconds=1, bpm=job.bpm)

    app.state.renderer = FailBass()
    with TestClient(app) as client:
        turn = client.post(
            "/turn",
            json={
                "session_id": "stream",
                "text": "I feel sad in the rain",
                "output": ["drums", "bass", "chords"],
                "overrides": {"key": "D minor", "style": "a piano ballad"},
                "answer": {"slot": "mood", "action": "skip_all"},
            },
        )
        assert turn.status_code == 200
        written = client.post("/turn", json={"session_id": "stream", "write_prompts": True})
        assert written.json()["status"] == "ready"
        rendered = client.post(
            "/render",
            headers={"Accept": "application/x-ndjson"},
            json={"session_id": "stream"},
        )
        assert rendered.status_code == 200
        assert rendered.headers["content-type"].startswith("application/x-ndjson")
        events = [json.loads(line) for line in rendered.text.splitlines() if line.strip()]
        drums = [item for item in events if item["kind"] == "progress" and item["layer"] == "drums"]
        assert [(item["take"], item["variant"], item["total"]) for item in drums] == [
            (1, 1, 3),
            (1, 2, 3),
            (1, 3, 3),
        ]
        assert {"kind": "error", "layer": "bass", "message": "That layer did not render. Try again."} in events
        finished = [item for item in events if item["kind"] == "layer"]
        assert [item["results"][0]["layer"] for item in finished] == ["drums", "chords"]
        assert events[-1] == {"kind": "done"}

        again = client.post(
            "/regenerate",
            headers={"Accept": "application/x-ndjson"},
            json={"session_id": "stream", "layer": "drums"},
        )
        assert again.status_code == 200
        follow = [json.loads(line) for line in again.text.splitlines() if line.strip()]
        assert [(item["take"], item["variant"]) for item in follow if item["kind"] == "progress"] == [
            (2, 1),
            (2, 2),
            (2, 3),
        ]

        missing = client.post("/regenerate", json={"session_id": "stream", "layer": "bass"})
        assert missing.status_code == 404
        retry = client.post("/render", json={"session_id": "stream", "layer": "bass"})
        assert retry.status_code == 200
        assert [(item["layer"], item["variant"]) for item in retry.json()] == [
            ("bass", 1),
            ("bass", 2),
            ("bass", 3),
        ]
        chords = client.post("/regenerate", json={"session_id": "stream", "layer": "chords"})
        assert chords.status_code == 200
        assert [item["variant"] for item in chords.json()] == [1, 2, 3]


def _assert_wav(path: Path, frames: int) -> None:
    with wave.open(str(path)) as handle:
        assert handle.getframerate() == 44100
        assert handle.getnchannels() == 2
        assert handle.getsampwidth() == 2
        assert handle.getnframes() == frames
        raw = handle.readframes(frames)
    peak = max(max(abs(left), abs(right)) for left, right in struct.iter_unpack("<hh", raw))
    assert peak > 1000


MESSAGE = (
    "A synth pattern at 105bpm with the chord progression C, am, F, G, wavy, "
    "agony and tension, release into a positive breath at the end"
)


def test_duplicate_request_id_returns_the_previous_response(tmp_path: Path) -> None:
    payload = {"session_id": "duplicate", "text": "I feel sad", "request_id": "same-id"}
    with TestClient(create_app(tmp_path / "data")) as client:
        first = client.post("/turn", json=payload)
        second = client.post("/turn", json=payload)
        assert first.status_code == 200
        assert second.json() == first.json()
        third = client.post(
            "/turn",
            json={**payload, "request_id": "next-id", "answer": {"slot": "mood", "action": "skip"}},
        )
    assert third.status_code == 200
    assert third.json()["brief"]["questions_asked"] == first.json()["brief"]["questions_asked"] + 1


def test_the_synth_pattern_message_renders(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "data")) as client:
        turn = client.post(
            "/turn",
            json={
                "session_id": "synth-pattern",
                "text": MESSAGE,
                "answer": {"slot": "mood", "action": "skip_all"},
            },
        )
        assert turn.status_code == 200
        body = turn.json()
        assert body["status"] == "review"
        assert body["brief"]["slots"]["tempo"]["value"] == "105"
        assert body["brief"]["slots"]["structure"]["value"] == "16 bars"
        assert body["brief"]["arc"]["start"] == "agony and tension"
        assert body["brief"]["arc"]["description"] == "Agony and tension releases into a positive breath"
        written = client.post("/turn", json={"session_id": "synth-pattern", "write_prompts": True})
        assert written.json()["status"] == "ready"
        rendered = client.post("/render", json={"session_id": "synth-pattern"})
    assert rendered.status_code == 200
    assert rendered.json()
    assert {item["bpm"] for item in rendered.json()} == {105}


def test_a_brief_without_bars_or_tempo_still_records() -> None:
    from contracts import LayerPrompt, SongBrief, SlotValue, TurnResponse

    from api.main import _record

    response = TurnResponse(
        status="ready",
        brief=SongBrief(
            slots={
                "structure": SlotValue(
                    value="release into a positive breath",
                    source="you",
                    reason="from the model",
                    confidence=0.9,
                ),
                "tempo": SlotValue(value="wavy", source="you", reason="from the model", confidence=0.9),
            },
            output=["drums"],
            questions_asked=0,
            skipped=[],
        ),
        prompts=[
            LayerPrompt(
                layer="drums",
                prompt="TrackType: Instrument, tight kit",
                negative="vocals",
                seeds=[0.1, 0.2, 0.3],
                kb_sources=["peaceful"],
            )
        ],
        progression={"roman": ["I"], "chords": ["C"]},
        trace=[],
    )
    record = _record(response)
    assert record.bars == 8
    assert record.bpm > 0
    assert record.mood == "peaceful"
    assert record.key == "C major"


def test_demo_loop_reports_a_key_and_a_tempo() -> None:
    fixture = Path(__file__).resolve().parents[3] / "apps" / "web" / "public" / "fixtures" / "detected-loop.wav"
    features = analyse(fixture, "full_track")
    assert features.key == "A"
    assert features.mode == "minor"
    assert features.bpm is not None
    assert 90 <= features.bpm <= 102
    assert features.confidence < 0.6


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
