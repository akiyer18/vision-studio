"""Bedrock provider. Same turn loop as MockProvider, with Claude for extraction and wording."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from contracts import LayerPrompt, SlotValue

from agent.defaults import parse_bpm
from agent.extract import user_mood
from agent.facets import Facet, FacetPick, applicable, catalog
from agent.interview import NextFacet, Ready, interpret
from agent.polish import rejection_reason
from agent.prompts import anchor_for, base_layer, selected_layers
from agent.slots import MAX_QUESTIONS, slot_specs
from agent.theory import chords_for
from agent.tool_schema import extraction_schema
from agent.turn import Choice, Session, TurnHooks, ingest_mock, run_session, store_slot

_EXTRACT = "record_slots"
_POLISH = "polish_prompts"
_INTERVIEW = "interview"
_EXTRACT_TOKENS = 600
_POLISH_TOKENS = 300
_INTERVIEW_TOKENS = 400
_CLOSED = ("mood", "energy", "world")

_EXTRACT_SYSTEM = (
    "You fill a song brief for Vision Studio. You are a helper, not the author. "
    "Return only slots you can justify from the user's text or the audio features. "
    "Never invent a mood, instrument, genre, key, or tempo. "
    "Each slot needs a value, a confidence from 0 to 1, a short reason, and evidence: "
    '"text" when the user said it, or "audio" when it was measured. '
    "Mood, energy, and world must be one of the closed labels. "
    "Leave a slot out when the input does not justify it. Do not set output."
)

_POLISH_SYSTEM = (
    "You polish Stable Audio prompts. You are a helper, not the author. "
    "Change wording only. Do not add an instrument, genre, or mood that is not already "
    "in the template prompt or the brief. Keep the TrackType tag, the BPM, the key when "
    "the template has one, and the anchor instrument. Return one positive prompt per layer. "
    "Do not write negative prompts."
)

_INTERVIEW_SYSTEM = (
    "You are the interviewer for Vision Studio. You are a helper, not the author. "
    "Read the conversation, the brief, the audio features, the slot schema, and the remaining question budget. "
    "Either ask one short question that refers to what the producer already said, with 2 to 4 options, "
    "or say the brief is ready and summarise it in one line. "
    "Never ask tempo. Never ask which layers to make, and never choose the output slot: the interface already chose the layers. "
    "Never ask a slot whose source is you or detected. "
    "Ask at most one question in a turn. "
    "Options for a slot that lists allowed values must be those labels. "
    "When facets are listed, you may ask one of them instead of a slot. Set facet to its id and options to 2 to 4 of its values. "
    "Choose the facet that most changes the sound, and only one whose condition is already met. "
    "Do not invent a mood, instrument, genre, or tempo. Do not steer the song somewhere new."
)

_INTERVIEW_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["decision"],
    "properties": {
        "decision": {"type": "string", "enum": ["next_question", "ready"]},
        "slot": {"type": "string"},
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "reason": {"type": "string"},
        "summary": {"type": "string"},
        "facet": {"type": "string"},
    },
}

_FACET = "facet_question"
_MAP = "map_facet"
_REFERENCE = "describe_reference"

_FACET_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["facet", "question", "options", "reason"],
    "properties": {
        "facet": {"type": "string"},
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "reason": {"type": "string"},
    },
}

_MAP_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["value", "descriptor"],
    "properties": {
        "value": {"type": "string"},
        "descriptor": {"type": "string"},
    },
}

_REFERENCE_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["descriptors"],
    "properties": {"descriptors": {"type": "string"}},
}

_FACET_SYSTEM = (
    "You choose the next facet question for Vision Studio. You are a helper, not the author. "
    "Pick the facet that most changes the sound from the list. Phrase one short question in the producer's context. "
    "options must be 2 to 4 labels copied from that facet. Do not invent a value."
)

_MAP_SYSTEM = (
    "Map the producer's free-text answer onto a facet. You are a helper, not the author. "
    "If it is close to one allowed label, set value to that label and descriptor to that label's meaning. "
    "Otherwise leave value empty and put their meaning in descriptor, without adding a new musical idea."
)

_REFERENCE_SYSTEM = (
    "Turn an artist or song reference into musical descriptors. You are a helper, not the author. "
    "Describe timbre, mood, and arrangement. Do not include the artist name, the song title, or lyrics."
)

_POLISH_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["prompts"],
    "properties": {
        "prompts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["layer", "prompt"],
                "properties": {
                    "layer": {"type": "string"},
                    "prompt": {"type": "string"},
                },
            },
        }
    },
}


def client_config():
    """Short timeouts and no retries, so a stalled call falls back quickly."""
    from botocore.config import Config

    return Config(connect_timeout=2, read_timeout=8, retries={"total_max_attempts": 1})


def session_kwargs() -> dict[str, str]:
    """Pass AWS_PROFILE only when it is set. Region is optional either way."""
    profile = os.environ.get("AWS_PROFILE", "").strip()
    region = os.environ.get("AWS_REGION", "").strip()
    kwargs: dict[str, str] = {}
    if profile:
        kwargs["profile_name"] = profile
    if region:
        kwargs["region_name"] = region
    return kwargs


def runtime_client():
    import boto3

    region = session_kwargs().get("region_name")
    session = boto3.Session(**session_kwargs())
    client_kwargs: dict[str, object] = {"config": client_config()}
    if region:
        client_kwargs["region_name"] = region
    return session.client("bedrock-runtime", **client_kwargs)


class BedrockProvider:
    def __init__(self, client: object | None = None, model_id: str | None = None) -> None:
        self.sessions: dict[str, Session] = {}
        self._client = client
        self.model_id = os.environ.get("BEDROCK_MODEL_ID", "") if model_id is None else model_id
        self.hooks: TurnHooks = _Hooks(self)

    def run_turn(self, request):
        return run_session(self.sessions, request, self.hooks)

    def client(self):
        if self._client is None:
            self._client = runtime_client()
        return self._client


_provider: BedrockProvider | None = None


def bedrock_provider() -> BedrockProvider:
    global _provider
    if _provider is None:
        _provider = BedrockProvider()
    return _provider


class _Hooks:
    def __init__(self, provider: BedrockProvider) -> None:
        self.provider = provider

    def ingest_text(self, session: Session) -> None:
        try:
            payload = _converse(
                self.provider,
                name=_EXTRACT,
                description="Slots justified by the user's text or the audio features.",
                schema=extraction_schema(),
                system=_EXTRACT_SYSTEM,
                message=_extract_message(session),
                max_tokens=_EXTRACT_TOKENS,
            )
        except Exception:
            session.note("fallback", "Bedrock unavailable, used the offline extractor")
            ingest_mock(session)
            return
        merge_slots(session, payload)

    def choose(self, session: Session) -> Choice | None:
        if session.questions_asked >= MAX_QUESTIONS:
            return None
        try:
            payload = _converse(
                self.provider,
                name=_INTERVIEW,
                description="The next question, or a one-line summary when the brief is ready.",
                schema=_INTERVIEW_SCHEMA,
                system=_INTERVIEW_SYSTEM,
                message=_interview_message(session),
                max_tokens=_INTERVIEW_TOKENS,
            )
        except Exception:
            session.note("fallback", "Bedrock unavailable, used the asking rule")
            return None
        result = interpret(
            payload,
            sources={name: slot.source for name, slot in session.slots.items()},
            questions_asked=session.questions_asked,
            mode=session.mode,
        )
        if isinstance(result, str):
            session.note("ask", result)
            return None
        if isinstance(result, Ready):
            return Choice(ready=True, summary=result.summary)
        if isinstance(result, NextFacet):
            return Choice(
                ready=False,
                slot="palette",
                facet=result.facet,
                text=result.text,
                options=result.options,
                reason=result.reason,
            )
        return Choice(ready=False, slot=result.slot, text=result.text, options=result.options, reason=result.reason)

    def choose_facet(self, session: Session, candidates: list[Facet]) -> FacetPick:
        payload = _converse(
            self.provider,
            name=_FACET,
            description="The next facet question.",
            schema=_FACET_SCHEMA,
            system=_FACET_SYSTEM,
            message=_facet_message(session, candidates),
            max_tokens=_INTERVIEW_TOKENS,
        )
        options = payload.get("options")
        if not isinstance(options, list):
            options = []
        return FacetPick(
            str(payload.get("facet") or ""),
            str(payload.get("question") or ""),
            tuple(str(item) for item in options),
            str(payload.get("reason") or ""),
        )

    def map_facet(self, session: Session, facet: Facet, text: str) -> str:
        payload = _converse(
            self.provider,
            name=_MAP,
            description="The closest facet value, or a descriptor for the producer's words.",
            schema=_MAP_SCHEMA,
            system=_MAP_SYSTEM,
            message=json.dumps(
                {
                    "facet": facet.id,
                    "question": facet.question,
                    "values": [{"label": value.label, "descriptor": value.descriptor} for value in facet.values],
                    "answer": text,
                }
            ),
            max_tokens=200,
        )
        value = str(payload.get("value") or "").strip()
        descriptor = str(payload.get("descriptor") or "").strip()
        if value and facet.find(value) is not None:
            return value
        return descriptor or value

    def describe_reference(self, session: Session) -> str:
        payload = _converse(
            self.provider,
            name=_REFERENCE,
            description="Musical descriptors for a reference. No artist or song name.",
            schema=_REFERENCE_SCHEMA,
            system=_REFERENCE_SYSTEM,
            message=json.dumps({"references": session.references, "idea": session.text}),
            max_tokens=200,
        )
        return str(payload.get("descriptors") or "").strip()

    def polish(self, session: Session, prompts: list[LayerPrompt]) -> list[LayerPrompt]:
        if not prompts:
            return prompts
        try:
            payload = _converse(
                self.provider,
                name=_POLISH,
                description="Improved positive prompts, wording only.",
                schema=_POLISH_SCHEMA,
                system=_POLISH_SYSTEM,
                message=_polish_message(session, prompts),
                max_tokens=_POLISH_TOKENS * len(prompts),
            )
        except Exception:
            session.note("fallback", "Bedrock unavailable, kept the template prompts")
            return prompts
        return _apply_polish(session, prompts, payload)


def _converse(provider: BedrockProvider, *, name: str, description: str, schema: dict, system: str, message: str, max_tokens: int) -> dict:
    if not provider.model_id.strip():
        raise RuntimeError("BEDROCK_MODEL_ID is not set")
    response = provider.client().converse(
        modelId=provider.model_id,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": message}]}],
        toolConfig={
            "tools": [
                {
                    "toolSpec": {
                        "name": name,
                        "description": description,
                        "inputSchema": {"json": schema},
                    }
                }
            ],
            "toolChoice": {"tool": {"name": name}},
        },
        inferenceConfig={"temperature": 0.2, "maxTokens": max_tokens},
    )
    return _tool_input(response, name)


def _tool_input(response: object, name: str) -> dict:
    if not isinstance(response, dict):
        raise RuntimeError("Bedrock returned no tool call")
    content = response.get("output", {}).get("message", {}).get("content", [])
    for block in content:
        tool = block.get("toolUse") if isinstance(block, dict) else None
        if isinstance(tool, dict) and tool.get("name") == name and isinstance(tool.get("input"), dict):
            return tool["input"]
    raise RuntimeError("Bedrock returned no tool call")


def _interview_message(session: Session) -> str:
    features = session.features.model_dump(exclude_none=True) if session.features is not None else None
    brief = {
        name: {"value": slot.value, "source": slot.source, "reason": slot.reason}
        for name, slot in session.slots.items()
    }
    schema = [{"slot": spec.slot, "options": list(spec.options)} for spec in slot_specs() if spec.slot != "tempo"]
    sound = session.slots.get("sound")
    facets = applicable(
        catalog(),
        mode=session.mode,
        layers=set(selected_layers(session.output)),
        sound=sound.value if sound is not None else "",
        answers=session.facet_values,
        asked=session.asked_facets,
    )
    return json.dumps(
        {
            "conversation": session.transcript,
            "brief": brief,
            "audio_features": features,
            "slots": schema,
            "facets": [_facet_brief(facet) for facet in facets],
            "questions_remaining": max(0, session.budget - session.questions_asked),
        },
        indent=2,
    )


def _facet_message(session: Session, candidates: list[Facet]) -> str:
    return json.dumps(
        {
            "conversation": session.transcript,
            "answers": session.facet_values,
            "facets": [_facet_brief(facet) for facet in candidates],
        },
        indent=2,
    )


def _facet_brief(facet: Facet) -> dict[str, object]:
    return {
        "id": facet.id,
        "intent": facet.intent,
        "importance": facet.importance,
        "when": facet.when,
        "question": facet.question,
        "values": [value.label for value in facet.values],
    }


def _extract_message(session: Session) -> str:
    features = session.features.model_dump(exclude_none=True) if session.features is not None else None
    brief = {name: {"value": slot.value, "source": slot.source} for name, slot in session.slots.items()}
    return json.dumps({"text": session.text, "audio_features": features, "brief": brief}, indent=2)


def _polish_message(session: Session, prompts: list[LayerPrompt]) -> str:
    world = session.slots["world"].value
    layers = [
        {"layer": item.layer, "anchor": _anchor(session, item.layer), "prompt": item.prompt} for item in prompts
    ]
    brief = {name: slot.value for name, slot in session.slots.items()}
    return json.dumps({"brief": brief, "layers": layers}, indent=2)


@dataclass(frozen=True)
class _Proposal:
    slot: str
    value: str
    confidence: float
    reason: str
    evidence: str


def merge_slots(session: Session, payload: dict) -> None:
    session.note("extract", "Claude read your idea")
    known = {spec.slot for spec in slot_specs()}
    closed = {spec.slot: set(spec.options) for spec in slot_specs() if spec.slot in _CLOSED and spec.options}
    raw_slots = payload.get("slots") if isinstance(payload, dict) else None
    if not isinstance(raw_slots, dict):
        return
    for name, raw in raw_slots.items():
        if name not in known or name == "output" or not isinstance(raw, dict):
            continue
        proposal = _proposal(name, raw)
        if proposal is None:
            session.note("extract", f"Dropped {name}: it had no evidence")
            continue
        _merge_one(session, proposal, closed)


def _proposal(name: str, raw: dict) -> _Proposal | None:
    evidence = raw.get("evidence")
    reason = raw.get("reason")
    value = raw.get("value")
    confidence = raw.get("confidence")
    if evidence not in {"text", "audio"} or not isinstance(reason, str) or not reason.strip():
        return None
    if not isinstance(value, str) or not value.strip():
        return None
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
        return None
    return _Proposal(name, value.strip(), float(confidence), reason.strip(), evidence)


def _merge_one(session: Session, proposal: _Proposal, closed: dict[str, set[str]]) -> None:
    if proposal.slot in closed and proposal.value not in closed[proposal.slot]:
        session.note("extract", f"Dropped {proposal.slot}: {proposal.value} is not one of the closed labels")
        return
    stored = proposal.value
    if proposal.slot == "tempo":
        number = parse_bpm(proposal.value)
        if number is None:
            session.note("extract", f"Dropped tempo: {proposal.value} has no tempo")
            return
        stored = str(number)
    if proposal.slot == "key" and not _key_parses(stored):
        session.note("extract", f"Dropped key: {stored} is not a key")
        return
    if proposal.slot == "mood":
        said = user_mood(session.text)
        if said is not None and said[0] != stored:
            label, word = said
            current = session.slots.get("mood")
            if current is not None and current.source == "you":
                session.note("extract", f"Kept {current.value}: you said {word}")
                return
            kept = SlotValue(value=label, source="you", reason=f"You said {word}", confidence=1.0)
            _keep_new(session, "mood", kept)
            session.note("extract", f"Kept {label}: you said {word}")
            return
    source = "you" if proposal.evidence == "text" else "detected"
    incoming = SlotValue(value=stored, source=source, reason=proposal.reason, confidence=proposal.confidence)
    current = session.slots.get(proposal.slot)
    if current is None:
        _keep_new(session, proposal.slot, incoming)
        session.note("extract", f"{proposal.slot}: {stored} ({proposal.reason})")
        return
    if proposal.slot in session.locked or current.source == "you":
        if not _same(proposal.slot, current.value, stored):
            session.note("extract", f"Kept your {proposal.slot}: {current.value}")
        return
    if current.source in {"detected", "reference"}:
        if proposal.evidence != "text":
            return
        if _same(proposal.slot, current.value, stored):
            _keep_new(session, proposal.slot, incoming)
            session.note("extract", f"Kept {current.value} for {proposal.slot} from what you said")
            return
        _keep_new(session, proposal.slot, incoming)
        session.note("extract", _disagreement(proposal, current.value, stored))
        return
    if current.source == "guessed" and proposal.confidence > current.confidence:
        previous = current.value
        _keep_new(session, proposal.slot, incoming)
        session.note(
            "extract",
            f"Replaced the guessed {proposal.slot} {previous} with {stored}: {proposal.reason}",
        )


def _keep_new(session: Session, name: str, value: SlotValue) -> None:
    store_slot(session, name, value)
    if name == "key":
        session.gave_key = True


def _key_parses(value: str) -> bool:
    try:
        chords_for(value, ["I"])
    except ValueError:
        return False
    return True


def _same(slot: str, left: str, right: str) -> bool:
    if slot == "tempo":
        return parse_bpm(left) is not None and parse_bpm(left) == parse_bpm(right)
    return " ".join(left.lower().split()) == " ".join(right.lower().split())


def _disagreement(proposal: _Proposal, measured: str, kept: str) -> str:
    stated = proposal.value
    if proposal.slot == "tempo" and "bpm" not in stated.lower():
        stated = f"{stated} BPM"
    return f"You said {stated}, the audio measured {measured}, kept {kept}"


def _apply_polish(session: Session, prompts: list[LayerPrompt], payload: dict) -> list[LayerPrompt]:
    returned = _polished_by_layer(payload)
    brief = " ".join(slot.value for slot in session.slots.values())
    key = session.slots["key"].value
    updated: list[LayerPrompt] = []
    for item in prompts:
        name = item.layer.replace("_", " ")
        polished = returned.get(item.layer)
        if polished is None:
            session.note("polish", f"Kept the template for the {name} prompt: Claude did not return one")
            updated.append(item)
            continue
        reason = rejection_reason(
            item.prompt,
            polished,
            anchor=_anchor(session, item.layer),
            brief=brief,
            key=key,
        )
        if reason is None:
            session.note("polish", f"Claude polished the {name} prompt")
            updated.append(item.model_copy(update={"prompt": polished}))
        else:
            session.note("polish", f"Kept the template for the {name} prompt: {reason}")
            updated.append(item)
    return updated


def _anchor(session: Session, layer: str) -> str:
    base = base_layer(layer)
    if base == "sound":
        sound = session.slots.get("sound")
        return sound.value if sound is not None else "sound"
    world = session.slots["world"].value
    if session.arc is not None and layer.endswith("_a"):
        world = session.arc.start_world
    elif session.arc is not None and layer.endswith("_b"):
        world = session.arc.end_world
    return anchor_for(world, base)


def _polished_by_layer(payload: dict) -> dict[str, str]:
    rows = payload.get("prompts") if isinstance(payload, dict) else None
    found: dict[str, str] = {}
    if not isinstance(rows, list):
        return found
    for row in rows:
        if not isinstance(row, dict):
            continue
        layer = row.get("layer")
        prompt = row.get("prompt")
        if isinstance(layer, str) and isinstance(prompt, str) and prompt.strip():
            found[layer] = prompt.strip()
    return found


_EXPLAIN_SYSTEM = (
    "You explain a finished sound for Vision Studio. Use only the brief, the trace, and the prompts. "
    "how states how it was made from those facts. steps are Make it in Logic instructions that use "
    "Logic's own instruments and plugins. Do not add a genre, instrument, or fact that is not in the input."
)

_HISTORY_SYSTEM = (
    "Rephrase only the history you are given, so it is easy to read. "
    "Do not add artists, tracks, tempos, keys, or facts. If it is already clear, make only light edits."
)

_EXPLAIN_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["how", "steps"],
    "properties": {
        "how": {"type": "string"},
        "steps": {"type": "array", "items": {"type": "string"}},
    },
}

_HISTORY_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["history"],
    "properties": {"history": {"type": "string"}},
}


def explain_payload(brief, prompts, trace) -> dict:
    provider = bedrock_provider()
    message = json.dumps(
        {
            "brief": brief.model_dump(exclude_none=True),
            "prompts": [item.model_dump() for item in prompts],
            "trace": [step.model_dump() for step in trace],
        }
    )
    return _converse(
        provider,
        name="explain_result",
        description="How the sound was made, and how to make it in Logic.",
        schema=_EXPLAIN_SCHEMA,
        system=_EXPLAIN_SYSTEM,
        message=message,
        max_tokens=700,
    )


def history_payload(history: str) -> dict:
    provider = bedrock_provider()
    return _converse(
        provider,
        name="rephrase_history",
        description="A readable rephrase of the supplied history only.",
        schema=_HISTORY_SCHEMA,
        system=_HISTORY_SYSTEM,
        message=history,
        max_tokens=400,
    )
