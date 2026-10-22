"""Render an exercise from its MIDI definition, then optionally colour it."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from agent.exercise_midi import write_midi
from agent.exercises import Exercise
from api.audio import SR, bar_frames, bar_seconds, write_wav
from api.renderer import _add_tone, _hat, _kick, _limit, _place, _snare
from api.stability import StabilityConfig, colour_audio, load_config

logger = logging.getLogger("api")
NOISE = 0.3
_CLEAN = "The clean samples are playing. The production pass was not used."
_CHECKED = "Production character was added and checked against the MIDI."
_MISMATCH = "The production pass did not match the MIDI, so the clean samples are playing."
_FAILED = "The production pass did not run, so the clean samples are playing."
_UNCHECKED = "The clean samples are playing. The MIDI check did not pass."


def render_reference(exercise: Exercise, folder: Path, *, config: StabilityConfig | None = None) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "reference.mid").write_bytes(write_midi(exercise))
    clean = synthesize(exercise)
    write_wav(folder / "clean.wav", clean)
    chosen = clean
    note = _CLEAN
    active = load_config() if config is None else config
    if active.ready:
        try:
            coloured = colour_audio(
                active,
                source=folder / "clean.wav",
                prompt=exercise.prompt,
                duration=bar_seconds(exercise.tempo, exercise.bars),
                noise=NOISE,
            )
            coloured = _fit(coloured, len(clean))
            ok, _why = verify(coloured, exercise)
            if ok:
                chosen = coloured
                note = _CHECKED
            else:
                note = _MISMATCH
        except Exception as error:
            detail = str(error)
            if active.api_key:
                detail = detail.replace(active.api_key, "[redacted]")
            logger.warning("train colour failed: %s", detail)
            note = _FAILED
    elif not verify(clean, exercise)[0]:
        note = _UNCHECKED
    write_wav(folder / "reference.wav", chosen)
    return note


def synthesize(exercise: Exercise) -> np.ndarray:
    frames = bar_frames(exercise.tempo, exercise.bars)
    audio = np.zeros((frames, 2), dtype=np.float64)
    rng = np.random.default_rng(1)
    for hit in exercise.hits:
        start = _sample((hit.bar - 1) * 16 + hit.step, frames, exercise.bars)
        _place(audio, start, _tone(hit.drum, hit.velocity, rng), 0.9, 0.9)
    for note in exercise.bass:
        origin = (note.bar - 1) * 16 + note.start
        start, end = _span(origin, note.length, frames, exercise.bars)
        _add_tone(audio, start, end, note.pitch, 0.45, 1, harmonic=0.15)
    for chord in exercise.chords:
        origin = (chord.bar - 1) * 16
        start, end = _span(origin, 16, frames, exercise.bars)
        for pitch in chord.notes:
            _add_tone(audio, start, end, pitch, 0.16, 1, detune=1.003)
    return _limit(audio)


def verify(audio: np.ndarray, exercise: Exercise, sr: int = SR) -> tuple[bool, str]:
    """Drum onsets within 30 ms, and chord pitch classes in each bar."""
    mono = np.asarray(audio, dtype=np.float64)
    if mono.ndim == 2:
        mono = mono.mean(axis=1)
    if exercise.hits and not _onsets_match(mono, exercise, sr):
        return False, "drum onsets"
    if exercise.chords and not _chroma_matches(mono, exercise, sr):
        return False, "chord chroma"
    return True, "ok"


def _onsets_match(mono: np.ndarray, exercise: Exercise, sr: int) -> bool:
    window = int(0.03 * sr)
    checked = missed = 0
    for hit in exercise.hits:
        if hit.drum == "open_hat":
            continue
        sample = _sample((hit.bar - 1) * 16 + hit.step, len(mono), exercise.bars)
        segment = np.abs(mono[max(0, sample - window) : sample + window + 1])
        before = np.abs(mono[max(0, sample - 3 * window) : max(0, sample - window)])
        peak = float(segment.max()) if segment.size else 0.0
        lead = float(before.max()) if before.size else 0.0
        floor = 0.012 * (hit.velocity / 127)
        checked += 1
        if peak < floor or (lead > 0 and peak < lead * 1.05 and hit.drum in {"kick", "snare"}):
            missed += 1
    return checked == 0 or missed / checked <= 0.2


def _chroma_matches(mono: np.ndarray, exercise: Exercise, sr: int) -> bool:
    weak = total = 0
    for chord in exercise.chords:
        start, end = _span((chord.bar - 1) * 16, 16, len(mono), exercise.bars)
        bins = _chroma(mono[start:end], sr)
        peak = float(bins.max())
        if peak <= 0:
            return False
        for note in chord.notes:
            total += 1
            if bins[note % 12] < 0.18 * peak:
                weak += 1
    return total == 0 or weak / total <= 0.34


def _chroma(mono: np.ndarray, sr: int) -> np.ndarray:
    if mono.size < 64:
        return np.zeros(12)
    windowed = mono * np.hanning(mono.size)
    spectrum = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(mono.size, 1 / sr)
    bins = np.zeros(12)
    for magnitude, freq in zip(spectrum, freqs, strict=True):
        if freq < 40:
            continue
        midi = 69 + 12 * np.log2(freq / 440)
        bins[int(round(midi)) % 12] += magnitude
    return bins


def _tone(kind: str, velocity: int, rng: np.random.Generator) -> np.ndarray:
    gain = velocity / 127
    if kind == "kick":
        tone = _kick(110 + velocity / 4)
    elif kind == "snare":
        tone = _snare(rng)
    elif kind == "open_hat":
        tone = _open_hat(rng)
    else:
        tone = _hat(rng, velocity)
    return tone * gain


def _open_hat(rng: np.random.Generator) -> np.ndarray:
    count = int(0.16 * SR)
    bright = np.diff(rng.uniform(-1, 1, count), prepend=0)
    return bright * np.exp(-14 * np.arange(count) / SR)


def _sample(step: int, frames: int, bars: int) -> int:
    width = frames / (bars * 16)
    return int(round(step * width))


def _span(step: int, length: int, frames: int, bars: int) -> tuple[int, int]:
    start = min(frames, _sample(step, frames, bars))
    end = min(frames, _sample(step + length, frames, bars))
    return start, max(start + 1, end) if end > start else min(frames, start + 1)


def _fit(audio: np.ndarray, frames: int) -> np.ndarray:
    shaped = np.asarray(audio, dtype=np.float64)
    if shaped.ndim == 1:
        shaped = np.column_stack([shaped, shaped])
    shaped = shaped[:, :2]
    if len(shaped) < frames:
        shaped = np.vstack([shaped, np.zeros((frames - len(shaped), 2))])
    return shaped[:frames]
