"""Auth token tests."""

from __future__ import annotations

from pathlib import Path

import jwt
import pytest
from api.auth import verify_token
from api.main import create_app
from fastapi.testclient import TestClient


def test_hs256_test_secret_verifies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_TEST_SECRET", "test-secret-at-least-thirty-two-chars")
    token = jwt.encode(
        {"sub": "user_abc", "email": "a@example.com"},
        "test-secret-at-least-thirty-two-chars",
        algorithm="HS256",
    )
    user = verify_token(token)
    assert user.id == "user_abc"
    assert user.email == "a@example.com"


def test_me_endpoint_returns_guest_without_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_REQUIRED", "0")
    with TestClient(create_app(tmp_path / "data")) as client:
        response = client.get("/me")
        assert response.status_code == 200
        assert response.json()["user"] is None


def test_me_endpoint_returns_signed_in_user(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_TEST_SECRET", "test-secret-at-least-thirty-two-chars")
    monkeypatch.setenv("AUTH_REQUIRED", "0")
    token = jwt.encode(
        {"sub": "user_1", "email": "u@example.com"},
        "test-secret-at-least-thirty-two-chars",
        algorithm="HS256",
    )
    with TestClient(create_app(tmp_path / "data")) as client:
        response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        body = response.json()
        assert body["user"]["id"] == "user_1"
        assert body["user"]["email"] == "u@example.com"


def test_auth_required_rejects_anonymous(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    with TestClient(create_app(tmp_path / "data")) as client:
        response = client.get("/me")
        assert response.status_code == 401
