"""Schema and repository tests against SQLite."""

from __future__ import annotations

from pathlib import Path

from api.db.engine import reset_engine, session_scope
from api.db.models import Base
from api.db.repo import Repository
from sqlalchemy import create_engine, inspect


def test_models_create_every_production_table(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'schema.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    names = set(inspect(engine).get_table_names())
    assert names == {
        "users",
        "sessions",
        "ideas",
        "renders",
        "exercises",
        "attempts",
        "analyses",
        "jobs",
        "usage",
    }
    engine.dispose()


def test_repository_round_trips_an_idea(tmp_path: Path) -> None:
    reset_engine()
    url = f"sqlite:///{tmp_path / 'repo.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()

    with session_scope(url) as session:
        repo = Repository(session)
        repo.upsert_user("user_1", "a@example.com")
        repo.upsert_session("11111111-1111-4111-8111-111111111111", user_id="user_1")
        idea = repo.save_idea(
            user_id="user_1",
            session_id="11111111-1111-4111-8111-111111111111",
            title="Rainy night",
            brief={"slots": {}},
            prompts=[],
            selected_layers=["drums"],
        )
        assert idea.title == "Rainy night"
        listed = repo.list_ideas("user_1")
        assert len(listed) == 1
        assert listed[0].id == idea.id
    reset_engine()


def test_alembic_revision_names_the_core_tables() -> None:
    text = Path(__file__).resolve().parents[1].joinpath("alembic/versions/001_initial_schema.py").read_text()
    for table in ("users", "sessions", "ideas", "renders", "exercises", "attempts", "analyses", "jobs", "usage"):
        assert f'"{table}"' in text or f"'{table}'" in text
