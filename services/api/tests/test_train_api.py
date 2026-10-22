"""Reference rendering and approximate audio comparison."""

from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from agent.exercises import load_exercises
from api.main import create_app
from api.stability import StabilityConfig
from api.train_audio import compare_audio
from api.train_render import render_reference, synthesize, verify


def _ready() -> StabilityConfig:
    return StabilityConfig(
        text_url="http://example.test/text",
        audio_url="http://example.test/audio",
        api_key="secret-key",
        text_fields={"prompt": "prompt", "negative_prompt": "negative_prompt", "duration": "duration", "seed": "seed"},
        audio_fields={
            "prompt": "prompt",
            "negative_prompt": "negative_prompt",
            "duration": "duration",
            "source": "source",
            "noise": "noise",
        },
    )


def test_clean_render_matches_the_midi(tmp_path: Path) -> None:
    exercise = load_exercises()["rhythm-drums-beginner"]
    ok, why = verify(synthesize(exercise), exercise)
    assert ok, why
    harmony = load_exercises()["harmony-beginner"]
    ok, why = verify(synthesize(harmony), harmony)
    assert ok, why

    note = render_reference(exercise, tmp_path, config=StabilityConfig("", "", "", {}, {}))
    assert "clean" in note.lower()
    assert (tmp_path / "reference.mid").stat().st_size > 0
    assert (tmp_path / "clean.wav").read_bytes() == (tmp_path / "reference.wav").read_bytes()


def test_failed_production_pass_keeps_the_clean_render(tmp_path: Path, monkeypatch) -> None:
    exercise = load_exercises()["harmony-beginner"]

    def colour(config, *, source, prompt, duration, noise):
        assert config.api_key == "secret-key"
        assert noise == 0.3
        return np.zeros((1000, 2))

    monkeypatch.setattr("api.train_render.colour_audio", colour)
    note = render_reference(exercise, tmp_path, config=_ready())

    assert "secret-key" not in note
    assert "clean" in note.lower()
    assert (tmp_path / "reference.wav").read_bytes() == (tmp_path / "clean.wav").read_bytes()


def test_audio_submission_is_marked_approximate() -> None:
    exercise = load_exercises()["rhythm-drums-beginner"]
    result = compare_audio(exercise, synthesize(exercise))

    assert result["approximate"] is True
    assert result["source"] == "audio"
    findings = [*result["matches"], *result["differences"], *result["missing"], *result["uncertain"]]
    assert findings
    assert all("confidence" in item and 0 <= item["confidence"] <= 1 for item in findings)


def test_midi_stays_hidden_until_reveal(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PROVIDER", "mock")
    app = create_app(tmp_path / "data")
    with TestClient(app) as client:
        started = client.post(
            "/train/exercise",
            json={"category": "rhythm", "type": "drums", "level": "beginner", "seed": 1},
        )
        assert started.status_code == 200
        body = started.json()
        assert "midi" not in body
        hidden = client.get(f"/train/files/{body['id']}/reference.mid")
        assert hidden.status_code == 404
        revealed = client.post(f"/train/exercise/{body['id']}/reveal")
        assert revealed.status_code == 200
        assert revealed.json()["midi"] == "reference.mid"
        assert "Bar 1" in revealed.json()["built"]
        opened = client.get(f"/train/files/{body['id']}/reference.mid")
        assert opened.status_code == 200
        assert opened.content.startswith(b"MThd")
