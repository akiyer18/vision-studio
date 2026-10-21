"""Keyword extraction for MockProvider, and the offline fallback when Bedrock is down."""

from __future__ import annotations

import re

from contracts import AudioFeatures, SlotValue

from agent.defaults import preset_for

MOOD_KEYWORDS = {
    "longing": ("miss", "lonely", "sad", "rain", "lost", "heart", "night drive"),
    "joyful": ("happy", "sun", "summer", "dance", "party", "celebrate"),
    "peaceful": ("calm", "peace", "morning", "sea", "soft", "sleep"),
    "tense": ("dark", "fear", "tense", "storm", "chase", "anger"),
}
MOOD_ORDER = ("longing", "joyful", "peaceful", "tense")
ENERGY_HIGH = ("dance", "party", "run", "club", "fast")


def keyword_confidence(hits: int) -> float:
    if hits <= 0:
        return 0.0
    return round(min(0.95, 0.55 + 0.15 * hits), 2)


def extract_text(text: str) -> dict[str, SlotValue]:
    mood_hits = {mood: _hits(text, phrases) for mood, phrases in MOOD_KEYWORDS.items()}
    best = _best_mood(mood_hits)
    energy_hits = _hits(text, ENERGY_HIGH)
    found: dict[str, SlotValue] = {}
    if best is not None:
        mood, hits = best
        confidence = keyword_confidence(hits)
        preset = preset_for(mood)
        found["mood"] = SlotValue(
            value=mood,
            source="you",
            reason=f"Heard {mood} in the text",
            confidence=confidence,
        )
        found["world"] = SlotValue(
            value=preset.world,
            source="you",
            reason=f"{preset.world} is the {mood} scene",
            confidence=confidence,
        )
        if energy_hits:
            found["energy"] = SlotValue(
                value="make people move",
                source="you",
                reason="Heard high energy in the text",
                confidence=keyword_confidence(energy_hits),
            )
        else:
            found["energy"] = SlotValue(
                value=preset.energy,
                source="you",
                reason=f"{preset.energy} follows the {mood} preset",
                confidence=confidence,
            )
    elif energy_hits:
        found["energy"] = SlotValue(
            value="make people move",
            source="you",
            reason="Heard high energy in the text",
            confidence=keyword_confidence(energy_hits),
        )
    return found


def extract_audio(features: AudioFeatures) -> dict[str, SlotValue]:
    found: dict[str, SlotValue] = {}
    key = detected_key(features.key, features.mode)
    if key is not None:
        found["key"] = SlotValue(
            value=key,
            source="detected",
            reason="Detected from the audio",
            confidence=features.confidence,
        )
    if features.instruments:
        found["palette"] = SlotValue(
            value=", ".join(features.instruments),
            source="detected",
            reason="Detected from the audio",
            confidence=features.confidence,
        )
    return found


def detected_key(key: str | None, mode: str | None) -> str | None:
    if key is None or not key.strip():
        return None
    cleaned = key.strip()
    if mode and mode.lower() in {"major", "minor"} and mode.lower() not in cleaned.lower():
        return f"{cleaned} {mode.lower()}"
    return cleaned


def _best_mood(hits: dict[str, int]) -> tuple[str, int] | None:
    ranked = sorted(
        ((mood, count) for mood, count in hits.items() if count > 0),
        key=lambda item: (-item[1], MOOD_ORDER.index(item[0])),
    )
    if not ranked:
        return None
    return ranked[0]


_BPM = re.compile(r"\b((?:around|about)\s+)?(\d+)\s*bpm\b", re.IGNORECASE)
_KEY = re.compile(r"\b([A-G])([#b]?)\s+(major|minor)\b", re.IGNORECASE)
_BARS = re.compile(r"\b(\d+)\s+bars?\b", re.IGNORECASE)
MOOD_SAID = (
    ("aggressive", "tense"),
    ("aggression", "tense"),
    ("angry", "tense"),
    ("anger", "tense"),
    ("harsh", "tense"),
    ("calm", "peaceful"),
    ("peaceful", "peaceful"),
    ("gentle", "peaceful"),
    ("sad", "longing"),
    ("lonely", "longing"),
    ("happy", "joyful"),
    ("joyful", "joyful"),
)


def stated_tempo(text: str) -> tuple[int, str] | None:
    """BPM and the phrase the producer used, such as 'around 90 BPM'."""
    match = _BPM.search(text)
    if match is None:
        return None
    number = int(match.group(2))
    if number <= 0:
        return None
    prefix = (match.group(1) or "").strip()
    phrase = f"{prefix} {number}".strip() if prefix else str(number)
    if "bpm" not in phrase.lower():
        phrase = f"{phrase} BPM"
    return number, phrase


def extract_numbers(text: str) -> dict[str, SlotValue]:
    """Tempo, key, and bar count written in the text. Both providers use this."""
    found: dict[str, SlotValue] = {}
    tempo = stated_tempo(text)
    if tempo is not None:
        number, _phrase = tempo
        found["tempo"] = SlotValue(
            value=str(number),
            source="you",
            reason=f"Heard {number} BPM in your words",
            confidence=1.0,
        )
    key_match = _KEY.search(text)
    if key_match is not None:
        letter, accidental, mode = key_match.group(1).upper(), key_match.group(2), key_match.group(3).lower()
        key = f"{letter}{accidental} {mode}"
        found["key"] = SlotValue(
            value=key,
            source="you",
            reason=f"Heard {key} in your words",
            confidence=1.0,
        )
    bars_match = _BARS.search(text)
    if bars_match is not None:
        count = int(bars_match.group(1))
        if count > 0:
            label = f"{count} bars"
            found["structure"] = SlotValue(
                value=label,
                source="you",
                reason=f"Heard {label} in your words",
                confidence=1.0,
            )
    return found


def user_mood(text: str) -> tuple[str, str] | None:
    """Closed mood label implied by the producer's own words, and the word that implied it."""
    lowered = text.lower()
    found: tuple[int, str, str] | None = None
    for word, label in MOOD_SAID:
        match = re.search(rf"\b{re.escape(word)}\b", lowered)
        if match is None:
            continue
        if found is None or match.start() < found[0]:
            found = (match.start(), label, word)
    if found is None:
        return None
    return found[1], found[2]


def _hits(text: str, phrases: tuple[str, ...]) -> int:
    lowered = text.lower()
    total = 0
    for phrase in phrases:
        total += len(re.findall(rf"\b{re.escape(phrase.lower())}\b", lowered))
    return total
