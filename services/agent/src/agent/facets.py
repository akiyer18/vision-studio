"""Facet catalog. Conditions decide what can be asked. Importance is the fallback order."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FacetValue:
    label: str
    descriptor: str


@dataclass(frozen=True)
class Facet:
    id: str
    layer: str
    group: str
    label: str
    question: str
    intent: str
    importance: int
    when: str
    values: tuple[FacetValue, ...]

    def find(self, text: str) -> FacetValue | None:
        needle = text.strip().lower()
        if not needle:
            return None
        for value in self.values:
            if needle == value.label.lower():
                return value
        return None

    @property
    def labels(self) -> tuple[str, ...]:
        return tuple(value.label for value in self.values)


@dataclass(frozen=True)
class FacetPick:
    facet_id: str
    text: str
    options: tuple[str, ...]
    reason: str


def facets_dir() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "kb" / "facets"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("kb/facets")


def load_facets(directory: Path | None = None) -> tuple[Facet, ...]:
    root = directory or facets_dir()
    if root.name != "facets":
        raise ValueError("Create facets load only from kb/facets")
    found: list[Facet] = []
    seen: set[str] = set()
    for path in sorted(root.glob("*.yaml")):
        document = _parse(path.read_text(encoding="utf-8"))
        if any(key in document for key in ("category", "hits", "objective", "instructions")):
            raise ValueError(f"{path.name} is an exercise file, not a Create facet")
        layer = str(document.get("layer") or "").strip()
        if not layer:
            raise ValueError(f"{path.name} has no layer")
        for group in document.get("groups") or []:
            group_id = str(group.get("id") or "").strip()
            group_label = str(group.get("label") or group_id).strip()
            for raw in group.get("facets") or []:
                facet = _facet(layer, group_id, group_label, raw, path.name)
                if facet.id in seen:
                    raise ValueError(f"duplicate facet {facet.id}")
                seen.add(facet.id)
                found.append(facet)
    if not found:
        raise FileNotFoundError("kb/facets has no facets")
    return tuple(found)


def applicable(
    catalog: tuple[Facet, ...],
    *,
    mode: str,
    layers: set[str],
    sound: str,
    answers: dict[str, str],
    asked: set[str],
) -> list[Facet]:
    sound_name = sound.lower()
    ready: list[Facet] = []
    for facet in catalog:
        if facet.id in asked:
            continue
        if facet.layer == "sound":
            if mode != "one_sound" or facet.group not in sound_name:
                continue
        elif facet.layer not in layers:
            continue
        if not _condition_met(facet.when, answers):
            continue
        ready.append(facet)
    return ready


def by_importance(candidates: list[Facet]) -> Facet | None:
    if not candidates:
        return None
    return max(candidates, key=lambda facet: facet.importance)


def guard_pick(pick: FacetPick, candidates: list[Facet], asked: set[str]) -> FacetPick | str:
    """A usable pick, or a plain-language reason to refuse it."""
    if pick.facet_id in asked:
        return f"Did not ask {pick.facet_id} again."
    if all(facet.id != pick.facet_id for facet in candidates):
        return f"Rejected {pick.facet_id}: it does not apply."
    facet = next(facet for facet in candidates if facet.id == pick.facet_id)
    options = tuple(option.strip() for option in pick.options if option.strip())
    if not 2 <= len(options) <= 4:
        return f"Rejected the {facet.id} options: a question needs 2 to 4 choices."
    invalid = [option for option in options if option not in facet.labels]
    if invalid:
        names = ", ".join(invalid)
        return f"Rejected the {facet.id} options: {names} is not a valid label."
    text = pick.text.strip() or facet.question
    reason = pick.reason.strip()
    if not reason.lower().startswith("asked"):
        reason = f"Asked about {facet.intent} because {reason[0].lower()}{reason[1:]}" if len(reason) > 1 else f"Asked about {facet.intent}"
    return FacetPick(facet.id, text, options, reason)


def fallback_pick(facet: Facet) -> FacetPick:
    return FacetPick(
        facet.id,
        facet.question,
        facet.labels[:4],
        f"Asked about {facet.intent} because it changes the sound",
    )


def resolve_answer(facet: Facet, text: str, mapped: str) -> tuple[str, str]:
    """A label and the descriptor that may go into a prompt."""
    found = facet.find(text)
    if found is not None:
        return found.label, found.descriptor
    if mapped:
        closest = facet.find(mapped)
        if closest is not None:
            return closest.label, closest.descriptor
        return text.strip(), " ".join(mapped.split())
    cleaned = text.strip()
    return cleaned, cleaned


def _condition_met(when: str, answers: dict[str, str]) -> bool:
    clause = when.strip()
    if not clause:
        return True
    for part in clause.split(" and "):
        facet_id, separator, needle = part.partition("~")
        if not separator:
            return False
        current = answers.get(facet_id.strip(), "")
        if needle.strip().lower() not in current.lower():
            return False
    return True


def _facet(layer: str, group: str, label: str, raw: dict, filename: str) -> Facet:
    facet_id = str(raw.get("id") or "").strip()
    question = str(raw.get("question") or "").strip()
    intent = str(raw.get("intent") or label).strip()
    if not facet_id or not question:
        raise ValueError(f"{filename} has a facet without an id or question")
    values = tuple(
        FacetValue(label=str(item.get("label") or "").strip(), descriptor=str(item.get("descriptor") or "").strip())
        for item in raw.get("values") or []
    )
    values = tuple(value for value in values if value.label and value.descriptor)
    if len(values) < 2:
        raise ValueError(f"{facet_id} needs at least two values")
    return Facet(
        id=facet_id,
        layer=layer,
        group=group,
        label=label,
        question=question,
        intent=intent,
        importance=int(raw.get("importance") or 0),
        when=str(raw.get("when") or "").strip(),
        values=values,
    )


def _parse(text: str) -> dict:
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        lines.append((len(raw) - len(raw.lstrip(" ")), stripped))
    if not lines:
        return {}
    parsed, index = _block(lines, 0, 0)
    if index != len(lines) or not isinstance(parsed, dict):
        raise ValueError("facet file did not parse")
    return parsed


def _block(lines: list[tuple[int, str]], index: int, indent: int) -> tuple[dict | list, int]:
    if index < len(lines) and lines[index][0] == indent and lines[index][1].startswith("- "):
        items: list[dict] = []
        while index < len(lines) and lines[index][0] == indent and lines[index][1].startswith("- "):
            key, value = _pair(lines[index][1][2:])
            index += 1
            node: dict = {key: value} if value is not None else {}
            if index < len(lines) and lines[index][0] > indent:
                child, index = _block(lines, index, lines[index][0])
                if isinstance(child, dict):
                    node.update(child)
            items.append(node)
        return items, index
    mapping: dict = {}
    while index < len(lines) and lines[index][0] == indent and not lines[index][1].startswith("- "):
        key, value = _pair(lines[index][1])
        index += 1
        if value is None:
            if index >= len(lines) or lines[index][0] <= indent:
                mapping[key] = ""
                continue
            child, index = _block(lines, index, lines[index][0])
            mapping[key] = child
        else:
            mapping[key] = value
    return mapping, index


def _pair(text: str) -> tuple[str, object | None]:
    key, separator, value = text.partition(":")
    if not separator:
        raise ValueError(f"expected key: value in {text}")
    body = value.strip()
    if not body:
        return key.strip(), None
    return key.strip(), _scalar(body)


def _scalar(value: str) -> object:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    if value.isdigit():
        return int(value)
    return value


_CATALOG: tuple[Facet, ...] | None = None


def catalog() -> tuple[Facet, ...]:
    global _CATALOG
    if _CATALOG is None:
        _CATALOG = load_facets()
    return _CATALOG


def facet_by_id(facet_id: str) -> Facet | None:
    for facet in catalog():
        if facet.id == facet_id:
            return facet
    return None
