"""Facts the producer stated. A locked fact is source you and cannot be replaced."""

from __future__ import annotations

import re

from contracts import SlotValue

FACTS = ("tempo", "key", "progression", "structure", "palette", "sound", "meter")

_BPM = re.compile(r"\b(\d+)\s*bpm\b", re.IGNORECASE)
_KEY = re.compile(r"\b([A-G])([#b]?)\s+(major|minor)\b", re.IGNORECASE)
_BARS = re.compile(r"\b(\d+)\s+bars?\b", re.IGNORECASE)
_METER = re.compile(r"\b([1-9]\d?)\s*/\s*(1|2|4|8|16)\b")
_CHORD = re.compile(
    r"\b([A-G])([#b]?)(maj7|m7|min|maj|dim|aug|sus2|sus4|m)?\b",
    re.IGNORECASE,
)
_INSTRUMENTS = (
    "piano",
    "guitar",
    "violin",
    "flute",
    "saxophone",
    "organ",
    "harp",
    "strings",
    "cello",
    "trumpet",
    "drums",
    "synth",
    "rhodes",
)
_SOUNDS = ("kick", "snare", "clap", "hat", "808", "pad", "pluck", "riser", "impact", "tom")

INTRO = (
    "Vision Studio asks a few short questions to match what you hear in your head. "
    "Details stay exactly as you gave them. Build now works at any point."
)

WHY = {
    "output": "The layers you want change what gets written next.",
    "mood": "The feeling is still open, and it shapes the harmony.",
    "energy": "Energy decides how the rhythm moves.",
    "world": "The sonic world picks the instruments around what you named.",
    "key": "The harmony colour is still open.",
    "style": "A reference can become musical words. The name stays out of the prompt.",
    "palette": "Any instrument you name stays in the prompt.",
    "structure": "The length sets how long the audio is.",
    "must_keep": "This says what in your audio must not change.",
    "sound": "The sound type chooses the layer.",
    "genre": "The genre narrows the sound.",
    "brightness": "Brightness shapes the top of the sound.",
    "intent": "Your recording can be reshaped, continued, or left as it is.",
    "about": "A little more of the idea gives the questions something to match.",
}


def kept_line(slot: str, value: str) -> str:
    shown = value
    if slot == "tempo" and "bpm" not in value.lower():
        shown = f"{value} BPM"
    labels = {
        "tempo": "tempo",
        "key": "key",
        "progression": "progression",
        "structure": "bar count",
        "palette": "instruments",
        "sound": "sound",
        "meter": "time signature",
    }
    return f"Kept your {labels.get(slot, slot)}: {shown}"


def why_for(slot: str) -> str:
    return WHY.get(slot, "This detail is still missing.")


def extract_facts(text: str) -> dict[str, SlotValue]:
    """Deterministic patterns. Claude may add facts, but these win first."""
    found: dict[str, SlotValue] = {}
    tempo = _BPM.search(text)
    if tempo is not None:
        number = int(tempo.group(1))
        if number > 0:
            found["tempo"] = _fact("tempo", str(number), f"Heard {number} BPM in your words")
    key_match = _KEY.search(text)
    if key_match is not None:
        letter = key_match.group(1).upper()
        accidental = key_match.group(2)
        mode = key_match.group(3).lower()
        key = f"{letter}{accidental} {mode}"
        found["key"] = _fact("key", key, f"Heard {key} in your words")
    bars = _BARS.search(text)
    if bars is not None:
        count = int(bars.group(1))
        if count > 0:
            label = f"{count} bars"
            found["structure"] = _fact("structure", label, f"Heard {label} in your words")
    meter = _METER.search(text)
    if meter is not None:
        signature = f"{int(meter.group(1))}/{int(meter.group(2))}"
        found["meter"] = _fact("meter", signature, f"Heard {signature} in your words")
    progression = _progression(text)
    if progression is not None:
        found["progression"] = _fact("progression", progression, f"Heard the progression {progression}")
    instruments = _named(text, _INSTRUMENTS)
    if instruments:
        found["palette"] = _fact("palette", ", ".join(instruments), "Heard the instruments you named")
    sounds = _named(text, _SOUNDS)
    if sounds:
        found["sound"] = _fact("sound", ", ".join(sounds), "Heard the sound you named")
    return found


def classify_intent(text: str) -> str | None:
    """transform, extend, or accompany. None when the words do not say."""
    lowered = text.lower()
    transform = bool(re.search(r"\b(reshape|transform|turn it into|make it|different)\b", lowered))
    extend = bool(re.search(r"\b(continue|extend|keep going|longer)\b", lowered))
    accompany = bool(re.search(r"\b(around it|accompany|layers around|build around|with my)\b", lowered))
    hits = [name for name, flag in (("transform", transform), ("extend", extend), ("accompany", accompany)) if flag]
    if len(hits) == 1:
        return hits[0]
    return None


def parse_chords(value: str) -> list[str] | None:
    parts = [part.strip() for part in value.split(",")]
    if len(parts) < 2:
        return None
    chords: list[str] = []
    for part in parts:
        match = _CHORD.fullmatch(part.strip())
        if match is None:
            return None
        letter = match.group(1).upper()
        accidental = match.group(2)
        quality = (match.group(3) or "").lower()
        root = f"{letter}{accidental}"
        if quality in {"m", "min"}:
            chords.append(f"{root}m")
        elif quality:
            chords.append(f"{root}{quality}")
        else:
            chords.append(root)
    return chords


_CHORD_LIST = re.compile(
    r"\b([A-G][#b]?(?:maj7|m7|min|maj|dim|aug|sus2|sus4|m)?"
    r"(?:\s*,\s*[A-G][#b]?(?:maj7|m7|min|maj|dim|aug|sus2|sus4|m)?){1,})\b",
    re.IGNORECASE,
)


def _progression(text: str) -> str | None:
    match = _CHORD_LIST.search(text)
    if match is None:
        return None
    parsed = parse_chords(match.group(1))
    if parsed is None or len(parsed) < 2:
        return None
    return ", ".join(parsed)


def _named(text: str, words: tuple[str, ...]) -> list[str]:
    lowered = text.lower()
    found: list[str] = []
    for word in words:
        if re.search(rf"\b{re.escape(word)}\b", lowered) and word not in found:
            found.append(word)
    return found


def _fact(slot: str, value: str, reason: str) -> SlotValue:
    return SlotValue(value=value, source="you", reason=reason, confidence=1.0)
