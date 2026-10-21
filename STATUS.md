# Status — end of day, 21 Oct 2026

AI producing assistant for Ableton Live 10 ("Claude Code for beats"). Claude Opus orchestrates 75 tools, Stable Audio
generates sound, Gemini listens, the ADEHack remote script (5.7) drives Live over TCP. Repo: akiyer18/vision-studio
(main == master after `git push origin main:master`).

## Where we are
- End to end works: text / beatbox / hum / attached audio -> sounds and clips in Live, with explanations and next moves.
- Existing-project flow: "Work on my Live project" scans the set, listens, proposes moves; `enhance_project` records the
  whole arrangement (up to 64 bars) -> Gemini describes -> Claude writes the Stable Audio prompt -> Stable Audio 3
  audio-to-audio -> warped clip "AI Enhance" + kit (groove from the result, clean generated sounds) + transcribed bass.
- Sound quality overhaul (measured, not guessed):
  - one-shots were cut to 0.2 s by a clamp bug; everything was dual-mono; Stable Audio asked for "a single kick" returns
    a sub drone. Now: hit SEQUENCES (3 phrasings, 2 parallel generations, pre-roll onset detection, role scoring,
    natural tails, -3 dBFS, free B/C alternates); local sub/808/snap synth; Haas widener by default on hats/perc/claps;
    Simpler velocity response set after loads; loop-first layers as warped audio clips (`add_loop_layer`), seeded from
    the mix (audio-to-audio) once anything exists.
  - judging is evidence-first (Gemini hears -> markers scored text-only; silence gate; order-swapped A/B; lite-judge
    labels) so it can no longer echo the target.
- Five audits (~120 findings) applied: non-destructive Live operations (recording appends, loads never retarget, user
  tracks never adopted/deleted, faders untouched), runner never leaves dangling tool calls, cached prompt, UI recovery
  and stacking-safe presentation (`audition` tool: solo, play, restore).
- Offline regression suite: `node tests/smoke.mjs` (106 checks, green).

## Known problems / tomorrow
1. Audio-to-audio over a WHOLE mix smears at medium strength (Gemini: audio 4/10). Treat the enhanced version as a
   reference + seed; build real layers from it (tops/texture via add_loop_layer seeded at 0.8, bass on a Live preset).
   Consider per-stem audio-to-audio and shorter windows (8-16 bars).
2. Never stack: verify in the UI that AI Kit / AI Bass start muted and AI Enhance is auditioned soloed.
3. Tempo intent: ask before moving a set's tempo; warp the user's audio clips (`set_clip_warp`) when moving it.
4. Capture starts at the playhead: add a `set_position`/jump command to ADEHack so enhance records from bar 1.
5. Gemini flash models hit daily quota -> lite model judges (labelled). Consider a second key or paid tier.
6. Slot pool: 6-8 indexed slot files per role is a hard cap per set (Live caches by filename); exhaustion now errors.
7. Run a real A/B listening session with a producer; measure "generic" vs "genre-true" with the rubric + A/B.
8. UI: layer cards exist; add Play/Keep/Another/Undo per layer in the project card; show `scoreNote` (lite judge).

## How to run
`cp .env.example .env` (keys), `npm start` -> http://localhost:3000, Live with the ADEHack control surface selected
(`bash ableton/install.sh` installs 5.7; relaunch Live). Python toolbelt: `bash tools/py/setup.sh`.
