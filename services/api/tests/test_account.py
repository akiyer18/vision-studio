"""Account import and ideas persistence."""

from __future__ import annotations

from pathlib import Path

import jwt
import pytest
from api.db.engine import reset_engine
from api.db.models import Base
from api.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine


@pytest.fixture()
def db_app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    reset_engine()
    url = f"sqlite:///{tmp_path / 'account.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("AUTH_TEST_SECRET", "test-secret-at-least-thirty-two-chars")
    monkeypatch.setenv("AUTH_REQUIRED", "0")
    app = create_app(tmp_path / "data")
    yield app
    reset_engine()


def _token(sub: str = "user_1") -> str:
    return jwt.encode(
        {"sub": sub, "email": f"{sub}@example.com"},
        "test-secret-at-least-thirty-two-chars",
        algorithm="HS256",
    )


def test_import_moves_local_ideas_and_train(db_app) -> None:
    headers = {"Authorization": f"Bearer {_token()}"}
    with TestClient(db_app) as client:
        response = client.post(
            "/me/import",
            headers=headers,
            json={
                "ideas": [
                    {
                        "id": "idea-1",
                        "session_id": "11111111-1111-4111-8111-111111111111",
                        "title": "Rain",
                        "brief": {"slots": {}},
                        "prompts": [],
                        "selected_layers": ["drums"],
                        "renders": [{"layer": "drums", "variant": 1, "path": "sessions/x/drums.wav", "seconds": 8, "bpm": 100}],
                    }
                ],
                "train": [
                    {
                        "template_id": "rhythm-drums-beginner",
                        "category": "rhythm",
                        "level": "beginner",
                        "stars": 3,
                        "date": "2026-10-25",
                        "next": "Try fills",
                    }
                ],
            },
        )
        assert response.status_code == 200
        assert response.json() == {"ideas": 1, "train": 1}
        ideas = client.get("/me/ideas", headers=headers)
        assert ideas.status_code == 200
        assert ideas.json()["ideas"][0]["title"] == "Rain"
        progress = client.get("/me/train-progress", headers=headers)
        assert progress.status_code == 200
        assert progress.json()["records"][0]["template_id"] == "rhythm-drums-beginner"
