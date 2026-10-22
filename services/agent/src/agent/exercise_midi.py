"""MIDI for an exercise. The symbolic grid is the source, and the file is one track."""

from __future__ import annotations

from dataclasses import dataclass

from agent.exercises import Exercise
from agent.theory import PPQ, _midi

STEP = PPQ // 4
DRUM_PITCH = {"kick": 36, "snare": 38, "hat": 42, "open_hat": 46}


@dataclass(frozen=True)
class MidiNote:
    tick: int
    duration: int
    pitch: int
    velocity: int


def write_midi(exercise: Exercise, *, skip: tuple[int, int, str] | None = None) -> bytes:
    tempo = round(60_000_000 / exercise.tempo)
    events = [(0, b"\xff\x51\x03" + tempo.to_bytes(3, "big"))]
    for hit in exercise.hits:
        if skip == (hit.bar, hit.step, hit.drum):
            continue
        start = ((hit.bar - 1) * 16 + hit.step) * STEP
        events.append((start, bytes((0x90, DRUM_PITCH[hit.drum], hit.velocity))))
        events.append((start + STEP // 2, bytes((0x80, DRUM_PITCH[hit.drum], 0))))
    for note in exercise.bass:
        start = ((note.bar - 1) * 16 + note.start) * STEP
        events.append((start, bytes((0x90, note.pitch, 96))))
        events.append((start + note.length * STEP, bytes((0x80, note.pitch, 0))))
    for chord in exercise.chords:
        start = (chord.bar - 1) * 16 * STEP
        end = chord.bar * 16 * STEP
        for pitch in chord.notes:
            events.append((start, bytes((0x90, pitch, 80))))
            events.append((end, bytes((0x80, pitch, 0))))
    events.sort(key=lambda item: (item[0], _order(item[1])))
    return _midi(events)


def read_midi(data: bytes) -> tuple[int, int | None, list[MidiNote]]:
    """PPQ, tempo in BPM when the file has one, and notes from every track."""
    if len(data) < 14 or data[:4] != b"MThd":
        raise ValueError("not a MIDI file")
    header = int.from_bytes(data[4:8], "big")
    fmt = int.from_bytes(data[8:10], "big")
    tracks = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    if fmt not in {0, 1} or division <= 0 or division & 0x8000:
        raise ValueError("MIDI format is not supported")
    cursor = 8 + header
    notes: list[MidiNote] = []
    bpm: int | None = None
    for _ in range(tracks):
        if cursor + 8 > len(data) or data[cursor : cursor + 4] != b"MTrk":
            raise ValueError("MIDI track is missing")
        length = int.from_bytes(data[cursor + 4 : cursor + 8], "big")
        track = data[cursor + 8 : cursor + 8 + length]
        cursor += 8 + length
        parsed, tempo = _track(track)
        notes.extend(parsed)
        if bpm is None and tempo is not None:
            bpm = tempo
    return division, bpm, notes


def _order(message: bytes) -> int:
    if message[0] == 0xFF:
        return 0
    if message[0] == 0x80:
        return 1
    return 2


def _track(track: bytes) -> tuple[list[MidiNote], int | None]:
    tick = 0
    index = 0
    status = 0
    bpm: int | None = None
    sounding: dict[int, list[tuple[int, int]]] = {}
    notes: list[MidiNote] = []
    while index < len(track):
        delta, index = _vlq(track, index)
        tick += delta
        if index >= len(track):
            break
        if track[index] & 0x80:
            status = track[index]
            index += 1
        kind = status & 0xF0
        if kind in {0x80, 0x90}:
            if index + 1 >= len(track):
                break
            pitch, velocity = track[index], track[index + 1]
            index += 2
            if kind == 0x90 and velocity:
                sounding.setdefault(pitch, []).append((tick, velocity))
            else:
                started = sounding.get(pitch)
                if started:
                    start, played = started.pop(0)
                    notes.append(MidiNote(start, max(0, tick - start), pitch, played))
        elif kind in {0xA0, 0xB0, 0xE0}:
            index += 2
        elif kind in {0xC0, 0xD0}:
            index += 1
        elif status == 0xFF:
            if index >= len(track):
                break
            meta = track[index]
            index += 1
            size, index = _vlq(track, index)
            payload = track[index : index + size]
            index += size
            if meta == 0x51 and len(payload) == 3:
                micros = int.from_bytes(payload, "big")
                if micros:
                    bpm = round(60_000_000 / micros)
            if meta == 0x2F:
                break
        elif status in {0xF0, 0xF7}:
            size, index = _vlq(track, index)
            index += size
        else:
            break
    return notes, bpm


def _vlq(data: bytes, index: int) -> tuple[int, int]:
    value = 0
    while index < len(data):
        byte = data[index]
        index += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, index
    raise ValueError("MIDI timing ran off the end of the track")
