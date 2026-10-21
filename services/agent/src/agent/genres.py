"""Curated genre files. The model may rephrase the history and nothing else."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_ORDER = (
    "lofi-hip-hop",
    "house",
    "techno",
    "drum-and-bass",
    "ambient",
    "trap",
    "synthwave",
    "neo-soul",
)


@dataclass(frozen=True)
class GenreReference:
    artist: str
    tracks: tuple[str, ...]


@dataclass(frozen=True)
class Genre:
    id: str
    title: str
    tempo_range: str
    bpm: int
    keys: tuple[str, ...]
    instruments: tuple[str, ...]
    drum_pattern: str
    production: str
    references: tuple[GenreReference, ...]
    history: str


def genres_dir() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "kb" / "genres"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("kb/genres")


def load_genres(directory: Path | None = None) -> tuple[Genre, ...]:
    root = directory or genres_dir()
    found = {path.stem: path for path in root.glob("*.md")}
    missing = [name for name in _ORDER if name not in found]
    if missing:
        raise FileNotFoundError(f"missing genre files: {', '.join(missing)}")
    return tuple(load_genre(found[name]) for name in _ORDER)


def load_genre(path: Path) -> Genre:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"{path.name} needs front matter")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise ValueError(f"{path.name} front matter does not close")
    fields = _front(text[4:end])
    history = text[end + 5 :].strip()
    if not history.startswith("DRAFT"):
        raise ValueError(f"{path.name} must stay marked DRAFT until it is edited")
    keys = _csv(fields["keys"])
    instruments = _csv(fields["instruments"])
    references = _references(fields["references"])
    if not keys or not instruments or not references:
        raise ValueError(f"{path.name} is missing keys, instruments, or references")
    return Genre(
        id=path.stem,
        title=_required(fields, "title"),
        tempo_range=_required(fields, "tempo_range"),
        bpm=int(_required(fields, "bpm")),
        keys=tuple(keys),
        instruments=tuple(instruments),
        drum_pattern=_required(fields, "drum_pattern"),
        production=_required(fields, "production"),
        references=tuple(references),
        history=history,
    )


def reference_values(genre: Genre) -> dict[str, str]:
    """Slots Use in Create sends, stored later with source reference."""
    return {
        "genre": genre.title,
        "tempo": str(genre.bpm),
        "key": genre.keys[0],
        "palette": ", ".join(genre.instruments),
        "pattern": genre.drum_pattern,
        "production": genre.production,
    }


def present_history(genre: Genre, complete=None) -> str:
    """Rephrase the history only. The file text is the fallback."""
    if complete is None:
        return genre.history
    try:
        payload = complete(genre.history)
    except Exception:
        return genre.history
    if not isinstance(payload, dict):
        return genre.history
    history = payload.get("history")
    if not isinstance(history, str) or not history.strip():
        return genre.history
    return history.strip()


def _front(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition(":")
        if not value.strip():
            raise ValueError(f"genre field {key} needs a value")
        fields[key.strip()] = value.strip()
    return fields


def _required(fields: dict[str, str], name: str) -> str:
    value = fields.get(name, "").strip()
    if not value:
        raise ValueError(f"genre field {name} is empty")
    return value


def _csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def _references(value: str) -> list[GenreReference]:
    found: list[GenreReference] = []
    for part in value.split("|"):
        artist, _, tracks = part.partition(":")
        names = _csv(tracks)
        if artist.strip() and names:
            found.append(GenreReference(artist.strip(), tuple(names)))
    return found
