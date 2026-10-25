"""Repositories for production tables."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from api.db.models import Attempt, Exercise, Idea, Job, Render, SessionRow, Usage, User


def _id() -> str:
    return str(uuid.uuid4())


class Repository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def upsert_user(self, user_id: str, email: str, plan: str = "free") -> User:
        row = self.session.get(User, user_id)
        if row is None:
            row = User(id=user_id, email=email, plan=plan)
            self.session.add(row)
        else:
            row.email = email
            if plan:
                row.plan = plan
        self.session.flush()
        return row

    def get_user(self, user_id: str) -> User | None:
        return self.session.get(User, user_id)

    def upsert_session(
        self,
        session_id: str,
        *,
        user_id: str | None = None,
        brief: dict[str, Any] | None = None,
        mode: str = "full",
        status: str = "idle",
    ) -> SessionRow:
        row = self.session.get(SessionRow, session_id)
        if row is None:
            row = SessionRow(
                id=session_id,
                user_id=user_id,
                brief=brief or {},
                mode=mode,
                status=status,
            )
            self.session.add(row)
        else:
            if user_id is not None:
                row.user_id = user_id
            if brief is not None:
                row.brief = brief
            row.mode = mode
            row.status = status
            row.updated_at = datetime.now(timezone.utc)
        self.session.flush()
        return row

    def save_idea(
        self,
        *,
        user_id: str,
        session_id: str,
        title: str,
        brief: dict[str, Any],
        prompts: list[Any],
        selected_layers: list[Any],
        idea_id: str | None = None,
    ) -> Idea:
        existing = None
        if idea_id:
            existing = self.session.get(Idea, idea_id)
        if existing is None:
            existing = self.session.scalar(
                select(Idea).where(Idea.user_id == user_id, Idea.session_id == session_id)
            )
        if existing is None:
            existing = Idea(
                id=idea_id or _id(),
                user_id=user_id,
                session_id=session_id,
                title=title,
                brief=brief,
                prompts=prompts,
                selected_layers=selected_layers,
            )
            self.session.add(existing)
        else:
            existing.title = title
            existing.brief = brief
            existing.prompts = prompts
            existing.selected_layers = selected_layers
            existing.updated_at = datetime.now(timezone.utc)
        self.session.flush()
        return existing

    def list_ideas(self, user_id: str, limit: int = 20) -> list[Idea]:
        return list(
            self.session.scalars(
                select(Idea).where(Idea.user_id == user_id).order_by(Idea.updated_at.desc()).limit(limit)
            )
        )

    def delete_idea(self, user_id: str, idea_id: str) -> bool:
        row = self.session.get(Idea, idea_id)
        if row is None or row.user_id != user_id:
            return False
        self.session.delete(row)
        self.session.flush()
        return True

    def create_job(
        self,
        *,
        kind: str,
        payload: dict[str, Any],
        user_id: str | None = None,
        job_id: str | None = None,
    ) -> Job:
        row = Job(id=job_id or _id(), user_id=user_id, kind=kind, status="queued", progress=0, payload=payload)
        self.session.add(row)
        self.session.flush()
        return row

    def get_job(self, job_id: str) -> Job | None:
        return self.session.get(Job, job_id)

    def update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        error: str | None = None,
        cost_cents: int | None = None,
        finished: bool = False,
    ) -> Job | None:
        row = self.session.get(Job, job_id)
        if row is None:
            return None
        if status is not None:
            row.status = status
        if progress is not None:
            row.progress = progress
        if error is not None:
            row.error = error
        if cost_cents is not None:
            row.cost_cents = cost_cents
        if finished:
            row.finished_at = datetime.now(timezone.utc)
        self.session.flush()
        return row

    def add_render(
        self,
        *,
        session_id: str,
        object_key: str,
        layer: str,
        variant: int = 1,
        take: int = 1,
        bpm: int = 0,
        seconds: float = 0.0,
        job_id: str | None = None,
        render_id: str | None = None,
    ) -> Render:
        row = Render(
            id=render_id or _id(),
            session_id=session_id,
            job_id=job_id,
            layer=layer,
            variant=variant,
            take=take,
            object_key=object_key,
            bpm=bpm,
            seconds=seconds,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def list_renders(self, session_id: str) -> list[Render]:
        return list(self.session.scalars(select(Render).where(Render.session_id == session_id)))

    def save_exercise(
        self,
        *,
        category: str,
        level: str,
        template_id: str = "",
        setup: dict[str, Any] | None = None,
        user_id: str | None = None,
        audio_key: str | None = None,
        midi_key: str | None = None,
        exercise_id: str | None = None,
    ) -> Exercise:
        row = Exercise(
            id=exercise_id or _id(),
            user_id=user_id,
            category=category,
            level=level,
            template_id=template_id,
            setup=setup or {},
            audio_key=audio_key,
            midi_key=midi_key,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def add_attempt(
        self,
        *,
        exercise_id: str,
        feedback: dict[str, Any],
        stars: int = 0,
        upload_key: str | None = None,
        attempt_id: str | None = None,
    ) -> Attempt:
        row = Attempt(
            id=attempt_id or _id(),
            exercise_id=exercise_id,
            upload_key=upload_key,
            feedback=feedback,
            stars=stars,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def list_attempts_for_user(self, user_id: str) -> list[Attempt]:
        return list(
            self.session.scalars(
                select(Attempt)
                .join(Exercise)
                .where(Exercise.user_id == user_id)
                .order_by(Attempt.created_at.desc())
            )
        )

    def record_usage(
        self,
        *,
        user_id: str,
        kind: str,
        units: int = 1,
        cost_cents: int = 0,
        job_id: str | None = None,
        usage_id: str | None = None,
    ) -> Usage:
        row = Usage(
            id=usage_id or _id(),
            user_id=user_id,
            job_id=job_id,
            kind=kind,
            units=units,
            cost_cents=cost_cents,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def usage_units_since(self, user_id: str, kind: str, since: datetime) -> int:
        rows = self.session.scalars(
            select(Usage).where(Usage.user_id == user_id, Usage.kind == kind, Usage.created_at >= since)
        )
        return sum(row.units for row in rows)
