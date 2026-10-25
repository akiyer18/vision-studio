"""Session, upload, and boot checks. Happy-path rendering stays in the other API tests."""

import os
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from api.audio import SR, sniff, write_wav
from api.guard import RateLimiter, assert_frontend_clean, cleanup_old_sessions, content_too_large
from api.main import create_app

SESSION = "99999999-9999-4999-8999-999999999999"


def test_sniff_reads_magic_bytes() -> None:
    assert sniff(b"RIFF" + b"\x00\x00\x00\x00" + b"WAVE") == "wav"
    assert sniff(b"ID3more") == "mp3"
    assert sniff(b"\xff\xfbrest") == "mp3"
    assert sniff(b"xxxxftypisom") == "m4a"
    assert sniff(b"FORM" + b"\x00\x00\x00\x00" + b"AIFF") == "aiff"
    assert sniff(b"\x1a\x45\xdf\xa3rest") == "webm"
    assert sniff(b"MThd") == "mid"
    assert sniff(b"OggS") is None


def test_a_long_recording_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("api.audio.MAX_SECONDS", 0)
    wav = tmp_path / "tone.wav"
    write_wav(wav, np.zeros((SR, 2)))
    with TestClient(create_app(tmp_path / "data")) as client:
        response = client.post(
            "/upload",
            data={"session_id": SESSION, "input_type": "instrument_loop"},
            files={"file": ("tone.wav", wav.read_bytes(), "audio/wav")},
        )
    assert response.status_code == 422
    assert response.json()["detail"] == "That recording is longer than 5 minutes."
    assert list((tmp_path / "data" / "sessions").rglob("*.wav")) == []


def test_extension_must_match_the_bytes(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "data")) as client:
        response = client.post(
            "/upload",
            data={"session_id": SESSION, "input_type": "instrument_loop"},
            files={"file": ("song.wav", b"not-a-wav", "audio/wav")},
        )
    assert response.status_code == 415


def test_session_ids_are_uuids_and_paths_stay_in_the_session(tmp_path: Path) -> None:
    outside = tmp_path / "data" / "secret.txt"
    outside.parent.mkdir(parents=True)
    outside.write_text("nope")
    with TestClient(create_app(tmp_path / "data")) as client:
        rejected = client.post("/turn", json={"session_id": "not-a-uuid", "text": "hi"})
        assert rejected.status_code == 400
        missing = client.get(
            f"/files/{SESSION}/renders/../../secret.txt",
            headers={"Origin": "http://localhost:5173"},
        )
        assert missing.status_code in {400, 404}
        assert b"nope" not in missing.content


def test_old_session_folders_are_removed(tmp_path: Path) -> None:
    root = tmp_path / "data"
    old = root / "sessions" / "11111111-1111-4111-8111-111111111111"
    fresh = root / "sessions" / SESSION
    old.mkdir(parents=True)
    fresh.mkdir()
    stale = time.time() - 8 * 86400
    os.utime(old, (stale, stale))
    assert cleanup_old_sessions(root) == 1
    assert not old.exists()
    assert fresh.exists()


def test_rate_limit_and_body_size(tmp_path: Path) -> None:
    assert content_too_large(str(53 * 1024 * 1024))
    assert not content_too_large(str(1024))
    app = create_app(tmp_path / "data")
    app.state.ip_limit = RateLimiter(limit=2, window=60)
    with TestClient(app) as client:
        body = {"session_id": SESSION, "text": "hi"}
        assert client.post("/turn", json=body).status_code == 200
        assert client.post("/turn", json=body).status_code == 200
        blocked = client.post("/turn", json=body)
        assert blocked.status_code == 429
        assert "Too many requests" in blocked.json()["detail"]


def test_unexpected_errors_hide_details(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_body: object) -> None:
        raise RuntimeError("STABILITY_API_KEY=secret-value")

    monkeypatch.setattr("api.main.run_turn", boom)
    with TestClient(create_app(tmp_path / "data"), raise_server_exceptions=False) as client:
        response = client.post("/turn", json={"session_id": SESSION, "text": "hi"})
    assert response.status_code == 500
    assert response.json()["detail"] == "Something went wrong. Try again."
    assert "secret-value" not in response.text
    assert "STABILITY_API_KEY" not in response.text


def test_boot_refuses_a_secret_in_the_frontend(tmp_path: Path) -> None:
    web = tmp_path / "apps" / "web" / "src"
    web.mkdir(parents=True)
    (web / "leak.ts").write_text("const name = 'STABILITY_API_KEY'\n")
    with pytest.raises(RuntimeError, match="^Refusing to boot: a secret appears in the frontend bundle$"):
        assert_frontend_clean(tmp_path)


def test_boot_refuses_a_vite_secret(tmp_path: Path) -> None:
    web = tmp_path / "apps" / "web" / "src"
    web.mkdir(parents=True)
    (web / "env.ts").write_text("export const key = import.meta.env.VITE_SECRET\n")
    with pytest.raises(RuntimeError, match="frontend bundle"):
        assert_frontend_clean(tmp_path)


def test_boot_allows_the_clerk_publishable_key(tmp_path: Path) -> None:
    web = tmp_path / "apps" / "web" / "src"
    web.mkdir(parents=True)
    (web / "clerk.ts").write_text("export const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY\n")
    assert_frontend_clean(tmp_path)
