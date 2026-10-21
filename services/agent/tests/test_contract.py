"""The user's words are facts. Questions fill gaps. Build now can happen at any moment."""

from contracts import AudioFeatures, TurnRequest

from agent.bedrock import BedrockProvider
from agent.facts import INTRO, classify_intent, extract_facts
from agent.prompt_check import problems
from agent.prompts import compile_prompts
from agent.turn import MockHooks, run_session, run_turn


def request(session_id: str, **fields: object) -> TurnRequest:
    return TurnRequest.model_validate({"session_id": session_id, **fields})


def test_patterns_lock_tempo_key_progression_bars_instruments_and_meter() -> None:
    text = "105bpm in F minor, piano, 8 bars, 4/4, C, Am, F, G"
    found = extract_facts(text)
    assert found["tempo"].value == "105"
    assert found["key"].value == "F minor"
    assert found["structure"].value == "8 bars"
    assert found["meter"].value == "4/4"
    assert found["palette"].value == "piano"
    assert found["progression"].value == "C, Am, F, G"
    for value in found.values():
        assert value.source == "you"

    first = run_turn(request("facts", text=text, output=["chords"]))
    slots = first.brief.slots
    assert slots.tempo is not None and slots.tempo.value == "105"
    assert slots.key is not None and slots.key.value == "F minor"
    assert slots.progression is not None and slots.progression.value == "C, Am, F, G"
    assert any(step.detail == "Kept your tempo: 105 BPM" for step in first.trace)
    assert any(step.detail == "Kept your key: F minor" for step in first.trace)
    assert any(step.detail == "Kept your progression: C, Am, F, G" for step in first.trace)
    assert any(step.detail == "Kept your bar count: 8 bars" for step in first.trace)
    assert any(step.detail == "Kept your instruments: piano" for step in first.trace)
    assert any(step.detail == "Kept your time signature: 4/4" for step in first.trace)

    blocked = run_turn(request("facts", overrides={"tempo": "80", "key": "C major", "progression": "G, D"}))
    assert blocked.brief.slots.tempo is not None and blocked.brief.slots.tempo.value == "105"
    assert blocked.brief.slots.key is not None and blocked.brief.slots.key.value == "F minor"
    assert blocked.brief.slots.progression is not None and blocked.brief.slots.progression.value == "C, Am, F, G"

    edited = run_turn(request("facts", review=True, overrides={"tempo": "90"}))
    assert edited.brief.slots.tempo is not None
    assert edited.brief.slots.tempo.value == "90"
    assert edited.brief.slots.tempo.source == "you"


def test_claude_cannot_replace_a_locked_fact() -> None:
    class Stub:
        def converse(self, **kwargs):
            return {
                "output": {
                    "message": {
                        "content": [
                            {
                                "toolUse": {
                                    "name": "record_slots",
                                    "toolUseId": "1",
                                    "input": {
                                        "slots": {
                                            "tempo": {
                                                "value": "80",
                                                "confidence": 0.9,
                                                "reason": "A guess",
                                                "evidence": "text",
                                            }
                                        }
                                    },
                                }
                            }
                        ]
                    }
                }
            }

    provider = BedrockProvider(client=Stub(), model_id="anthropic.test")
    response = provider.run_turn(request("claude-lock", text="105bpm"))
    tempo = response.brief.slots.tempo
    assert tempo is not None and tempo.value == "105" and tempo.source == "you"


def test_the_first_message_states_the_contract_and_each_question_says_why() -> None:
    response = run_turn(request("intro", text="Hello"))
    assert response.intro == INTRO
    assert response.question is not None
    assert response.question.why
    assert response.question.max == 10


def test_build_now_reviews_before_any_question() -> None:
    response = run_turn(request("build-now", text="a calm pad", build_now=True))
    assert response.status == "review"
    assert response.prompts is None
    assert response.brief.slots.mood is not None


def test_coverage_ends_the_interview_and_ten_is_the_hard_maximum() -> None:
    response = run_turn(request("cap", text="Hello"))
    asked = 0
    while response.status == "question" and asked < 12:
        question = response.question
        assert question is not None
        asked += 1
        response = run_turn(
            request(
                "cap",
                answer={
                    "slot": question.slot or "mood",
                    "action": "skip",
                    "facet": question.facet,
                },
            )
        )
    assert response.status == "review"
    assert response.brief.questions_asked <= 10
    finished = run_turn(request("covered", text="Hello", answer={"slot": "mood", "action": "skip_all"}))
    assert finished.status == "review"
    assert finished.brief.coverage == 1


def test_audio_intent_is_classified_or_asked_once() -> None:
    features = AudioFeatures(input_type="instrument_loop", key="C", mode="major", bpm=100, confidence=0.8, path="/tmp/take.wav")
    heard = run_turn(request("extend", text="continue this", audio_features=features))
    assert classify_intent("continue this") == "extend"
    assert heard.brief.audio_intent == "extend"
    assert heard.question is None or heard.question.slot != "intent"

    asked = run_turn(request("unclear", audio_features=features))
    assert asked.question is not None
    assert asked.question.slot == "intent"
    assert asked.question.text == "Should I reshape your recording, continue it, or build new layers around it?"
    again = run_turn(request("unclear"))
    assert again.status == "question"
    assert again.question is not None and again.question.slot == "intent"

    chosen = run_turn(request("unclear", answer={"slot": "intent", "action": "answer", "value": "Reshape it"}))
    assert chosen.brief.audio_intent == "transform"
    assert chosen.brief.noise == 0.5


def test_skip_all_reviews_and_write_prompts_uses_the_stated_progression() -> None:
    reviewed = run_turn(
        request(
            "chords",
            text="105bpm in F minor, C, Am, F, G",
            output=["chords"],
            answer={"slot": "mood", "action": "skip_all"},
        )
    )
    assert reviewed.status == "review"
    assert reviewed.prompts is None
    ready = run_turn(request("chords", write_prompts=True))
    assert ready.status == "ready"
    assert ready.progression is not None
    assert ready.progression.chords == ["C", "Am", "F", "G"]
    assert ready.progression.roman == []
    assert ready.prompts is not None
    assert "C, Am, F, G" in ready.prompts[0].prompt
    assert "105 BPM" in ready.prompts[0].prompt
    assert "F minor" in ready.prompts[0].prompt
    assert "piano" in ready.prompts[0].prompt.lower()


def test_a_prompt_that_fails_twice_keeps_the_template() -> None:
    class Bad(MockHooks):
        def polish(self, session, prompts):
            return [prompt.model_copy(update={"prompt": "joyful trumpet solo"}) for prompt in prompts]

    sessions: dict = {}
    run_session(
        sessions,
        request("bad", text="105bpm", output=["drums"], answer={"slot": "mood", "action": "skip_all"}),
        Bad(),
    )
    ready = run_session(sessions, request("bad", write_prompts=True), Bad())
    assert ready.prompts is not None
    assert "105 BPM" in ready.prompts[0].prompt
    assert "trumpet" not in ready.prompts[0].prompt
    assert any(step.detail.startswith("Kept the template:") for step in ready.trace)


def test_prompt_check_rejects_a_contradiction_and_an_artist() -> None:
    prompts = compile_prompts(
        ["drums"],
        mood="peaceful",
        energy="low",
        world="warm and intimate",
        key="C major",
        bpm=74,
        arrangement="",
    )
    slots = {"mood": type("Slot", (), {"value": "peaceful", "source": "you"})()}
    found = problems(prompts, slots, ["Billie Eilish"])
    assert found == []
    broken = prompts[0].model_copy(update={"prompt": prompts[0].prompt + " like Billie Eilish, aggressive"})
    found = problems([broken], slots, ["Billie Eilish"])
    assert found
