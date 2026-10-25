"""Object storage adapter tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from api.storage import LocalStore, build_store, content_type_for, session_object_key, storage_mode


def test_local_store_round_trips_bytes(tmp_path: Path) -> None:
    store = LocalStore(root=tmp_path)
    key = session_object_key("11111111-1111-4111-8111-111111111111", "renders/drums.wav")
    store.put_bytes(key, b"RIFF", content_type="audio/wav")
    assert store.exists(key)
    assert store.get_bytes(key) == b"RIFF"
    assert store.local_path(key) is not None
    assert store.signed_url(key).startswith("/files/")


def test_local_store_rejects_path_escape(tmp_path: Path) -> None:
    store = LocalStore(root=tmp_path)
    with pytest.raises(ValueError):
        store.put_bytes("../secret", b"no")


def test_build_store_defaults_to_local(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STORAGE", raising=False)
    store = build_store(tmp_path)
    assert isinstance(store, LocalStore)
    assert storage_mode() == "local"


def test_build_store_requires_s3_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORAGE", "s3")
    monkeypatch.delenv("S3_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("S3_SECRET_ACCESS_KEY", raising=False)
    with pytest.raises(RuntimeError, match="S3_ACCESS_KEY"):
        build_store()


def test_content_type_for_audio_and_midi() -> None:
    assert content_type_for("a.wav") == "audio/wav"
    assert content_type_for("b.mid") == "audio/midi"
    assert content_type_for("c.bin") == "application/octet-stream"
