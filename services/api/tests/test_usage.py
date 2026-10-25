"""Usage limits and cost tracking."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from api.db.engine import reset_engine, session_scope
from api.db.models import Base
from api.db.repo import Repository
from api.main import create_app
from api.usage import assert_within_quota, cost_for, plan_for
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine


@pytest.fixture()
def db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    reset_engine()
    url = f"sqlite:///{tmp_path / 'usage.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("USAGE_LIMITS", "1")
    monkeypatch.setenv("AUTH_TEST_SECRET", "test-secret-at-least-thirty-two-chars")
    yield url
    reset_engine()


def test_free_plan_has_lower_render_cap_than_pro() -> None:
    assert plan_for("free").renders_per_day < plan_for("pro").renders_per_day
    assert cost_for("render") > 0


def test_quota_blocks_when_daily_limit_is_hit(db_url: str) -> None:
    with session_scope(db_url) as session:
        repo = Repository(session)
        repo.upsert_user("user_q", "q@example.com", plan="free")
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        for _ in range(plan_for("free").renders_per_day):
            repo.record_usage(user_id="user_q", kind="render", units=1, cost_cents=8)
        # Force created_at into the window by touching rows is unnecessary; insert is now.
        assert repo.usage_units_since("user_q", "render", since) >= plan_for("free").renders_per_day
    with pytest.raises(HTTPException) as raised:
        assert_within_quota("user_q", "render", "free")
    assert raised.value.status_code == 429


def test_job_endpoint_records_cost(db_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_REQUIRED", "0")
    token = jwt.encode(
        {"sub": "user_cost", "email": "c@example.com"},
        "test-secret-at-least-thirty-two-chars",
        algorithm="HS256",
    )
    with session_scope(db_url) as session:
        Repository(session).upsert_user("user_cost", "c@example.com")
    with TestClient(create_app(tmp_path / "data")) as client:
        response = client.post(
            "/jobs",
            headers={"Authorization": f"Bearer {token}"},
            json={"kind": "analyse", "payload": {"source_key": "a.wav"}},
        )
        assert response.status_code == 200
        assert response.json()["cost_cents"] == cost_for("analyse")
