"""Estimate a performance from audio. Every finding carries a confidence, and the result stays approximate."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from agent.compare import score
from agent.exercises import BassNote, Exercise
from api.audio import SR

_CONFIDENT = 0.6


def compare_audio(exercise: Exercise, audio: np.ndarray, sr: int = SR) -> dict[str, object]:
    mono = np.asarray(audio, dtype=np.float64)
    if mono.ndim == 2:
        mono = mono.mean(axis=1)
    heard, uncertain, confidences, transcriber = _hear(exercise, mono, sr)
    result = score(exercise, heard, source="audio", approximate=True)
    absence = 0.72 if _dense(heard, exercise) else 0.35
    kept: list[dict[str, object]] = []
    missing = result["missing"] if isinstance(result["missing"], list) else []
    for item in missing:
        if not isinstance(item, dict):
            continue
        confidence = float(confidences.get((item["bar"], item["step"], item["what"]), absence))
        item["confidence"] = round(confidence, 3)
        if confidence < _CONFIDENT:
            uncertain.append(item)
        else:
            kept.append(item)
    result["missing"] = kept
    for key in ("matches", "differences"):
        bucket = result.get(key)
        if not isinstance(bucket, list):
            continue
        staying: list[dict[str, object]] = []
        for item in bucket:
            if not isinstance(item, dict):
                continue
            item["confidence"] = round(float(confidences.get((item["bar"], item["step"], item["what"]), 0.75)), 3)
            if float(item["confidence"]) < _CONFIDENT:
                uncertain.append(item)
            else:
                staying.append(item)
        result[key] = staying
    for item in uncertain:
        item.setdefault("confidence", 0.4)
    result["uncertain"] = uncertain
    result["approximate"] = True
    result["source"] = "audio"
    result["transcriber"] = transcriber
    return result


def read_wav(path: Path) -> np.ndarray:
    import wave

    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2").astype(np.float64)
    if channels == 1:
        frames = np.column_stack([frames, frames])
    else:
        frames = frames.reshape(-1, channels)[:, :2]
    return frames / 32768.0


def _hear(
    exercise: Exercise, mono: np.ndarray, sr: int
) -> tuple[dict[str, object], list[dict[str, object]], dict[tuple[object, object, object], float], str]:
    drums: dict[tuple[int, int], dict[str, int]] = {}
    bass: list[BassNote] = []
    chords: dict[int, list[int]] = {}
    uncertain: list[dict[str, object]] = []
    confidences: dict[tuple[object, object, object], float] = {}
    transcriber = "built-in"
    if exercise.hits:
        for event in _drum_events(mono, sr, exercise):
            key = (event["bar"], event["step"], event["what"])
            confidences[key] = event["confidence"]
            if event["confidence"] < _CONFIDENT:
                uncertain.append(_finding(event))
                continue
            slot = drums.setdefault((int(event["bar"]), int(event["step"])), {})
            slot[str(event["drum"])] = max(int(event["velocity"]), slot.get(str(event["drum"]), 0))
    pitched = _basic_pitch(mono, sr)
    if pitched is not None:
        transcriber = "basic-pitch"
    if exercise.bass:
        notes = pitched if pitched is not None else _bass_estimate(mono, sr, exercise)
        for note, confidence in notes:
            if note.bar < 1 or note.bar > exercise.bars:
                continue
            confidences[(note.bar, note.start, "bass")] = confidence
            if confidence < _CONFIDENT:
                uncertain.append(_finding({"bar": note.bar, "step": note.start, "what": "bass", "confidence": confidence}))
            else:
                bass.append(note)
    if exercise.chords:
        for bar, pitches, confidence in _chord_bars(mono, sr, exercise):
            confidences[(bar, 0, "chord")] = confidence
            symbol = exercise.chords[bar - 1].symbol if bar - 1 < len(exercise.chords) else "chord"
            confidences[(bar, 0, symbol)] = confidence
            confidences[(bar, 0, "inversion")] = min(confidence, 0.55)
            if confidence < _CONFIDENT:
                uncertain.append(_finding({"bar": bar, "step": 0, "what": symbol, "confidence": confidence}))
            else:
                chords[bar] = pitches
    return {"drums": drums, "bass": bass, "chords": chords}, uncertain, confidences, transcriber


def _drum_events(mono: np.ndarray, sr: int, exercise: Exercise) -> list[dict[str, object]]:
    hop = max(1, int(0.005 * sr))
    window = max(64, int(0.02 * sr))
    if mono.size < window:
        return []
    lows: list[float] = []
    mids: list[float] = []
    highs: list[float] = []
    times: list[float] = []
    for start in range(0, len(mono) - window, hop):
        segment = mono[start : start + window] * np.hanning(window)
        spectrum = np.abs(np.fft.rfft(segment))
        freqs = np.fft.rfftfreq(window, 1 / sr)
        lows.append(float(spectrum[freqs < 180].sum()))
        mids.append(float(spectrum[(freqs >= 180) & (freqs < 2500)].sum()))
        highs.append(float(spectrum[freqs >= 5000].sum()))
        times.append(start / sr)
    bands = {"kick": _peaks(np.array(lows)), "snare": _peaks(np.array(mids)), "hat": _peaks(np.array(highs))}
    events: list[dict[str, object]] = []
    step_seconds = (60 / exercise.tempo) / 4
    origin = _origin(bands["kick"][0], times, step_seconds)
    for drum, (indexes, flux, threshold) in bands.items():
        for index in indexes:
            raw = int(round(times[index] / step_seconds)) - origin
            if raw < 0:
                continue
            bar = raw // 16 + 1
            step = raw % 16
            if bar < 1 or bar > exercise.bars:
                continue
            confidence = float(min(1.0, flux[index] / (threshold * 3 or 1)))
            what = "ghost snare" if drum == "snare" and confidence < 0.75 else drum
            events.append(
                {
                    "bar": bar,
                    "step": step,
                    "beat": step // 4 + 1,
                    "drum": drum,
                    "what": what,
                    "velocity": 40 if what == "ghost snare" else 100,
                    "confidence": confidence,
                }
            )
    return events


def _peaks(band: np.ndarray) -> tuple[list[int], np.ndarray, float]:
    if band.size == 0:
        return [], band, 1.0
    flux = np.maximum(0, np.diff(band, prepend=band[0]))
    threshold = float(np.median(flux) + np.std(flux))
    if threshold <= 0:
        threshold = float(np.max(flux) * 0.5 or 1)
    found = [
        index
        for index in range(1, len(flux) - 1)
        if flux[index] >= threshold and flux[index] >= flux[index - 1] and flux[index] >= flux[index + 1]
    ]
    return found, flux, threshold


def _origin(indexes: list[int], times: list[float], step_seconds: float) -> int:
    if not indexes:
        return 0
    first = int(round(times[indexes[0]] / step_seconds))
    barline = (first // 16) * 16
    return barline if 0 <= first - barline <= 1 else first


def _bass_estimate(mono: np.ndarray, sr: int, exercise: Exercise) -> list[tuple[BassNote, float]]:
    notes: list[tuple[BassNote, float]] = []
    for bar in range(1, exercise.bars + 1):
        for step in range(16):
            start, end = _slice(bar, step, 1, len(mono), exercise.bars)
            pitch, confidence = _low_pitch(mono[start:end], sr)
            if pitch is None or confidence < 0.45:
                continue
            notes.append((BassNote(bar, step, 1, pitch), confidence))
    return notes


def _chord_bars(mono: np.ndarray, sr: int, exercise: Exercise) -> list[tuple[int, list[int], float]]:
    rows: list[tuple[int, list[int], float]] = []
    for bar in range(1, exercise.bars + 1):
        start, end = _slice(bar, 0, 16, len(mono), exercise.bars)
        segment = mono[start:end]
        bins = _chroma(segment, sr)
        peak = float(bins.max())
        if peak <= 0:
            rows.append((bar, [], 0.2))
            continue
        chosen = [index for index in range(12) if bins[index] >= 0.45 * peak]
        lowest, low_confidence = _low_pitch(segment, sr)
        pitches = [60 + pitch_class for pitch_class in chosen]
        if lowest is not None:
            pitches = [lowest] + [pitch for pitch in pitches if pitch % 12 != lowest % 12]
        energy = float(sum(bins[pitch_class] for pitch_class in chosen) / (bins.sum() or 1))
        confidence = min(1.0, energy) if low_confidence >= 0.4 else min(0.55, energy)
        rows.append((bar, pitches, confidence))
    return rows


def _basic_pitch(mono: np.ndarray, sr: int) -> list[tuple[BassNote, float]] | None:
    try:
        from basic_pitch.inference import predict
    except Exception:
        return None
    import tempfile
    import wave

    pcm = np.clip(mono * 32767, -32768, 32767).astype("<i2")
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav") as handle:
            with wave.open(handle, "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(sr)
                writer.writeframes(pcm.tobytes())
            _model, _midi, events = predict(handle.name)
    except Exception:
        return None
    notes: list[tuple[BassNote, float]] = []
    for event in events:
        if len(event) < 4:
            continue
        start, end, pitch, amplitude = event[0], event[1], int(event[2]), float(event[3])
        step = int(round(start / ((60 / 100) / 4)))
        bar = step // 16 + 1
        length = max(1, int(round((end - start) / ((60 / 100) / 4))))
        notes.append((BassNote(bar, step % 16, length, pitch), min(1.0, amplitude)))
    return notes


def _low_pitch(segment: np.ndarray, sr: int) -> tuple[int | None, float]:
    if segment.size < 64:
        return None, 0.0
    spectrum = np.abs(np.fft.rfft(segment * np.hanning(segment.size)))
    freqs = np.fft.rfftfreq(segment.size, 1 / sr)
    band = (freqs >= 40) & (freqs <= 400)
    if not np.any(band) or float(spectrum[band].max()) <= 0:
        return None, 0.0
    local = spectrum[band]
    freq = float(freqs[band][int(np.argmax(local))])
    confidence = float(local.max() / (spectrum.max() or 1))
    if freq <= 0:
        return None, 0.0
    return int(round(69 + 12 * np.log2(freq / 440))), min(1.0, confidence)


def _chroma(mono: np.ndarray, sr: int) -> np.ndarray:
    if mono.size < 64:
        return np.zeros(12)
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(mono.size)))
    freqs = np.fft.rfftfreq(mono.size, 1 / sr)
    bins = np.zeros(12)
    for magnitude, freq in zip(spectrum, freqs, strict=True):
        if freq < 40:
            continue
        midi = 69 + 12 * np.log2(freq / 440)
        bins[int(round(midi)) % 12] += magnitude
    return bins


def _slice(bar: int, step: int, length: int, frames: int, bars: int) -> tuple[int, int]:
    width = frames / (bars * 16)
    start = int(round(((bar - 1) * 16 + step) * width))
    end = int(round(((bar - 1) * 16 + step + length) * width))
    return max(0, min(frames, start)), max(0, min(frames, end))


def _dense(heard: dict[str, object], exercise: Exercise) -> bool:
    drums = heard.get("drums")
    if not isinstance(drums, dict) or not exercise.hits:
        return bool(heard.get("chords"))
    return len(drums) >= max(1, len({(hit.bar, hit.step) for hit in exercise.hits}) // 2)


def _finding(event: dict[str, object]) -> dict[str, object]:
    return {
        "bar": event["bar"],
        "beat": event.get("beat", int(event["step"]) // 4 + 1),
        "step": event["step"],
        "what": event["what"],
        "confidence": round(float(event["confidence"]), 3),
    }
