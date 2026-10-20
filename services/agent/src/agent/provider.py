"""Song agent provider. MockProvider now, BedrockProvider later."""

from __future__ import annotations

from typing import Protocol

from contracts import TurnRequest, TurnResponse


class Provider(Protocol):
    def run_turn(self, request: TurnRequest) -> TurnResponse: ...
