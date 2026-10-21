"""Session files, WAV length, ffmpeg conversion, and librosa analysis."""

from __future__ import annotations

import re
import subprocess
import wave
from pathlib import Path

import numpy as np
from contracts import AudioFeatures

SR = 44100
UPLOAD_LIMIT = 50 * 1024 * 1024
SECTION = "verse"
_SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
_CONVERT = {".webm", ".opus", ".ogg", ".weba", ".mp3", ".m4a", ".mp4", ".aac"}
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


class ConversionError(RuntimeError):
    pass


def default_data_root() -> Path:
    return Path(__file__).resolve().parents[4] / "data"


def check_session_id(session_id: str) -> str:
    if _SESSION_ID.match(session_id) is None:
        raise ValueError("session_id must be letters, numbers, hyphens, or underscores")
    return session_id


def session_dir(data_root: Path, session_id: str) -> Path:
    return data_root / "sessions" / check_session_id(session_id)


def bar_seconds(bpm: int, bars: int) -> float:
    return bars * 4 * 60 / bpm


def bar_frames(bpm: int, bars: int) -> int:
    return int(round(bar_seconds(bpm, bars) * SR))


def wav_name(layer: str, bpm: int, bars: int, variant: int) -> str:
    return f"{SECTION}_{layer}_{bpm}bpm_{bars}bars_v{variant}.wav"


def midi_name(kind: str, bpm: int, bars: int) -> str:
    return f"{SECTION}_{kind}_{bpm}bpm_{bars}bars.mid"


def write_wav(path: Path, samples: np.ndarray) -> None:
    """Write 44.1 kHz, 16 bit, stereo PCM trimmed to the buffer length."""
    audio = np.asarray(samples, dtype=np.float64)
    if audio.ndim != 2 or audio.shape[1] != 2:
        raise ValueError("audio must be stereo")
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1:
        audio = audio / peak
    pcm = np.clip(audio * 32767, -32768, 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", Path(name).name).strip("._")
    return cleaned or "upload"


def needs_conversion(filename: str, content_type: str | None) -> bool:
    if Path(filename).suffix.lower() in _CONVERT:
        return True
    kind = (content_type or "").lower()
    return any(token in kind for token in ("webm", "opus", "ogg", "mpeg", "mp3", "mp4", "m4a"))


def convert_to_wav(source: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        completed = subprocess.run(
            ["ffmpeg", "-y", "-i", str(source), "-ar", str(SR), "-ac", "2", "-sample_fmt", "s16", str(dest)],
            check=False,
            capture_output=True,
        )
    except FileNotFoundError as error:
        raise ConversionError("ffmpeg is not installed") from error
    if completed.returncode != 0:
        raise ConversionError("ffmpeg could not convert the recording")


def analyse(path: Path, input_type: str) -> AudioFeatures:
    import librosa

    samples, rate = librosa.load(path, sr=SR, mono=True)
    tempo, _beats = librosa.beat.beat_track(y=samples, sr=rate)
    bpm = float(np.median(np.atleast_1d(tempo)))
    chroma = np.mean(librosa.feature.chroma_cqt(y=samples, sr=rate), axis=1)
    key, mode, confidence = _key_from_chroma(chroma)
    detected = float(bpm) if np.isfinite(bpm) and bpm > 0 else None
    return AudioFeatures(input_type=input_type, key=key, mode=mode, bpm=detected, confidence=confidence)


def _key_from_chroma(chroma: np.ndarray) -> tuple[str, str, float]:
    scores = [
        (_correlation(chroma, np.roll(profile, shift)), shift, mode)
        for mode, profile in (("major", _MAJOR), ("minor", _MINOR))
        for shift in range(12)
    ]
    scores.sort(reverse=True)
    best, shift, mode = scores[0]
    second = scores[1][0]
    confidence = float(np.clip((best - second) / (abs(best) + 1e-6), 0.0, 1.0))
    return _NAMES[shift], mode, confidence


def _correlation(left: np.ndarray, right: np.ndarray) -> float:
    if float(np.std(left)) == 0 or float(np.std(right)) == 0:
        return 0.0
    value = float(np.corrcoef(left, right)[0, 1])
    if not np.isfinite(value):
        return 0.0
    return value
