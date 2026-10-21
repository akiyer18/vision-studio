"""Facet branching, depth, arcs, and references."""

from contracts import TurnRequest

from agent.facets import FacetPick
from agent.turn import MockHooks, run_session, run_turn


def request(session_id: str, **fields: object) -> TurnRequest:
    return TurnRequest.model_validate({"session_id": session_id, **fields})


FILLED = {
    "mood": "tense",
    "energy": "steady",
    "world": "dark and electronic",
    "key": "E minor",
    "style": "no reference",
    "palette": "no preference",
    "structure": "8 bars",
    "must_keep": "nothing",
}


def _drums(session_id: str, **fields: object) -> TurnRequest:
    return request(session_id, output=["drums"], overrides=FILLED, text="a kick", **fields)


def _answer(response, value: str) -> dict[str, str]:
    question = response.question
    assert question is not None
    return {"slot": question.slot, "action": "answer", "value": value, "facet": question.facet}


def test_distorted_kick_asks_for_distortion() -> None:
    first = run_turn(_drums("kick"))

    assert first.question is not None
    assert first.question.facet == "kick_character"
    assert first.question.text == "What kind of kick?"
    assert "distorted industrial" in first.question.options

    second = run_turn(request("kick", answer=_answer(first, "distorted industrial")))

    assert second.question is not None
    assert second.question.facet == "kick_distortion"
    assert second.question.text == "How distorted should the kick be?"
    assert second.question.options == ["gritty saturation", "full clipping"]
    assert second.question.facet != first.question.facet


def test_a_clean_kick_skips_distortion() -> None:
    first = run_turn(_drums("clean-kick"))
    second = run_turn(request("clean-kick", answer=_answer(first, "punchy club")))

    assert second.question is not None
    assert second.question.facet == "kick_tail"


def test_a_facet_is_never_asked_twice() -> None:
    class Repeat(MockHooks):
        def choose_facet(self, session, candidates):
            return FacetPick("kick_character", "Again?", ("punchy club", "deep boomy"), "again")

    sessions: dict = {}
    first = run_session(sessions, _drums("repeat"), Repeat())
    assert first.question is not None
    assert first.question.facet == "kick_character"

    second = run_session(sessions, request("repeat", answer=_answer(first, "punchy club")), Repeat())

    assert second.question is not None
    assert second.question.facet != "kick_character"
    assert any("Did not ask kick_character again." in step.detail for step in second.trace)


def test_invalid_facet_options_use_the_facet_question() -> None:
    class BadOptions(MockHooks):
        def choose_facet(self, session, candidates):
            return FacetPick("kick_character", "Pick a colour", ("nope", "also nope"), "because")

    sessions: dict = {}
    response = run_session(sessions, _drums("bad-options"), BadOptions())

    assert response.question is not None
    assert response.question.facet == "kick_character"
    assert response.question.text == "What kind of kick?"
    assert "nope" not in response.question.options
    assert "punchy club" in response.question.options
    assert any("Rejected the kick_character options" in step.detail for step in response.trace)


def test_free_text_is_stored_as_a_descriptor() -> None:
    first = run_turn(_drums("woody"))
    second = run_turn(request("woody", answer=_answer(first, "a woody knock")))

    facets = second.brief.facets or []
    stored = next(facet for facet in facets if facet.id == "kick_character")
    assert stored.value == "a woody knock"
    assert stored.descriptor == "a woody knock"
    assert second.question is not None
    assert second.question.facet != "kick_character"


def test_go_deeper_adds_questions_and_can_be_pressed_again() -> None:
    opened = run_turn(request("deeper", text="Hello"))
    assert opened.question is not None
    ready = run_turn(request("deeper", answer={"slot": "mood", "action": "skip_all"}))
    assert ready.status == "ready"
    assert ready.prompts is not None

    response = run_turn(request("deeper", deepen=True))
    asked = ready.brief.questions_asked
    for _ in range(3):
        assert response.status == "question"
        assert response.question is not None
        assert response.question.facet
        asked += 1
        assert response.brief.questions_asked == asked
        response = run_turn(request("deeper", answer=_answer(response, response.question.options[0])))

    assert response.status == "ready"
    again = run_turn(request("deeper", deepen=True))
    assert again.status == "question"
    assert again.question is not None
    assert again.question.facet
    assert again.brief.questions_asked == response.brief.questions_asked + 1


def test_a_transition_stores_an_arc_and_two_section_prompts() -> None:
    response = run_turn(
        request(
            "arc",
            text="from dark to bright",
            output=["drums"],
            answer={"slot": "mood", "action": "skip_all"},
        )
    )

    assert response.status == "ready"
    assert response.brief.arc is not None
    assert response.brief.arc.label == "Dark to bright"
    assert response.prompts is not None
    assert [prompt.layer for prompt in response.prompts] == ["drums_a", "drums_b"]
    assert "Section A" in response.prompts[0].prompt
    assert "tight electronic kit" in response.prompts[0].prompt
    assert "Section B" in response.prompts[1].prompt
    assert "four on the floor" in response.prompts[1].prompt


def test_artist_names_never_appear_in_prompts() -> None:
    class Describing(MockHooks):
        def describe_reference(self, session):
            return "dark minimal pop, close whispered vocals, deep sub bass, like Billie Eilish"

    sessions: dict = {}
    response = run_session(
        sessions,
        request(
            "artist",
            text="a sad night like Billie Eilish",
            output=["drums"],
            answer={"slot": "mood", "action": "skip_all"},
        ),
        Describing(),
    )

    assert response.prompts is not None
    for prompt in response.prompts:
        assert "Billie" not in prompt.prompt
        assert "Eilish" not in prompt.prompt
        assert "Billie" not in prompt.negative
        assert "Eilish" not in prompt.negative
    assert "dark minimal pop" in response.prompts[0].prompt
    assert "close whispered vocals" in response.prompts[0].prompt
    assert any(step.detail == "Used musical descriptors instead of Billie Eilish" for step in response.trace)
