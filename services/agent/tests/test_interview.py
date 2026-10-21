"""Adaptive interviewer with a stubbed Claude, plus deterministic number extraction."""

from botocore.exceptions import ClientError
from contracts import TurnRequest

from agent.bedrock import BedrockProvider
from agent.turn import run_turn


def request(session_id: str, **fields: object) -> TurnRequest:
    return TurnRequest.model_validate({"session_id": session_id, **fields})


def tool_response(name: str, payload: dict) -> dict:
    return {"output": {"message": {"content": [{"toolUse": {"name": name, "input": payload, "toolUseId": "1"}}]}}}


def slot(value: str, evidence: str = "text", confidence: float = 0.9, reason: str = "From the words") -> dict:
    return {"value": value, "confidence": confidence, "reason": reason, "evidence": evidence}


class Stub:
    def __init__(self, responses: list) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


INDUSTRIAL = "94 bpm, four on the floor, industrial, aggressive, distorted, bassy"
QUESTION = "Do you want it raw and minimal like warehouse techno, or big and cinematic?"


def test_stated_numbers_fill_tempo_key_and_bars_without_bedrock() -> None:
    response = run_turn(request("numbers", text="94 bpm in F minor for 8 bars"))

    tempo = response.brief.slots.tempo
    key = response.brief.slots.key
    structure = response.brief.slots.structure
    assert tempo is not None and tempo.value == "94" and tempo.source == "you"
    assert key is not None and key.value == "F minor" and key.source == "you"
    assert structure is not None and structure.value == "8 bars" and structure.source == "you"
    assert any(step.detail == "Heard 94 BPM in your words" for step in response.trace)
    assert any(step.detail == "Heard F minor in your words" for step in response.trace)
    assert any(step.detail == "Heard 8 bars in your words" for step in response.trace)


def test_industrial_line_asks_at_most_one_question() -> None:
    stub = Stub(
        [
            tool_response(
                "record_slots",
                {
                    "slots": {
                        "mood": slot("tense", reason="Aggressive reads as tense"),
                        "energy": slot("make people move", reason="Aggressive and distorted read as high energy"),
                        "world": slot(
                            "dark and electronic",
                            reason="Industrial and aggressive means a dark, high energy world",
                        ),
                    }
                },
            ),
            tool_response(
                "interview",
                {
                    "decision": "next_question",
                    "slot": "style",
                    "question": QUESTION,
                    "options": ["raw and minimal", "big and cinematic"],
                    "reason": "Asked about texture because the style was unclear",
                },
            ),
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("industrial", text=INDUSTRIAL))

    assert response.brief.questions_asked <= 1
    assert response.question is not None
    assert response.question.slot == "style"
    assert response.question.text == QUESTION
    assert response.question.slot not in {"mood", "tempo", "energy", "world"}
    tempo = response.brief.slots.tempo
    mood = response.brief.slots.mood
    energy = response.brief.slots.energy
    world = response.brief.slots.world
    assert tempo is not None and tempo.value == "94" and tempo.source == "you"
    assert mood is not None and mood.value == "tense" and mood.source == "you"
    assert energy is not None and energy.value == "make people move" and energy.source == "you"
    assert world is not None and world.value == "dark and electronic" and world.source == "you"
    details = [step.detail for step in response.trace]
    assert "Heard 94 BPM in your words" in details
    assert any("Industrial and aggressive means a dark, high energy world" in detail for detail in details)
    assert "Asked about texture because the style was unclear" in details
    sent = stub.calls[1]["messages"][0]["content"][0]["text"]
    assert INDUSTRIAL in sent
    assert "questions_remaining" in sent
    assert "94" in sent


def test_guardrail_blocks_a_repeated_slot() -> None:
    stub = Stub(
        [
            tool_response("record_slots", {"slots": {"mood": slot("tense", reason="You said aggressive")}}),
            tool_response(
                "interview",
                {
                    "decision": "next_question",
                    "slot": "mood",
                    "question": "Calm or tense?",
                    "options": ["peaceful", "tense"],
                    "reason": "Checking the mood",
                },
            ),
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("repeat", text="an aggressive night drive"))

    assert response.question is not None
    assert response.question.slot != "mood"
    assert any(step.detail == "Did not ask mood again: you already said it." for step in response.trace)


def test_invalid_options_are_rejected() -> None:
    stub = Stub(
        [
            tool_response("record_slots", {"slots": {}}),
            tool_response(
                "interview",
                {
                    "decision": "next_question",
                    "slot": "mood",
                    "question": "How does it feel?",
                    "options": ["calm", "angry"],
                    "reason": "The mood was missing",
                },
            ),
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("options", text="a long walk home"))

    assert response.question is not None
    assert response.question.slot == "output"
    assert response.question.text == "What would help most right now?"
    assert any("Rejected the mood options" in step.detail for step in response.trace)
    assert "calm" in next(step.detail for step in response.trace if "Rejected the mood options" in step.detail)


def test_interviewer_error_falls_back_to_the_asking_rule() -> None:
    error = ClientError({"Error": {"Code": "ServiceUnavailable", "Message": "down"}}, "Converse")
    stub = Stub(
        [
            tool_response("record_slots", {"slots": {"mood": slot("tense", reason="You said tense")}}),
            error,
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("fallback", text="a tense night"))

    assert response.question is not None
    assert response.question.slot == "output"
    assert response.question.text == "What would help most right now?"
    assert any(step.detail == "Bedrock unavailable, used the asking rule" for step in response.trace)


def test_contradiction_keeps_the_users_mood() -> None:
    stub = Stub(
        [
            tool_response("record_slots", {"slots": {"mood": slot("peaceful", reason="It sounded calm")}}),
            tool_response("interview", {"decision": "ready", "summary": "Aggressive and tense."}),
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("clash", text="aggressive and distorted"))

    mood = response.brief.slots.mood
    assert mood is not None
    assert mood.value == "tense"
    assert mood.source == "you"
    assert any(step.detail == "Kept tense: you said aggressive" for step in response.trace)
    assert response.summary == "Aggressive and tense."
