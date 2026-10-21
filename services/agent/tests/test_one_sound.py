from contracts import TurnRequest

from agent.prompts import track_type
from agent.turn import run_turn


def request(session_id: str, **fields: object) -> TurnRequest:
    return TurnRequest.model_validate({"session_id": session_id, **fields})


def test_one_sound_skip_all_returns_one_layer() -> None:
    first = run_turn(request("one-sound", text="a calm morning", mode="one_sound"))

    assert first.status == "question"
    assert first.question is not None
    assert first.question.slot == "sound"
    assert first.question.text == "What kind of sound is it?"
    assert first.question.options == ["snare", "808", "pad", "riser"]
    assert first.question.max == 5

    ready = run_turn(request("one-sound", mode="one_sound", answer={"slot": "sound", "action": "skip_all"}))

    assert ready.status == "ready"
    assert ready.prompts is not None
    assert len(ready.prompts) == 1
    prompt = ready.prompts[0]
    assert prompt.layer == "sound"
    assert prompt.prompt.startswith("TrackType: Instrument, pad")
    assert "no genre" in prompt.prompt
    assert len(prompt.seeds) == 3
    assert ready.brief.slots.sound is not None
    assert ready.brief.slots.sound.value == "pad"
    assert ready.brief.slots.genre is not None
    assert ready.brief.slots.genre.value == "no genre"
    assert ready.brief.slots.brightness is not None
    assert ready.brief.slots.brightness.value == "balanced"


def test_one_sound_snare_is_sfx_after_skip_all() -> None:
    run_turn(request("snare", text="a calm morning", mode="one_sound"))
    run_turn(request("snare", mode="one_sound", answer={"slot": "sound", "action": "answer", "value": "snare"}))
    ready = run_turn(request("snare", mode="one_sound", answer={"slot": "genre", "action": "skip_all"}))

    assert ready.prompts is not None
    assert ready.prompts[0].prompt.startswith("TrackType: SFX, snare")
    assert track_type("warm pad") == "Instrument"
    assert track_type("riser") == "SFX"
