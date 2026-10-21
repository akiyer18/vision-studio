"""Renderer protocol and a mock renderer that synthesizes the brief."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

import numpy as np
from agent.theory import root_near, voice_chord
from contracts import RenderJob, RenderResult

from api.audio import SR, bar_frames, session_dir, wav_name, write_wav

_LAYERS = ("drums", "chords", "bass", "melody", "texture", "full_mix", "sound")
_MIX_PARTS = ("drums", "chords", "bass", "texture")
_MINUS_1_DB = 10 ** (-1 / 20)
_LIMIT_DB = 10 ** (-0.1 / 20)


class Renderer(Protocol):
    def render(self, job: RenderJob, chords: list[str]) -> RenderResult: ...


class MockRenderer:
    def __init__(self, data_root: Path) -> None:
        self.data_root = data_root

    def render(self, job: RenderJob, chords: list[str]) -> RenderResult:
        if job.layer not in _LAYERS:
            raise ValueError(f"unknown layer: {job.layer}")
        frames = bar_frames(job.bpm, job.bars)
        audio = _synthesize(job.layer, chords, job.bpm, frames, job.seed)
        audio = _trim(audio, frames)
        name = wav_name(job.layer, job.bpm, job.bars, job.variant)
        path = session_dir(self.data_root, job.session_id) / "renders" / name
        write_wav(path, audio)
        return RenderResult(
            layer=job.layer,
            variant=job.variant,
            path=str(path),
            seconds=job.bars * 4 * 60 / job.bpm,
            bpm=job.bpm,
        )


def _synthesize(layer: str, chords: list[str], bpm: int, frames: int, seed: int) -> np.ndarray:
    if layer == "full_mix":
        mixed = np.zeros((frames, 2), dtype=np.float64)
        for part in _MIX_PARTS:
            mixed += _peak_normalize(_synthesize(part, chords, bpm, frames, seed), _MINUS_1_DB)
        return _limit(mixed)
    if layer == "drums":
        return _drums(bpm, frames, seed)
    symbols = [chords[bar % len(chords)] for bar in range(_bars(bpm, frames))]
    if layer == "chords":
        return _chords(symbols, bpm, frames, seed)
    if layer == "bass":
        return _bass(symbols, bpm, frames, seed)
    if layer == "melody":
        return _melody(symbols, bpm, frames, seed)
    if layer == "sound":
        return _texture(frames, seed)
    return _texture(frames, seed)


def _drums(bpm: int, frames: int, seed: int) -> np.ndarray:
    audio = np.zeros((frames, 2), dtype=np.float64)
    step = int(round(60 / bpm / 4 * SR))
    rng = np.random.default_rng(seed)
    kick = _kick(140 + seed % 40)
    snare = _snare(rng)
    hat = _hat(rng, seed)
    density = seed % 1000
    hat_stride = 4 if density < 300 else 2 if density < 700 else 1
    hits = [(0, "kick"), (4, "snare"), (8, "kick"), (12, "snare")]
    hits.extend((index, "hat") for index in range(0, 16, hat_stride))
    if density > 500:
        hits.append((10, "kick"))
    if density > 800:
        hits.append((14, "snare"))
    sounds = {"kick": (kick, 0.8, 0.8), "snare": (snare, 0.85, 0.45), "hat": (hat, 0.4, 0.85)}
    bars = _bars(bpm, frames)
    for bar in range(bars):
        origin = bar * step * 16
        for index, kind in hits:
            tone, left, right = sounds[kind]
            _place(audio, origin + index * step, tone, left, right)
    return audio


def _chords(symbols: list[str], bpm: int, frames: int, seed: int) -> np.ndarray:
    audio = np.zeros((frames, 2), dtype=np.float64)
    inversion = seed % 3
    for bar, symbol in enumerate(symbols):
        start, end = _bar_span(bar, bpm, frames)
        for pitch in voice_chord(symbol, inversion=inversion):
            _add_tone(audio, start, end, pitch, 0.22, seed, detune=1.003)
    return audio


def _bass(symbols: list[str], bpm: int, frames: int, seed: int) -> np.ndarray:
    audio = np.zeros((frames, 2), dtype=np.float64)
    velocity = 80 + seed % 21
    for bar, symbol in enumerate(symbols):
        start, end = _bar_span(bar, bpm, frames)
        _add_tone(audio, start, end, root_near(symbol), velocity / 160, seed, harmonic=(seed % 10) / 30)
    return audio


def _melody(symbols: list[str], bpm: int, frames: int, seed: int) -> np.ndarray:
    """The top tone of the chord voicing. The spec names no separate melody synthesis."""
    audio = np.zeros((frames, 2), dtype=np.float64)
    for bar, symbol in enumerate(symbols):
        start, end = _bar_span(bar, bpm, frames)
        top = voice_chord(symbol, inversion=seed % 3)[-1]
        _add_tone(audio, start, end, top, 0.35, seed)
    return audio


def _texture(frames: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noise = rng.uniform(-1, 1, (frames, 2))
    window = 5 + seed % 80
    kernel = np.ones(window) / window
    filtered = np.column_stack([np.convolve(noise[:, channel], kernel, mode="same") for channel in (0, 1)])
    envelope = np.linspace(0.2, 1, frames)[:, None]
    return filtered * envelope * 0.35


def _add_tone(
    audio: np.ndarray,
    start: int,
    end: int,
    pitch: int,
    amplitude: float,
    seed: int,
    *,
    detune: float = 1.0,
    harmonic: float = 0.0,
) -> None:
    count = end - start
    if count <= 0:
        return
    time = np.arange(count) / SR
    frequency = 440 * 2 ** ((pitch - 69) / 12)
    frequency *= 1 + (seed % 5000) * 1e-6
    phase = (seed % 360) * np.pi / 180
    tone = np.sin(2 * np.pi * frequency * time + phase)
    if detune != 1:
        tone += 0.4 * np.sin(2 * np.pi * frequency * detune * time + phase)
    if harmonic:
        tone += harmonic * np.sin(2 * np.pi * frequency * 2 * time + phase)
    attack = min(int(0.06 * SR), count // 4 or 1)
    release = min(int(0.1 * SR), count // 4 or 1)
    envelope = np.ones(count)
    envelope[:attack] = np.linspace(0, 1, attack)
    envelope[-release:] = np.linspace(envelope[-release], 0, release)
    voiced = tone * envelope * amplitude
    audio[start:end, 0] += voiced
    audio[start:end, 1] += voiced


def _kick(start_hz: float) -> np.ndarray:
    count = int(0.18 * SR)
    time = np.arange(count) / SR
    frequency = start_hz * np.exp(-18 * time) + 42
    phase = np.cumsum(frequency) / SR * 2 * np.pi
    body = np.sin(phase) * np.exp(-10 * time)
    click = np.exp(-90 * time) * np.sin(2 * np.pi * 1500 * time)
    return body * 0.9 + click * 0.25


def _snare(rng: np.random.Generator) -> np.ndarray:
    count = int(0.12 * SR)
    time = np.arange(count) / SR
    noise = rng.uniform(-1, 1, count)
    tone = np.sin(2 * np.pi * 190 * time)
    return (0.65 * noise + 0.35 * tone) * np.exp(-16 * time)


def _hat(rng: np.random.Generator, seed: int) -> np.ndarray:
    count = int(0.045 * SR)
    noise = rng.uniform(-1, 1, count)
    bright = np.diff(noise, prepend=0)
    window = 2 + seed % 5
    kernel = np.ones(window) / window
    dull = np.convolve(bright, kernel, mode="same")
    mix = 0.35 + (seed % 100) / 200
    return (mix * bright + (1 - mix) * dull) * np.exp(-55 * np.arange(count) / SR)


def _place(audio: np.ndarray, start: int, tone: np.ndarray, left: float, right: float) -> None:
    if start >= len(audio):
        return
    end = min(len(audio), start + len(tone))
    count = end - start
    audio[start:end, 0] += tone[:count] * left
    audio[start:end, 1] += tone[:count] * right


def _bars(bpm: int, frames: int) -> int:
    bar = 4 * 60 / bpm * SR
    return max(1, int(round(frames / bar)))


def _bar_span(bar: int, bpm: int, frames: int) -> tuple[int, int]:
    bar_length = 4 * 60 / bpm * SR
    start = min(frames, int(round(bar * bar_length)))
    end = min(frames, int(round((bar + 1) * bar_length)))
    return start, end


def _peak_normalize(audio: np.ndarray, level: float) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak == 0:
        return audio
    return audio * (level / peak)


def _limit(audio: np.ndarray) -> np.ndarray:
    """Hold the sum just under 0 dBFS."""
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > _LIMIT_DB:
        audio = audio * (_LIMIT_DB / peak)
    return np.clip(audio, -_LIMIT_DB, _LIMIT_DB)


def _trim(audio: np.ndarray, frames: int) -> np.ndarray:
    if len(audio) > frames:
        return audio[:frames]
    if len(audio) < frames:
        pad = np.zeros((frames - len(audio), 2), dtype=np.float64)
        return np.vstack((audio, pad))
    return audio
