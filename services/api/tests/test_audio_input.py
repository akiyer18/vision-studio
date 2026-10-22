"""Uploaded audio keeps its features and reaches the renderer as source audio."""

import json
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from api.audio import SR, write_wav
from api.main import create_app
from api.stability import StabilityAPIRenderer


def _five_seconds(path: Path) -> None:
    count = SR * 5
    time = np.arange(count)
    click = (time % (SR // 2)) < 700
    tone = 0.35 * np.sin(2 * np.pi * 220 * time / SR) * click
    stereo = np.column_stack([tone, tone])
    write_wav(path, stereo)


def _convert(source: Path, dest: Path, *codec: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-i", str(source), *codec, str(dest)], check=True, capture_output=True)


def _seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / handle.getframerate()


def test_wav_mp3_and_webm_keep_features_and_reach_the_renderer(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    mp3 = tmp_path / "take.mp3"
    webm = tmp_path / "take.webm"
    _five_seconds(wav)
    _convert(wav, mp3, "-codec:a", "libmp3lame")
    _convert(wav, webm, "-c:a", "libopus")
    assert _seconds(wav) == 5

    uploads = [
        ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "instrument_loop", "take.wav", wav, "audio/wav"),
        ("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "full_track", "take.mp3", mp3, "audio/mpeg"),
        ("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "hum", "take.webm", webm, "audio/webm"),
    ]
    with TestClient(create_app(tmp_path / "data")) as client:
        stored: dict[str, dict] = {}
        for session_id, input_type, name, source, content_type in uploads:
            response = client.post(
                "/upload",
                data={"session_id": session_id, "input_type": input_type},
                files={"file": (name, source.read_bytes(), content_type)},
            )
            assert response.status_code == 200
            features = response.json()
            assert features["input_type"] == input_type
            assert features["key"]
            assert features["mode"] in {"major", "minor"}
            assert isinstance(features["bpm"], int | float) and features["bpm"] > 0
            assert features["path"].endswith(".wav")
            assert _seconds(Path(features["path"])) == pytest.approx(5, abs=0.05)
            stored[session_id] = features

        _render_with_intent(client, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", stored["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"], "reshape this", "transform")
        _render_with_intent(client, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", stored["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], "continue this", "extend")
        _render_with_intent(client, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", stored["cccccccc-cccc-4ccc-8ccc-cccccccccccc"], "build around it", "accompany")


def _render_with_intent(client: TestClient, session_id: str, features: dict, text: str, intent: str) -> None:
    turn = client.post(
        "/turn",
        json={
            "session_id": session_id,
            "text": text,
            "output": ["drums"],
            "audio_features": features,
            "answer": {"slot": "mood", "action": "skip_all"},
        },
    )
    assert turn.status_code == 200
    assert turn.json()["brief"]["audio_intent"] == intent
    written = client.post("/turn", json={"session_id": session_id, "write_prompts": True})
    assert written.json()["status"] == "ready"
    rendered = client.post("/render", json={"session_id": session_id})
    assert rendered.status_code == 200
    debug = client.get(f"/debug/{session_id}")
    assert debug.status_code == 200
    body = debug.json()
    dumped = json.dumps(body)
    assert "STABILITY_API_KEY" not in dumped
    assert "Authorization" not in dumped
    assert body["upload"]["path"] == features["path"]
    assert body["upload"]["features"]["key"] == features["key"]
    jobs = body["jobs"]
    assert jobs
    if intent in {"transform", "extend"}:
        assert {job["init_audio"] for job in jobs} == {features["path"]}
        if intent == "transform":
            assert {job["noise"] for job in jobs} == {0.5}
    else:
        assert {job["init_audio"] for job in jobs} == {None}


def test_a_stated_progression_is_the_chords_source_audio(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "data")) as client:
        client.post(
            "/turn",
            json={
                "session_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                "text": "105bpm, C, Am, F, G",
                "output": ["chords"],
                "answer": {"slot": "mood", "action": "skip_all"},
            },
        )
        written = client.post("/turn", json={"session_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "write_prompts": True})
        assert written.json()["progression"]["chords"] == ["C", "Am", "F", "G"]
        rendered = client.post("/render", json={"session_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"})
        assert rendered.status_code == 200
        debug = client.get("/debug/dddddddd-dddd-4ddd-8ddd-dddddddddddd").json()
        sources = {job["init_audio"] for job in debug["jobs"]}
        assert len(sources) == 1
        pinned = Path(next(iter(sources)))
        assert pinned.is_file()
        assert "pinned" in pinned.name


def test_stability_falls_back_to_the_mock_when_the_endpoint_is_blank(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("STABILITY_TEXT_URL", "STABILITY_AUDIO_URL", "STABILITY_API_KEY"):
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("RENDERER", "stability_api")
    app = create_app(tmp_path / "data")
    assert isinstance(app.state.renderer, StabilityAPIRenderer)
    with TestClient(app) as client:
        client.post(
            "/turn",
            json={
                "session_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                "text": "a calm pad",
                "output": ["drums"],
                "answer": {"slot": "mood", "action": "skip_all"},
            },
        )
        client.post("/turn", json={"session_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "write_prompts": True})
        rendered = client.post("/render", json={"session_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"})
        assert rendered.status_code == 200
        assert rendered.json()[0]["path"].endswith(".wav")
        debug = client.get("/debug/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee").json()
        assert any("mock renderer" in note for note in debug["notes"])
        assert "api_key" not in json.dumps(debug)
