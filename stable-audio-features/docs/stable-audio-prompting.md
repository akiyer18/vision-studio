# Stable Audio prompting (condensed from docs.stability.ai/stable-audio, read 2026-10-21)

## Structure (in this order)
1. Genre / style reference (era, location, recording style, usage context: "club", "film scene")
2. Main instruments and rhythmic elements, and how they should sound
3. Mood, energy, arrangement ("builds to a drop", "sparse then dense")
4. Production character (recording, room, mic perspective, processing)
5. Performance / texture details last, only when they matter
Always give the BPM when rhythm matters. Describe sounds, never give instructions ("make it...").

## Tags (optional, put first)
- `TrackType: Music` full track · `TrackType: Instrument` isolated stem / layer / loop · `TrackType: SFX` hits, risers, foley, transitions
- `Format: Duo` two instruments · `Genre: <name>`

## Recipes we use
- One-shot drum (SFX form = source + action/decay + production):
  `TrackType: SFX, a classic natural recording of 14-inch hi-hats played tightly closed, zero ring, very fast decay, close-miked, dry`
  `TrackType: SFX, deep electronic kick drum, single hit, hard click transient, 600 ms sub tail, saturated, dry`
- Drum loop as a stem (coherent kit source):
  `TrackType: Instrument, Genre: Deep House, drum loop at 124 BPM, warm round kick, soft claps on 2 and 4, shuffled closed hats, tight and dry, no melody`
- Texture / pad layer: `TrackType: Instrument, evolving analog pad, slow filter movement, wide, 124 BPM, no drums`
- Full-mix restyle (audio-to-audio on our render): `TrackType: Music, Genre: ..., <mood>, <production character>, 124 BPM`
- Vocals: the model is instrumental-first; it can produce non-lexical vocal textures, not lyrics.

## Audio-to-audio (our `strength` = the guide's init noise level)
- 0.3 barely changes the input · 0.5 keeps rhythm/melody, changes timbre (beatbox -> lo-fi hip hop) · 0.8-0.9 full timbre/style transfer
- Our mapping: hum/beatbox -> drum one-shot: 0.6-0.75 · reference imitation ("like this"): 0.5-0.6 · restyle our render: 0.4-0.6

## Models
- `stable-audio-2.5`: sync, fast (4-8 s), 8 credits, 1-190 s
- `stable-audio-3`: async (poll), 8 credits, 1-380 s, variable length; use for loops, textures, restyles where quality > speed
- `steps` 4-8 (default 8), `cfg_scale` 1-25 (default 1), `seed` 0 = random. Outputs vary per run: iterate.
