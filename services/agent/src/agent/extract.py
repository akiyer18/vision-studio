"""Keyword extraction for MockProvider. Replaced by Bedrock later."""

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
    if features.input_type == "full_track":
        found["style"] = SlotValue(
            value="full track",
            source="reference",
            reason="A full track was given as the reference",
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


def _hits(text: str, phrases: tuple[str, ...]) -> int:
    lowered = text.lower()
    total = 0
    for phrase in phrases:
        total += len(re.findall(rf"\b{re.escape(phrase.lower())}\b", lowered))
    return total
