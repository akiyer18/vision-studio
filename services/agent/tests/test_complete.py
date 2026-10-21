"""A brief can always be compiled, even when a field is missing or not a number."""

import re

from contracts import TurnRequest

from agent.prompts import compile_prompts
from agent.turn import run_turn

MESSAGE = (
    "A synth pattern at 105bpm with the chord progression C, am, F, G, wavy, "
    "agony and tension, release into a positive breath at the end"
)


def test_the_synth_pattern_message_completes_and_keeps_the_journey_on_the_arc() -> None:
    response = run_turn(
        TurnRequest.model_validate(
            {
                "session_id": "synth-pattern",
                "text": MESSAGE,
                "answer": {"slot": "mood", "action": "skip_all"},
            }
        )
    )

    assert response.status == "review"
    slots = response.brief.slots
    assert slots.tempo is not None
    assert slots.tempo.value == "105"
    assert slots.tempo.source == "you"
    assert slots.structure is not None
    assert slots.structure.value == "16 bars"
    assert "breath" not in slots.structure.value
    assert slots.key is not None
    assert re.search(r"\b(major|minor)\b", slots.key.value)
    assert response.brief.output
    assert response.brief.arc is not None
    assert response.brief.arc.start == "agony and tension"
    assert response.brief.arc.end == "a positive breath"
    assert response.brief.arc.description == "Agony and tension releases into a positive breath"
    written = run_turn(
        TurnRequest.model_validate({"session_id": "synth-pattern", "write_prompts": True})
    )
    assert written.status == "ready"
    assert written.prompts
    response = written
    assert "105 BPM" in response.prompts[0].prompt
    opening = next(prompt for prompt in response.prompts if prompt.layer.endswith("_a"))
    closing = next(prompt for prompt in response.prompts if prompt.layer.endswith("_b"))
    assert "Section A" in opening.prompt
    assert "tense, brooding, urgent" in opening.prompt
    assert "Section B" in closing.prompt
    assert "calm, tender, soft" in closing.prompt
    assert any(step.step == "complete_brief" and "16 bars" in step.detail for step in response.trace)


def test_stated_bars_win_when_the_idea_also_has_an_arc() -> None:
    response = run_turn(
        TurnRequest.model_validate(
            {
                "session_id": "stated-bars",
                "text": "from dark to bright, 4 bars",
                "output": ["drums"],
                "answer": {"slot": "mood", "action": "skip_all"},
            }
        )
    )

    assert response.brief.arc is not None
    assert response.brief.arc.label == "Dark to bright"
    assert response.brief.slots.structure is not None
    assert response.brief.slots.structure.value == "4 bars"


def test_text_in_a_numeric_slot_keeps_the_default_and_says_so() -> None:
    response = run_turn(
        TurnRequest.model_validate(
            {
                "session_id": "text-numbers",
                "text": "a calm pad",
                "output": ["drums"],
                "overrides": {"tempo": "wavy", "structure": "a long journey"},
                "answer": {"slot": "mood", "action": "skip_all"},
            }
        )
    )

    assert response.status == "review"
    tempo = response.brief.slots.tempo
    structure = response.brief.slots.structure
    assert tempo is not None and tempo.value == "wavy"
    assert tempo.source == "you"
    assert structure is not None and structure.value == "a long journey"
    assert structure.source == "you"
    assert any(step.detail == "Kept your tempo: wavy BPM" for step in response.trace)
    assert any(step.detail == "Kept your bar count: a long journey" for step in response.trace)


def test_compiler_does_not_raise_when_a_field_is_missing() -> None:
    prompts = compile_prompts(
        ["drums"],
        mood="",
        energy="high",
        world="ocean",
        key="C major",
        bpm=105,
    )

    assert len(prompts) == 1
    assert "105 BPM" in prompts[0].prompt
    assert "calm, tender, soft" in prompts[0].prompt
    assert "steady groove" in prompts[0].prompt
