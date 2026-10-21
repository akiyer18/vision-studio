"""A prompt may only say what the reviewed brief allows."""

from __future__ import annotations

import re

from contracts import LayerPrompt

from agent.facts import parse_chords
from agent.prompts import anchor_for

_MOOD_WORDS = {
    "longing": ("joyful", "euphoric", "party"),
    "joyful": ("melancholic", "brooding", "sad"),
    "peaceful": ("aggressive", "distorted", "urgent"),
    "tense": ("euphoric", "tender", "lullaby"),
}


def prompt_problem(prompt: LayerPrompt, slots: dict, references: list[str]) -> str | None:
    text = prompt.prompt
    lowered = text.lower()
    tempo = slots.get("tempo")
    if tempo is not None and tempo.source == "you" and tempo.value not in text:
        return f"the {prompt.layer} prompt dropped your tempo"
    key = slots.get("key")
    if key is not None and key.source == "you":
        parts = key.value.split()
        if parts and parts[0].lower() not in lowered:
            return f"the {prompt.layer} prompt dropped your key"
        if len(parts) > 1 and parts[1].lower() not in lowered:
            return f"the {prompt.layer} prompt dropped the mode"
    progression = slots.get("progression")
    if progression is not None and progression.source == "you":
        symbols = parse_chords(progression.value) or []
        for symbol in symbols:
            if symbol.lower() not in lowered:
                return f"the {prompt.layer} prompt dropped {symbol}"
    palette = slots.get("palette")
    if palette is not None and palette.source == "you":
        for name in [part.strip() for part in palette.value.split(",") if part.strip()]:
            if name.lower() not in lowered:
                return f"the {prompt.layer} prompt dropped {name}"
    try:
        anchor = anchor_for(_world(slots), prompt.layer)
    except KeyError:
        anchor = ""
    if anchor and anchor.lower() not in lowered:
        return f"the {prompt.layer} prompt dropped its anchor"
    for name in references:
        if name and name.lower() in lowered:
            return f"the {prompt.layer} prompt names {name}"
    mood = slots.get("mood")
    if mood is not None:
        for word in _MOOD_WORDS.get(mood.value, ()):
            if re.search(rf"\b{re.escape(word)}\b", lowered):
                return f"the {prompt.layer} prompt says {word}, against {mood.value}"
    words = re.findall(r"[A-Za-z0-9']+", text)
    if len(words) > 70:
        return f"the {prompt.layer} prompt is longer than about 60 words"
    return None


def problems(prompts: list[LayerPrompt], slots: dict, references: list[str]) -> list[str]:
    found = [prompt_problem(prompt, slots, references) for prompt in prompts]
    return [item for item in found if item]


def _world(slots: dict) -> str:
    world = slots.get("world")
    if world is None:
        return "warm and intimate"
    return world.value
