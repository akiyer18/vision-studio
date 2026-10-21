"""Mood presets, tempo derivation, and one-line default reasons."""

from __future__ import annotations

import re
from dataclasses import dataclass

from contracts import SlotValue

ENERGY_BPM = {
    "slow and breathing": 76,
    "steady": 96,
    "make people move": 122,
}


@dataclass(frozen=True)
class Preset:
    mood: str
    energy: str
    world: str
    key: str
    colour: str
    bpm: int
    roman: tuple[str, ...]


PRESETS = {
    "joyful": Preset("joyful", "make people move", "bright and danceable", "C major", "", 124, ("I", "V", "vi", "IV")),
    "peaceful": Preset(
        "peaceful",
        "slow and breathing",
        "warm and intimate",
        "C major",
        "Lydian colour",
        72,
        ("Imaj7", "IVmaj7"),
    ),
    "longing": Preset("longing", "slow and breathing", "warm and intimate", "D minor", "", 76, ("i", "VI", "III", "VII")),
    "tense": Preset("tense", "steady", "dark and electronic", "E minor", "Phrygian colour", 110, ("i", "bII")),
}


def parse_bpm(value: str) -> int | None:
    """First positive integer in a stated or measured tempo."""
    match = re.search(r"\d+", value)
    if match is None:
        return None
    number = int(match.group())
    if number <= 0:
        return None
    return number


def preset_for(mood: str) -> Preset:
    return PRESETS.get(mood, PRESETS["peaceful"])


def derive_bpm(energy: str, mood: str) -> tuple[int, str]:
    """Start at the energy tempo, then nudge halfway toward the mood preset BPM."""
    energy_bpm = ENERGY_BPM[energy]
    preset_bpm = preset_for(mood).bpm
    bpm = round((energy_bpm + preset_bpm) / 2)
    if energy_bpm == preset_bpm and mood == "longing" and energy == "slow and breathing":
        return bpm, "76 BPM because slow tempos read as sad"
    if energy_bpm == preset_bpm:
        return bpm, f"{bpm} BPM because {energy} and the {mood} preset agree"
    return bpm, f"{bpm} BPM, nudged from {energy_bpm} toward the {mood} preset at {preset_bpm}"


def default_slot(slot: str, mood: str, *, audio: bool) -> SlotValue:
    preset = preset_for(mood)
    if slot == "mood":
        return _guess("peaceful", "Mood with no signal defaults to peaceful")
    if slot == "energy":
        return _guess(preset.energy, f"{preset.energy} follows the {mood} preset")
    if slot == "world":
        return _guess(preset.world, f"{preset.world} is the {mood} scene")
    if slot == "key":
        if preset.colour:
            reason = f"{preset.key} because {mood} defaults to a {preset.colour}"
        else:
            reason = f"{preset.key} because that is the {mood} preset"
        return _guess(preset.key, reason)
    if slot == "style":
        return _guess("no reference", "No artist or song was given", 0.3)
    if slot == "palette":
        return _guess("no preference", "No instruments were named", 0.3)
    if slot == "structure":
        return _guess("8 bars", "8 bars is the default length", 0.3)
    if slot == "must_keep":
        if audio:
            return _guess("everything", "Nothing was marked, so the whole recording stays", 0.3)
        return _guess("nothing", "There is no audio to keep", 0.3)
    if slot == "output":
        return _guess("all layers separately", "All layers separately is the default output")
    if slot == "sound":
        return _guess("pad", "A pad is the default when the sound type was not named")
    if slot == "genre":
        return _guess("no genre", "No genre was named", 0.3)
    if slot == "brightness":
        return _guess("balanced", "Brightness with no signal stays balanced")
    if slot == "pattern":
        return _guess("no pattern named", "No drum pattern was named", 0.3)
    if slot == "production":
        return _guess("no production noted", "No production technique was named", 0.3)
    raise KeyError(slot)


def skipped(value: SlotValue) -> SlotValue:
    return value.model_copy(update={"reason": f"skipped: {value.reason}"})


def _guess(value: str, reason: str, confidence: float = 0.4) -> SlotValue:
    return SlotValue(value=value, source="guessed", reason=reason, confidence=confidence)
