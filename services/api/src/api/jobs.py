"""Inline and Redis job queues with progress stored in memory or Postgres."""

from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

QUEUE_KEY = "vision:jobs"

Handler = Callable[[dict[str, Any], Callable[[int, str | None], None]], dict[str, Any]]


@dataclass
class JobState:
    id: str
    kind: str
    status: str = "queued"
    progress: int = 0
    payload: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    cost_cents: int = 0
    user_id: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_at: str | None = None


_lock = threading.Lock()
_jobs: dict[str, JobState] = {}
_handlers: dict[str, Handler] = {}


def queue_mode() -> str:
    return (os.environ.get("QUEUE") or "inline").strip().lower()


def redis_url() -> str | None:
    return os.environ.get("REDIS_URL") or None


def register_handler(kind: str, handler: Handler) -> None:
    _handlers[kind] = handler


def get_handler(kind: str) -> Handler | None:
    return _handlers.get(kind)


def create_job(kind: str, payload: dict[str, Any], user_id: str | None = None) -> JobState:
    job = JobState(id=str(uuid.uuid4()), kind=kind, payload=payload, user_id=user_id)
    with _lock:
        _jobs[job.id] = job
    _persist_create(job)
    return job


def get_job(job_id: str) -> JobState | None:
    with _lock:
        found = _jobs.get(job_id)
        if found is not None:
            return found
    return _persist_get(job_id)


def update_job(
    job_id: str,
    *,
    status: str | None = None,
    progress: int | None = None,
    error: str | None = None,
    result: dict[str, Any] | None = None,
    cost_cents: int | None = None,
    finished: bool = False,
) -> JobState | None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            job = _persist_get(job_id)
            if job is None:
                return None
            _jobs[job_id] = job
        if status is not None:
            job.status = status
        if progress is not None:
            job.progress = max(0, min(100, progress))
        if error is not None:
            job.error = error
        if result is not None:
            job.result = result
        if cost_cents is not None:
            job.cost_cents = cost_cents
        if finished:
            job.finished_at = datetime.now(timezone.utc).isoformat()
        snapshot = JobState(**job.__dict__)
    _persist_update(snapshot, finished=finished)
    return snapshot


def enqueue(job: JobState) -> JobState:
    if queue_mode() == "redis":
        url = redis_url()
        if not url:
            raise RuntimeError("REDIS_URL is required when QUEUE=redis")
        import redis

        client = redis.Redis.from_url(url, decode_responses=True)
        client.rpush(QUEUE_KEY, json.dumps({"id": job.id, "kind": job.kind}))
        return job
    return run_job(job.id)


def run_job(job_id: str) -> JobState:
    job = get_job(job_id)
    if job is None:
        raise KeyError(job_id)
    handler = get_handler(job.kind)
    if handler is None:
        update_job(job_id, status="failed", error=f"No handler for {job.kind}", finished=True)
        found = get_job(job_id)
        assert found is not None
        return found

    def report(progress: int, status: str | None = "running") -> None:
        update_job(job_id, status=status, progress=progress)

    update_job(job_id, status="running", progress=1)
    try:
        result = handler(job.payload, report)
        update_job(job_id, status="done", progress=100, result=result or {}, finished=True)
    except Exception as error:  # noqa: BLE001 — surface to the job row
        update_job(job_id, status="failed", error=str(error), finished=True)
    found = get_job(job_id)
    assert found is not None
    return found


def claim_next() -> str | None:
    url = redis_url()
    if not url:
        return None
    import redis

    client = redis.Redis.from_url(url, decode_responses=True)
    raw = client.blpop(QUEUE_KEY, timeout=2)
    if raw is None:
        return None
    _, payload = raw
    data = json.loads(payload)
    return str(data["id"])


def job_public(job: JobState) -> dict[str, Any]:
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "result": job.result,
        "cost_cents": job.cost_cents,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
    }


def reset_jobs() -> None:
    with _lock:
        _jobs.clear()


def _persist_create(job: JobState) -> None:
    if not os.environ.get("DATABASE_URL"):
        return
    try:
        from api.db.engine import session_scope
        from api.db.repo import Repository

        with session_scope() as session:
            Repository(session).create_job(
                kind=job.kind,
                payload=job.payload,
                user_id=job.user_id,
                job_id=job.id,
            )
    except Exception:
        return


def _persist_update(job: JobState, *, finished: bool) -> None:
    if not os.environ.get("DATABASE_URL"):
        return
    try:
        from api.db.engine import session_scope
        from api.db.repo import Repository

        with session_scope() as session:
            Repository(session).update_job(
                job.id,
                status=job.status,
                progress=job.progress,
                error=job.error,
                cost_cents=job.cost_cents,
                finished=finished,
            )
    except Exception:
        return


def _persist_get(job_id: str) -> JobState | None:
    if not os.environ.get("DATABASE_URL"):
        return None
    try:
        from api.db.engine import session_scope
        from api.db.repo import Repository

        with session_scope() as session:
            row = Repository(session).get_job(job_id)
            if row is None:
                return None
            return JobState(
                id=row.id,
                kind=row.kind,
                status=row.status,
                progress=row.progress,
                payload=dict(row.payload or {}),
                error=row.error,
                cost_cents=row.cost_cents,
                user_id=row.user_id,
                created_at=row.created_at.isoformat() if row.created_at else "",
                finished_at=row.finished_at.isoformat() if row.finished_at else None,
            )
    except Exception:
        return None
