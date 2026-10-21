import pytest
from contracts import AudioFeatures, TurnRequest

from agent.defaults import derive_bpm
from agent.prompts import compile_prompts
from agent.slots import slot_specs
from agent.theory import chords_for
from agent.turn import run_turn


def request(session_id: str, **fields: object) -> TurnRequest:
    return TurnRequest.model_validate({"session_id": session_id, **fields})


def test_slots_match_the_spec_table() -> None:
    specs = {spec.slot: spec for spec in slot_specs()}
    assert [spec.slot for spec in slot_specs()] == [
        "output",
        "mood",
        "energy",
        "world",
        "key",
        "style",
        "palette",
        "structure",
        "must_keep",
        "tempo",
        "sound",
        "genre",
        "brightness",
        "pattern",
        "production",
    ]
    assert specs["tempo"].impact == 0
    assert specs["output"].impact == 1.0
    assert specs["output"].question == "What would help most right now?"
    assert specs["output"].options == ("drums", "chords", "all layers separately", "full song")
    assert specs["style"].options == ()
    assert specs["palette"].options == ()
    assert specs["structure"].options == ("4 bars", "8 bars", "16 bars")


def test_one_word_asks_what_the_song_is_about() -> None:
    response = run_turn(request("one-word", text="Hello"))

    assert response.status == "question"
    assert response.question is not None
    assert response.question.text == "What is this song about?"
    assert response.question.options == []
    assert response.question.slot == "mood"
    assert response.question.index == 1
    assert response.question.max == 5
    assert response.brief.questions_asked == 1
    assert response.brief.slots.mood is None
    assert [step.step for step in response.trace] == ["extract", "ask"]


def test_about_answer_reruns_extraction() -> None:
    run_turn(request("about", text="Hello"))
    response = run_turn(
        request(
            "about",
            answer={"slot": "mood", "action": "answer", "value": "I miss the rain"},
        )
    )

    assert response.brief.slots.mood is not None
    assert response.brief.slots.mood.value == "longing"
    assert response.brief.slots.mood.source == "you"
    assert response.status == "question"
    assert response.question is not None
    assert response.question.slot == "output"


def test_sentence_with_mood_words() -> None:
    response = run_turn(request("sentence", text="I feel sad in the rain"))

    mood = response.brief.slots.mood
    energy = response.brief.slots.energy
    world = response.brief.slots.world
    assert mood is not None and energy is not None and world is not None
    assert mood.value == "longing"
    assert mood.source == "you"
    assert mood.confidence == 0.85
    assert energy.value == "slow and breathing"
    assert energy.source == "you"
    assert world.value == "warm and intimate"
    assert world.source == "you"
    assert response.status == "question"
    assert response.question is not None
    assert response.question.slot == "output"


def test_lyrics_raise_confidence() -> None:
    lyrics = "\n".join(
        [
            "I miss you",
            "Lonely in the rain",
            "Lost on a night drive",
        ]
    )
    response = run_turn(request("lyrics", text=lyrics))

    mood = response.brief.slots.mood
    assert mood is not None
    assert mood.value == "longing"
    assert mood.source == "you"
    assert mood.confidence == 0.95
    assert response.question is not None
    assert response.question.slot == "output"


def test_detected_audio_features_then_skip_all() -> None:
    first = run_turn(
        request(
            "audio",
            audio_features=AudioFeatures(
                input_type="instrument_loop",
                key="D",
                mode="minor",
                bpm=90,
                chords=["Dm", "Bb"],
                instruments=["piano", "cello"],
                confidence=0.9,
            ),
        )
    )

    assert first.brief.slots.key is not None
    assert first.brief.slots.key.value == "D minor"
    assert first.brief.slots.key.source == "detected"
    assert first.brief.slots.key.confidence == 0.9
    assert first.brief.slots.palette is not None
    assert first.brief.slots.palette.value == "piano, cello"
    assert first.brief.slots.palette.source == "detected"
    assert first.brief.slots.tempo is not None
    assert first.brief.slots.tempo.value == "90"
    assert first.brief.slots.tempo.source == "detected"
    assert first.question is not None
    assert first.question.slot == "output"
    assert "tempo" not in first.question.text.lower()
    assert any(step.detail == "bpm: 90.0" or step.detail == "bpm: 90" for step in first.trace)
    assert any(step.detail == "chords: Dm, Bb" for step in first.trace)

    ready = run_turn(request("audio", answer={"slot": "output", "action": "skip_all"}))

    assert ready.status == "ready"
    assert ready.question is None
    assert ready.prompts is not None
    assert [prompt.layer for prompt in ready.prompts] == ["drums", "chords", "bass", "melody", "texture"]
    assert "90 BPM" in ready.prompts[0].prompt
    assert "in D minor" in ready.prompts[1].prompt
    assert "90 BPM" in ready.prompts[1].prompt
    assert ready.brief.slots.key is not None
    assert ready.brief.slots.key.source == "detected"
    assert ready.progression is not None
    assert ready.progression.roman == ["Imaj7", "IVmaj7"]
    assert ready.progression.chords == ["Dmaj7", "Gmaj7"]


def test_full_track_values_are_detected() -> None:
    response = run_turn(
        request(
            "full-track",
            audio_features=AudioFeatures(
                input_type="full_track",
                key="A",
                mode="minor",
                bpm=100,
                confidence=0.8,
            ),
        )
    )

    assert response.brief.slots.style is None
    assert response.brief.slots.key is not None
    assert response.brief.slots.key.value == "A minor"
    assert response.brief.slots.key.source == "detected"


def test_skip_all_on_the_first_question_is_ready_with_prompts() -> None:
    first = run_turn(request("skip-all", text="Hello"))
    assert first.question is not None
    assert first.question.text == "What is this song about?"

    ready = run_turn(request("skip-all", answer={"slot": "mood", "action": "skip_all"}))

    assert ready.status == "ready"
    assert ready.question is None
    assert ready.prompts is not None
    assert [prompt.layer for prompt in ready.prompts] == ["drums", "chords", "bass", "melody", "texture"]
    assert ready.prompts[0].prompt == (
        "TrackType: Instrument, soft brushed drum kit, sparse lazy groove, "
        "calm, tender, soft, gentle dynamics, slow build, 74 BPM"
    )
    assert ready.prompts[1].prompt == (
        "TrackType: Instrument, warm felt piano chords with soft strings in C major, "
        "calm, tender, soft, gentle dynamics, slow build, 74 BPM"
    )
    assert ready.prompts[0].negative == "chords, bass, melody, texture, vocals"
    assert ready.prompts[0].kb_sources == ["peaceful", "warm and intimate"]
    assert len(ready.prompts[0].seeds) == 3
    assert ready.brief.questions_asked == 1
    assert ready.brief.slots.mood is not None
    assert ready.brief.slots.mood.reason.startswith("skipped: ")
    assert ready.brief.skipped == [
        "output",
        "mood",
        "energy",
        "world",
        "key",
        "style",
        "palette",
        "structure",
        "must_keep",
    ]
    assert {step.step for step in ready.trace} >= {"extract", "ask", "answer", "default", "tempo", "theory", "prompt"}


def test_skip_all_without_a_prior_question_is_ready() -> None:
    ready = run_turn(request("skip-now", answer={"slot": "mood", "action": "skip_all"}))

    assert ready.status == "ready"
    assert ready.prompts is not None
    assert [prompt.layer for prompt in ready.prompts] == ["drums", "chords", "bass", "melody", "texture"]


def test_full_brief_asks_nothing() -> None:
    response = run_turn(
        request(
            "full",
            text="We dance and celebrate at the summer party",
            output=["full_mix"],
            overrides={"key": "C major", "style": "a bright pop song"},
        )
    )

    assert response.status == "ready"
    assert response.question is None
    assert response.brief.questions_asked == 0
    assert response.prompts is not None
    assert response.prompts[0].prompt == (
        "TrackType: Music, bright plucks, punchy kick and synth bass, clean modern production "
        "instrumental in C major, bright, uplifting, euphoric, driving and energetic, 123 BPM"
    )
    assert response.prompts[0].negative == "vocals"
    assert response.prompts[0].kb_sources == ["joyful", "bright and danceable"]
    assert response.progression is not None
    assert response.progression.roman == ["I", "V", "vi", "IV"]
    assert response.progression.chords == ["C", "G", "Am", "F"]
    assert response.brief.slots.palette is not None
    assert response.brief.slots.palette.value == "no preference"
    assert response.brief.slots.palette.source == "guessed"
    assert response.brief.slots.structure is not None
    assert response.brief.slots.structure.value == "8 bars"
    assert response.brief.slots.must_keep is not None
    assert response.brief.slots.must_keep.value == "nothing"


def test_you_decide_and_skip_follow_the_default_rules() -> None:
    first = run_turn(request("decide", text="I feel sad in the rain"))
    assert first.question is not None
    assert first.question.slot == "output"

    decided = run_turn(request("decide", answer={"slot": "output", "action": "you_decide"}))
    output = decided.brief.slots.output
    assert output is not None
    assert output.value == "all layers separately"
    assert output.source == "guessed"
    assert output.reason == "All layers separately is the default output"
    assert "output" not in decided.brief.skipped
    assert decided.question is not None
    assert decided.question.slot == "key"

    skipped = run_turn(request("decide", answer={"slot": "key", "action": "skip"}))
    key = skipped.brief.slots.key
    assert key is not None
    assert key.value == "D minor"
    assert key.source == "guessed"
    assert key.reason.startswith("skipped: ")
    assert skipped.brief.skipped == ["key"]


@pytest.mark.parametrize(
    ("key", "romans", "chords"),
    [
        ("D minor", ["i", "VI", "III", "VII"], ["Dm", "Bb", "F", "C"]),
        ("E minor", ["i", "VI", "III", "VII"], ["Em", "C", "G", "D"]),
        ("E minor", ["i", "bII"], ["Em", "F"]),
        ("C major", ["I", "V", "vi", "IV"], ["C", "G", "Am", "F"]),
        ("C major", ["Imaj7", "IVmaj7"], ["Cmaj7", "Fmaj7"]),
        ("F# minor", ["i", "VI", "III", "VII"], ["F#m", "D", "A", "E"]),
        ("Bb major", ["I", "V", "vi", "IV"], ["Bb", "F", "Gm", "Eb"]),
    ],
)
def test_theory_transposes_the_spec_progressions(key: str, romans: list[str], chords: list[str]) -> None:
    assert chords_for(key, romans) == chords


def test_longing_tempo_uses_the_spec_reason() -> None:
    bpm, reason = derive_bpm("slow and breathing", "longing")
    assert bpm == 76
    assert reason == "76 BPM because slow tempos read as sad"
    assert derive_bpm("slow and breathing", "peaceful")[0] == 74
    assert derive_bpm("make people move", "joyful")[0] == 123
    assert derive_bpm("steady", "tense")[0] == 103


def test_prompt_compiler_is_deterministic() -> None:
    kwargs = {
        "output": ["drums", "chords"],
        "mood": "longing",
        "energy": "slow and breathing",
        "world": "warm and intimate",
        "key": "D minor",
        "bpm": 76,
    }
    first = compile_prompts(**kwargs)
    second = compile_prompts(**kwargs)
    assert first[0].prompt == (
        "TrackType: Instrument, soft brushed drum kit, sparse lazy groove, "
        "melancholic, late night, intimate, gentle dynamics, slow build, 76 BPM"
    )
    assert first[0].negative == "chords, bass, melody, texture, vocals"
    assert first[1].prompt == (
        "TrackType: Instrument, warm felt piano chords with soft strings in D minor, "
        "melancholic, late night, intimate, gentle dynamics, slow build, 76 BPM"
    )
    assert first[1].negative == "drums, bass, melody, texture, vocals"
    assert first[0].kb_sources == ["longing", "warm and intimate"]
    assert first[0].seeds == second[0].seeds
    assert len(first[0].seeds) == 3
    assert first[0].seeds != first[1].seeds
    retaken = compile_prompts(**kwargs, take=2)
    assert retaken[0].seeds != first[0].seeds
    assert compile_prompts(**kwargs, take=1)[0].seeds == first[0].seeds
