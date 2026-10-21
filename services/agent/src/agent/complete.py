"""Fill every field a compile or a render would otherwise refuse."""

from __future__ import annotations

import re
from typing import Protocol

from contracts import SlotValue, SongBrief

from agent.arc import Motion, detect_arc
from agent.defaults import ENERGY_BPM, PRESETS, default_slot, derive_bpm, parse_bpm, preset_for
from agent.extract import stated_tempo
from agent.slots import slot_specs

_BARS = re.compile(r"^(\d+)(?:\s+bars?)?$", re.IGNORECASE)
_KEY = re.compile(r"^([A-G])([#b]?)\s+(major|minor)\b", re.IGNORECASE)
_PROMPT_BPM = re.compile(r"(\d+)\s+BPM")
_CLOSED = ("mood", "energy", "world")


class _BriefSession(Protocol):
    slots: dict[str, SlotValue]
    arc: Motion | None
    text: str
    mode: str
    output: list[str]

    def note(self, step: str, detail: str) -> None: ...

    def mood_name(self) -> str: ...


def complete_brief(session: _BriefSession) -> None:
    """Guarantee tempo, an integer bar count, a key with a mode, and an output."""
    for slot in _CLOSED:
        _complete_closed(session, slot)
    _complete_key(session)
    _complete_tempo(session)
    _complete_bars(session)
    _complete_output(session)


def bar_count(value: str) -> int | None:
    match = _BARS.match(value.strip())
    if match is None:
        return None
    number = int(match.group(1))
    if number <= 0:
        return None
    return number


def timing_from_brief(brief: SongBrief, prompt: str) -> tuple[int, int]:
    """BPM and bars for a render. Never raises."""
    tempo = brief.slots.tempo
    bpm = parse_bpm(tempo.value) if tempo is not None else None
    if bpm is None:
        match = _PROMPT_BPM.search(prompt)
        bpm = int(match.group(1)) if match is not None else None
    if bpm is None:
        mood = brief.slots.mood.value if brief.slots.mood is not None else "peaceful"
        energy = brief.slots.energy.value if brief.slots.energy is not None else ""
        if mood not in PRESETS:
            mood = "peaceful"
        if energy not in ENERGY_BPM:
            energy = preset_for(mood).energy
        bpm, _reason = derive_bpm(energy, mood)
    structure = brief.slots.structure
    bars = bar_count(structure.value) if structure is not None else None
    if bars is None:
        bars = 16 if brief.arc is not None else 8
    return bpm, bars


def _complete_closed(session: _BriefSession, slot: str) -> None:
    options = _options(slot)
    current = session.slots.get(slot)
    if current is not None and current.source == "you":
        return
    if current is not None and current.value in options:
        return
    fallback = default_slot(slot, session.mood_name(), audio=False)
    if current is not None:
        session.note("complete_brief", f"Kept {fallback.value}: {current.value} is not a {slot}")
    else:
        session.note("complete_brief", fallback.reason)
    session.slots[slot] = fallback


def _complete_key(session: _BriefSession) -> None:
    current = session.slots.get("key")
    if current is not None and current.source == "you":
        return
    if current is not None and _key_ok(current.value):
        return
    chosen = preset_for(session.mood_name()).key
    reason = f"{chosen} because that is the {session.mood_name()} preset"
    if current is not None:
        session.note("complete_brief", f"Kept {chosen}: {current.value} is not a key")
    else:
        session.note("complete_brief", reason)
    session.slots["key"] = SlotValue(value=chosen, source="guessed", reason=reason, confidence=0.4)


def _complete_tempo(session: _BriefSession) -> None:
    current = session.slots.get("tempo")
    if current is not None and current.source == "you":
        return
    number = parse_bpm(current.value) if current is not None else None
    if current is not None and number is not None:
        if current.value.strip() != str(number):
            session.slots["tempo"] = current.model_copy(update={"value": str(number)})
        return
    stated = stated_tempo(session.text)
    if stated is not None:
        bpm, _phrase = stated
        if current is not None:
            session.note("complete_brief", f"Kept {bpm} BPM: {current.value} is not a tempo")
        else:
            session.note("complete_brief", f"Heard {bpm} BPM in your words")
        session.slots["tempo"] = SlotValue(
            value=str(bpm),
            source="you",
            reason=f"Heard {bpm} BPM in your words",
            confidence=1.0,
        )
        return
    mood = session.mood_name()
    energy = session.slots["energy"].value
    bpm, reason = derive_bpm(energy, mood)
    if current is not None:
        session.note("complete_brief", f"Kept the derived tempo: {current.value} is not a tempo")
    else:
        session.note("complete_brief", reason)
    session.slots["tempo"] = SlotValue(value=str(bpm), source="guessed", reason=reason, confidence=0.4)


def _complete_bars(session: _BriefSession) -> None:
    current = session.slots.get("structure")
    raw = current.value if current is not None else ""
    count = bar_count(raw) if raw else None
    if count is None and raw and session.arc is None:
        found = detect_arc(raw)
        if found is not None:
            session.arc = found
            session.note("complete_brief", f"The idea moves: {found.label}")
    if current is not None and current.source == "you":
        if count is not None:
            _store_bars(session, count, source="you", reason=current.reason, confidence=current.confidence)
        return
    if session.arc is not None:
        if count == 16 and current is not None and current.value == "16 bars":
            return
        reason = "16 bars because the idea has an arc"
        if raw and count is None:
            session.note("complete_brief", f"Kept 16 bars: {raw} is not a bar count")
        else:
            session.note("complete_brief", reason)
        _store_bars(session, 16, source="guessed", reason=reason, confidence=0.4)
        return
    if count is not None and current is not None:
        if current.value != f"{count} bars":
            _store_bars(session, count, source=current.source, reason=current.reason, confidence=current.confidence)
        return
    reason = "8 bars is the default length"
    if raw:
        session.note("complete_brief", f"Kept 8 bars: {raw} is not a bar count")
    else:
        session.note("complete_brief", reason)
    _store_bars(session, 8, source="guessed", reason=reason, confidence=0.4)


def _complete_output(session: _BriefSession) -> None:
    if session.mode == "one_sound":
        if "output" not in session.slots:
            session.slots["output"] = SlotValue(
                value="one sound",
                source="you",
                reason="One sound mode",
                confidence=1.0,
            )
            session.note("complete_brief", "One sound mode")
        return
    if session.output:
        return
    value = default_slot("output", session.mood_name(), audio=False)
    session.output = ["all_layers"]
    session.slots["output"] = value
    session.note("complete_brief", value.reason)


def _store_bars(session: _BriefSession, count: int, *, source: str, reason: str, confidence: float) -> None:
    label = f"{count} bars"
    current = session.slots.get("structure")
    if current is not None and current.value == label and current.source == source:
        return
    session.slots["structure"] = SlotValue(value=label, source=source, reason=reason, confidence=confidence)


def _key_ok(value: str) -> bool:
    cleaned = re.sub(r"\s*\([^)]*\)$", "", value.strip())
    return _KEY.match(cleaned) is not None


def _options(slot: str) -> set[str]:
    for spec in slot_specs():
        if spec.slot == slot:
            return set(spec.options)
    return set()
