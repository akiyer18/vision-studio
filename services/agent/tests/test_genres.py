from contracts import TurnRequest

from agent.genres import load_genres, present_history, reference_values
from agent.turn import run_turn

_IDS = (
    "lofi-hip-hop",
    "house",
    "techno",
    "drum-and-bass",
    "ambient",
    "trap",
    "synthwave",
    "neo-soul",
)


def test_genre_files_load_in_order_with_traits() -> None:
    genres = load_genres()
    assert [genre.id for genre in genres] == list(_IDS)
    for genre in genres:
        assert genre.history.startswith("DRAFT")
        assert genre.bpm > 0
        assert genre.tempo_range
        assert genre.keys
        assert genre.instruments
        assert genre.drum_pattern
        assert genre.production
        assert genre.references


def test_history_fallback_is_the_file_text() -> None:
    genre = load_genres()[0]

    def fail(history: str) -> dict:
        raise RuntimeError("bedrock down")

    assert present_history(genre) == genre.history
    assert present_history(genre, fail) == genre.history


def test_use_in_create_prefills_reference_slots() -> None:
    genre = next(item for item in load_genres() if item.id == "lofi-hip-hop")
    prefill = reference_values(genre)
    assert prefill == {
        "genre": "Lofi hip hop",
        "tempo": "80",
        "key": "D minor",
        "palette": "dusty drums, electric piano, soft bass",
        "pattern": "sparse swung kick with soft hats",
        "production": "vinyl crackle, tape warmth, gentle sidechain",
    }

    response = run_turn(TurnRequest.model_validate({"session_id": "genre-create", "text": "a calm morning", "reference": prefill}))

    slots = response.brief.slots
    assert slots.genre is not None and slots.genre.source == "reference"
    assert slots.tempo is not None and slots.tempo.value == "80" and slots.tempo.source == "reference"
    assert slots.key is not None and slots.key.value == "D minor" and slots.key.source == "reference"
    assert slots.palette is not None and slots.palette.source == "reference"
    assert slots.pattern is not None and slots.pattern.source == "reference"
    assert slots.production is not None and slots.production.source == "reference"
    if response.question is not None:
        assert response.question.slot not in {"genre", "tempo", "key", "palette", "pattern", "production"}
