"""Instrument, genre, and mood words already used by the agent, plus vocab.yaml."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from agent.prompts import ANCHORS, DESCRIPTORS, ENERGY_WORDS, MOOD_WORDS
from agent.slots import slot_specs

_STOP = {"and", "with", "the", "for", "from", "a", "of", "in", "on", "to", "or"}


def vocab_path() -> Path:
    return Path(__file__).resolve().parents[2] / "vocab.yaml"


@lru_cache(maxsize=1)
def vocabulary() -> tuple[str, ...]:
    phrases: set[str] = set()
    for text in _section_four_texts():
        _add_text(phrases, text)
    for spec in slot_specs():
        for option in spec.options:
            _add_text(phrases, option)
    for world in ANCHORS.values():
        for anchor in world.values():
            _add_text(phrases, anchor)
    for phrase in _yaml_phrases(vocab_path()):
        _add_text(phrases, phrase)
    return tuple(sorted(phrases, key=len, reverse=True))


def phrase_in(text: str, phrase: str) -> bool:
    words = phrase.lower().split()
    if not words:
        return False
    pattern = r"\b" + r"\s+".join(re.escape(word) for word in words) + r"\b"
    return re.search(pattern, text.lower()) is not None


def novel_phrase(polished: str, template: str, brief: str) -> str | None:
    for phrase in vocabulary():
        if phrase_in(polished, phrase) and not phrase_in(template, phrase) and not phrase_in(brief, phrase):
            return phrase
    return None


def _section_four_texts() -> list[str]:
    texts = list(MOOD_WORDS.values()) + list(ENERGY_WORDS.values())
    for layers in DESCRIPTORS.values():
        texts.extend(layers.values())
    return texts


def _add_text(phrases: set[str], text: str) -> None:
    for part in text.split(","):
        phrase = " ".join(part.lower().split())
        if len(phrase) >= 3:
            phrases.add(phrase)
        for word in phrase.split():
            if len(word) >= 3 and word not in _STOP:
                phrases.add(word)


def _yaml_phrases(path: Path) -> list[str]:
    phrases: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line.startswith("- "):
            phrases.append(line[2:].strip())
    return phrases
