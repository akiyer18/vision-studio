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


PPQ = 480
VELOCITY = 90
_SYMBOL = re.compile(r"^([A-G])([#b]?)(maj7|m)?$")
_INTERVALS = {None: (0, 4, 7), "m": (0, 3, 7), "maj7": (0, 4, 7, 11)}


def voice_chord(symbol: str, *, inversion: int = 0, center: int = 60) -> list[int]:
    """Close voicing: the lowest tone sits nearest the center, and the rest stack above it."""
    tones = _tones(symbol)
    shift = inversion % len(tones)
    ordered = tones[shift:] + tones[:shift]
    notes = [nearest_pitch(ordered[0], center)]
    for pitch_class in ordered[1:]:
        step = (pitch_class - notes[-1]) % 12
        notes.append(notes[-1] + (step or 12))
    return notes


def root_near(symbol: str, center: int = 36) -> int:
    """Bass root nearest C2."""
    return nearest_pitch(_tones(symbol)[0], center)


def nearest_pitch(pitch_class: int, center: int) -> int:
    base = pitch_class % 12
    return min((base + 12 * octave for octave in range(-1, 11)), key=lambda note: (abs(note - center), note))


def chords_midi(chords: list[str], *, bpm: int, bars: int) -> bytes:
    return _midi(_note_events("chords", chords, bpm=bpm, bars=bars))


def bass_midi(chords: list[str], *, bpm: int, bars: int) -> bytes:
    return _midi(_note_events("bass", chords, bpm=bpm, bars=bars))


def midi_span(data: bytes) -> tuple[int, int]:
    """Tempo in microseconds per quarter, and the tick of the last event."""
    index = 14
    if data[:4] != b"MThd" or data[index : index + 4] != b"MTrk":
        raise ValueError("not a one-track MIDI file")
    length = int.from_bytes(data[index + 4 : index + 8], "big")
    track = data[index + 8 : index + 8 + length]
    tick = 0
    tempo = 0
    cursor = 0
    while cursor < len(track):
        delta, cursor = _read_vlq(track, cursor)
        tick += delta
        status = track[cursor]
        cursor += 1
        if status == 0xFF:
            kind = track[cursor]
            cursor += 1
            size, cursor = _read_vlq(track, cursor)
            payload = track[cursor : cursor + size]
            cursor += size
            if kind == 0x51:
                tempo = int.from_bytes(payload, "big")
            if kind == 0x2F:
                break
        elif status in {0x80, 0x90}:
            cursor += 2
        else:
            raise ValueError(f"unsupported MIDI status {status:#x}")
    return tempo, tick


def note_ons(data: bytes) -> list[tuple[int, int, int]]:
    """Note-ons as tick, pitch, velocity."""
    index = 14
    length = int.from_bytes(data[index + 4 : index + 8], "big")
    track = data[index + 8 : index + 8 + length]
    tick = 0
    cursor = 0
    notes: list[tuple[int, int, int]] = []
    while cursor < len(track):
        delta, cursor = _read_vlq(track, cursor)
        tick += delta
        status = track[cursor]
        cursor += 1
        if status == 0xFF:
            cursor += 1
            size, cursor = _read_vlq(track, cursor)
            cursor += size
        elif status == 0x90:
            pitch, velocity = track[cursor], track[cursor + 1]
            cursor += 2
            if velocity:
                notes.append((tick, pitch, velocity))
        elif status == 0x80:
            cursor += 2
        else:
            raise ValueError(f"unsupported MIDI status {status:#x}")
    return notes


def _tones(symbol: str) -> list[int]:
    match = _SYMBOL.match(symbol.strip())
    if match is None:
        raise ValueError(f"unrecognised chord: {symbol}")
    letter, accidental, quality = match.group(1), match.group(2), match.group(3)
    root = _PITCHES[letter]
    if accidental == "#":
        root += 1
    elif accidental == "b":
        root -= 1
    return [(root + interval) % 12 for interval in _INTERVALS[quality]]


def _note_events(kind: str, chords: list[str], *, bpm: int, bars: int) -> list[tuple[int, bytes]]:
    if not chords:
        raise ValueError("a progression needs at least one chord")
    tempo = round(60_000_000 / bpm)
    events = [(0, b"\xff\x51\x03" + tempo.to_bytes(3, "big"))]
    ticks_per_bar = 4 * PPQ
    for bar in range(bars):
        symbol = chords[bar % len(chords)]
        pitches = [root_near(symbol)] if kind == "bass" else voice_chord(symbol)
        start = bar * ticks_per_bar
        end = start + ticks_per_bar
        for pitch in pitches:
            events.append((start, bytes((0x90, pitch, VELOCITY))))
            events.append((end, bytes((0x80, pitch, 0))))
    events.sort(key=lambda item: (item[0], _event_order(item[1])))
    return events


def _event_order(message: bytes) -> int:
    if message[0] == 0xFF:
        return 0
    if message[0] == 0x80:
        return 1
    return 2


def _midi(events: list[tuple[int, bytes]]) -> bytes:
    payload = bytearray()
    previous = 0
    for tick, message in events:
        payload += _vlq(tick - previous)
        payload += message
        previous = tick
    payload += b"\x00\xff\x2f\x00"
    header = b"MThd\x00\x00\x00\x06\x00\x00\x00\x01" + PPQ.to_bytes(2, "big")
    return header + b"MTrk" + len(payload).to_bytes(4, "big") + bytes(payload)


def _vlq(value: int) -> bytes:
    encoded = bytearray([value & 0x7F])
    value >>= 7
    while value:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    encoded.reverse()
    return bytes(encoded)


def _read_vlq(data: bytes, index: int) -> tuple[int, int]:
    value = 0
    while True:
        byte = data[index]
        index += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, index
