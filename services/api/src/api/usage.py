"""Per-plan quotas and estimated cost per job."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from api.db.engine import database_url, session_scope
from api.db.repo import Repository


@dataclass(frozen=True)
class PlanLimits:
    name: str
    renders_per_day: int
    turns_per_day: int
    analyse_per_day: int


PLANS: dict[str, PlanLimits] = {
    "free": PlanLimits(name="free", renders_per_day=10, turns_per_day=40, analyse_per_day=5),
    "pro": PlanLimits(name="pro", renders_per_day=200, turns_per_day=500, analyse_per_day=100),
}

# Tentative unit costs in cents for tracking (not billed yet).
COST_CENTS = {
    "render": 8,
    "analyse": 5,
    "train_reference": 6,
    "train_grade": 3,
    "turn": 1,
}


def plan_for(name: str | None) -> PlanLimits:
    return PLANS.get((name or "free").lower(), PLANS["free"])


def cost_for(kind: str, units: int = 1) -> int:
    return COST_CENTS.get(kind, 1) * max(1, units)


def usage_enabled() -> bool:
    return bool(database_url()) and (os.environ.get("USAGE_LIMITS") or "1") not in {"0", "false", "no"}


def assert_within_quota(user_id: str | None, kind: str, plan_name: str | None = "free") -> None:
    if not user_id or not usage_enabled():
        return
    plan = plan_for(plan_name)
    limit = {
        "render": plan.renders_per_day,
        "analyse": plan.analyse_per_day,
        "train_reference": plan.renders_per_day,
        "train_grade": plan.renders_per_day,
        "turn": plan.turns_per_day,
    }.get(kind)
    if limit is None:
        return
    since = datetime.now(timezone.utc) - timedelta(days=1)
    with session_scope() as session:
        used = Repository(session).usage_units_since(user_id, kind, since)
    if used >= limit:
        raise HTTPException(
            429,
            f"Daily {kind} limit reached on the {plan.name} plan. Try again tomorrow or upgrade.",
        )


def record_job_usage(user_id: str | None, kind: str, job_id: str | None = None, units: int = 1) -> int:
    cents = cost_for(kind, units)
    if not user_id or not database_url():
        return cents
    try:
        with session_scope() as session:
            Repository(session).record_usage(
                user_id=user_id,
                kind=kind,
                units=units,
                cost_cents=cents,
                job_id=job_id,
            )
            if job_id:
                Repository(session).update_job(job_id, cost_cents=cents)
    except Exception:
        return cents
    return cents
