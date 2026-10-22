# vision-studio — ADE Hack final pitch (3 minutes, 22 Oct 2026)

AI producing assistant for Ableton Live 10. A Claude producer agent builds in your Live set, Stable Audio makes every
sound, Gemini listens to the result and judges it, and you stay in the wheel: every move is auditioned alone with
keep / another take / undo. Plus a Training mode that teaches production by ear.

## Setup checklist (15 min before, in order)

1. `.env`: `STABILITY_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (+ `GEMINI_API_KEYS=key2,key3` for quota
   rotation, `GEMINI_PAID=1` or `GEMINI_TIER=paid` if a paid key is in; `HF_TOKEN` optional). Check
   `GET http://localhost:3000/api/health`: `stabilityKey` / `anthropicKey` true, `live.running` = `5.8`,
   `geminiStatus` = `ok (key 1/1, flash)` (the `gemini` object next to it lists blocked pairs and rejected keys).
   `node scripts/check-keys.mjs` calls every provider with the real keys and prints PASS/FAIL per key.
2. `cd ~/ade-hack && npm start` -> open http://localhost:3000, switch on **Projector** mode in the header (big type
   for the screen; the button reads **Projector on** while active, the P key toggles it, and it is remembered).
3. Live 10: `bash ableton/install.sh` once, then **fully quit and relaunch** Live. Preferences > Link/MIDI > Control
   Surface = **ADEHack** (In/Out: None). `node ableton/client.js version` -> `5.8`. The health badge says
   "restart Live to load script 5.8" (and the hero line "Quit and relaunch Live to load 5.8") until you do.
4. Live browser: Places must contain **ADE Hack** (`~/Music/Ableton/User Library/ADE Hack`). If missing: Places >
   Add Folder..., then restart Live once more. Slot pool: 8 files per role (`SLOT_POOL`) must be indexed.
5. `node scripts/live-check.mjs` -> must end in **GO**. It checks health + every API key live, script 5.8 (ping and
   version), `jump 1` with read-back, `set_tempo --warp-clips` at the CURRENT tempo (no tempo change; it warps unwarped
   Session clips, so Edit > Undo in Live if you did not want that, or pass `--no-warp`), describe_set (warns on soloed
   tracks), the ADE Hack Place + indexed slot files per role, a 2-bar play from bar 1 with meters (`--no-play` when the
   PA is live), and the Python toolbelt. Each line is PASS / WARN / FAIL with the fix underneath.
6. Open the teammate's real Live set (the 6-track deep house set works). Master at -6 dB, audio out to the PA.
   Have Live and the browser side by side on the projector. Reset the chat so the transcript starts empty.
7. Ears: if the health line says "lite judge", quota is gone on the flash models; swap in the second key or say it
   on stage. Never promise a listen.
8. Training mode: open http://localhost:3000/training.html in a second tab and pre-generate one beginner example
   (Stable Audio takes ~20 s) so the audience never waits on a generation.

## The sequence (what to type, what the audience sees)

### A. Work on a real project (70 s)
| # | You | Live / screen |
|---|---|---|
| 1 | Click **Work on my Live project**. | The agent reads the set (describe_set), records 8 bars from bar 1, Gemini describes what it hears. The card lists the tracks, the genre it detected, and 3 production moves. No track is touched. |
| 2 | `enhance it: make it feel like a late-night deep house record, keep my drums` | New tracks appear next to yours: **AI Enhance** (whole-mix audio-to-audio, the reference), **AI Tops**, **AI Texture**, **AI Bass**, **AI Kit**. Only AI Enhance is audible, soloed for a few bars; everything else starts muted. The reply says what is audible and ends with "keep / another take / undo". Per-layer score 0-10 (the judge's confidence) with a verdict better / weaker / even against your own stem, judge model named, labelled when a lite judge answered. |
| 3 | Click **Play** on AI Tops, then **Keep**. Click **Another** on AI Bass. | Tops are auditioned alone, then unmuted. The bass is regenerated and re-auditioned; nothing stacks. Say: "the creator decides, the agent proposes." |
| 4 | `slow it to 118` | You named the BPM, so the agent moves it without asking: it warps your unwarped audio clips first (set_tempo warp_clips, Session clips; Live 10 exposes no Arrangement clips to the API, so those keep their speed and the reply says so) and reports any it could not warp. If you instead say `turn it into deep house`, the tool refuses to move the tempo (needsConfirmation) and the agent asks in one line: "Your set is at 124; deep house usually sits at 122. Move it, or keep 124?" |

### B. From scratch (60 s)
| # | You | Live / screen |
|---|---|---|
| 5 | New empty set (Cmd+N in Live). `make me a UK garage beat at 132` | First reply opens with two sentences of genre history and 3 reference tracks (from the knowledge blueprint). Then set_tempo -> design_kit (Stable Audio candidates judged by Gemini against the blueprint) -> build_kit on one Drums track (Drum Rack pads, kick/snare/clap) -> add_loop_layer Tops seeded from the mix -> play. Playable within ~5 tool calls, under a minute. (The history comes from the blueprint's "Era & tempo" and "References" sections: `lib/knowledge.getIntro` injects it as `[genre history: ...]` on the first mention of a genre, and the agent's GENRE INTRO rule renders it as two sentences plus three references.) |
| 6 | `add a bass that interlocks with the kick` | Live's own bass preset on a Bass track, MIDI roots on offbeat 8ths, auditioned, then "keep / another / undo" chips. |
| 7 | `listen to the kick and be honest` | Judge-by-ear: it renders the kick, Gemini scores it against the blueprint line with the spread shown; low score -> regenerates once, hot-swaps the pad, says "checked the kick: tight, clicky". |

### C. Training mode (45 s)
| # | You | Screen |
|---|---|---|
| 8 | Training tab: level **Beginner**, genre **Deep House**, **Start**. | A 4-bar drum example plays (Stable Audio 3), with hints: BPM, drums only. Timer runs. |
| 9 | The musician teammate recreates it in Live for ~30 s (kick, clap, hats on a Drum Rack). Click **Check**. | The tool records their 4 bars from bar 1 and compares: score, what is close (tempo, kick on the floor), what is off (clap late, hats too busy), one hint (`score`, `closest`, `off`, `nextHint`, `drums.yours` in words, `tempo`, `attempts` / `best`, the capture to replay, a `note` when the script is older than 5.8 and recorded from the playhead, `scoreNote` when a lite judge answered). |
| 10 | Click **Reveal**. | The target's parts land in Live on muted tracks next to theirs: **Target Drums** (the example's own hits on pads + its MIDI grid), **Target Bass** from intermediate up, **Target Keys** on advanced, and **Target Mix** (the whole example as a clip), with a plain-language "how this was built". End on: "it generates, it listens, it judges, and it teaches." |

If a step fails live: say what failed, type `what is in my set right now?` and continue. Every tool call and its
result is in the transcript; failures are visible and honest.

## 5 talking points (architecture)

1. **Claude producer agent, 76 tools.** Claude Opus 5.5 runs the session as an agent: design_kit, add_loop_layer,
   enhance_project, judge_sound, refine_sound / undo_sound, audition. Every action in Live is a tool result the
   audience can read. A production playbook (groove, sound design, stereo, mix) and 25 genre blueprints with proven
   Stable Audio prompts live in its system prompt and knowledge base; unknown genres get a blueprint written on the fly.
2. **Stable Audio for every sound, used for what it is good at.** Loops and music via Stable Audio 3, one-shots from
   hit sequences (not "a single kick", which returns a sub drone), audio-to-audio seeded by the mix so layers belong
   together, per-stem audio-to-audio for enhancing a real project. No sample packs.
3. **Ears that cannot cheat.** Gemini hears the render, markers are scored text-only, silence is gated, A/B
   comparisons are order-swapped, and lite-judge answers are labelled. Key rotation keeps flash models in the demo.
4. **Live 10 remote script, no Max for Live.** ADEHack 5.8: 53 JSON-over-TCP commands (clips, Drum Rack pads,
   devices, mixer, scenes, warping, recording from bar 1, undo), every API name verified against Live's own bundled
   scripts (53 = 51 in 5.7 + set_position + jump). Non-destructive by contract: user tracks are never adopted, deleted or re-levelled.
5. **Creator in the wheel.** One audible new thing at a time, keep / another / undo per layer, ask before moving the
   set's tempo, and Training mode turns the same pipeline into a by-ear exercise with score and reveal.

## 3 honest limitations

1. **Gemini is the only ear with budget.** Flash models have daily quotas; with keys exhausted the judge degrades to
   a lite model and says so. Music Flamingo (ZeroGPU) is optional and often out of quota.
2. **Live 10's API cannot create group or return tracks, route a sidechain, or reload a changed sample under the same
   name.** Sounds rotate through 8 slot files per role; when every slot is in use the agent asks you to remove or
   replace a layer instead of silently reusing a sound.
3. **Whole-mix audio-to-audio smears at medium strength.** That is why the enhanced version is a reference and seed
   only; the real layers are built per stem on 8-16 bar windows, and compose_track still takes 5-7 minutes on this Mac.
