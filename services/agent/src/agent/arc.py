"""A from-to idea. The start and the end each become a section prompt."""

from __future__ import annotations

import re
from dataclasses import dataclass

_FROM_TO = re.compile(r"\bfrom\s+(.+?)\s+to\s+(.+?)(?:[.!,]|$)", re.IGNORECASE)

# Words the producer actually used, mapped onto the closed mood, energy, and world labels.
_STATES = {
    "dark": ("tense", "steady", "dark and electronic"),
    "bright": ("joyful", "make people move", "bright and danceable"),
    "sad": ("longing", "slow and breathing", "warm and intimate"),
    "calm": ("peaceful", "slow and breathing", "warm and intimate"),
    "soft": ("peaceful", "slow and breathing", "warm and intimate"),
    "heavy": ("tense", "make people move", "dark and electronic"),
    "light": ("peaceful", "slow and breathing", "wide and cinematic"),
    "tense": ("tense", "steady", "dark and electronic"),
    "peaceful": ("peaceful", "slow and breathing", "warm and intimate"),
    "joyful": ("joyful", "make people move", "bright and danceable"),
    "longing": ("longing", "slow and breathing", "warm and intimate"),
}


@dataclass(frozen=True)
class Motion:
    label: str
    start: str
    end: str
    start_mood: str
    start_energy: str
    start_world: str
    end_mood: str
    end_energy: str
    end_world: str


def detect_arc(text: str) -> Motion | None:
    match = _FROM_TO.search(text)
    if match is None:
        return None
    start = _state(match.group(1))
    end = _state(match.group(2))
    if start is None or end is None:
        return None
    return Motion(
        label=f"{_lead(match.group(1))} to {match.group(2).strip().lower()}",
        start=match.group(1).strip().lower(),
        end=match.group(2).strip().lower(),
        start_mood=start[0],
        start_energy=start[1],
        start_world=start[2],
        end_mood=end[0],
        end_energy=end[1],
        end_world=end[2],
    )


def _state(phrase: str) -> tuple[str, str, str] | None:
    for word in phrase.lower().split():
        found = _STATES.get(word.strip(".,!?"))
        if found is not None:
            return found
    return None


def _lead(phrase: str) -> str:
    word = phrase.strip()
    if not word:
        return word
    return word[:1].upper() + word[1:].lower()
