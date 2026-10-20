import api
import agent
from contracts import TurnResponse


def slot(value: str) -> dict[str, object]:
    return {
        "value": value,
        "source": "guessed",
        "reason": "default",
        "confidence": 0.4,
    }


def test_ready_turn_response_validates() -> None:
    response = TurnResponse.model_validate(
        {
            "status": "ready",
            "brief": {
                "slots": {
                    "output": slot("drums"),
                    "mood": slot("peaceful"),
                    "energy": slot("slow and breathing"),
                    "world": slot("warm and intimate"),
                    "key": slot("C major"),
                    "style": slot("none named"),
                    "palette": slot("piano"),
                    "structure": slot("8 bars"),
                    "must_keep": slot("nothing"),
                },
                "output": ["drums"],
                "questions_asked": 0,
                "skipped": [],
            },
            "prompts": [
                {
                    "layer": "drums",
                    "prompt": "TrackType: Instrument, soft brushed drum kit, 76 BPM",
                    "negative": "vocals",
                    "seeds": [1, 2, 3],
                    "kb_sources": ["peaceful", "warm and intimate"],
                }
            ],
            "trace": [{"step": "defaults", "detail": "filled from the peaceful preset"}],
        }
    )

    assert response.status == "ready"
    assert response.question is None
    assert response.prompts is not None
    assert response.prompts[0].seeds == (1, 2, 3)
    assert api.TurnResponse is TurnResponse
    assert agent.TurnResponse is TurnResponse
