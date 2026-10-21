"""Adaptive interviewer. Claude proposes the next question. These checks always win."""

from __future__ import annotations

from dataclasses import dataclass

from agent.asking import ONE_SOUND
from agent.slots import MAX_QUESTIONS, slot_specs

_BLOCKED = {"you", "detected"}


@dataclass(frozen=True)
class NextQuestion:
    slot: str
    text: str
    options: tuple[str, ...]
    reason: str


@dataclass(frozen=True)
class Ready:
    summary: str


def interpret(
    payload: object,
    *,
    sources: dict[str, str],
    questions_asked: int,
    mode: str,
) -> NextQuestion | Ready | str:
    """A question, a ready summary, or a plain-language reason the proposal was refused."""
    if not isinstance(payload, dict):
        return "The interviewer returned nothing usable."
    decision = payload.get("decision")
    if decision == "ready":
        summary = payload.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            return "The interviewer was ready but gave no summary."
        return Ready(summary.strip())
    if decision != "next_question":
        return "The interviewer did not choose a question or say it was ready."
    if questions_asked >= MAX_QUESTIONS:
        return "Did not ask: five questions is the maximum."
    slot = payload.get("slot")
    question = payload.get("question")
    reason = payload.get("reason")
    options = payload.get("options")
    known = {spec.slot: spec for spec in slot_specs()}
    if not isinstance(slot, str) or slot not in known:
        return "Did not ask: that is not a slot."
    if slot == "tempo":
        return "Did not ask tempo."
    if mode == "one_sound" and slot not in ONE_SOUND:
        return f"Did not ask {slot}: one sound only asks its own slots."
    source = sources.get(slot)
    if source in _BLOCKED:
        return f"Did not ask {slot} again: you already said it." if source == "you" else f"Did not ask {slot} again: the audio already set it."
    if not isinstance(question, str) or not question.strip():
        return "Did not ask: the question was empty."
    if not isinstance(reason, str) or not reason.strip():
        return "Did not ask: there was no reason."
    if not isinstance(options, list) or not all(isinstance(item, str) and item.strip() for item in options):
        return f"Rejected the {slot} options: they were not usable labels."
    cleaned = tuple(item.strip() for item in options)
    if not 2 <= len(cleaned) <= 4:
        return f"Rejected the {slot} options: a question needs 2 to 4 choices."
    allowed = set(known[slot].options)
    if allowed:
        invalid = [item for item in cleaned if item not in allowed]
        if invalid:
            names = ", ".join(invalid)
            return f"Rejected the {slot} options: {names} is not a valid label."
    line = reason.strip()
    if not line.lower().startswith("asked"):
        line = f"Asked about {slot.replace('_', ' ')} because {line[0].lower()}{line[1:]}" if len(line) > 1 else f"Asked about {slot.replace('_', ' ')}"
    return NextQuestion(slot, question.strip(), cleaned, line)
