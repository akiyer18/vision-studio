"""Slot table loaded from services/agent/slots.yaml."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ASK_THRESHOLD = 0.35
MAX_QUESTIONS = 5
ABOUT_QUESTION = "What is this song about?"


@dataclass(frozen=True)
class SlotSpec:
    slot: str
    impact: float
    ask_when: str
    question: str
    options: tuple[str, ...]


def slots_path() -> Path:
    return Path(__file__).resolve().parents[2] / "slots.yaml"


@lru_cache(maxsize=1)
def slot_specs() -> tuple[SlotSpec, ...]:
    specs: list[SlotSpec] = []
    current: dict[str, object] | None = None
    for raw in slots_path().read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith(" ") and line.endswith(":"):
            current = {"slot": line[:-1].strip(), "options": []}
            specs.append(_spec_from(current))
            continue
        if current is None:
            raise ValueError(f"slots.yaml entry before a slot name: {raw}")
        stripped = line.strip()
        if stripped.startswith("- "):
            options = list(current["options"])
            options.append(stripped[2:].strip())
            current["options"] = options
            specs[-1] = _spec_from(current)
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key == "impact":
            current[key] = float(value)
        elif key == "options":
            current["options"] = []
        else:
            current[key] = value
        specs[-1] = _spec_from(current)
    if len(specs) != 10:
        raise ValueError(f"expected 10 slots, found {len(specs)}")
    return tuple(specs)


def _spec_from(current: dict[str, object]) -> SlotSpec:
    raw_options = current.get("options", [])
    options = raw_options if isinstance(raw_options, list) else []
    return SlotSpec(
        slot=str(current["slot"]),
        impact=float(current.get("impact", 0)),
        ask_when=str(current.get("ask_when", "")),
        question=str(current.get("question", "")),
        options=tuple(str(option) for option in options),
    )
