"""Four short feedback sections. A cited bar or beat has to be in the comparison."""

from __future__ import annotations

import json
import re
from collections.abc import Callable

from agent.exercises import Exercise, exercise_to_dict

_SECTIONS = ("right", "differs", "improve", "next")
_BEAT_OF = re.compile(r"\bbeat\s+(\d+)\s+of\s+bar\s+(\d+)\b", re.IGNORECASE)
_BAR_BEAT = re.compile(r"\bbar\s+(\d+)\s+beat\s+(\d+)\b", re.IGNORECASE)
_BAR = re.compile(r"\bbar\s+(\d+)\b", re.IGNORECASE)
_BEAT = re.compile(r"\bbeat\s+(\d+)\b", re.IGNORECASE)
_FOCUS = {
    "hits": "Focus on where the kick and snare sit.",
    "velocity": "Focus on accents and on the quiet notes.",
    "ghosts": "Focus on the quiet snare notes around the backbeat.",
    "bass": "Focus on the bass pitches and where they start.",
    "rests": "Focus on the gaps in the bass line.",
    "octaves": "Focus on when the bass changes octave.",
    "progression": "Focus on naming the chord of each bar before the voicing.",
    "voicing": "Focus on the lowest note of each chord and how the voices move.",
    "extensions": "Focus on the added 7ths and 9ths.",
}
_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["right", "differs", "improve", "next"],
    "properties": {
        "right": {"type": "string"},
        "differs": {"type": "string"},
        "improve": {"type": "string"},
        "next": {"type": "string"},
    },
}
_SYSTEM = (
    "You write training feedback for Vision Studio. You are a helper, not the author. "
    "The user message is a comparison result and an exercise definition. "
    "Write four short sections: what the player got right, what differs, how to improve, "
    "and what to focus on next. Mention only bars, beats, and events that appear in "
    "matches, differences, or missing. Do not mention an event from the uncertain list "
    "as a fact. If approximate is true, say the reading is an estimate. Do not invent a bar or a beat."
)


def write_feedback(
    result: dict[str, object],
    exercise: Exercise,
    complete: Callable[[dict[str, object], Exercise], dict[str, object]] | None = None,
) -> dict[str, object]:
    draft = template_feedback(result, exercise)
    stars = stars_from(result.get("scores") if isinstance(result.get("scores"), dict) else {})
    chosen = draft
    source = "template"
    if complete is not None:
        try:
            raw = complete(result, exercise)
            sections = {key: str(raw[key]).strip() for key in _SECTIONS}
        except Exception:
            sections = {}
        if sections and all(sections.values()) and grounded(sections, result):
            chosen = sections
            source = "claude"
    return {**chosen, "stars": stars, "source": source}


def template_feedback(result: dict[str, object], exercise: Exercise) -> dict[str, str]:
    matches = _facts(result.get("matches"))
    differences = _facts(result.get("differences"))
    missing = _facts(result.get("missing"))
    if matches:
        right = "You matched " + _join([_phrase(item) for item in matches[:3]]) + "."
    else:
        right = "The comparison did not record a clear match yet."
    if result.get("approximate"):
        right = "This reading is an estimate from the audio. " + right
    bits = [f"{_phrase(item)} is missing" for item in missing[:3]]
    bits += [f"{_phrase(item)} differs" for item in differences[:3]]
    differs = _join(bits).capitalize() + "." if bits else "Nothing in the comparison is marked as different."
    if result.get("uncertain"):
        differs += " Some of the audio was unclear, so those events are not listed as facts."
    if missing:
        improve = f"Loop the reference and match {_phrase(missing[0])} before changing anything else."
    elif differences:
        improve = f"Loop the reference and listen again to {_phrase(differences[0])}."
    else:
        improve = "Play it again at the exercise tempo and keep the same placement."
    return {"right": right, "differs": differs, "improve": improve, "next": _focus(result, exercise)}


def grounded(sections: dict[str, str], result: dict[str, object]) -> bool:
    text = " ".join(str(sections.get(key, "")) for key in _SECTIONS)
    bars, pairs = _places(result)
    for match in _BEAT_OF.finditer(text):
        if (int(match.group(2)), int(match.group(1))) not in pairs:
            return False
    for match in _BAR_BEAT.finditer(text):
        if (int(match.group(1)), int(match.group(2))) not in pairs:
            return False
    stripped = _BAR_BEAT.sub(" ", _BEAT_OF.sub(" ", text))
    for match in _BAR.finditer(stripped):
        if int(match.group(1)) not in bars:
            return False
    for match in _BEAT.finditer(stripped):
        if not any(beat == int(match.group(1)) for _, beat in pairs):
            return False
    return True


def stars_from(scores: dict[str, object]) -> int:
    values = [float(value) for value in scores.values() if isinstance(value, (int, float))]
    if not values:
        return 1
    mean = sum(values) / len(values)
    if mean >= 0.85:
        return 3
    if mean >= 0.55:
        return 2
    return 1


def feedback_payload(result: dict[str, object], exercise: Exercise) -> dict[str, object]:
    from agent.bedrock import BedrockProvider, _converse

    kept = {
        key: result.get(key)
        for key in (
            "source",
            "approximate",
            "matches",
            "differences",
            "missing",
            "uncertain",
            "scores",
            "progression_correct",
            "voicing_similarity",
        )
    }
    message = json.dumps({"exercise": exercise_to_dict(exercise), "result": kept})
    return _converse(
        BedrockProvider(),
        name="training_feedback",
        description="Four short feedback sections grounded in the comparison.",
        schema=_SCHEMA,
        system=_SYSTEM,
        message=message,
        max_tokens=500,
    )


def _places(result: dict[str, object]) -> tuple[set[int], set[tuple[int, int]]]:
    bars: set[int] = set()
    pairs: set[tuple[int, int]] = set()
    for key in ("matches", "differences", "missing"):
        for item in _facts(result.get(key)):
            bar = int(item["bar"])
            beat = int(item["beat"])
            bars.add(bar)
            pairs.add((bar, beat))
    return bars, pairs


def _facts(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict) and "bar" in item and "beat" in item]


def _phrase(item: dict[str, object]) -> str:
    return f"the {item['what']} on beat {item['beat']} of bar {item['bar']}"


def _focus(result: dict[str, object], exercise: Exercise) -> str:
    scores = result.get("scores")
    if not isinstance(scores, dict) or not scores:
        return "Repeat the exercise and listen for the downbeat."
    ordered = [name for name in _FOCUS if name in scores]
    if not ordered:
        return "Repeat the same exercise and listen once more before moving on."
    lowest = min(ordered, key=lambda name: float(scores[name]))
    if exercise.category == "harmony" and lowest in {"hits", "velocity", "ghosts"}:
        lowest = "progression"
    return _FOCUS[lowest]


def _join(items: list[str]) -> str:
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]
