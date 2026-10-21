"""Keep a polished prompt only when it still says the same musical thing."""

from __future__ import annotations

import re

from agent.vocab import novel_phrase, phrase_in


def rejection_reason(template: str, polished: str, *, anchor: str, brief: str, key: str) -> str | None:
    """None means the polished wording may replace the template."""
    tag = "TrackType: Music" if "TrackType: Music" in template else "TrackType: Instrument"
    if tag not in polished:
        return "it dropped the track type"
    bpm = re.search(r"\d+ BPM", template)
    if bpm is not None and bpm.group(0) not in polished:
        return "it dropped the BPM"
    if key and phrase_in(template, key) and not phrase_in(polished, key):
        return "it dropped the key"
    if not phrase_in(polished, anchor):
        return "it dropped the main instrument"
    added = novel_phrase(polished, template, brief)
    if added is not None:
        return f"it added {added}"
    if len(polished) < 0.6 * len(template):
        return "it is shorter than 0.6 times the template"
    if len(polished) > 1.5 * len(template):
        return "it is longer than 1.5 times the template"
    return None
