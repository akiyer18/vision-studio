"""One conversation turn. Session state stays in memory on the provider."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Protocol

from contracts import (
    AudioFeatures,
    LayerPrompt,
    Question,
    SlotValue,
    SongBrief,
    TraceStep,
    TurnRequest,
    TurnResponse,
)

from agent.arc import Motion, detect_arc
from agent.complete import complete_brief
from agent.asking import AskContext, almost_empty, next_one_sound, next_question
from agent.defaults import PRESETS, default_slot, derive_bpm, parse_bpm, preset_for, skipped
from agent.extract import extract_audio, extract_numbers, extract_text, stated_tempo
from agent.facets import Facet, FacetPick, applicable, by_importance, catalog, facet_by_id, fallback_pick, guard_pick, resolve_answer
from agent.prompts import compile_one_sound, compile_prompts, selected_layers
from agent.slots import ABOUT_QUESTION, MAX_QUESTIONS, slot_specs
from agent.theory import chords_for

OUTPUT_LABEL = {
    "drums": "drums",
    "chords": "chords",
    "bass": "bass",
    "melody": "melody",
    "texture": "texture",
    "all_layers": "all layers separately",
    "full_mix": "full song",
}
OUTPUT_FROM_LABEL = {label: [choice] for choice, label in OUTPUT_LABEL.items()}
OUTPUT_FROM_LABEL.update({choice: [choice] for choice in OUTPUT_LABEL})
AUDIO_INPUTS = {"hum", "vocal", "instrument_loop", "drum_loop", "full_track"}


@dataclass
class Pending:
    kind: str
    slot: str
    text: str
    options: tuple[str, ...]
    facet: str = ""


@dataclass
class Choice:
    ready: bool
    summary: str = ""
    slot: str = ""
    text: str = ""
    options: tuple[str, ...] = ()
    reason: str = ""
    facet: str = ""


class TurnHooks(Protocol):
    def ingest_text(self, session: Session) -> None: ...

    def polish(self, session: Session, prompts: list[LayerPrompt]) -> list[LayerPrompt]: ...

    def choose(self, session: Session) -> Choice | None: ...


@dataclass
class Session:
    session_id: str
    text: str = ""
    input_type: str | None = None
    gave_key: bool = False
    detected_bpm: float | None = None
    features: AudioFeatures | None = None
    locked: set[str] = field(default_factory=set)
    slots: dict[str, SlotValue] = field(default_factory=dict)
    output: list[str] = field(default_factory=list)
    questions_asked: int = 0
    skipped: list[str] = field(default_factory=list)
    pending: Pending | None = None
    about_asked: bool = False
    force_ready: bool = False
    mode: str = "full"
    summary: str = ""
    transcript: list[dict[str, str]] = field(default_factory=list)
    trace: list[TraceStep] = field(default_factory=list)
    facet_values: dict[str, str] = field(default_factory=dict)
    facet_descriptors: dict[str, str] = field(default_factory=dict)
    asked_facets: set[str] = field(default_factory=set)
    references: list[str] = field(default_factory=list)
    style_descriptors: str = ""
    references_noted: bool = False
    arc: Motion | None = None
    extra: int = 0
    budget: int = MAX_QUESTIONS
    deepening: bool = False

    def note(self, step: str, detail: str) -> None:
        self.trace.append(TraceStep(step=step, detail=detail))

    @property
    def is_audio(self) -> bool:
        return self.input_type in AUDIO_INPUTS

    def mood_name(self) -> str:
        mood = self.slots.get("mood")
        if mood is None:
            return "peaceful"
        return mood.value


class MockHooks:
    def ingest_text(self, session: Session) -> None:
        ingest_mock(session)

    def polish(self, session: Session, prompts: list[LayerPrompt]) -> list[LayerPrompt]:
        return prompts

    def choose(self, session: Session) -> Choice | None:
        return None


class MockProvider:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.hooks: TurnHooks = MockHooks()

    def run_turn(self, request: TurnRequest) -> TurnResponse:
        return run_session(self.sessions, request, self.hooks)


_mock = MockProvider()


def run_turn(request: TurnRequest) -> TurnResponse:
    return _select_provider().run_turn(request)


def _select_provider():
    provider = os.environ.get("PROVIDER", "mock")
    if provider in {"", "mock"}:
        return _mock
    if provider == "bedrock":
        from agent.bedrock import bedrock_provider

        return bedrock_provider()
    raise RuntimeError("PROVIDER must be mock or bedrock")


def run_session(sessions: dict[str, Session], request: TurnRequest, hooks: TurnHooks) -> TurnResponse:
    session = sessions.setdefault(request.session_id, Session(request.session_id))
    if request.mode:
        session.mode = request.mode
    if request.reference is not None:
        _apply_reference(session, request.reference)
    if request.audio_features is not None:
        _apply_audio(session, request.audio_features)
    if request.output:
        _set_output(session, list(request.output), "you", "You chose this output", 1.0)
        session.note("answer", f"output: {session.slots['output'].value}")
    if request.overrides is not None:
        _apply_overrides(session, request.overrides)
    if request.text:
        _remember_text(session, request.text, hooks)
    if request.answer is not None:
        _apply_answer(
            session,
            request.answer.slot,
            request.answer.action,
            request.answer.value,
            hooks,
            request.answer.facet,
        )
    elif session.pending is not None and not request.deepen:
        return _question_response(session, session.pending, waiting=True)
    if request.deepen:
        session.force_ready = False
        session.extra += 3
        session.budget += 3
        session.deepening = True
        session.note("ask", "Going deeper")
    if session.force_ready:
        return _ready(session, hooks)
    if session.deepening:
        facet_turn = _facet_turn(session, hooks)
        if facet_turn is not None:
            return facet_turn
        session.deepening = False
        session.extra = 0
        return _ready(session, hooks)
    picked = hooks.choose(session)
    if picked is not None and picked.ready:
        if picked.summary:
            session.summary = picked.summary
        return _ready(session, hooks)
    if picked is not None and picked.facet:
        return _ask_choice_facet(session, picked)
    if picked is not None:
        return _ask(session, Pending("slot", picked.slot, picked.text, picked.options), picked.reason)
    if session.mode != "one_sound" and _should_ask_about(session):
        session.about_asked = True
        pending = Pending("about", "mood", ABOUT_QUESTION, ())
        return _ask(session, pending)
    spec = (
        next_one_sound(frozenset(session.slots), session.questions_asked)
        if session.mode == "one_sound"
        else next_question(_context(session))
    )
    if spec is not None and session.questions_asked < session.budget:
        pending = Pending("slot", spec.slot, spec.question, spec.options)
        return _ask(session, pending)
    facet_turn = _facet_turn(session, hooks)
    if facet_turn is not None:
        return facet_turn
    return _ready(session, hooks)


def _remember_text(session: Session, text: str, hooks: TurnHooks) -> None:
    incoming = text.strip()
    if incoming:
        session.text = f"{session.text} {incoming}".strip() if session.text else incoming
        session.transcript.append({"role": "user", "text": incoming})
        _apply_numbers(session, incoming)
        _remember_arc(session, incoming)
        _remember_names(session, incoming)
    if session.text:
        hooks.ingest_text(session)


def ingest_mock(session: Session) -> None:
    found = extract_text(session.text)
    if not found:
        session.note("extract", "No mood, energy, or scene in the text")
        return
    for name, value in found.items():
        if name in session.slots:
            continue
        _store(session, name, value)
        session.note("extract", f"{name}: {value.value} ({value.reason})")


def store_slot(session: Session, name: str, value: SlotValue) -> None:
    session.slots[name] = value
    if value.source == "you":
        session.locked.add(name)


_store = store_slot


def _apply_audio(session: Session, features: AudioFeatures) -> None:
    session.input_type = features.input_type
    session.features = features
    for name, value in extract_audio(features).items():
        if name in session.slots:
            continue
        _store(session, name, value)
        session.note("detect", f"{name}: {value.value} ({value.reason})")
        if name == "key":
            session.gave_key = True
    if features.bpm is not None:
        session.detected_bpm = features.bpm
        measured = str(int(features.bpm + 0.5))
        current = session.slots.get("tempo")
        if current is None or (current.source == "guessed" and "tempo" not in session.locked):
            if current is not None and current.value != measured:
                session.note("tempo", f"The audio measured {measured}, replacing the guessed {current.value}")
            _store(
                session,
                "tempo",
                SlotValue(
                    value=measured,
                    source="detected",
                    reason="Detected from the audio",
                    confidence=features.confidence,
                ),
            )
        session.note("detect", f"bpm: {features.bpm}")
    if features.chords:
        session.note("detect", "chords: " + ", ".join(features.chords))


def _apply_reference(session: Session, reference: object) -> None:
    data = reference.model_dump(exclude_none=True) if hasattr(reference, "model_dump") else dict(reference)
    for name, value in data.items():
        current = session.slots.get(name)
        if current is not None and current.source == "you":
            continue
        _store(
            session,
            name,
            SlotValue(value=str(value), source="reference", reason="From the genre file", confidence=1.0),
        )
        session.locked.add(name)
        if name == "key":
            session.gave_key = True
        session.note("reference", f"{name}: {value}")


def _apply_overrides(session: Session, overrides: object) -> None:
    data = overrides.model_dump(exclude_none=True) if hasattr(overrides, "model_dump") else dict(overrides)
    for name, value in data.items():
        if name == "output":
            _set_output(session, _enums_for_label(str(value)), "you", "You set this in the request", 1.0)
        else:
            _store(
                session,
                name,
                SlotValue(
                    value=str(value),
                    source="you",
                    reason="You set this in the request",
                    confidence=1.0,
                ),
            )
            if name == "key":
                session.gave_key = True
        session.locked.add(name)
        session.note("answer", f"{name}: {session.slots[name].value}")


def _apply_numbers(session: Session, text: str) -> None:
    stated = stated_tempo(text)
    for name, value in extract_numbers(text).items():
        current = session.slots.get(name)
        if current is not None and current.source == "you":
            continue
        if (
            name == "tempo"
            and stated is not None
            and current is not None
            and current.source == "detected"
            and current.value != value.value
        ):
            phrase, kept = stated[1], value.value
            session.note("extract", f"You said {phrase}, the audio measured {current.value}, kept {kept}")
        _store(session, name, value)
        session.note("extract", value.reason)
        if name == "key":
            session.gave_key = True


def _apply_answer(
    session: Session,
    slot: str,
    action: str,
    value: str | None,
    hooks: TurnHooks,
    facet: str | None = None,
) -> None:
    pending = session.pending
    session.pending = None
    if action == "skip_all":
        session.transcript.append({"role": "user", "text": "Skip all and build"})
        session.note("answer", "skip all, filling the remaining slots")
        _fill_gaps(session, skipped_fill=True)
        session.force_ready = True
        return
    facet_id = facet or (pending.facet if pending is not None and pending.kind == "facet" else "")
    if facet_id:
        _answer_facet(session, facet_id, action, value or "", hooks)
        return
    if pending is not None and pending.kind == "about" and action == "answer":
        _remember_text(session, value or "", hooks)
        session.note("answer", "Re-ran extraction on the description")
        return
    spoken = value.strip() if value else ""
    if action == "you_decide":
        spoken = "You decide"
    elif action == "skip":
        spoken = "Skip this"
    if spoken:
        session.transcript.append({"role": "user", "text": spoken})
    target = pending.slot if pending is not None else slot
    if action == "you_decide" or (action == "answer" and target == "key" and (value or "").lower() == "not sure"):
        _use_default(session, target, mark_skipped=False)
        return
    if action == "skip":
        _use_default(session, target, mark_skipped=True)
        return
    if target == "key" and value and value.lower() in {"major", "minor"}:
        _set_key_mode(session, value.lower())
        return
    if target == "output":
        choices = _enums_for_label(value or "")
        _set_output(session, choices, "you", "You answered", 1.0)
        session.note("answer", f"output: {session.slots['output'].value}")
        return
    _store(session, target, SlotValue(value=value or "", source="you", reason="You answered", confidence=1.0))
    session.note("answer", f"{target}: {value or ''}")
    if target == "style" and value:
        _remember_name(session, value)


def _use_default(session: Session, slot: str, *, mark_skipped: bool) -> None:
    value = default_slot(slot, session.mood_name(), audio=session.is_audio)
    if mark_skipped:
        value = skipped(value)
        if slot not in session.skipped:
            session.skipped.append(slot)
    if slot == "output":
        _set_output(session, ["all_layers"], value.source, value.reason, value.confidence)
    else:
        session.slots[slot] = value
    session.note("default", f"{slot}: {value.value} ({value.reason})")


def _set_key_mode(session: Session, mode: str) -> None:
    current = session.slots.get("key")
    base = current.value if current is not None else preset_for(session.mood_name()).key
    note = base.split()[0]
    chosen = f"{note} {mode}"
    _store(session, "key", SlotValue(value=chosen, source="you", reason=f"You chose {mode}", confidence=1.0))
    session.gave_key = True
    session.note("answer", f"key: {chosen}")


def _fill_gaps(session: Session, *, skipped_fill: bool) -> None:
    for spec in slot_specs():
        if spec.slot in session.slots or spec.slot in {"tempo", "pattern", "production"}:
            continue
        if spec.impact == 0 and not (session.mode == "one_sound" and spec.slot in {"sound", "genre", "brightness"}):
            continue
        if session.mode == "one_sound" and spec.slot == "output":
            continue
        _use_default(session, spec.slot, mark_skipped=skipped_fill)


def _set_output(session: Session, choices: list[str], source: str, reason: str, confidence: float) -> None:
    session.output = choices
    label = ", ".join(OUTPUT_LABEL[choice] for choice in choices)
    _store(session, "output", SlotValue(value=label, source=source, reason=reason, confidence=confidence))


def _enums_for_label(value: str) -> list[str]:
    choices: list[str] = []
    for part in value.split(","):
        label = part.strip().lower()
        if label not in OUTPUT_FROM_LABEL:
            raise ValueError(f"unknown output: {part}")
        for choice in OUTPUT_FROM_LABEL[label]:
            if choice not in choices:
                choices.append(choice)
    if not choices:
        raise ValueError("output answer was empty")
    return choices


def _should_ask_about(session: Session) -> bool:
    if session.about_asked or session.questions_asked > 0:
        return False
    found = any(name in session.slots for name in ("mood", "energy", "world"))
    return almost_empty(session.text, session.input_type, found)


def _context(session: Session) -> AskContext:
    return AskContext(
        filled=frozenset(session.slots),
        output_set=bool(session.output),
        input_type=session.input_type,
        gave_key=session.gave_key,
        questions_asked=session.questions_asked,
    )


def _ask(session: Session, pending: Pending, reason: str = "") -> TurnResponse:
    session.questions_asked += 1
    if pending.kind == "facet" and pending.facet:
        session.asked_facets.add(pending.facet)
    session.pending = pending
    session.transcript.append({"role": "agent", "text": pending.text})
    session.note("ask", reason or f"Asked: {pending.text}")
    return _question_response(session, pending, waiting=False)


def _question_response(session: Session, pending: Pending, *, waiting: bool) -> TurnResponse:
    if waiting:
        session.note("ask", f"Still waiting on {pending.text}")
    return TurnResponse(
        status="question",
        question=Question(
            slot=pending.slot,
            text=pending.text,
            options=list(pending.options),
            index=session.questions_asked,
            max=session.budget,
            facet=pending.facet or None,
        ),
        brief=_brief(session),
        trace=list(session.trace),
    )


def _tempo(session: Session, energy: str, mood: str) -> tuple[int, str]:
    current = session.slots.get("tempo")
    parsed = parse_bpm(current.value) if current is not None else None
    if current is not None and parsed is not None:
        if current.source == "detected":
            return parsed, f"{parsed} BPM detected from the audio"
        if current.source == "you":
            reason = current.reason or f"{parsed} BPM from what you said"
            return parsed, reason
        return parsed, current.reason
    bpm, reason = derive_bpm(energy, mood)
    _store(
        session,
        "tempo",
        SlotValue(value=str(bpm), source="guessed", reason=reason, confidence=0.4),
    )
    return bpm, reason


def _ready(session: Session, hooks: TurnHooks) -> TurnResponse:
    if session.mode == "one_sound" and "output" not in session.slots:
        _store(
            session,
            "output",
            SlotValue(value="one sound", source="you", reason="One sound mode", confidence=1.0),
        )
    _fill_gaps(session, skipped_fill=False)
    complete_brief(session)
    mood = session.mood_name()
    energy = session.slots["energy"].value
    world = session.slots["world"].value
    key = session.slots["key"].value
    bpm, tempo_reason = _tempo(session, energy, mood)
    session.note("tempo", tempo_reason)
    arrangement = _style_descriptors(session, hooks)
    romans = list(PRESETS.get(mood, PRESETS["peaceful"]).roman)
    try:
        chords = chords_for(key, romans)
    except ValueError:
        key = preset_for(mood).key
        session.slots["key"] = SlotValue(
            value=key,
            source="guessed",
            reason=f"{key} because that is the {mood} preset",
            confidence=0.4,
        )
        session.note("complete_brief", f"Kept {key}: the key could not be read")
        chords = chords_for(key, romans)
    session.note("theory", f"{' '.join(romans)} in {key} is {', '.join(chords)}")
    if session.mode == "one_sound":
        prompts = compile_one_sound(
            sound=session.slots["sound"].value,
            genre=session.slots["genre"].value,
            brightness=session.slots["brightness"].value,
            mood=mood,
            energy=energy,
            key=key,
            bpm=bpm,
            facets=_facet_text(session, "sound"),
            arrangement=arrangement,
            arc=session.arc,
        )
    else:
        prompts = compile_prompts(
            session.output,
            mood=mood,
            energy=energy,
            world=world,
            key=key,
            bpm=bpm,
            facets=_facet_texts(session),
            arrangement=arrangement,
            arc=session.arc,
        )
    if not prompts and session.mode != "one_sound":
        session.output = ["all_layers"]
        prompts = compile_prompts(
            session.output,
            mood=mood,
            energy=energy,
            world=world,
            key=key,
            bpm=bpm,
            facets=_facet_texts(session),
            arrangement=arrangement,
            arc=session.arc,
        )
    prompts = hooks.polish(session, prompts)
    prompts = [_scrub_prompt(prompt, session.references) for prompt in prompts]
    _note_references(session)
    session.note("prompt", f"Wrote {len(prompts)} prompt" if len(prompts) == 1 else f"Wrote {len(prompts)} prompts")
    session.pending = None
    session.force_ready = True
    if not session.summary:
        session.summary = _summary(session, bpm)
    return TurnResponse(
        status="ready",
        brief=_brief(session),
        prompts=prompts,
        progression={"roman": romans, "chords": chords},
        trace=list(session.trace),
        summary=session.summary,
    )


def _summary(session: Session, bpm: int) -> str:
    mood = session.slots.get("mood")
    world = session.slots.get("world")
    key = session.slots.get("key")
    parts: list[str] = []
    if mood is not None:
        parts.append(mood.value)
    if world is not None:
        parts.append(world.value)
    if key is not None:
        parts.append(f"{bpm} BPM in {key.value}")
    else:
        parts.append(f"{bpm} BPM")
    return "Ready to build: " + ", ".join(parts) + "."


def _brief(session: Session) -> SongBrief:
    payload: dict = {
        "slots": {name: value.model_dump() for name, value in session.slots.items()},
        "output": session.output,
        "questions_asked": session.questions_asked,
        "skipped": session.skipped,
    }
    rows = _facet_rows(session)
    if rows:
        payload["facets"] = rows
    if session.arc is not None:
        payload["arc"] = {
            "label": session.arc.label,
            "start": session.arc.start,
            "end": session.arc.end,
            "description": session.arc.description,
        }
    return SongBrief.model_validate(payload)


_REFERENCE = re.compile(
    r"\b(?:like|inspired by|in the style of)\s+"
    r"([A-Z][A-Za-z0-9'&.-]+(?:\s+[A-Z][A-Za-z0-9'&.-]+){0,3})"
)
_NOT_A_NAME = {"no reference", "no preference", "none", "nothing"}


def _facet_turn(session: Session, hooks: TurnHooks) -> TurnResponse | None:
    if session.deepening:
        if session.extra <= 0:
            return None
    elif session.questions_asked >= session.budget:
        return None
    candidates = _candidates(session)
    if not candidates:
        return None
    pick = _offered_facet(session, hooks, candidates)
    if session.deepening:
        session.extra -= 1
    return _ask(session, Pending("facet", "palette", pick.text, pick.options, pick.facet_id), pick.reason)


def _ask_choice_facet(session: Session, picked: Choice) -> TurnResponse | None:
    candidates = _candidates(session)
    guarded = guard_pick(
        FacetPick(picked.facet, picked.text, picked.options, picked.reason),
        candidates,
        session.asked_facets,
    )
    if isinstance(guarded, str):
        session.note("ask", guarded)
        match = next((facet for facet in candidates if facet.id == picked.facet), None)
        if match is None:
            return None
        guarded = fallback_pick(match)
    return _ask(session, Pending("facet", "palette", guarded.text, guarded.options, guarded.facet_id), guarded.reason)


def _offered_facet(session: Session, hooks: TurnHooks, candidates: list[Facet]) -> FacetPick:
    chooser = getattr(hooks, "choose_facet", None)
    offered: FacetPick | None = None
    if chooser is not None:
        try:
            offered = chooser(session, candidates)
        except Exception:
            session.note("fallback", "Bedrock unavailable, used the facet order")
            offered = None
    if offered is None:
        facet = by_importance(candidates)
        if facet is None:
            raise RuntimeError("no facet to ask")
        return fallback_pick(facet)
    guarded = guard_pick(offered, candidates, session.asked_facets)
    if isinstance(guarded, str):
        session.note("ask", guarded)
        facet = by_importance(candidates)
        if facet is None:
            raise RuntimeError("no facet to ask")
        return fallback_pick(facet)
    return guarded


def _candidates(session: Session) -> list[Facet]:
    sound = session.slots.get("sound")
    return applicable(
        catalog(),
        mode=session.mode,
        layers=set(selected_layers(session.output)),
        sound=sound.value if sound is not None else "",
        answers=session.facet_values,
        asked=session.asked_facets,
    )


def _answer_facet(session: Session, facet_id: str, action: str, value: str, hooks: TurnHooks) -> None:
    facet = facet_by_id(facet_id)
    spoken = "You decide" if action == "you_decide" else "Skip this" if action == "skip" else value
    session.transcript.append({"role": "user", "text": spoken})
    session.asked_facets.add(facet_id)
    if facet is None:
        session.note("answer", f"Ignored unknown facet {facet_id}")
        return
    if action == "skip":
        session.note("answer", f"Skipped {facet.label}")
        return
    text = facet.values[0].label if action == "you_decide" else value
    mapped = ""
    if action == "answer" and facet.find(text) is None:
        mapper = getattr(hooks, "map_facet", None)
        if mapper is not None:
            try:
                mapped = mapper(session, facet, text) or ""
            except Exception:
                session.note("fallback", "Bedrock unavailable, kept your words")
    label, descriptor = resolve_answer(facet, text, mapped)
    descriptor = _without_all(descriptor, session.references)
    session.facet_values[facet.id] = label
    session.facet_descriptors[facet.id] = descriptor
    session.note("answer", f"{facet.id}: {label}")


def _facet_rows(session: Session) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for facet in catalog():
        if facet.id not in session.facet_values:
            continue
        rows.append(
            {
                "id": facet.id,
                "layer": facet.layer,
                "label": facet.label,
                "value": session.facet_values[facet.id],
                "descriptor": session.facet_descriptors.get(facet.id, ""),
                "options": list(facet.labels),
            }
        )
    return rows


def _facet_texts(session: Session) -> dict[str, str]:
    grouped: dict[str, list[str]] = {}
    for facet in catalog():
        if facet.layer == "sound":
            continue
        descriptor = session.facet_descriptors.get(facet.id, "")
        if descriptor:
            grouped.setdefault(facet.layer, []).append(descriptor)
    return {layer: _without_all(", ".join(parts), session.references) for layer, parts in grouped.items()}


def _facet_text(session: Session, layer: str) -> str:
    parts = [
        session.facet_descriptors[facet.id]
        for facet in catalog()
        if facet.layer == layer and facet.id in session.facet_descriptors
    ]
    return _without_all(", ".join(parts), session.references)


def _style_descriptors(session: Session, hooks: TurnHooks) -> str:
    if session.style_descriptors:
        return session.style_descriptors
    if not session.references:
        return ""
    text = ""
    describer = getattr(hooks, "describe_reference", None)
    if describer is not None:
        try:
            text = describer(session) or ""
        except Exception:
            session.note("fallback", "Bedrock unavailable, kept the reference out of the prompt")
    session.style_descriptors = _without_all(text, session.references)
    return session.style_descriptors


def _note_references(session: Session) -> None:
    if session.references_noted or not session.references:
        return
    session.references_noted = True
    for name in session.references:
        session.note("prompt", f"Used musical descriptors instead of {name}")


def _scrub_prompt(prompt: LayerPrompt, names: list[str]) -> LayerPrompt:
    if not names:
        return prompt
    return prompt.model_copy(
        update={
            "prompt": _without_all(prompt.prompt, names),
            "negative": _without_all(prompt.negative, names),
        }
    )


def _remember_arc(session: Session, text: str) -> None:
    if session.arc is not None:
        return
    found = detect_arc(text)
    if found is None:
        return
    session.arc = found
    session.note("extract", f"The idea moves: {found.label}")


def _remember_names(session: Session, text: str) -> None:
    for match in _REFERENCE.finditer(text):
        _remember_name(session, match.group(1))


def _remember_name(session: Session, value: str) -> None:
    cleaned = " ".join(value.split()).strip(" .,!")
    if not _looks_like_name(cleaned):
        return
    if any(cleaned.lower() == item.lower() for item in session.references):
        return
    session.references.append(cleaned)


def _looks_like_name(value: str) -> bool:
    if value.lower() in _NOT_A_NAME:
        return False
    parts = value.split()
    if not parts or len(parts) > 5:
        return False
    return all(part[:1].isupper() for part in parts)


def _without_all(text: str, names: list[str]) -> str:
    for name in names:
        text = _without(text, name)
    return text


def _without(text: str, name: str) -> str:
    if len(name.strip()) < 3:
        return text
    cleaned = re.sub(re.escape(name), "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+,", ",", cleaned)
    cleaned = re.sub(r",\s*,", ",", cleaned)
    return re.sub(r"\s{2,}", " ", cleaned).strip()
