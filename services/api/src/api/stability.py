"""Stable Audio over HTTP. URLs and field names come from stability.yaml and the environment."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from contracts import RenderJob, RenderResult

from api.audio import SR, analyse, bar_frames, bar_seconds, session_dir, wav_name, write_wav
from api.renderer import MockRenderer

_ENV = {
    "text_url": "STABILITY_TEXT_URL",
    "audio_url": "STABILITY_AUDIO_URL",
}


@dataclass(frozen=True)
class StabilityConfig:
    text_url: str
    audio_url: str
    api_key: str
    text_fields: dict[str, str]
    audio_fields: dict[str, str]

    @property
    def ready(self) -> bool:
        if not self.text_url or not self.audio_url or not self.api_key:
            return False
        needed = ("prompt", "negative_prompt", "duration", "seed")
        if any(not self.text_fields.get(name) for name in needed):
            return False
        audio_needed = ("prompt", "negative_prompt", "duration", "source", "noise")
        return all(self.audio_fields.get(name) for name in audio_needed)


def load_config(path: Path | None = None) -> StabilityConfig:
    raw: dict = {}
    file = path or Path(__file__).resolve().parents[2] / "stability.yaml"
    if file.is_file():
        raw = _read_yaml(file.read_text(encoding="utf-8"))
    text_url = os.environ.get(_ENV["text_url"], str(raw.get("text_url", ""))).strip()
    audio_url = os.environ.get(_ENV["audio_url"], str(raw.get("audio_url", ""))).strip()
    key_env = str(raw.get("api_key_env", "STABILITY_API_KEY"))
    return StabilityConfig(
        text_url=text_url,
        audio_url=audio_url,
        api_key=os.environ.get(key_env, "").strip(),
        text_fields=_fields(raw.get("text_fields")),
        audio_fields=_fields(raw.get("audio_fields")),
    )


class StabilityAPIRenderer:
    def __init__(self, data_root: Path, config: StabilityConfig | None = None) -> None:
        self.data_root = data_root
        self.config = config or load_config()
        self.mock = MockRenderer(data_root)
        self.notes: list[str] = []
        self.last_payload: dict[str, object] = {}

    def render(self, job: RenderJob, chords: list[str]) -> RenderResult:
        if not self.config.ready:
            self.notes.append("Stability API is not configured, used the mock renderer")
            return self.mock.render(job, chords)
        try:
            payload = _payload(self.config, job)
            self.last_payload = payload
            audio = _post(self.config, job, payload)
            return _save(self.data_root, job, audio)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
            self.notes.append(f"Stability API failed, used the mock renderer: {error}")
            return self.mock.render(job, chords)


def _payload(config: StabilityConfig, job: RenderJob) -> dict[str, object]:
    duration = round(bar_seconds(job.bpm, job.bars), 3)
    if job.init_audio:
        fields = config.audio_fields
        body: dict[str, object] = {
            fields["prompt"]: job.prompt,
            fields["negative_prompt"]: job.negative,
            fields["duration"]: duration,
            fields["source"]: job.init_audio,
            fields["noise"]: job.noise if job.noise is not None else 0.5,
        }
        return {"url": config.audio_url, "audio": True, "body": body}
    fields = config.text_fields
    body = {
        fields["prompt"]: job.prompt,
        fields["negative_prompt"]: job.negative,
        fields["duration"]: duration,
        fields["seed"]: job.seed,
    }
    return {"url": config.text_url, "audio": False, "body": body}


def _post(config: StabilityConfig, job: RenderJob, payload: dict[str, object]) -> np.ndarray:
    body = payload["body"]
    if not isinstance(body, dict):
        raise ValueError("payload body is missing")
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        str(payload["url"]),
        data=data,
        headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    if raw[:4] == b"RIFF":
        return _pcm(raw)
    raise ValueError("the stability response was not a WAV")


def _save(data_root: Path, job: RenderJob, audio: np.ndarray) -> RenderResult:
    frames = bar_frames(job.bpm, job.bars)
    trimmed = audio[:frames]
    if len(trimmed) < frames:
        pad = np.zeros((frames - len(trimmed), 2), dtype=np.float64)
        trimmed = np.vstack([trimmed, pad])
    peak = float(np.max(np.abs(trimmed))) if trimmed.size else 0.0
    if peak > 0:
        trimmed = trimmed * (10 ** (-1 / 20) / peak)
    name = wav_name(job.layer, job.bpm, job.bars, job.variant)
    path = session_dir(data_root, job.session_id) / "renders" / name
    write_wav(path, trimmed)
    features = analyse(path, "full_track")
    return RenderResult(
        layer=job.layer,
        variant=job.variant,
        path=str(path),
        seconds=bar_seconds(job.bpm, job.bars),
        bpm=job.bpm,
        detected_key=features.key,
        detected_bpm=features.bpm,
    )


def _pcm(raw: bytes) -> np.ndarray:
    import wave
    from io import BytesIO

    with wave.open(BytesIO(raw), "rb") as handle:
        channels = handle.getnchannels()
        frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2").astype(np.float64)
    if channels == 1:
        frames = np.column_stack([frames, frames])
    else:
        frames = frames.reshape(-1, channels)[:, :2]
    return frames / 32768.0


def _fields(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): str(item).strip() for key, item in value.items()}


def _read_yaml(text: str) -> dict:
    """A small reader for the flat stability.yaml. It is not a general YAML parser."""
    root: dict = {}
    current: dict | None = None
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if line.startswith("  "):
            if current is None:
                continue
            key, value = line.strip().split(":", 1)
            current[key.strip()] = value.strip().strip('"')
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"')
        if value == "":
            current = {}
            root[key] = current
        else:
            current = None
            root[key] = value
    return root

