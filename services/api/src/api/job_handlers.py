"""Default job handlers. Heavy work is a placeholder until render is fully queued."""

from __future__ import annotations

from typing import Any, Callable

Report = Callable[[int, str | None], None]
Register = Callable[[str, Callable[[dict[str, Any], Report], dict[str, Any]]], None]


def register_default_handlers(register: Register) -> None:
    register("render", handle_render)
    register("analyse", handle_analyse)
    register("train_reference", handle_train_reference)
    register("train_grade", handle_train_grade)


def handle_render(payload: dict[str, Any], report: Report) -> dict[str, Any]:
    report(10, "running")
    session_id = str(payload.get("session_id") or "")
    layers = payload.get("layers") or []
    report(50, "running")
    report(90, "running")
    return {"session_id": session_id, "layers": layers, "ok": True}


def handle_analyse(payload: dict[str, Any], report: Report) -> dict[str, Any]:
    report(20, "running")
    report(80, "running")
    return {"source_key": payload.get("source_key"), "ok": True}


def handle_train_reference(payload: dict[str, Any], report: Report) -> dict[str, Any]:
    report(25, "running")
    report(75, "running")
    return {"exercise_id": payload.get("exercise_id"), "ok": True}


def handle_train_grade(payload: dict[str, Any], report: Report) -> dict[str, Any]:
    report(30, "running")
    report(70, "running")
    return {"exercise_id": payload.get("exercise_id"), "ok": True}
