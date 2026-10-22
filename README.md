# ADE Hack · Vision Studio — AI Producing Assistant for Ableton Live

**"Claude Code for beats."** A producer agent (Claude Opus 5.5 with 76 tools) sits next to you with Ableton Live 10
open. It builds your beat layer by layer, synthesizes every sound with Stable Audio, listens to its own result with
Gemini and judges it against a genre blueprint, works inside your existing Live project without touching your tracks,
and keeps you in control: one audible new thing at a time, keep / another take / undo per layer. A Training mode turns
the same pipeline into a by-ear production exercise.

```
you ── text / beatbox / hum / your Live set ──▶ Claude producer agent (76 tools, playbook, 25 genre blueprints)
                                                   ├─▶ Stable Audio 2.5 + 3   loops, hit sequences, audio-to-audio (per stem)
                                                   ├─▶ Gemini (ears)          describe, critique, A/B judge, score vs blueprint
                                                   ├─▶ local toolbelt          Demucs stems, basic-pitch MIDI, librosa, ffmpeg
                                                   └─▶ Ableton Live 10        ADEHack remote script 5.8, JSON over TCP 9004
                                                   └── every step streamed to the web UI (SSE), production-first reply
```

## What makes it different
- **Closed loop: generate -> listen -> judge -> fix.** Every kit is picked by Gemini A/B against the genre blueprint;
  the judge is evidence-first (silence gate, order-swapped A/B, lite-judge answers labelled) so it cannot echo the target.
- **Creator in the wheel.** New layers are auditioned alone (never stacked), each one ends with keep / another / undo,
  and the agent asks before moving your set's tempo (then warps your clips first). User tracks are never adopted,
  deleted or re-levelled.
- **It knows the genre.** 25 blueprints (patterns, sounds, bass, arrangement, proven Stable Audio prompts, history and
  references); unknown styles get a blueprint written on the fly. Replies talk production, not measurements.
- **Works on your real project.** "Work on my Live project" scans the set, records 8-16 bars from bar 1, and proposes
  moves; `enhance_project` treats whole-mix audio-to-audio as reference + seed and builds real layers per stem.
- **Training mode** (`/training.html`): pick a level, Stable Audio generates a short example, recreate it in Live by
  ear, Check scores your attempt, Reveal drops the target's parts into your session with "how this was built".

## Run
```bash
cd ~/ade-hack && npm install
cp .env.example .env     # then fill in (never committed):
#   STABILITY_API_KEY     required - every sound (Stable Audio 2.5 one-shots/a2a, Stable Audio 3 loops/music)
#   ANTHROPIC_API_KEY     required - the producer agent (claude-opus-5-5)
#   GEMINI_API_KEY        required - the ears (audio in). GEMINI_API_KEYS=k2,k3 rotates keys per (key, model) on daily quota
#   GEMINI_PAID=1         optional - paid tier (or GEMINI_TIER=paid): never fall back to lite judges, fail loudly instead
#   HF_TOKEN              optional - Music Flamingo / MuScriptor Spaces (ZeroGPU quota)
#   SLOT_POOL=8           optional - slot files per sound role in the Live Place (2..32; Live must index them: re-add the Place)
#   SOUNDCHARTS_*         optional - real catalogue for reference_track (sandbox data without it)
npm start                # http://localhost:3000 ; GET /api/health shows keys, Live script version, ears status
bash tools/py/setup.sh   # optional toolbelt (Demucs, basic-pitch, librosa, pedalboard), Python 3.11 venv, ~10 min
node tests/smoke.mjs     # offline regression suite
```
Pages: `/` chat-first studio (project card, layer cards, Tools drawer with Prompt Lab), `/training.html` Training mode.

## Demo flow
Open http://localhost:3000. Either click **Work on my Live project** with a set open, or start from nothing: *"make
me a UK garage beat at 132"* gets a playable Drum Rack + tops loop within ~5 tool calls, then *"add a bass that
interlocks with the kick"*, *"listen to the kick and be honest"*, *"make a B scene"*, *"lay it out: 8 bars of A then 8
of B"*. Attach a beatbox / hum / reference file and the agent builds from your hits and notes. The full 3-minute stage
script is in **DEMO.md**.

## Tool roles (who does what)
| Component | Role | Where |
|---|---|---|
| **Claude Opus 5.5** (Anthropic API) | Reasoning and orchestration: the producer agent with 76 tools, production playbook (groove, sound design, stereo, mix), genre blueprints injected per turn, creator-in-control and tempo-intent rules. Never touches audio itself. | `lib/agent.js`, `lib/knowledge.js`, `server.js /api/chat` |
| **Stability AI, Stable Audio 2.5 + 3** | Sounds: hit sequences sliced into one-shots with free alternates, genre loops (`design_kit`, `generate_loop`), loop layers seeded from the mix (audio-to-audio), per-stem enhance of a real project, full tracks (`compose_track`). | `lib/stability.js`, `lib/hits.js`, tools synthesize_sound, design_kit, add_loop_layer, enhance_project |
| **Gemini** (audio-in; Music Flamingo optional) | Ears: describe a capture, production-first critique, pairwise A/B authenticity, strict genre rubric, label chopped pieces, judge a sound against its prompt. Key rotation + lite-judge labelling. | `lib/ears.js`, tools listen, judge_sound, critique_capture, production_dna, critique_mix |
| **Open-source toolbelt** (`tools/py`) | Demucs stems, basic-pitch audio-to-MIDI, librosa tempo/key/groove, pedalboard processing and master preview. Optional until `tools/py/setup.sh` runs. | `lib/pytools.js`, tools separate_stems, transcribe_audio, analyze_music, process_audio |
| **Built-in DSP** | YIN pitch tracking, onset/centroid beatbox classification, loop -> 16th MIDI + groove, local sub/808/snap synth, Haas widener, offline ffmpeg render, loudness/band analysis, rubberband tune/stretch. | `lib/melody.js`, `lib/rhythm.js`, `lib/synthlocal.js`, `lib/render.js`, `lib/analyze.js` |
| **ADEHack 5.8** (Live 10 remote script) | Hands: 53 JSON-over-TCP commands: tracks, clips, Simpler hot-swap, Drum Rack pads, devices + parameters, sends, mixer, scenes, transport, warping, audio clips, meters, arrangement/session recording from bar 1 (`set_position` / `jump`), tempo with clip warping, undo. Full list: `ableton/README.md`. | `ableton/ADEHack/ADEHack.py`, `ableton/client.js` |
| **Training mode** | Stable Audio example per level -> capture the user's attempt -> compare (A/B + pattern/bass match) -> reveal parts on muted `Target` tracks. | `lib/training.js`, `public/training.html` |

## Agent tools (lib/agent.js) - 76
**Hear / analyze:** listen · judge_sound · listen_live · critique_capture · analyze_recording · transcribe_audio · analyze_audio · compare_audio · analyze_music · production_dna · critique_mix · label_pieces · review_mix · describe_set · read_clip · clip_info · meters · reference_track · genre_guide · genre_blueprint
**Make sounds:** synthesize_sound · synth_local · generate_loop · generate_rhythm · design_kit · compose_track · restyle_mix · restyle_audio · refine_sound · undo_sound · slice_sample · chop_sample · layer_samples · tune_sample · shape_sample · separate_stems · process_audio · master_preview · render_preview · import_sample
**Build in Live:** set_tempo · set_position · build_kit · load_to_pad · build_drum_layer · build_melody_layer · add_loop_layer · load_audio_clip · update_layer · replace_sound · remove_layer · enhance_project · create_scene · fire_scene · record_arrangement · record_performance · capture_midi · set_clip_warp · set_track_color · live_undo
**Shape, mix, present:** add_effect · set_param · list_devices · browse_library · load_device · set_mixer · mix_balance · set_send · list_tracks · audition · show_live · play · stop · explain_result · budget
Attachments (beatbox, hum, reference files) and the sample registry persist per chat session (`.tmp/chat-state.json`).
Server glue: `POST /api/chat` (SSE), `POST /api/upload`, `POST /api/project/scan`, `POST /api/refine`, `POST /api/training/*`, `GET /api/health`, `GET /api/knowledge`.

## Licenses (what we ship or call)
| Component | License / terms | Note |
|---|---|---|
| express, multer, zod, @anthropic-ai/sdk | MIT | shipped (npm) |
| dotenv | BSD-2-Clause | shipped (npm) |
| ffmpeg / ffprobe | LGPL-2.1+ core; the Homebrew build is **GPL** (x264 etc.) | called as a separate process |
| rubberband CLI | **GPL-2.0+** (commercial license sold by Breakfast Quay) | called as a separate process |
| torch, torchaudio, numpy, soundfile, numba, llvmlite | BSD-style (libsndfile LGPL-2.1) | toolbelt venv |
| librosa | ISC | toolbelt venv |
| Demucs (code + htdemucs weights) | MIT | toolbelt venv |
| basic-pitch (Spotify) | Apache-2.0 | toolbelt venv |
| pedalboard (Spotify) | **GPL-3.0** (JUCE) | toolbelt venv, separate process |
| pyloudnorm | MIT | toolbelt venv |
| Stability AI API (Stable Audio 2.5) | Stability AI Developer Platform Terms of Service; paid credits, generated audio usable under those terms and the usage policy | API call |
| Anthropic API (Claude Opus 5.5) | Anthropic Commercial Terms of Service + Usage Policy | API call |
| Google Gemini API | Gemini API Additional Terms; on the unpaid tier Google may use prompts/audio to improve products | API call |
| Hugging Face Spaces (ZeroGPU) | Hugging Face Terms of Service; shared GPU quota per account | API call |
| NVIDIA Music Flamingo (via HF Space) | model weights under NVIDIA's **non-commercial** license (NVIDIA OneWay Noncommercial License, confirmed on the model card 2026-10-21; research/demo only) | API call |
| MuScriptor (via HF Space) | no license stated on the Space card (checked 2026-10-21); treat as demo-only until clarified | API call |
| Ableton Live 10 Python API (`Live`, `_Framework`) | Ableton's proprietary modules; used only inside Live, we ship only our own script | not redistributed |

**What this means:** everything above is fine for a hackathon demo and for personal use. For a product you would (a) replace Music Flamingo with a commercially licensed listener (Gemini already is) or get an NVIDIA license, (b) keep the GPL pieces (pedalboard, rubberband, GPL ffmpeg build) as separately installed tools the user runs, or swap them for permissive equivalents, and (c) review the Stability and Google data/usage terms for your customers' audio.

## Layout
- `server.js` Express API: chat (SSE), uploads, project scan, refine/undo, Prompt Lab, render/score, Live wrappers (`makeCtx`), slot pool
- `lib/agent.js` producer agent (system prompt + 76 tools) · `lib/knowledge.js` genre blueprints (`knowledge/genres/*.md`) + Live preset inventory
- `lib/stability.js` Stable Audio 2.5 / 3 client · `lib/hits.js` hit-sequence one-shots · `lib/ears.js` Gemini / Flamingo ears · `lib/training.js` Training mode
- `lib/capture.js` AudioTee capture of Live · `lib/pytools.js` toolbelt bridge (`tools/py`) · `lib/render.js`, `lib/analyze.js` offline render + measurements
- `public/index.html` chat-first studio UI · `public/training.html` Training mode
- `ableton/` Live 10 remote script (ADEHack), `client.js`, `install.sh`
- `tests/smoke.mjs` offline regression suite; `scripts/test-*.mjs` focused tests

Costs: Stable Audio 2.5 = 8 credits (~$0.08) per generation; Stable Audio 3 loops/tracks cost more per second.

## Ableton Live 10 setup (one time, ~2 min)
1. `bash ableton/install.sh` copies ADEHack 5.8 into the Live 10 app bundle (it refuses if `ableton/VERSION` and the script disagree).
2. Fully quit and relaunch Live (remote scripts load at startup). Preferences › Link/MIDI › Control Surface 1 = **ADEHack** (Input/Output: None).
3. Preferences › Audio › pick an output device. Add two return tracks (A/B) if you want sends.
4. In Live's browser, Places › **Add Folder...** › `~/Music/Ableton/User Library/ADE Hack`. An added Place is indexed immediately; the script searches it first. Live caches samples by filename, so sounds rotate through `SLOT_POOL` numbered slot files per role.
5. Check: `node ableton/client.js version` → `5.8`. The web UI's health badge compares the running script to `ableton/VERSION` and says **"restart to load script vX.Y"** after every reinstall.
6. Captures (project scan, enhance, Training check) need macOS System Audio Recording permission for the terminal that runs `npm start` (AudioTee taps Live's process).

Known Live 10 Standard limits: no Echo / Ping Pong Delay (10.1 merged them into **Delay**; the script aliases them), no Operator/Analog/Wavetable (Suite), no API to create group or return tracks, no compressor sidechain routing.
