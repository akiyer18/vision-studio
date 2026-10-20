"""One conversation turn. Session state stays in memory on the provider."""

from __future__ import annotations

from dataclasses import dataclass, field

from contracts import (
    AudioFeatures,
    Question,
    SlotValue,
    SongBrief,
    TraceStep,
    TurnRequest,
    TurnResponse,
)

from agent.asking import AskContext, almost_empty, next_question
from agent.defaults import PRESETS, default_slot, derive_bpm, preset_for, skipped
from agent.extract import extract_audio, extract_text
from agent.prompts import compile_prompts
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


@dataclass
class Session:
    session_id: str
    text: str = ""
    input_type: str | None = None
    gave_key: bool = False
    detected_bpm: float | None = None
    slots: dict[str, SlotValue] = field(default_factory=dict)
    output: list[str] = field(default_factory=list)
    questions_asked: int = 0
    skipped: list[str] = field(default_factory=list)
    pending: Pending | None = None
    about_asked: bool = False
    force_ready: bool = False
    trace: list[TraceStep] = field(default_factory=list)

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


class MockProvider:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}

    def run_turn(self, request: TurnRequest) -> TurnResponse:
        session = self.sessions.setdefault(request.session_id, Session(request.session_id))
        if request.audio_features is not None:
            _apply_audio(session, request.audio_features)
        if request.output:
            _set_output(session, list(request.output), "you", "You chose this output", 1.0)
            session.note("answer", f"output: {session.slots['output'].value}")
        if request.overrides is not None:
            _apply_overrides(session, request.overrides)
        if request.text:
            _remember_text(session, request.text)
        if request.answer is not None:
            _apply_answer(session, request.answer.slot, request.answer.action, request.answer.value)
        elif session.pending is not None:
            return _question_response(session, session.pending, waiting=True)
        if session.force_ready:
            return _ready(session)
        if _should_ask_about(session):
            session.about_asked = True
            pending = Pending("about", "mood", ABOUT_QUESTION, ())
            return _ask(session, pending)
        spec = next_question(_context(session))
        if spec is not None and session.questions_asked < MAX_QUESTIONS:
            pending = Pending("slot", spec.slot, spec.question, spec.options)
            return _ask(session, pending)
        return _ready(session)


_provider = MockProvider()


def run_turn(request: TurnRequest) -> TurnResponse:
    return _provider.run_turn(request)


def _remember_text(session: Session, text: str) -> None:
    session.text = f"{session.text} {text}".strip() if session.text else text.strip()
    found = extract_text(session.text)
    if not found:
        session.note("extract", "No mood, energy, or scene in the text")
        return
    for name, value in found.items():
        if name in session.slots:
            continue
        session.slots[name] = value
        session.note("extract", f"{name}: {value.value} ({value.reason})")


def _apply_audio(session: Session, features: AudioFeatures) -> None:
    session.input_type = features.input_type
    for name, value in extract_audio(features).items():
        if name in session.slots:
            continue
        session.slots[name] = value
        session.note("detect", f"{name}: {value.value} ({value.reason})")
        if name == "key":
            session.gave_key = True
    if features.bpm is not None:
        session.detected_bpm = features.bpm
        session.note("detect", f"bpm: {features.bpm}")
    if features.chords:
        session.note("detect", "chords: " + ", ".join(features.chords))


def _apply_overrides(session: Session, overrides: object) -> None:
    data = overrides.model_dump(exclude_none=True) if hasattr(overrides, "model_dump") else dict(overrides)
    for name, value in data.items():
        if name == "output":
            _set_output(session, _enums_for_label(str(value)), "you", "You set this in the request", 1.0)
        else:
            session.slots[name] = SlotValue(
                value=str(value),
                source="you",
                reason="You set this in the request",
                confidence=1.0,
            )
            if name == "key":
                session.gave_key = True
        session.note("answer", f"{name}: {session.slots[name].value}")


def _apply_answer(session: Session, slot: str, action: str, value: str | None) -> None:
    pending = session.pending
    session.pending = None
    if action == "skip_all":
        session.note("answer", "skip all, filling the remaining slots")
        _fill_gaps(session, skipped_fill=True)
        session.force_ready = True
        return
    if pending is not None and pending.kind == "about" and action == "answer":
        _remember_text(session, value or "")
        session.note("answer", "Re-ran extraction on the description")
        return
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
    session.slots[target] = SlotValue(value=value or "", source="you", reason="You answered", confidence=1.0)
    session.note("answer", f"{target}: {value or ''}")


def _use_default(session: Session, slot: str, *, mark_skipped: bool) -> None:
    value = default_slot(slot, session.mood_name(), audio=session.is_audio)
    if mark_skipped:
        value = skipped(value)
        if slot not in session.skipped:
            session.skipped.append(slot)
    if slot == "output":
        _set_output(session, ["full_mix"], value.source, value.reason, value.confidence)
    else:
        session.slots[slot] = value
    session.note("default", f"{slot}: {value.value} ({value.reason})")


def _set_key_mode(session: Session, mode: str) -> None:
    current = session.slots.get("key")
    base = current.value if current is not None else preset_for(session.mood_name()).key
    note = base.split()[0]
    chosen = f"{note} {mode}"
    session.slots["key"] = SlotValue(value=chosen, source="you", reason=f"You chose {mode}", confidence=1.0)
    session.gave_key = True
    session.note("answer", f"key: {chosen}")


def _fill_gaps(session: Session, *, skipped_fill: bool) -> None:
    for spec in slot_specs():
        if spec.slot in session.slots:
            continue
        _use_default(session, spec.slot, mark_skipped=skipped_fill)


def _set_output(session: Session, choices: list[str], source: str, reason: str, confidence: float) -> None:
    session.output = choices
    label = ", ".join(OUTPUT_LABEL[choice] for choice in choices)
    session.slots["output"] = SlotValue(value=label, source=source, reason=reason, confidence=confidence)


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


def _ask(session: Session, pending: Pending) -> TurnResponse:
    session.questions_asked += 1
    session.pending = pending
    session.note("ask", f"{pending.slot}: {pending.text}")
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
            max=MAX_QUESTIONS,
        ),
        brief=_brief(session),
        trace=list(session.trace),
    )


def _ready(session: Session) -> TurnResponse:
    _fill_gaps(session, skipped_fill=False)
    mood = session.mood_name()
    energy = session.slots["energy"].value
    world = session.slots["world"].value
    key = session.slots["key"].value
    if session.detected_bpm is not None:
        bpm = int(session.detected_bpm + 0.5)
        tempo_reason = f"{bpm} BPM detected from the audio"
    else:
        bpm, tempo_reason = derive_bpm(energy, mood)
    session.note("tempo", tempo_reason)
    romans = list(PRESETS.get(mood, PRESETS["peaceful"]).roman)
    chords = chords_for(key, romans)
    session.note("theory", f"{' '.join(romans)} in {key} is {', '.join(chords)}")
    prompts = compile_prompts(session.output, mood=mood, energy=energy, world=world, key=key, bpm=bpm)
    session.note("prompt", f"Wrote {len(prompts)} prompt" if len(prompts) == 1 else f"Wrote {len(prompts)} prompts")
    session.pending = None
    session.force_ready = True
    return TurnResponse(
        status="ready",
        brief=_brief(session),
        prompts=prompts,
        progression={"roman": romans, "chords": chords},
        trace=list(session.trace),
    )


def _brief(session: Session) -> SongBrief:
    return SongBrief.model_validate(
        {
            "slots": {name: value.model_dump() for name, value in session.slots.items()},
            "output": session.output,
            "questions_asked": session.questions_asked,
            "skipped": session.skipped,
        }
    )
