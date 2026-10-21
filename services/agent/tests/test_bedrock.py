"""BedrockProvider with a stubbed client. No network."""

import json

import pytest
from botocore.exceptions import ClientError, ReadTimeoutError
from contracts import TurnRequest

from agent.bedrock import BedrockProvider, client_config, session_kwargs
from agent.prompts import ANCHORS, DESCRIPTORS
from agent.tool_schema import extraction_schema
from agent.vocab import vocabulary


def request(session_id: str, **fields: object) -> TurnRequest:
    return TurnRequest.model_validate({"session_id": session_id, **fields})


def tool_response(name: str, payload: dict) -> dict:
    return {"output": {"message": {"content": [{"toolUse": {"name": name, "input": payload, "toolUseId": "1"}}]}}}


def slot(value: str, evidence: str = "text", confidence: float = 0.8, reason: str = "From the words") -> dict:
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


def test_schema_comes_from_the_slot_contract() -> None:
    schema = extraction_schema()
    slots = schema["properties"]["slots"]["properties"]
    mood = slots["mood"]
    assert mood["properties"]["value"]["enum"] == ["joyful", "peaceful", "longing", "tense"]
    assert mood["properties"]["evidence"]["enum"] == ["text", "audio"]
    assert "source" not in mood["properties"]
    assert mood["properties"]["confidence"]["minimum"] == 0
    assert mood["properties"]["confidence"]["maximum"] == 1
    assert "tempo" in slots
    assert "required" not in schema["properties"]["slots"]
    assert slots["energy"]["properties"]["value"]["enum"] == ["slow and breathing", "steady", "make people move"]


def test_vocabulary_includes_spec_words_and_the_curated_list() -> None:
    words = set(vocabulary())
    assert "piano" in words
    assert "drum kit" in words
    assert "longing" in words
    assert "trumpet" in words
    assert "jazz" in words
    assert "gently" not in words


def test_anchors_already_sit_in_the_descriptors() -> None:
    assert set(ANCHORS) == set(DESCRIPTORS)
    for world, layers in ANCHORS.items():
        assert set(layers) == set(DESCRIPTORS[world])
        for layer, anchor in layers.items():
            assert anchor.lower() in DESCRIPTORS[world][layer].lower()


def test_extraction_maps_text_evidence_to_you() -> None:
    stub = Stub(
        [
            tool_response(
                "record_slots",
                {
                    "slots": {
                        "mood": slot("longing", reason="You said you miss the rain"),
                        "energy": slot("slow and breathing", confidence=0.7),
                        "world": slot("warm and intimate", confidence=0.6),
                    }
                },
            )
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("extract", text="I miss the rain", output=["drums"]))

    mood = response.brief.slots.mood
    assert mood is not None
    assert mood.value == "longing"
    assert mood.source == "you"
    assert mood.confidence == 0.8
    assert any(step.detail == "Claude read your idea" for step in response.trace)
    call = stub.calls[0]
    assert call["inferenceConfig"] == {"temperature": 0.2, "maxTokens": 600}
    assert "topP" not in call["inferenceConfig"]
    assert call["toolConfig"]["toolChoice"] == {"tool": {"name": "record_slots"}}
    assert "negative" not in call["messages"][0]["content"][0]["text"]


def test_user_answer_and_override_stay_locked() -> None:
    stub = Stub(
        [
            tool_response(
                "record_slots",
                {"slots": {"mood": slot("tense", reason="The text sounds tense"), "key": slot("G minor")}},
            )
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    provider.run_turn(request("lock", answer={"slot": "mood", "action": "answer", "value": "joyful"}))
    response = provider.run_turn(request("lock", text="a tense night", overrides={"key": "F major"}))

    mood = response.brief.slots.mood
    key = response.brief.slots.key
    assert mood is not None and mood.value == "joyful" and mood.source == "you"
    assert key is not None and key.value == "F major" and key.source == "you"
    details = [step.detail for step in response.trace]
    assert "Kept your mood: joyful" in details
    assert "Kept your key: F major" in details


def test_text_beats_measured_tempo() -> None:
    stub = Stub(
        [
            tool_response(
                "record_slots",
                {"slots": {"tempo": slot("around 90", reason="You said around 90")}},
            )
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(
        request(
            "tempo",
            text="around 90 bpm",
            audio_features={
                "input_type": "full_track",
                "bpm": 124,
                "confidence": 0.95,
            },
        )
    )

    tempo = response.brief.slots.tempo
    assert tempo is not None
    assert tempo.value == "90"
    assert tempo.source == "you"
    assert "You said around 90 BPM, the audio measured 124, kept 90" in [step.detail for step in response.trace]


def test_audio_evidence_does_not_replace_a_measurement() -> None:
    stub = Stub(
        [
            tool_response(
                "record_slots",
                {"slots": {"key": slot("C major", evidence="audio", reason="A different guess")}},
            )
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(
        request(
            "measured",
            text="listen to this",
            audio_features={"input_type": "instrument_loop", "key": "D", "mode": "minor", "confidence": 0.9},
        )
    )

    key = response.brief.slots.key
    assert key is not None
    assert key.value == "D minor"
    assert key.source == "detected"


def test_guessed_slot_is_replaced_when_new_input_is_stronger() -> None:
    stub = Stub(
        [
            tool_response("record_slots", {"slots": {}}),
            tool_response(
                "record_slots",
                {"slots": {"mood": slot("longing", confidence=0.9, reason="You said you miss the rain")}},
            ),
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    provider.run_turn(request("guess", text="Hello"))
    provider.run_turn(request("guess", answer={"slot": "mood", "action": "you_decide"}))
    response = provider.run_turn(request("guess", text="I miss the rain"))

    mood = response.brief.slots.mood
    assert mood is not None
    assert mood.value == "longing"
    assert mood.source == "you"
    assert any(step.detail.startswith("Replaced the guessed mood peaceful with longing") for step in response.trace)


def test_invalid_closed_label_is_dropped() -> None:
    stub = Stub([tool_response("record_slots", {"slots": {"mood": slot("sad", reason="The text says sad")}})])
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    provider.run_turn(request("invalid", answer={"slot": "mood", "action": "answer", "value": "joyful"}))
    response = provider.run_turn(request("invalid", text="I feel sad"))

    mood = response.brief.slots.mood
    assert mood is not None and mood.value == "joyful"
    assert any(step.detail == "Dropped mood: sad is not one of the closed labels" for step in response.trace)


def test_slots_without_evidence_are_dropped() -> None:
    stub = Stub(
        [
            tool_response(
                "record_slots",
                {"slots": {"energy": {"value": "steady", "confidence": 0.9, "reason": "A guess"}}},
            )
        ]
    )
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("evidence", text="A steady walk", output=["drums"]))

    assert response.brief.slots.energy is None
    assert any("Dropped energy" in step.detail for step in response.trace)


def _ready_provider(stub: Stub) -> BedrockProvider:
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    return provider


def test_successful_polish_keeps_wording_and_leaves_negatives() -> None:
    stub = Stub([])

    def converse(**kwargs):
        stub.calls.append(kwargs)
        message = json.loads(kwargs["messages"][0]["content"][0]["text"])
        prompts = []
        for layer in message["layers"]:
            prompts.append({"layer": layer["layer"], "prompt": layer["prompt"].replace(",", ", quite", 1)})
        return tool_response("polish_prompts", {"prompts": prompts})

    stub.converse = converse
    provider = _ready_provider(stub)
    response = provider.run_turn(request("polish", answer={"slot": "mood", "action": "skip_all"}))

    assert response.status == "ready"
    assert response.prompts is not None
    drums = response.prompts[0]
    assert drums.layer == "drums"
    assert "quite" in drums.prompt
    assert "drum kit" in drums.prompt.lower()
    assert "74 BPM" in drums.prompt
    assert drums.negative == "chords, bass, melody, texture, vocals"
    assert any(step.detail == "Claude polished the drums prompt" for step in response.trace)
    assert "negative" not in stub.calls[0]["messages"][0]["content"][0]["text"]
    assert stub.calls[0]["inferenceConfig"]["maxTokens"] == 300 * len(response.prompts)
    assert stub.calls[0]["inferenceConfig"]["temperature"] == 0.2


@pytest.mark.parametrize(
    ("layer", "mutate", "reason"),
    [
        ("drums", lambda prompt: prompt.replace("drum kit, ", ""), "it dropped the main instrument"),
        ("drums", lambda prompt: prompt.replace("74 BPM", "80 BPM"), "it dropped the BPM"),
        ("drums", lambda prompt: prompt.replace("TrackType: Instrument, ", ""), "it dropped the track type"),
        ("chords", lambda prompt: prompt.replace("C major", "F major"), "it dropped the key"),
    ],
)
def test_polish_rejects_a_prompt_that_drops_a_required_fact(layer: str, mutate, reason: str) -> None:
    _assert_template_kept(layer, mutate, reason)


def test_polish_rejects_a_new_vocabulary_word() -> None:
    _assert_template_kept("bass", lambda prompt: prompt.replace("sub bass", "sub bass and trumpet"), "it added trumpet")


def test_polish_rejects_a_prompt_that_is_too_long() -> None:
    _assert_template_kept("drums", lambda prompt: prompt + " quite" * 40, "it is longer than 1.5 times the template")


def test_polish_rejects_a_prompt_that_is_too_short() -> None:
    _assert_template_kept(
        "drums",
        lambda prompt: "TrackType: Instrument, drum kit, 74 BPM",
        "it is shorter than 0.6 times the template",
    )


def _assert_template_kept(layer: str, mutate, reason: str) -> None:
    stub = Stub([])

    def converse(**kwargs):
        stub.calls.append(kwargs)
        message = json.loads(kwargs["messages"][0]["content"][0]["text"])
        prompts = []
        for item in message["layers"]:
            text = mutate(item["prompt"]) if item["layer"] == layer else item["prompt"]
            prompts.append({"layer": item["layer"], "prompt": text})
        return tool_response("polish_prompts", {"prompts": prompts})

    stub.converse = converse
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request(f"keep-{layer}-{reason}", answer={"slot": "mood", "action": "skip_all"}))
    assert response.prompts is not None
    kept = next(item for item in response.prompts if item.layer == layer)
    original = json.loads(stub.calls[0]["messages"][0]["content"][0]["text"])
    template = next(item["prompt"] for item in original["layers"] if item["layer"] == layer)
    assert kept.prompt == template
    assert any(step.detail == f"Kept the template for the {layer} prompt: {reason}" for step in response.trace)


def test_fallback_on_bedrock_error_uses_the_offline_extractor() -> None:
    error = ClientError({"Error": {"Code": "ServiceUnavailable", "Message": "down"}}, "Converse")
    stub = Stub([error])
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("error", text="I feel sad in the rain"))

    mood = response.brief.slots.mood
    assert mood is not None and mood.value == "longing"
    assert any(step.detail == "Bedrock unavailable, used the offline extractor" for step in response.trace)


def test_fallback_on_timeout_uses_the_offline_extractor() -> None:
    stub = Stub([ReadTimeoutError(endpoint_url="https://bedrock-runtime.us-east-1.amazonaws.com")])
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("timeout", text="I feel sad in the rain"))

    mood = response.brief.slots.mood
    assert mood is not None and mood.value == "longing"
    assert any(step.detail == "Bedrock unavailable, used the offline extractor" for step in response.trace)


def test_polish_fallback_keeps_the_template() -> None:
    stub = Stub([ReadTimeoutError(endpoint_url="https://bedrock-runtime.us-east-1.amazonaws.com")])
    provider = BedrockProvider(client=stub, model_id="anthropic.test")
    response = provider.run_turn(request("polish-down", answer={"slot": "mood", "action": "skip_all"}))

    assert response.prompts is not None
    assert "74 BPM" in response.prompts[0].prompt
    assert "quite" not in response.prompts[0].prompt
    assert any(step.detail == "Bedrock unavailable, kept the template prompts" for step in response.trace)


def test_client_config_disables_retries() -> None:
    config = client_config()
    assert config.connect_timeout == 2
    assert config.read_timeout == 8
    assert config.retries["total_max_attempts"] == 1


def test_profile_is_omitted_unless_it_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.delenv("AWS_REGION", raising=False)
    assert session_kwargs() == {}
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    assert session_kwargs() == {"region_name": "us-east-1"}
    monkeypatch.setenv("AWS_PROFILE", "vision")
    assert session_kwargs() == {"profile_name": "vision", "region_name": "us-east-1"}
