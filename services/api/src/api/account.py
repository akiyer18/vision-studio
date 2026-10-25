"""Signed-in ideas, train progress, and localStorage import."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from api.db.engine import database_url, session_scope
from api.db.models import Render
from api.db.repo import Repository


class IdeaPayload(BaseModel):
    id: str
    session_id: str
    title: str = ""
    brief: dict[str, Any] = Field(default_factory=dict)
    prompts: list[Any] = Field(default_factory=list)
    selected_layers: list[Any] = Field(default_factory=list)
    renders: list[Any] = Field(default_factory=list)
    date: str | None = None
    status: str | None = None
    mode: str | None = None
    thread: list[Any] = Field(default_factory=list)
    trace: list[Any] = Field(default_factory=list)


class TrainRecordPayload(BaseModel):
    template_id: str
    category: str
    level: str
    stars: int = 0
    date: str = ""
    next: str = ""
    exercise_id: str | None = None
    feedback: dict[str, Any] = Field(default_factory=dict)


class ImportBody(BaseModel):
    ideas: list[IdeaPayload] = Field(default_factory=list)
    train: list[TrainRecordPayload] = Field(default_factory=list)


def _user_id(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(401, "Sign in to continue")
    return str(user_id)


def _require_db() -> None:
    if not database_url():
        raise HTTPException(503, "Database is not configured")


def register_account(app: FastAPI) -> None:
    @app.get("/me/ideas")
    def list_ideas(request: Request) -> dict[str, object]:
        user_id = _user_id(request)
        _require_db()
        with session_scope() as session:
            rows = Repository(session).list_ideas(user_id)
            return {
                "ideas": [
                    {
                        "id": row.id,
                        "session_id": row.session_id,
                        "title": row.title,
                        "brief": row.brief,
                        "prompts": row.prompts,
                        "selected_layers": row.selected_layers,
                        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                    }
                    for row in rows
                ]
            }

    @app.put("/me/ideas/{idea_id}")
    def put_idea(idea_id: str, body: IdeaPayload, request: Request) -> dict[str, object]:
        user_id = _user_id(request)
        _require_db()
        with session_scope() as session:
            repo = Repository(session)
            repo.upsert_session(body.session_id, user_id=user_id, brief=body.brief, mode=body.mode or "full")
            idea = repo.save_idea(
                user_id=user_id,
                session_id=body.session_id,
                title=body.title,
                brief=body.brief,
                prompts=body.prompts,
                selected_layers=body.selected_layers,
                idea_id=idea_id,
            )
            for index, render in enumerate(body.renders):
                if not isinstance(render, dict):
                    continue
                path = str(render.get("path") or "")
                if not path:
                    continue
                render_id = f"{idea_id}-r{index}"
                if session.get(Render, render_id) is None:
                    repo.add_render(
                        session_id=body.session_id,
                        object_key=path,
                        layer=str(render.get("layer") or "drums"),
                        variant=int(render.get("variant") or 1),
                        bpm=int(render.get("bpm") or 0),
                        seconds=float(render.get("seconds") or 0),
                        render_id=render_id,
                    )
            return {"id": idea.id}

    @app.delete("/me/ideas/{idea_id}")
    def delete_idea(idea_id: str, request: Request) -> dict[str, object]:
        user_id = _user_id(request)
        _require_db()
        with session_scope() as session:
            ok = Repository(session).delete_idea(user_id, idea_id)
            if not ok:
                raise HTTPException(404, "Idea not found")
            return {"ok": True}

    @app.get("/me/train-progress")
    def train_progress(request: Request) -> dict[str, object]:
        user_id = _user_id(request)
        _require_db()
        with session_scope() as session:
            attempts = Repository(session).list_attempts_for_user(user_id)
            records = []
            for attempt in attempts:
                feedback = attempt.feedback or {}
                records.append(
                    {
                        "template_id": feedback.get("template_id") or attempt.exercise.template_id,
                        "category": attempt.exercise.category,
                        "level": attempt.exercise.level,
                        "stars": attempt.stars,
                        "date": attempt.created_at.isoformat() if attempt.created_at else "",
                        "next": feedback.get("next") or "",
                    }
                )
            return {"records": records}

    @app.post("/me/import")
    def import_local(body: ImportBody, request: Request) -> dict[str, object]:
        user_id = _user_id(request)
        _require_db()
        imported_ideas = 0
        imported_train = 0
        with session_scope() as session:
            repo = Repository(session)
            for idea in body.ideas:
                repo.upsert_session(idea.session_id, user_id=user_id, brief=idea.brief, mode=idea.mode or "full")
                repo.save_idea(
                    user_id=user_id,
                    session_id=idea.session_id,
                    title=idea.title,
                    brief=idea.brief,
                    prompts=idea.prompts,
                    selected_layers=idea.selected_layers,
                    idea_id=idea.id,
                )
                imported_ideas += 1
            for record in body.train:
                exercise = repo.save_exercise(
                    category=record.category,
                    level=record.level,
                    template_id=record.template_id,
                    user_id=user_id,
                    exercise_id=record.exercise_id,
                    setup={"imported": True},
                )
                repo.add_attempt(
                    exercise_id=exercise.id,
                    feedback={
                        "template_id": record.template_id,
                        "next": record.next,
                        "date": record.date,
                        **record.feedback,
                    },
                    stars=record.stars,
                )
                imported_train += 1
        return {"ideas": imported_ideas, "train": imported_train}
