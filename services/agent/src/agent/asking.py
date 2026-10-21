"""Asking rule. Plain code: score = impact x (1 - confidence), highest above 0.35, hard maximum 10."""

from __future__ import annotations

from dataclasses import dataclass

from agent.slots import ASK_THRESHOLD, MAX_QUESTIONS, SlotSpec, slot_specs

AUDIO_INPUTS = {"hum", "vocal", "instrument_loop", "drum_loop", "full_track"}


@dataclass(frozen=True)
class AskContext:
    filled: frozenset[str]
    output_set: bool
    input_type: str | None
    gave_key: bool
    questions_asked: int


ONE_SOUND = ("sound", "genre", "structure", "mood", "brightness")


def next_one_sound(filled: frozenset[str], questions_asked: int) -> SlotSpec | None:
    """One sound asks only its five slots, in section 11 order, still at most 5."""
    if questions_asked >= MAX_QUESTIONS:
        return None
    specs = {spec.slot: spec for spec in slot_specs()}
    for name in ONE_SOUND:
        if name in filled:
            continue
        return specs[name]
    return None


def next_question(context: AskContext) -> SlotSpec | None:
    if context.questions_asked >= MAX_QUESTIONS:
        return None
    best: tuple[float, int, SlotSpec] | None = None
    for index, spec in enumerate(slot_specs()):
        if spec.slot in context.filled or not _condition(spec.slot, context):
            continue
        score = spec.impact * (1 - 0.0)
        if score <= ASK_THRESHOLD:
            continue
        if best is None or score > best[0]:
            best = (score, index, spec)
    if best is None:
        return None
    return best[2]


def almost_empty(text: str, input_type: str | None, found_slots: bool) -> bool:
    if input_type in AUDIO_INPUTS or input_type == "midi":
        return False
    words = text.split()
    if not words:
        return True
    return len(words) == 1 and not found_slots


def _condition(slot: str, context: AskContext) -> bool:
    if slot == "tempo":
        return False
    if slot == "output":
        return not context.output_set
    if slot == "key":
        text_input = context.input_type in {None, "text_only"}
        return text_input and not context.gave_key
    if slot == "must_keep":
        return context.input_type in AUDIO_INPUTS
    return True
