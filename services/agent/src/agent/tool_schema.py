"""Build the Bedrock tool schema from the slot JSON Schema. Do not hand-write slot fields."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from agent.slots import slot_specs

_CLOSED = ("mood", "energy", "world")


def schema_dir() -> Path:
    import contracts

    directory = Path(contracts.__file__).resolve().parents[2] / "schemas"
    if not (directory / "slot_value.json").is_file():
        raise FileNotFoundError(f"slot schemas are not at {directory}")
    return directory


@lru_cache(maxsize=1)
def extraction_schema() -> dict[str, object]:
    directory = schema_dir()
    slot_value = json.loads((directory / "slot_value.json").read_text(encoding="utf-8"))
    slot_names = json.loads((directory / "slot_name.json").read_text(encoding="utf-8"))["enum"]
    closed = {spec.slot: list(spec.options) for spec in slot_specs() if spec.slot in _CLOSED and spec.options}
    properties = slot_value["properties"]
    slots = {name: _slot_schema(name, properties, closed.get(name)) for name in slot_names}
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "slots": {
                "type": "object",
                "additionalProperties": False,
                "properties": slots,
            }
        },
    }


def _slot_schema(name: str, properties: dict[str, object], enum: list[str] | None) -> dict[str, object]:
    value: dict[str, object] = {"type": "string"}
    if enum:
        value["enum"] = enum
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "reason", "evidence"],
        "properties": {
            "value": value,
            "confidence": properties["confidence"],
            "reason": properties["reason"],
            "evidence": {"type": "string", "enum": ["text", "audio"]},
        },
    }
