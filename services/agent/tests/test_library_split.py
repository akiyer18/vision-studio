"""Create facets and Train exercises stay in separate folders, loaders, and caches."""

from contracts import TurnRequest

from agent.exercises import exercise_phrases, exercises_dir, load_exercises
from agent.facets import catalog, facets_dir, load_facets
from agent.turn import run_turn

import pytest


def test_create_loader_refuses_the_exercise_folder() -> None:
    with pytest.raises(ValueError, match="kb/facets"):
        load_facets(exercises_dir())


def test_train_loader_refuses_the_facet_folder() -> None:
    with pytest.raises(ValueError, match="kb/exercises"):
        load_exercises(facets_dir())


def test_caches_stay_separate() -> None:
    from agent import exercises, facets

    first_catalog = facets.catalog()
    first_exercises = exercises.load_exercises()
    load_facets(facets_dir())
    load_exercises(exercises_dir())
    assert facets.catalog() is first_catalog
    assert exercises.load_exercises() is first_exercises
    assert {item.id for item in first_catalog}.isdisjoint(first_exercises)


def test_create_facets_only_contain_kb_facet_values() -> None:
    files = {path.name: path.read_text(encoding="utf-8") for path in facets_dir().glob("*.yaml")}
    library = "\n".join(files.values())
    phrases = {phrase.lower() for phrase in exercise_phrases()}
    assert files
    assert load_exercises()
    for facet in catalog():
        assert facet.question in library
        for value in facet.values:
            assert value.label in library
            assert value.descriptor in library
            blob = f"{facet.question} {value.label} {value.descriptor}".lower()
            assert all(phrase not in blob for phrase in phrases)


def test_train_only_loads_kb_exercises() -> None:
    loaded = load_exercises()
    names = {path.stem for path in exercises_dir().glob("*.yaml")}
    assert set(loaded) == names
    for exercise in loaded.values():
        source = (exercises_dir() / f"{exercise.id}.yaml").read_text(encoding="utf-8")
        assert exercise.prompt in source
        assert exercise.objective in source
        assert "groups:" not in source


def test_the_drum_exercise_never_becomes_a_kick_facet() -> None:
    prompt = load_exercises()["rhythm-drums-beginner"].prompt
    assert prompt.startswith("Create a 4-bar drum loop at 100 BPM")
    first = run_turn(
        TurnRequest.model_validate(
            {
                "session_id": "kick-leak",
                "output": ["drums"],
                "text": "a kick",
                "overrides": {
                    "mood": "tense",
                    "energy": "steady",
                    "world": "dark and electronic",
                    "key": "E minor",
                    "style": "no reference",
                    "palette": "no preference",
                    "structure": "8 bars",
                    "must_keep": "nothing",
                },
            }
        )
    )
    assert first.question is not None
    assert first.question.facet == "kick_character"
    leaked = run_turn(
        TurnRequest.model_validate(
            {
                "session_id": "kick-leak",
                "answer": {"slot": first.question.slot, "action": "answer", "value": prompt, "facet": "kick_character"},
            }
        )
    )
    stored = leaked.brief.facets or []
    blob = " ".join(f"{facet.label}: {facet.value} {facet.descriptor}" for facet in stored)
    assert "Create a 4-bar drum loop" not in blob
    assert "Kick: Create a 4-bar" not in blob
    assert any("Train exercise" in step.detail for step in leaked.trace)
    ready = run_turn(TurnRequest.model_validate({"session_id": "kick-leak", "answer": {"slot": "mood", "action": "skip_all"}}))
    written = run_turn(TurnRequest.model_validate({"session_id": "kick-leak", "write_prompts": True}))
    assert ready.status == "review"
    assert written.prompts is not None
    for item in written.prompts:
        assert "4-bar drum loop" not in item.prompt
        assert "Create a 4-bar" not in item.prompt
