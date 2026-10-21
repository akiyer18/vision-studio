"""One live Bedrock turn. Skipped unless RUN_BEDROCK=1."""

import os

import pytest
from contracts import TurnRequest

from agent.bedrock import BedrockProvider


@pytest.mark.bedrock
def test_bedrock_reads_a_short_idea() -> None:
    if os.environ.get("RUN_BEDROCK") != "1":
        pytest.skip("set RUN_BEDROCK=1 to call Bedrock")
    provider = BedrockProvider()
    response = provider.run_turn(
        TurnRequest.model_validate({"session_id": "bedrock-live", "text": "I miss the rain", "output": ["drums"]})
    )
    assert any("Claude read your idea" in step.detail for step in response.trace)
    mood = response.brief.slots.mood
    assert mood is not None
    assert mood.source == "you"
    assert mood.value in {"joyful", "peaceful", "longing", "tense"}
