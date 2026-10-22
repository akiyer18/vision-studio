from contracts import LayerPrompt, SongBrief, TraceStep

from agent.explain import explain_result, explain_template


def _brief() -> SongBrief:
    return SongBrief.model_validate(
        {
            "slots": {
                "mood": {"value": "peaceful", "source": "you", "reason": "You answered", "confidence": 1},
                "sound": {"value": "pad", "source": "guessed", "reason": "A pad is the default", "confidence": 0.4},
            },
            "output": [],
            "questions_asked": 1,
            "skipped": [],
        }
    )


def _prompt() -> LayerPrompt:
    return LayerPrompt(layer="sound", prompt="TrackType: Instrument, pad", negative="vocals", seeds=[1, 2, 3], kb_sources=[])


def test_explain_fallback_uses_the_brief_and_the_prompt() -> None:
    brief = _brief()
    prompt = _prompt()
    trace = [TraceStep(step="ask", detail="sound: What kind of sound is it?")]
    explanation = explain_template(brief, [prompt], trace)

    assert explanation.source == "template"
    assert "Mood: peaceful. You answered." in explanation.how
    assert "Sound: pad. A pad is the default." in explanation.how
    assert "Choices: sound: What kind of sound is it?" in explanation.how
    assert explanation.steps == (
        "In Logic, add a sound track and shape it with Logic's instruments and plugins until it matches: TrackType: Instrument, pad",
    )


def test_level_only_changes_how_much_is_explained() -> None:
    brief = _brief()
    prompt = _prompt()
    trace = [TraceStep(step="ask", detail="sound: What kind of sound is it?")]
    full = explain_template(brief, [prompt], trace)
    same = explain_result(brief, [prompt], trace, depth="intermediate")
    short = explain_result(brief, [prompt], trace, depth="beginner")
    deep = explain_result(brief, [prompt], trace, depth="advanced")

    assert same.how == full.how
    assert same.steps == full.steps
    assert short.how == "Mood: peaceful."
    assert short.steps == ("In Logic, add a sound track.",)
    assert full.how in deep.how
    assert deep.steps[0].endswith("Then try one change and compare.")


def test_explain_falls_back_when_the_call_fails() -> None:
    def fail(brief, prompts, trace):
        raise RuntimeError("bedrock down")

    explanation = explain_result(_brief(), [_prompt()], [], fail)
    assert explanation.source == "template"
    assert explanation.how.startswith("Mood: peaceful.")
