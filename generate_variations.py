#!/usr/bin/env python3
"""Generate 5 Stable Audio 3.0 (Large) audio-to-audio variations of a source beat.

Endpoint: POST /v2beta/audio/stable-audio/audio-to-audio  (async -> returns id)
Poll:     GET  /v2beta/audio/results/{id}

The source beat is transformed with a descriptive prompt and a fixed denoising
("noise") strength. Random seeds produce distinct variations.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests

BASE_URL = "https://api.stability.ai"
GENERATE_URL = f"{BASE_URL}/v2beta/audio/stable-audio/audio-to-audio"
RESULTS_URL = f"{BASE_URL}/v2beta/audio/results"

MODEL = "stable-audio-3"          # Stable Audio 3.0 Large (API-exposed model)
STRENGTH = 0.4                    # "noise" level: 0 = identical to input, 1 = fully regenerated
DURATION = 33                     # seconds, matches the ~33s source beat
OUTPUT_FORMAT = "mp3"
NUM_VARIATIONS = 5
POLL_INTERVAL = 5                 # seconds
MAX_WAIT = 900                    # 15 minutes hard cap per generation

ROOT = Path(__file__).resolve().parent
INPUT_AUDIO = ROOT / "samples" / "Lofi+hip+hop+beat,+chillhop.cfg1.54789.mp3"
OUTPUT_DIR = ROOT / "stability_output"

PROMPT = (
    "A mellow lo-fi hip-hop beat in the chillhop style. Warm vinyl crackle and "
    "tape hiss over dusty boom-bap drums, a laid-back jazzy Rhodes chord "
    "progression, a deep rounded sub-bass groove, soft swung hi-hats and a slow "
    "head-nod tempo. Relaxed, nostalgic, late-night study vibes."
)


def submit(session: requests.Session, index: int) -> str:
    """Start one async generation and return its id."""
    with INPUT_AUDIO.open("rb") as fh:
        resp = session.post(
            GENERATE_URL,
            files={"audio": (INPUT_AUDIO.name, fh, "audio/mpeg")},
            data={
                "prompt": PROMPT,
                "model": MODEL,
                "duration": str(DURATION),
                "strength": str(STRENGTH),
                "output_format": OUTPUT_FORMAT,
            },
        )
    if resp.status_code != 202:
        raise RuntimeError(f"submit #{index} failed [{resp.status_code}]: {resp.text}")
    return resp.json()["id"]


def fetch_result(session: requests.Session, gen_id: str, index: int) -> dict:
    """Poll until the generation completes; return metadata + bytes."""
    waited = 0
    while waited < MAX_WAIT:
        resp = session.get(f"{RESULTS_URL}/{gen_id}")
        if resp.status_code == 200:
            return {
                "audio": resp.content,
                "seed": resp.headers.get("seed"),
                "finish_reason": resp.headers.get("finish-reason"),
            }
        if resp.status_code == 202:
            time.sleep(POLL_INTERVAL)
            waited += POLL_INTERVAL
            print(f"  variation #{index}: in progress ({waited}s)...", flush=True)
            continue
        raise RuntimeError(
            f"result #{index} failed [{resp.status_code}]: {resp.text}"
        )
    raise TimeoutError(f"variation #{index} did not finish within {MAX_WAIT}s")


def main() -> int:
    api_key = os.environ.get("STABILITY_API_KEY")
    if not api_key:
        print("ERROR: set the STABILITY_API_KEY environment variable", file=sys.stderr)
        return 2

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update(
        {"Authorization": f"Bearer {api_key}", "Accept": "audio/*"}
    )

    print(f"Input:  {INPUT_AUDIO}")
    print(f"Prompt: {PROMPT}")
    print(f"Model:  {MODEL} | strength(noise): {STRENGTH} | duration: {DURATION}s\n")

    # 1) Submit all generations up front (each returns an id immediately).
    jobs: list[dict] = []
    for i in range(1, NUM_VARIATIONS + 1):
        try:
            gen_id = submit(session, i)
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f"variation #{i}: submit error -> {exc}", file=sys.stderr)
            continue
        jobs.append({"index": i, "id": gen_id})
        print(f"variation #{i}: submitted (id={gen_id[:12]}...)", flush=True)
        time.sleep(0.3)  # gentle spacing to stay well under the rate limit

    # 2) Poll each to completion and write the MP3.
    manifest: list[dict] = []
    for job in jobs:
        i, gen_id = job["index"], job["id"]
        try:
            result = fetch_result(session, gen_id, i)
        except Exception as exc:  # noqa: BLE001
            print(f"variation #{i}: FAILED -> {exc}", file=sys.stderr)
            continue

        out_path = OUTPUT_DIR / f"variation_{i}.mp3"
        out_path.write_bytes(result["audio"])
        size_kb = len(result["audio"]) / 1024
        print(
            f"variation #{i}: saved {out_path.name} "
            f"({size_kb:.0f} KB, seed={result['seed']}, "
            f"finish={result['finish_reason']})",
            flush=True,
        )
        manifest.append(
            {
                "variation": i,
                "file": out_path.name,
                "generation_id": gen_id,
                "seed": result["seed"],
                "finish_reason": result["finish_reason"],
                "size_bytes": len(result["audio"]),
                "model": MODEL,
                "strength": STRENGTH,
                "duration": DURATION,
                "output_format": OUTPUT_FORMAT,
                "prompt": PROMPT,
            }
        )

    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    print(f"\nDone: {len(manifest)}/{NUM_VARIATIONS} variations in {OUTPUT_DIR}")
    return 0 if len(manifest) == NUM_VARIATIONS else 1


if __name__ == "__main__":
    raise SystemExit(main())
