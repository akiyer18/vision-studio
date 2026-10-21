"""Deterministic Stable Audio prompts, one per selected layer."""

from __future__ import annotations

import hashlib

from contracts import LayerPrompt

LAYER_ORDER = ("drums", "chords", "bass", "melody", "texture")
TONAL = {"chords", "bass", "melody"}
MOOD_WORDS = {
    "longing": "melancholic, late night, intimate",
    "joyful": "bright, uplifting, euphoric",
    "peaceful": "calm, tender, soft",
    "tense": "tense, brooding, urgent",
}
ENERGY_WORDS = {
    "slow and breathing": "gentle dynamics, slow build",
    "steady": "steady groove",
    "make people move": "driving and energetic",
}
DESCRIPTORS = {
    "warm and intimate": {
        "drums": "soft brushed drum kit, sparse lazy groove",
        "chords": "warm felt piano chords with soft strings",
        "bass": "deep round sub bass",
        "melody": "gentle muted guitar lead",
        "texture": "vinyl crackle and soft room ambience",
        "full_mix": "felt piano, brushed drums and deep sub bass, warm tape production",
    },
    "wide and cinematic": {
        "drums": "big roomy toms and soft cymbal swells",
        "chords": "wide string pads and grand piano chords",
        "bass": "low cello and sub bass",
        "melody": "airy synth lead",
        "texture": "long reverb swells and risers",
        "full_mix": "wide strings, grand piano and big reverb",
    },
    "dark and electronic": {
        "drums": "tight electronic kit, deep kick, crisp hats",
        "chords": "dark analog synth pad chords",
        "bass": "distorted sub bass",
        "melody": "detuned saw lead",
        "texture": "metallic hits and cold noise sweeps",
        "full_mix": "dark synths, deep kick, distorted sub and cold reverb",
    },
    "bright and danceable": {
        "drums": "four on the floor kick, open hats, claps",
        "chords": "bright plucked synth chords",
        "bass": "punchy synth bass",
        "melody": "catchy vocal chop style synth lead",
        "texture": "white noise risers and sparkles",
        "full_mix": "bright plucks, punchy kick and synth bass, clean modern production",
    },
}
# The anchor is the layer's main instrument. It already appears in that descriptor.
ANCHORS = {
    "warm and intimate": {
        "drums": "drum kit",
        "chords": "piano",
        "bass": "sub bass",
        "melody": "guitar lead",
        "texture": "vinyl crackle",
        "full_mix": "piano",
    },
    "wide and cinematic": {
        "drums": "toms",
        "chords": "string pads",
        "bass": "cello",
        "melody": "synth lead",
        "texture": "reverb swells",
        "full_mix": "strings",
    },
    "dark and electronic": {
        "drums": "kick",
        "chords": "synth pad chords",
        "bass": "sub bass",
        "melody": "saw lead",
        "texture": "metallic hits",
        "full_mix": "kick",
    },
    "bright and danceable": {
        "drums": "four on the floor",
        "chords": "plucked synth chords",
        "bass": "synth bass",
        "melody": "synth lead",
        "texture": "risers",
        "full_mix": "synth bass",
    },
}


def compile_prompts(
    output: list[str],
    *,
    mood: str,
    energy: str,
    world: str,
    key: str,
    bpm: int,
    take: int = 1,
) -> list[LayerPrompt]:
    mood_words = MOOD_WORDS[mood]
    energy_words = ENERGY_WORDS[energy]
    sources = [mood, world]
    prompts: list[LayerPrompt] = []
    for layer in selected_layers(output):
        descriptor = DESCRIPTORS[world][layer]
        if layer == "full_mix":
            prompt = (
                f"TrackType: Music, {descriptor} instrumental in {key}, "
                f"{mood_words}, {energy_words}, {bpm} BPM"
            )
            negative = "vocals"
        else:
            body = f"{descriptor} in {key}" if layer in TONAL else descriptor
            prompt = f"TrackType: Instrument, {body}, {mood_words}, {energy_words}, {bpm} BPM"
            negative = _negative(layer)
        prompts.append(
            LayerPrompt(
                layer=layer,
                prompt=prompt,
                negative=negative,
                seeds=seeds_for(layer, mood, world, key, bpm, take),
                kb_sources=sources,
            )
        )
    return prompts


def anchor_for(world: str, layer: str) -> str:
    return ANCHORS[world][layer]


def selected_layers(output: list[str]) -> list[str]:
    layers: list[str] = []
    if "all_layers" in output:
        layers.extend(LAYER_ORDER)
    for name in LAYER_ORDER:
        if name in output and name not in layers:
            layers.append(name)
    if "full_mix" in output:
        layers.append("full_mix")
    return layers


def _negative(layer: str) -> str:
    others = [name for name in LAYER_ORDER if name != layer]
    return ", ".join([*others, "vocals"])


def seeds_for(layer: str, mood: str, world: str, key: str, bpm: int, take: int = 1) -> tuple[float, float, float]:
    """Hash of the layer and brief, plus the take. Take 1 stays reproducible."""
    digest = hashlib.sha256(f"{layer}|{mood}|{world}|{key}|{bpm}|{take}".encode()).digest()
    return tuple(float(int.from_bytes(digest[index * 4 : index * 4 + 4], "big") % 1_000_000) for index in range(3))
