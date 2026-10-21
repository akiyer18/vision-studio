"""How a result was made, and how to rebuild it in Logic."""

from __future__ import annotations

from dataclasses import dataclass

from contracts import LayerPrompt, SongBrief, TraceStep

_LABELS = {
    "output": "Output",
    "mood": "Mood",
    "energy": "Energy",
    "world": "World",
    "key": "Key",
    "style": "Style",
    "palette": "Palette",
    "structure": "Structure",
    "must_keep": "Must keep",
    "tempo": "Tempo",
    "sound": "Sound",
    "genre": "Genre",
    "brightness": "Brightness",
    "pattern": "Pattern",
    "production": "Production",
}


@dataclass(frozen=True)
class Explanation:
    how: str
    steps: tuple[str, ...]
    source: str


def explain_template(brief: SongBrief, prompts: list[LayerPrompt], trace: list[TraceStep]) -> Explanation:
    lines: list[str] = []
    slots = brief.slots.model_dump(exclude_none=True)
    for name, label in _LABELS.items():
        slot = slots.get(name)
        if not isinstance(slot, dict):
            continue
        value = slot.get("value")
        reason = slot.get("reason")
        if isinstance(value, str) and value and isinstance(reason, str):
            lines.append(f"{label}: {value}. {reason}.")
    details = [step.detail for step in trace if step.detail]
    if details:
        lines.append("Choices: " + "; ".join(details))
    how = " ".join(lines) if lines else "The brief has no filled slots yet."
    steps = tuple(
        "In Logic, add a "
        f"{prompt.layer.replace('_', ' ')} track and shape it with Logic's instruments and plugins until it matches: {prompt.prompt}"
        for prompt in prompts
    )
    return Explanation(how=how, steps=steps, source="template")


def explain_result(brief: SongBrief, prompts: list[LayerPrompt], trace: list[TraceStep], complete=None) -> Explanation:
    """complete is the Claude call. Any failure keeps the template."""
    fallback = explain_template(brief, prompts, trace)
    if complete is None:
        return fallback
    try:
        payload = complete(brief, prompts, trace)
    except Exception:
        return fallback
    if not isinstance(payload, dict):
        return fallback
    how = payload.get("how")
    steps = payload.get("steps")
    if not isinstance(how, str) or not how.strip():
        return fallback
    if not isinstance(steps, list) or not steps or not all(isinstance(step, str) and step.strip() for step in steps):
        return fallback
    return Explanation(how=how.strip(), steps=tuple(step.strip() for step in steps), source="claude")
