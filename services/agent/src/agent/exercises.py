"""Exercise templates in kb/exercises, and variations that stay inside each level."""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, replace
from pathlib import Path

_LEVELS = {"beginner", "intermediate", "advanced"}
_CATEGORIES = {"rhythm", "harmony"}
_TYPES = {"drums", "bass", "chords"}
_DRUMS = {"kick", "snare", "hat", "open_hat"}
_A_MINOR = (45, 47, 48, 50, 52, 53, 55, 57)
_A_MINOR_PCS = {9, 11, 0, 2, 4, 5, 7}

_INTERMEDIATE_KICKS = (
    (0, 3, 8, 11),
    (0, 6, 8, 14),
    (0, 3, 8, 10),
    (0, 7, 8, 12),
    (0, 3, 6, 8, 14),
)
_ADVANCED_KICKS = (
    (0, 3, 6, 10, 14),
    (0, 3, 8, 10, 13),
    (0, 6, 7, 8, 11, 14),
    (0, 3, 6, 8, 11),
)
_INTERMEDIATE_CHORDS = (
    (
        ("C", (60, 64, 67), 0, ()),
        ("G", (59, 62, 67), 1, ()),
        ("Am", (57, 60, 64), 0, ()),
        ("F", (57, 60, 65), 1, ()),
    ),
    (
        ("C", (64, 67, 72), 1, ()),
        ("G", (62, 67, 71), 2, ()),
        ("Am", (60, 64, 69), 1, ()),
        ("F", (60, 65, 69), 2, ()),
    ),
    (
        ("C", (60, 64, 67), 0, ()),
        ("G", (62, 67, 71), 2, ()),
        ("Am", (64, 69, 72), 2, ()),
        ("F", (65, 69, 72), 0, ()),
    ),
)
_ADVANCED_CHORDS = (
    (
        ("Cm", (51, 55, 58, 60), 1, ("7",)),
        ("Ab", (51, 55, 56, 60), 2, ("7",)),
        ("Eb", (51, 55, 58, 62, 65), 0, ("7", "9")),
        ("Bb", (62, 65, 68, 70, 72), 1, ("7", "9")),
    ),
    (
        ("Cm", (60, 63, 67, 70, 74), 0, ("7", "9")),
        ("Ab", (60, 63, 68, 70), 1, ("9",)),
        ("Eb", (58, 62, 63, 67), 2, ("7",)),
        ("Bb", (58, 62, 65, 68), 0, ("7",)),
    ),
    (
        ("Cm", (55, 58, 60, 63), 2, ("7",)),
        ("Ab", (56, 60, 63, 67, 70), 0, ("7", "9")),
        ("Eb", (55, 58, 63, 65), 1, ("9",)),
        ("Bb", (53, 56, 58, 60, 62), 2, ("7", "9")),
    ),
)
_ADVANCED_BASS = (
    (
        (1, 2, 1, 45),
        (1, 6, 2, 57),
        (1, 11, 1, 48),
        (2, 1, 2, 52),
        (2, 9, 1, 45),
        (3, 5, 1, 55),
        (3, 12, 2, 57),
        (4, 0, 1, 45),
        (4, 2, 1, 47),
        (4, 4, 1, 48),
        (4, 6, 1, 50),
        (4, 8, 1, 52),
        (4, 10, 1, 53),
        (4, 12, 2, 57),
    ),
    (
        (1, 3, 1, 57),
        (1, 8, 1, 45),
        (1, 14, 1, 50),
        (2, 2, 2, 48),
        (2, 7, 1, 57),
        (2, 12, 1, 52),
        (3, 1, 1, 45),
        (3, 6, 2, 55),
        (3, 11, 1, 48),
        (4, 0, 1, 57),
        (4, 3, 1, 55),
        (4, 5, 1, 53),
        (4, 7, 1, 52),
        (4, 9, 1, 50),
        (4, 11, 1, 48),
        (4, 14, 1, 45),
    ),
)
_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
_TYPE_LABELS = {"drums": "Drums only", "bass": "Drums and bass line", "chords": "Harmony"}


@dataclass(frozen=True)
class Hit:
    bar: int
    step: int
    drum: str
    velocity: int


@dataclass(frozen=True)
class BassNote:
    bar: int
    start: int
    length: int
    pitch: int


@dataclass(frozen=True)
class Chord:
    bar: int
    symbol: str
    notes: tuple[int, ...]
    inversion: int
    extensions: tuple[str, ...]


@dataclass(frozen=True)
class Exercise:
    id: str
    category: str
    type: str
    level: str
    tempo: int
    bars: int
    key: str
    prompt: str
    objective: str
    instructions: str
    hits: tuple[Hit, ...]
    bass: tuple[BassNote, ...]
    chords: tuple[Chord, ...]

    @property
    def type_label(self) -> str:
        return _TYPE_LABELS[self.type]


def exercises_dir() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "kb" / "exercises"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("kb/exercises")


_EXERCISES: dict[str, Exercise] | None = None


def load_exercises(directory: Path | None = None) -> dict[str, Exercise]:
    global _EXERCISES
    if directory is None and _EXERCISES is not None:
        return _EXERCISES
    root = directory or exercises_dir()
    if root.name != "exercises":
        raise ValueError("Train exercises load only from kb/exercises")
    found: dict[str, Exercise] = {}
    for path in sorted(root.glob("*.yaml")):
        data = parse_yaml(path.read_text(encoding="utf-8"))
        if "groups" in data:
            raise ValueError(f"{path.name} is a Create facet file, not an exercise")
        exercise = exercise_from_data(data)
        found[exercise.id] = exercise
    if not found:
        raise FileNotFoundError("kb/exercises")
    if directory is None:
        _EXERCISES = found
    return found


def exercise_phrases() -> tuple[str, ...]:
    """Prompt, objective, and instruction text. Create must not store these as facets."""
    phrases: list[str] = []
    for exercise in load_exercises().values():
        for phrase in (exercise.prompt, exercise.objective, exercise.instructions):
            cleaned = phrase.strip()
            if cleaned:
                phrases.append(cleaned)
    return tuple(phrases)


def find_template(category: str, kind: str, level: str) -> Exercise:
    for exercise in load_exercises().values():
        if exercise.category == category and exercise.type == kind and exercise.level == level:
            return exercise
    raise KeyError(category, kind, level)


def apply_setup(
    exercise: Exercise,
    *,
    tempo: int | None = None,
    bars: int | None = None,
    key: str | None = None,
) -> Exercise:
    """Tempo, length, and key chosen on the setup card. The pattern repeats to fill the bars."""
    next_tempo = exercise.tempo if tempo is None else int(tempo)
    if not 40 <= next_tempo <= 220:
        next_tempo = exercise.tempo
    next_bars = exercise.bars if bars is None else int(bars)
    if next_bars not in (4, 8, 16, 32):
        next_bars = exercise.bars
    next_key = exercise.key
    delta = 0
    if key and exercise.key:
        old = _root(exercise.key)
        new = _root(key)
        if old is not None and new is not None:
            delta = (new - old) % 12
            if delta > 6:
                delta -= 12
            next_key = key.strip()
    if next_tempo == exercise.tempo and next_bars == exercise.bars and next_key == exercise.key and delta == 0:
        return exercise
    prompt = exercise.prompt
    if next_tempo != exercise.tempo:
        prompt = re.sub(r"\b\d+\s*BPM\b", f"{next_tempo} BPM", prompt)
    if next_bars != exercise.bars:
        prompt = re.sub(r"\b\d+-bar\b", f"{next_bars}-bar", prompt)
    if exercise.key and next_key != exercise.key and exercise.key in prompt:
        prompt = prompt.replace(exercise.key, next_key)
    return replace(
        exercise,
        tempo=next_tempo,
        bars=next_bars,
        key=next_key,
        prompt=prompt,
        hits=tuple(
            replace(hit, bar=bar)
            for hit in exercise.hits
            for bar in _places(hit.bar, exercise.bars, next_bars)
        ),
        bass=tuple(
            replace(note, bar=bar, pitch=max(0, min(127, note.pitch + delta)))
            for note in exercise.bass
            for bar in _places(note.bar, exercise.bars, next_bars)
        ),
        chords=tuple(
            replace(
                chord,
                bar=bar,
                symbol=_shift_symbol(chord.symbol, delta),
                notes=tuple(max(0, min(127, pitch + delta)) for pitch in chord.notes),
            )
            for chord in exercise.chords
            for bar in _places(chord.bar, exercise.bars, next_bars)
        ),
    )


def _places(bar: int, source: int, target: int) -> tuple[int, ...]:
    if target == source:
        return (bar,)
    if target < source:
        return (bar,) if bar <= target else ()
    return tuple(range(bar, target + 1, source))


def _root(label: str) -> int | None:
    token = label.strip().split(" ", 1)[0]
    token = {"Db": "C#", "D#": "Eb", "Gb": "F#", "G#": "Ab", "A#": "Bb"}.get(token, token)
    try:
        return _NAMES.index(token)
    except ValueError:
        return None


def _shift_symbol(symbol: str, delta: int) -> str:
    if delta == 0:
        return symbol
    for name in sorted(_NAMES, key=len, reverse=True):
        if symbol.startswith(name):
            return _NAMES[(_NAMES.index(name) + delta) % 12] + symbol[len(name) :]
    return symbol


def vary(template: Exercise, seed: int) -> Exercise:
    """A fresh exercise. Positions and chords stay inside the level's constraints."""
    rng = random.Random(seed)
    if template.category == "harmony" and template.level == "beginner":
        return _beginner_harmony(template, rng)
    if template.category == "harmony" and template.level == "intermediate":
        return _plan_chords(template, _INTERMEDIATE_CHORDS[rng.randrange(len(_INTERMEDIATE_CHORDS))])
    if template.category == "harmony":
        return _plan_chords(template, _ADVANCED_CHORDS[rng.randrange(len(_ADVANCED_CHORDS))])
    if template.level == "beginner":
        return _beginner_rhythm(template, rng)
    if template.level == "intermediate":
        return _intermediate_rhythm(template, rng)
    return _advanced_rhythm(template, rng)


def describe(exercise: Exercise) -> str:
    parts: list[str] = []
    if exercise.hits:
        parts.append(_describe_drums(exercise))
    if exercise.bass:
        parts.append(_describe_bass(exercise))
    if exercise.chords:
        parts.append(_describe_chords(exercise))
    return " ".join(parts)


def exercise_from_data(data: object) -> Exercise:
    if not isinstance(data, dict):
        raise ValueError("exercise file must be a map")
    for name in ("id", "category", "type", "level", "tempo", "bars", "prompt", "objective", "instructions"):
        if name not in data:
            raise ValueError(f"exercise is missing {name}")
    category = str(data["category"])
    kind = str(data["type"])
    level = str(data["level"])
    if category not in _CATEGORIES or kind not in _TYPES or level not in _LEVELS:
        raise ValueError("exercise category, type, or level is not recognised")
    tempo = int(data["tempo"])
    bars = int(data["bars"])
    hits = tuple(_hit(item, bars) for item in _rows(data.get("hits")))
    bass = tuple(_bass(item, bars) for item in _rows(data.get("bass")))
    chords = tuple(_chord(item, bars) for item in _rows(data.get("chords")))
    return Exercise(
        id=str(data["id"]),
        category=category,
        type=kind,
        level=level,
        tempo=tempo,
        bars=bars,
        key=str(data.get("key", "")),
        prompt=str(data["prompt"]),
        objective=str(data["objective"]),
        instructions=str(data["instructions"]),
        hits=hits,
        bass=bass,
        chords=chords,
    )


def exercise_to_dict(exercise: Exercise) -> dict[str, object]:
    return {
        "id": exercise.id,
        "category": exercise.category,
        "type": exercise.type,
        "level": exercise.level,
        "tempo": exercise.tempo,
        "bars": exercise.bars,
        "key": exercise.key,
        "prompt": exercise.prompt,
        "objective": exercise.objective,
        "instructions": exercise.instructions,
        "hits": [hit.__dict__ for hit in exercise.hits],
        "bass": [note.__dict__ for note in exercise.bass],
        "chords": [
            {
                "bar": chord.bar,
                "symbol": chord.symbol,
                "notes": list(chord.notes),
                "inversion": chord.inversion,
                "extensions": list(chord.extensions),
            }
            for chord in exercise.chords
        ],
    }


def parse_yaml(text: str) -> dict[str, object]:
    """The exercise files use maps, lists, quoted strings, and inline lists."""
    rows = _yaml_rows(text)
    value, index = _read(rows, 0, 0)
    if index != len(rows):
        raise ValueError("could not read the exercise file")
    if not isinstance(value, dict):
        raise ValueError("exercise file must be a map")
    return value


def _yaml_rows(text: str) -> list[tuple[int, str]]:
    rows: list[tuple[int, str]] = []
    for raw in text.splitlines():
        line = _strip_comment(raw).rstrip()
        if not line.strip():
            continue
        if line.startswith("\t"):
            raise ValueError("exercise files use spaces")
        indent = len(line) - len(line.lstrip(" "))
        rows.append((indent, line.strip()))
    return rows


def _strip_comment(raw: str) -> str:
    quoted = False
    for index, char in enumerate(raw):
        if char == '"':
            quoted = not quoted
        elif char == "#" and not quoted:
            return raw[:index]
    return raw


def _read(rows: list[tuple[int, str]], index: int, indent: int) -> tuple[object, int]:
    if index >= len(rows) or rows[index][0] < indent:
        return {}, index
    if rows[index][1].startswith("- "):
        return _read_list(rows, index, indent)
    return _read_map(rows, index, indent)


def _read_map(rows: list[tuple[int, str]], index: int, indent: int) -> tuple[dict[str, object], int]:
    data: dict[str, object] = {}
    while index < len(rows) and rows[index][0] == indent and not rows[index][1].startswith("- "):
        key, _, rest = rows[index][1].partition(":")
        rest = rest.strip()
        index += 1
        if rest == "":
            if index < len(rows) and rows[index][0] > indent:
                child, index = _read(rows, index, rows[index][0])
                data[key.strip()] = child
            else:
                data[key.strip()] = ""
        else:
            data[key.strip()] = _scalar(rest)
    return data, index


def _read_list(rows: list[tuple[int, str]], index: int, indent: int) -> tuple[list[object], int]:
    items: list[object] = []
    while index < len(rows) and rows[index][0] == indent and rows[index][1].startswith("- "):
        content = rows[index][1][2:].strip()
        index += 1
        if content == "":
            child, index = _read(rows, index, rows[index][0])
            items.append(child)
            continue
        if ":" not in content:
            items.append(_scalar(content))
            continue
        key, _, rest = content.partition(":")
        item: dict[str, object] = {}
        rest = rest.strip()
        if rest:
            item[key.strip()] = _scalar(rest)
        else:
            child, index = _read(rows, index, rows[index][0])
            item[key.strip()] = child
        while index < len(rows) and rows[index][0] == indent + 2 and not rows[index][1].startswith("- "):
            child_key, _, child_rest = rows[index][1].partition(":")
            child_rest = child_rest.strip()
            index += 1
            if child_rest:
                item[child_key.strip()] = _scalar(child_rest)
            else:
                nested, index = _read(rows, index, rows[index][0])
                item[child_key.strip()] = nested
        items.append(item)
    return items, index


def _scalar(text: str) -> object:
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1]
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [_scalar(part.strip()) for part in inner.split(",")]
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    return text


def _rows(value: object) -> list[object]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("exercise list was not a list")
    return value


def _hit(item: object, bars: int) -> Hit:
    if not isinstance(item, dict):
        raise ValueError("a drum hit must be a map")
    bar = int(item["bar"])
    step = int(item["step"])
    drum = str(item["drum"])
    velocity = int(item["velocity"])
    if not 1 <= bar <= bars or not 0 <= step <= 15 or drum not in _DRUMS or not 1 <= velocity <= 127:
        raise ValueError("a drum hit is outside the 16 step grid")
    return Hit(bar, step, drum, velocity)


def _bass(item: object, bars: int) -> BassNote:
    if not isinstance(item, dict):
        raise ValueError("a bass note must be a map")
    bar = int(item["bar"])
    start = int(item["start"])
    length = int(item["length"])
    pitch = int(item["pitch"])
    if not 1 <= bar <= bars or not 0 <= start <= 15 or length < 1 or not 0 <= pitch <= 127:
        raise ValueError("a bass note is outside the grid")
    return BassNote(bar, start, length, pitch)


def _chord(item: object, bars: int) -> Chord:
    if not isinstance(item, dict):
        raise ValueError("a chord must be a map")
    notes = item.get("notes")
    extensions = item.get("extensions")
    if not isinstance(notes, list) or not isinstance(extensions, list):
        raise ValueError("chord notes and extensions must be lists")
    bar = int(item["bar"])
    if not 1 <= bar <= bars:
        raise ValueError("a chord is outside the exercise")
    return Chord(
        bar,
        str(item["symbol"]),
        tuple(int(note) for note in notes),
        int(item["inversion"]),
        tuple(str(extension) for extension in extensions),
    )


def _beginner_rhythm(template: Exercise, rng: random.Random) -> Exercise:
    hits: list[Hit] = []
    for hit in template.hits:
        if hit.drum == "hat":
            velocity = rng.randint(74, 92)
        elif hit.drum == "kick":
            velocity = rng.randint(100, 116)
        else:
            velocity = rng.randint(104, 120)
        hits.append(replace(hit, velocity=velocity))
    bass = tuple(replace(note, length=rng.choice((3, 4))) for note in template.bass)
    return replace(template, hits=tuple(hits), bass=bass)


def _intermediate_rhythm(template: Exercise, rng: random.Random) -> Exercise:
    kicks = _INTERMEDIATE_KICKS[rng.randrange(len(_INTERMEDIATE_KICKS))]
    open_step = rng.choice((6, 10, 14))
    hits: list[Hit] = []
    for bar in range(1, 5):
        bar_kicks = (0, 8) if bar == 4 else kicks
        for step in bar_kicks:
            hits.append(Hit(bar, step, "kick", rng.randint(96, 116)))
        hits.append(Hit(bar, 4, "snare", rng.randint(104, 120)))
        if bar == 4:
            for step, velocity in ((12, 80), (13, 92), (14, 104), (15, 116)):
                hits.append(Hit(bar, step, "snare", velocity))
            for step in range(12):
                hits.append(Hit(bar, step, "hat", 96 if step == 0 else rng.randint(64, 100)))
        else:
            hits.append(Hit(bar, 12, "snare", rng.randint(104, 120)))
            for step in range(16):
                if bar == 2 and step == open_step:
                    hits.append(Hit(bar, step, "open_hat", rng.randint(84, 108)))
                else:
                    hits.append(Hit(bar, step, "hat", 96 if step == 0 else rng.randint(64, 100)))
    bass = _locked_bass(rng, kicks) if template.type == "bass" else ()
    return replace(template, hits=tuple(hits), bass=bass)


def _advanced_rhythm(template: Exercise, rng: random.Random) -> Exercise:
    kicks = _ADVANCED_KICKS[rng.randrange(len(_ADVANCED_KICKS))]
    open_steps = {rng.choice((2, 7)), rng.choice((11, 15))}
    hits: list[Hit] = []
    for bar in range(1, 4):
        for step in kicks:
            hits.append(Hit(bar, step, "kick", rng.randint(90, 116)))
        hits.append(Hit(bar, 4, "snare", rng.randint(108, 122)))
        hits.append(Hit(bar, 12, "snare", rng.randint(108, 122)))
        for step in (3, 5, 11, 13):
            hits.append(Hit(bar, step, "snare", rng.randint(28, 44)))
        for step in range(16):
            drum = "open_hat" if step in open_steps else "hat"
            hits.append(Hit(bar, step, drum, 100 if step in open_steps else rng.randint(58, 104)))
    hits.append(Hit(4, 0, "kick", 110))
    hits.append(Hit(4, 3, "kick", 90))
    hits.append(Hit(4, 4, "snare", 112))
    for step in (8, 10, 12, 13, 14, 15):
        hits.append(Hit(4, step, "snare", 88 + (step - 8) * 4))
    for step in (9, 11):
        hits.append(Hit(4, step, "snare", 36))
    for step in range(8):
        hits.append(Hit(4, step, "hat", rng.randint(60, 100)))
    bass = _advanced_bass(rng) if template.type == "bass" else ()
    return replace(template, hits=tuple(hits), bass=bass)


def _locked_bass(rng: random.Random, kicks: tuple[int, ...]) -> tuple[BassNote, ...]:
    notes: list[BassNote] = []
    for bar in range(1, 4):
        for step in kicks:
            notes.append(BassNote(bar, step, 1, rng.choice(_A_MINOR[:5])))
        extra = next(step for step in (2, 5, 7, 10, 13, 15) if step not in kicks)
        notes.append(BassNote(bar, extra, 1, rng.choice(_A_MINOR)))
    for step in (2, 6, 10, 14):
        notes.append(BassNote(4, step, 1, rng.choice(_A_MINOR)))
    return tuple(notes)


def _advanced_bass(rng: random.Random) -> tuple[BassNote, ...]:
    pattern = _ADVANCED_BASS[rng.randrange(len(_ADVANCED_BASS))]
    return tuple(BassNote(bar, start, length, pitch) for bar, start, length, pitch in pattern)


def _beginner_harmony(template: Exercise, rng: random.Random) -> Exercise:
    octave = 60 if rng.randrange(2) == 0 else 48
    voiced = (
        ("C", (octave, octave + 4, octave + 7), 0, ()),
        ("G", (octave + 7, octave + 11, octave + 14), 0, ()),
        ("Am", (octave + 9, octave + 12, octave + 16), 0, ()),
        ("F", (octave + 5, octave + 9, octave + 12), 0, ()),
    )
    return _plan_chords(template, voiced)


def _plan_chords(template: Exercise, plan: tuple[tuple[str, tuple[int, ...], int, tuple[str, ...]], ...]) -> Exercise:
    chords = tuple(
        Chord(bar, symbol, notes, inversion, extensions)
        for bar, (symbol, notes, inversion, extensions) in enumerate(plan, start=1)
    )
    return replace(template, chords=chords)


def _describe_drums(exercise: Exercise) -> str:
    sentences: list[str] = []
    for bar in range(1, exercise.bars + 1):
        kicks = [_step_name(hit.step) for hit in exercise.hits if hit.bar == bar and hit.drum == "kick"]
        snares = [
            _step_name(hit.step)
            for hit in exercise.hits
            if hit.bar == bar and hit.drum == "snare" and hit.velocity >= 50
        ]
        ghosts = [
            _step_name(hit.step)
            for hit in exercise.hits
            if hit.bar == bar and hit.drum == "snare" and hit.velocity < 50
        ]
        opens = [_step_name(hit.step) for hit in exercise.hits if hit.bar == bar and hit.drum == "open_hat"]
        sentence = f"Bar {bar}: kick on {_join(kicks)}, snare on {_join(snares)}."
        if ghosts:
            sentence += f" Ghost snares on {_join(ghosts)}."
        if opens:
            sentence += f" Open hat on {_join(opens)}."
        sentences.append(sentence)
    return " ".join(sentences)


def _describe_bass(exercise: Exercise) -> str:
    notes = [f"bar {note.bar} {_pitch_name(note.pitch)} at {_step_name(note.start)}" for note in exercise.bass]
    return "Bass notes: " + ", ".join(notes) + "."


def _describe_chords(exercise: Exercise) -> str:
    parts: list[str] = []
    for chord in exercise.chords:
        names = " ".join(_pitch_name(note) for note in chord.notes)
        extension = f" Extensions: {_join(list(chord.extensions))}." if chord.extensions else ""
        parts.append(f"Bar {chord.bar}: {chord.symbol}, inversion {chord.inversion}, notes {names}.{extension}")
    return " ".join(parts)


def _step_name(step: int) -> str:
    beat = step // 4 + 1
    place = step % 4
    if place == 0:
        return f"beat {beat}"
    if place == 2:
        return f"the and of beat {beat}"
    if place == 1:
        return f"the sixteenth after beat {beat}"
    if beat < 4:
        return f"the sixteenth before beat {beat + 1}"
    return "the last sixteenth"


def _pitch_name(pitch: int) -> str:
    return f"{_NAMES[pitch % 12]}{pitch // 12 - 1}"


def _join(items: list[str]) -> str:
    if not items:
        return "none"
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def a_minor_pitch(pitch: int) -> bool:
    return pitch % 12 in _A_MINOR_PCS
