"""Roman numerals to chord names in any key."""

from __future__ import annotations

import re

_PITCHES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_MAJOR = (0, 2, 4, 5, 7, 9, 11)
_MINOR = (0, 2, 3, 5, 7, 8, 10)
_SHARP = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_FLAT = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")
_FIFTHS = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4}
_ROMAN = re.compile(r"^(?P<acc>[b#]?)(?P<num>[ivIV]+)(?P<qual>maj7)?$")
_KEY = re.compile(r"^([A-G])([#b]?)\s+(major|minor)\b", re.IGNORECASE)
_DEGREE = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7}


def chords_for(key: str, romans: list[str] | tuple[str, ...]) -> list[str]:
    tonic, mode, prefer_flats = _parse_key(key)
    relative_major = tonic if mode == "major" else (tonic + 3) % 12
    flats = _fifths(relative_major, prefer_flats) < 0
    scale = _MAJOR if mode == "major" else _MINOR
    names = _FLAT if flats else _SHARP
    chords: list[str] = []
    for roman in romans:
        degree, accidental, quality = _parse_roman(roman)
        root = names[(tonic + scale[degree - 1] + accidental) % 12]
        chords.append(_symbol(root, quality))
    return chords


def _parse_key(key: str) -> tuple[int, str, bool]:
    cleaned = re.sub(r"\s*\([^)]*\)$", "", key.strip())
    match = _KEY.match(cleaned)
    if match is None:
        raise ValueError(f"unrecognised key: {key}")
    letter, accidental, mode = match.group(1).upper(), match.group(2), match.group(3).lower()
    pitch = _PITCHES[letter]
    if accidental == "#":
        pitch = (pitch + 1) % 12
    elif accidental == "b":
        pitch = (pitch - 1) % 12
    return pitch, mode, accidental == "b"


def _parse_roman(token: str) -> tuple[int, int, str]:
    match = _ROMAN.match(token.strip())
    if match is None:
        raise ValueError(f"unrecognised numeral: {token}")
    accidental = {"b": -1, "#": 1}.get(match.group("acc"), 0)
    numeral = match.group("num")
    degree = _DEGREE[numeral.lower()]
    if match.group("qual") == "maj7":
        quality = "maj7"
    elif numeral.isupper():
        quality = "major"
    else:
        quality = "minor"
    return degree, accidental, quality


def _fifths(major_pc: int, prefer_flats: bool) -> int:
    if major_pc == 1:
        return -5 if prefer_flats else 7
    if major_pc == 6:
        return -6 if prefer_flats else 6
    if major_pc == 11 and prefer_flats:
        return -7
    return _FIFTHS[major_pc]


def _symbol(root: str, quality: str) -> str:
    if quality == "minor":
        return f"{root}m"
    if quality == "maj7":
        return f"{root}maj7"
    return root
