"""Compare a recreation with the exercise. Audio results stay marked as estimates."""

from __future__ import annotations

from agent.exercise_midi import MidiNote, read_midi
from agent.exercises import BassNote, Exercise, a_minor_pitch

GM = {36: "kick", 38: "snare", 40: "snare", 42: "hat", 46: "open_hat"}
_ROLES = {"kick", "snare", "hat", "open_hat", "bass"}
_TRIADS = {
    "C": {0, 4, 7},
    "G": {7, 11, 2},
    "Am": {9, 0, 4},
    "F": {5, 9, 0},
    "Cm": {0, 3, 7},
    "Ab": {8, 0, 3},
    "Eb": {3, 7, 10},
    "Bb": {10, 2, 5},
}
_MARK = {"kick": "K", "snare": "S", "hat": "H", "open_hat": "O"}


def compare_midi(exercise: Exercise, data: bytes, mapping: dict[int, str] | None = None) -> dict[str, object]:
    ppq, bpm, notes = read_midi(data)
    assigned, unknown = _assign(exercise, notes, mapping or {})
    if unknown:
        return {"status": "needs_mapping", "notes": unknown}
    result = score(exercise, _place(exercise, assigned, ppq), source="midi", approximate=False)
    if bpm is not None and abs(bpm - exercise.tempo) > 3:
        differences = result["differences"]
        if isinstance(differences, list):
            differences.append(_event(1, 0, "tempo", detail=f"{bpm} BPM"))
    return result


def score(exercise: Exercise, heard: dict[str, object], *, source: str, approximate: bool) -> dict[str, object]:
    matches: list[dict[str, object]] = []
    differences: list[dict[str, object]] = []
    missing: list[dict[str, object]] = []
    scores: dict[str, float] = {}
    drums = heard["drums"]
    bass = heard["bass"]
    chord_notes = heard["chords"]
    if not isinstance(drums, dict) or not isinstance(bass, list) or not isinstance(chord_notes, dict):
        raise ValueError("heard performance is incomplete")
    if exercise.hits:
        _drums(exercise, drums, matches, differences, missing, scores)
    if exercise.bass:
        _bass(exercise, bass, matches, differences, missing, scores)
    progression: bool | None = None
    voicing: float | None = None
    if exercise.chords:
        progression, voicing = _harmony(exercise, chord_notes, matches, differences, missing, scores)
    return {
        "status": "compared",
        "source": source,
        "approximate": approximate,
        "matches": matches,
        "differences": differences,
        "missing": missing,
        "uncertain": [],
        "scores": {name: round(value, 4) for name, value in scores.items()},
        "progression_correct": progression,
        "voicing_similarity": None if voicing is None else round(voicing, 4),
        "grid": _grid(exercise, drums, bass, chord_notes, differences, missing),
    }


def _assign(
    exercise: Exercise, notes: list[MidiNote], mapping: dict[int, str]
) -> tuple[list[tuple[MidiNote, str]], list[int]]:
    assigned: list[tuple[MidiNote, str]] = []
    unknown: set[int] = set()
    for note in notes:
        role = _role(exercise, note.pitch, mapping)
        if role is None:
            unknown.add(note.pitch)
        else:
            assigned.append((note, role))
    return assigned, sorted(unknown)


def _role(exercise: Exercise, pitch: int, mapping: dict[int, str]) -> str | None:
    if pitch in mapping:
        role = mapping[pitch]
        if role not in _ROLES:
            raise ValueError("drum mapping is not a kick, snare, hat, open hat, or bass")
        return role
    if pitch in GM and exercise.type != "chords":
        return GM[pitch]
    if exercise.type == "chords":
        return "chord"
    if exercise.type == "bass" and a_minor_pitch(pitch) and 28 <= pitch <= 76:
        return "bass"
    return None


def _place(exercise: Exercise, assigned: list[tuple[MidiNote, str]], ppq: int) -> dict[str, object]:
    step_ticks = ppq / 4
    placed: list[tuple[int, int, str, int, int]] = []
    for note, role in assigned:
        step = int(round(note.tick / step_ticks))
        length = max(1, int(round(note.duration / step_ticks))) if note.duration else 1
        placed.append((step, length, role, note.pitch, note.velocity))
    origins = [step for step, _, role, _, _ in placed if role == "kick"] or [step for step, *_rest in placed]
    origin = 0
    if origins:
        first = min(origins)
        barline = (first // 16) * 16
        origin = barline if 0 <= first - barline <= 1 else first
    drums: dict[tuple[int, int], dict[str, int]] = {}
    bass: list[BassNote] = []
    chords: dict[int, list[int]] = {}
    for step, length, role, pitch, velocity in placed:
        local = step - origin
        if local < 0:
            continue
        bar = local // 16 + 1
        cell = local % 16
        if bar < 1 or bar > exercise.bars:
            continue
        if role in {"kick", "snare", "hat", "open_hat"}:
            slot = drums.setdefault((bar, cell), {})
            slot[role] = max(velocity, slot.get(role, 0))
        elif role == "bass":
            bass.append(BassNote(bar, cell, length, pitch))
        else:
            chords.setdefault(bar, []).append(pitch)
    return {"drums": drums, "bass": bass, "chords": chords}


def _drums(
    exercise: Exercise,
    heard: dict[tuple[int, int], dict[str, int]],
    matches: list[dict[str, object]],
    differences: list[dict[str, object]],
    missing: list[dict[str, object]],
    scores: dict[str, float],
) -> None:
    reference: dict[tuple[int, int], dict[str, int]] = {}
    for hit in exercise.hits:
        reference.setdefault((hit.bar, hit.step), {})[hit.drum] = hit.velocity
    total = present = same_band = ghosts = ghosts_found = 0
    for (bar, step), drums in reference.items():
        played = heard.get((bar, step), {})
        for drum, velocity in drums.items():
            total += 1
            what = _what(drum, velocity)
            ghost = _band(velocity) == "ghost"
            ghosts += int(ghost)
            if drum not in played:
                missing.append(_event(bar, step, what))
                continue
            present += 1
            if ghost and _band(played[drum]) == "ghost":
                ghosts_found += 1
            if _band(velocity) == _band(played[drum]):
                same_band += 1
                matches.append(_event(bar, step, what))
            else:
                differences.append(_event(bar, step, what, detail="velocity"))
        for drum in played:
            if drum not in drums:
                differences.append(_event(bar, step, drum, detail="extra"))
    for (bar, step), played in heard.items():
        if (bar, step) not in reference:
            for drum in played:
                differences.append(_event(bar, step, drum, detail="extra"))
    scores["hits"] = present / total if total else 1.0
    scores["velocity"] = same_band / present if present else 0.0
    if ghosts:
        scores["ghosts"] = ghosts_found / ghosts


def _bass(
    exercise: Exercise,
    heard: list[BassNote],
    matches: list[dict[str, object]],
    differences: list[dict[str, object]],
    missing: list[dict[str, object]],
    scores: dict[str, float],
) -> None:
    used: set[int] = set()
    matched = octave_misses = rest_extras = 0
    for note in exercise.bass:
        found = None
        for index, played in enumerate(heard):
            if index in used:
                continue
            if played.bar == note.bar and played.start == note.start and played.pitch % 12 == note.pitch % 12:
                found = index
                break
        if found is None:
            missing.append(_event(note.bar, note.start, "bass"))
            continue
        used.add(found)
        played = heard[found]
        matched += 1
        if played.pitch != note.pitch:
            octave_misses += 1
            differences.append(_event(note.bar, note.start, "octave", detail=f"played {played.pitch}"))
        if abs(played.length - note.length) > 1:
            differences.append(_event(note.bar, note.start, "length"))
        else:
            matches.append(_event(note.bar, note.start, "bass"))
    for index, played in enumerate(heard):
        if index not in used:
            rest_extras += 1
            differences.append(_event(played.bar, played.start, "rest", detail="extra bass note"))
    total = len(exercise.bass) or 1
    scores["bass"] = matched / len(exercise.bass) if exercise.bass else 1.0
    scores["octaves"] = 1.0 if octave_misses == 0 else max(0.0, 1 - octave_misses / total)
    scores["rests"] = 1.0 if rest_extras == 0 else max(0.0, 1 - rest_extras / total)


def _harmony(
    exercise: Exercise,
    heard: dict[int, list[int]],
    matches: list[dict[str, object]],
    differences: list[dict[str, object]],
    missing: list[dict[str, object]],
    scores: dict[str, float],
) -> tuple[bool, float]:
    identified = voiced = extensions_ok = 0
    previous_ref: list[int] | None = None
    previous_heard: list[int] | None = None
    for chord in exercise.chords:
        played = heard.get(chord.bar, [])
        triad = _TRIADS[chord.symbol]
        heard_pcs = {pitch % 12 for pitch in played}
        ref_pcs = {pitch % 12 for pitch in chord.notes}
        identity = triad <= heard_pcs
        if not played:
            missing.append(_event(chord.bar, 0, chord.symbol))
        elif identity:
            identified += 1
            matches.append(_event(chord.bar, 0, chord.symbol))
        else:
            differences.append(_event(chord.bar, 0, chord.symbol, detail="different chord"))
        same_bass = bool(played) and min(played) % 12 == min(chord.notes) % 12
        if played and same_bass and heard_pcs == ref_pcs:
            voiced += 1
        elif played and not same_bass:
            differences.append(_event(chord.bar, 0, "inversion"))
        if heard_pcs - triad == ref_pcs - triad:
            extensions_ok += 1
        elif identity:
            differences.append(_event(chord.bar, 0, "extension"))
        if previous_ref is not None and previous_heard is not None and played:
            gap = abs(_leading(previous_ref, list(chord.notes)) - _leading(previous_heard, played))
            if gap > 3:
                differences.append(_event(chord.bar, 0, "voice leading"))
        previous_ref = list(chord.notes)
        previous_heard = played or None
    total = len(exercise.chords) or 1
    scores["progression"] = identified / total
    scores["voicing"] = voiced / total
    scores["extensions"] = extensions_ok / total
    return identified == len(exercise.chords), voiced / total


def _grid(
    exercise: Exercise,
    drums: dict[tuple[int, int], dict[str, int]],
    bass: list[BassNote],
    chords: dict[int, list[int]],
    differences: list[dict[str, object]],
    missing: list[dict[str, object]],
) -> dict[str, object]:
    flagged = {(int(item["bar"]), int(item["step"])) for item in differences + missing}
    payload: dict[str, object] = {}
    if exercise.hits:
        reference: dict[tuple[int, int], dict[str, int]] = {}
        for hit in exercise.hits:
            reference.setdefault((hit.bar, hit.step), {})[hit.drum] = hit.velocity
        payload["drums"] = [
            [
                {
                    "step": step,
                    "beat": step // 4 + 1,
                    "reference": _marks(reference.get((bar, step), {})),
                    "yours": _marks(drums.get((bar, step), {})),
                    "diff": (bar, step) in flagged,
                }
                for step in range(16)
            ]
            for bar in range(1, exercise.bars + 1)
        ]
    if exercise.bass:
        ref = {(note.bar, note.start): note.pitch for note in exercise.bass}
        played = {(note.bar, note.start): note.pitch for note in bass}
        payload["bass"] = [
            [
                {
                    "step": step,
                    "beat": step // 4 + 1,
                    "reference": ref.get((bar, step)),
                    "yours": played.get((bar, step)),
                    "diff": ref.get((bar, step)) != played.get((bar, step)),
                }
                for step in range(16)
            ]
            for bar in range(1, exercise.bars + 1)
        ]
    if exercise.chords:
        payload["chords"] = [
            {
                "bar": chord.bar,
                "reference": chord.symbol,
                "yours": chords.get(chord.bar, []),
                "inversion": chord.inversion,
                "diff": (chord.bar, 0) in flagged,
            }
            for chord in exercise.chords
        ]
    return payload


def _marks(drums: dict[str, int]) -> list[str]:
    marks: list[str] = []
    for drum in ("kick", "snare", "hat", "open_hat"):
        if drum not in drums:
            continue
        marks.append("g" if drum == "snare" and drums[drum] < 50 else _MARK[drum])
    return marks


def _what(drum: str, velocity: int) -> str:
    if drum == "snare" and velocity < 50:
        return "ghost snare"
    return drum


def _band(velocity: int) -> str:
    if velocity < 50:
        return "ghost"
    if velocity <= 100:
        return "normal"
    return "accent"


def _leading(left: list[int], right: list[int]) -> int:
    ordered_left = sorted(left)
    ordered_right = sorted(right)
    count = min(len(ordered_left), len(ordered_right))
    return sum(abs(ordered_left[index] - ordered_right[index]) for index in range(count))


def _event(bar: int, step: int, what: str, **extra: object) -> dict[str, object]:
    item: dict[str, object] = {"bar": bar, "beat": step // 4 + 1, "step": step, "what": what}
    item.update(extra)
    return item
