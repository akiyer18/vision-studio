"""A musical journey. The start and the end each become a section prompt."""

from __future__ import annotations

import re
from dataclasses import dataclass

_FROM_TO = re.compile(r"\bfrom\s+(.+?)\s+to\s+(.+?)(?:[.!,]|$)", re.IGNORECASE)
_RELEASE = re.compile(
    r"([^,.]{2,80}?)\s*,\s*release into\s+(.+?)(?:\s+at the end)?\s*(?:[.!,]|$)",
    re.IGNORECASE,
)

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
    "tension": ("tense", "steady", "dark and electronic"),
    "agony": ("tense", "steady", "dark and electronic"),
    "peaceful": ("peaceful", "slow and breathing", "warm and intimate"),
    "joyful": ("joyful", "make people move", "bright and danceable"),
    "positive": ("joyful", "make people move", "bright and danceable"),
    "longing": ("longing", "slow and breathing", "warm and intimate"),
    "breath": ("peaceful", "slow and breathing", "warm and intimate"),
}


@dataclass(frozen=True)
class Motion:
    label: str
    start: str
    end: str
    description: str
    start_mood: str
    start_energy: str
    start_world: str
    end_mood: str
    end_energy: str
    end_world: str


def detect_arc(text: str) -> Motion | None:
    match = _FROM_TO.search(text)
    if match is not None:
        motion = _motion(match.group(1), match.group(2), "to")
        if motion is not None:
            return motion
    release = _RELEASE.search(text)
    if release is None:
        return None
    return _motion(release.group(1), release.group(2), "release")


def _motion(start: str, end: str, kind: str) -> Motion | None:
    start_state = _state(start)
    end_state = _state(end)
    if start_state is None or end_state is None:
        return None
    start_words = " ".join(start.split()).lower()
    end_words = " ".join(end.split()).lower()
    label = f"{_lead(start_words)} to {end_words}"
    if kind == "release":
        description = f"{_lead(start_words)} releases into {end_words}"
    else:
        description = label
    return Motion(
        label=label,
        start=start_words,
        end=end_words,
        description=description,
        start_mood=start_state[0],
        start_energy=start_state[1],
        start_world=start_state[2],
        end_mood=end_state[0],
        end_energy=end_state[1],
        end_world=end_state[2],
    )


def _state(phrase: str) -> tuple[str, str, str] | None:
    lowered = phrase.lower()
    # A breath is a release, even when the producer also calls it positive.
    if "breath" in lowered.split():
        return _STATES["breath"]
    for word in lowered.split():
        found = _STATES.get(word.strip(".,!?"))
        if found is not None:
            return found
    return None


def _lead(phrase: str) -> str:
    word = phrase.strip()
    if not word:
        return word
    return word[:1].upper() + word[1:]
