"""Deterministic Stable Audio prompts, one per selected layer."""

from __future__ import annotations

import hashlib

from contracts import LayerPrompt

from agent.arc import Motion

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


def mood_words(mood: str) -> str:
    return MOOD_WORDS.get(mood) or MOOD_WORDS["peaceful"]


def energy_words(energy: str) -> str:
    return ENERGY_WORDS.get(energy) or ENERGY_WORDS["steady"]


def world_descriptor(world: str, base: str) -> str:
    table = DESCRIPTORS.get(world) or DESCRIPTORS["warm and intimate"]
    found = table.get(base)
    if found:
        return found
    fallback = DESCRIPTORS["warm and intimate"]
    return fallback.get(base) or fallback["texture"]
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


BRIGHTNESS_WORDS = {
    "dark": "dark, few highs",
    "balanced": "balanced highs",
    "bright": "bright, airy highs",
}
_SFX = {"snare", "riser"}


def track_type(sound: str) -> str:
    words = set(sound.lower().replace("-", " ").split())
    if words & _SFX:
        return "SFX"
    return "Instrument"


def compile_one_sound(
    *,
    sound: str,
    genre: str,
    brightness: str,
    mood: str,
    energy: str,
    key: str,
    bpm: int,
    take: int = 1,
    facets: str = "",
    arrangement: str = "",
    arc: Motion | None = None,
) -> list[LayerPrompt]:
    if arc is not None:
        return [
            _one_section("a", arc.start_mood, arc.start_energy, sound, genre, brightness, key, bpm, take, facets, arrangement),
            _one_section("b", arc.end_mood, arc.end_energy, sound, genre, brightness, key, bpm, take, facets, arrangement),
        ]
    return [
        _one_layer("sound", sound, genre, brightness, mood, energy, key, bpm, take, facets, arrangement),
    ]


def _one_section(
    letter: str,
    mood: str,
    energy: str,
    sound: str,
    genre: str,
    brightness: str,
    key: str,
    bpm: int,
    take: int,
    facets: str,
    arrangement: str,
) -> LayerPrompt:
    return _one_layer(
        f"sound_{letter}",
        sound,
        genre,
        brightness,
        mood,
        energy,
        key,
        bpm,
        take,
        facets,
        arrangement,
        letter.upper(),
    )


def _one_layer(
    layer: str,
    sound: str,
    genre: str,
    brightness: str,
    mood: str,
    energy: str,
    key: str,
    bpm: int,
    take: int,
    facets: str,
    arrangement: str,
    section: str = "",
) -> LayerPrompt:
    kind = track_type(sound)
    body = f"{sound} in {key}" if kind == "Instrument" else sound
    body = _with_facets(body, facets)
    bright = BRIGHTNESS_WORDS.get(brightness, brightness)
    section_bit = f", Section {section}" if section else ""
    prompt = (
        f"TrackType: {kind}, {body}{section_bit}, {genre}, {bright}, "
        f"{mood_words(mood)}, {energy_words(energy)}, {bpm} BPM"
    )
    return LayerPrompt(
        layer=layer,
        prompt=_arrange(prompt, arrangement, bpm),
        negative="vocals",
        seeds=seeds_for(layer, mood, genre, key, bpm, take),
        kb_sources=[mood, genre],
    )


def compile_prompts(
    output: list[str],
    *,
    mood: str,
    energy: str,
    world: str,
    key: str,
    bpm: int,
    take: int = 1,
    facets: dict[str, str] | None = None,
    arrangement: str = "",
    arc: Motion | None = None,
) -> list[LayerPrompt]:
    if arc is not None:
        prompts: list[LayerPrompt] = []
        for layer in selected_layers(output):
            prompts.append(
                _layer_prompt(
                    f"{layer}_a",
                    layer,
                    mood=arc.start_mood,
                    energy=arc.start_energy,
                    world=arc.start_world,
                    key=key,
                    bpm=bpm,
                    take=take,
                    facets=(facets or {}).get(layer, ""),
                    arrangement=arrangement,
                    section="A",
                )
            )
            prompts.append(
                _layer_prompt(
                    f"{layer}_b",
                    layer,
                    mood=arc.end_mood,
                    energy=arc.end_energy,
                    world=arc.end_world,
                    key=key,
                    bpm=bpm,
                    take=take,
                    facets=(facets or {}).get(layer, ""),
                    arrangement=arrangement,
                    section="B",
                )
            )
        return prompts
    return [
        _layer_prompt(
            layer,
            layer,
            mood=mood,
            energy=energy,
            world=world,
            key=key,
            bpm=bpm,
            take=take,
            facets=(facets or {}).get(layer, ""),
            arrangement=arrangement,
            section="",
        )
        for layer in selected_layers(output)
    ]


def _layer_prompt(
    name: str,
    base: str,
    *,
    mood: str,
    energy: str,
    world: str,
    key: str,
    bpm: int,
    take: int,
    facets: str,
    arrangement: str,
    section: str,
) -> LayerPrompt:
    mood_line = mood_words(mood)
    energy_line = energy_words(energy)
    descriptor = world_descriptor(world, base)
    section_bit = f", Section {section}" if section else ""
    if base == "full_mix":
        body = f"{descriptor} instrumental in {key}"
        prompt = f"TrackType: Music, {_with_facets(body, facets)}{section_bit}, {mood_line}, {energy_line}, {bpm} BPM"
        negative = "vocals"
    else:
        body = f"{descriptor} in {key}" if base in TONAL else descriptor
        prompt = f"TrackType: Instrument, {_with_facets(body, facets)}{section_bit}, {mood_line}, {energy_line}, {bpm} BPM"
        negative = _negative(base)
    return LayerPrompt(
        layer=name,
        prompt=_arrange(prompt, arrangement, bpm),
        negative=negative,
        seeds=seeds_for(name, mood, world, key, bpm, take),
        kb_sources=[mood, world],
    )


def anchor_for(world: str, layer: str) -> str:
    return ANCHORS[world][base_layer(layer)]


def base_layer(layer: str) -> str:
    if len(layer) > 2 and layer[-2] == "_" and layer[-1] in {"a", "b"}:
        return layer[:-2]
    return layer


def _with_facets(body: str, facets: str) -> str:
    if not facets:
        return body
    return f"{body}, {facets}"


def _arrange(prompt: str, arrangement: str, bpm: int) -> str:
    if not arrangement:
        return prompt
    suffix = f"{bpm} BPM"
    if prompt.endswith(suffix):
        return f"{prompt[: -len(suffix)]}{arrangement}, {suffix}"
    return f"{prompt}, {arrangement}"


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
