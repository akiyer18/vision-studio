"""Session files, WAV length, ffmpeg conversion, and librosa analysis."""

from __future__ import annotations

import logging
import re
import secrets
import subprocess
import wave
from pathlib import Path

import numpy as np
from contracts import AudioFeatures

logger = logging.getLogger("api")

SR = 44100
UPLOAD_LIMIT = 50 * 1024 * 1024
MAX_SECONDS = 5 * 60
SECTION = "verse"
_SESSION_ID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_EXT = {
    ".wav": "wav",
    ".mp3": "mp3",
    ".m4a": "m4a",
    ".aiff": "aiff",
    ".aif": "aiff",
    ".webm": "webm",
    ".mid": "mid",
    ".midi": "mid",
}
_CONVERT = {"mp3", "m4a", "aiff", "webm"}
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


class ConversionError(RuntimeError):
    pass


def default_data_root() -> Path:
    return Path(__file__).resolve().parents[4] / "data"


def check_session_id(session_id: str) -> str:
    if _SESSION_ID.fullmatch(session_id) is None:
        raise ValueError("session_id must be a UUID")
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


def sniff(payload: bytes) -> str | None:
    if len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WAVE":
        return "wav"
    if payload.startswith(b"ID3") or (len(payload) >= 2 and payload[0] == 0xFF and (payload[1] & 0xE0) == 0xE0):
        return "mp3"
    if len(payload) >= 12 and payload[4:8] == b"ftyp":
        return "m4a"
    if len(payload) >= 12 and payload[:4] == b"FORM" and payload[8:12] in {b"AIFF", b"AIFC"}:
        return "aiff"
    if payload.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"
    if payload.startswith(b"MThd"):
        return "mid"
    return None


def upload_kind(filename: str, payload: bytes) -> str:
    kind = _EXT.get(Path(filename).suffix.lower())
    if kind is None or sniff(payload) != kind:
        raise ValueError("Use a wav, mp3, m4a, aiff, webm, or mid file.")
    return kind


def stored_name(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".midi":
        suffix = ".mid"
    if suffix == ".aif":
        suffix = ".aiff"
    return f"{secrets.token_hex(16)}{suffix}"


def needs_conversion(kind: str) -> bool:
    return kind in _CONVERT


def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        if rate <= 0:
            raise ConversionError("ffmpeg could not convert the recording")
        return handle.getnframes() / rate


def assert_short_enough(path: Path) -> None:
    if wav_seconds(path) > MAX_SECONDS:
        raise ConversionError("That recording is longer than 5 minutes.")


def convert_to_wav(source: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    command = ["ffmpeg", "-y", "-i", str(source), "-ar", str(SR), "-ac", "2", "-sample_fmt", "s16", str(dest)]
    try:
        completed = subprocess.run(command, check=False, capture_output=True, timeout=60)
    except FileNotFoundError as error:
        raise ConversionError("ffmpeg is not installed") from error
    except subprocess.TimeoutExpired as error:
        logger.warning("ffmpeg timed out")
        raise ConversionError("ffmpeg could not convert the recording") from error
    if completed.returncode != 0:
        logger.warning("ffmpeg failed: %s", completed.stderr.decode(errors="replace")[:500])
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
