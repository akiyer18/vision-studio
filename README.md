# ADE Hack · AI Producing Assistant for Ableton

**"Claude Code for beats."** You talk to a producer agent (Claude Opus 5.5 with tools). It plans the beat, synthesizes every sound
with Stability AI (Stable Audio 2.5), analyzes your beatbox/hum, lays each layer into Ableton Live itself through our remote script,
and tells you what it did and what to try next. You answer in plain language ("more swing", "make the kick punchier",
"add a saw arp in F minor") and it edits the Live set in place.

```
you ──text / beatbox / hum──▶ Claude producer agent ──tools──▶ Stability AI (sounds)
                                       │                       ├─▶ pattern / melody / rhythm analysis (lib/)
                                       │                       └─▶ Ableton Live 10 (ADEHack remote script, TCP 9004)
                                       └── streams every step to the web UI (SSE) + a short report with next steps
```

Hum or beatbox the sound in your head → Stability AI (Stable Audio 2.5) turns it into a real sample.
Describe the groove in words → you get a MIDI clip. Both land in Ableton's browser under **User Library › ADE Hack**.

## Run
```bash
cd ~/ade-hack && npm install
# .env (never committed):
#   STABILITY_API_KEY="sk-..."        required - every sound
#   ANTHROPIC_API_KEY="sk-ant-..."    required - the producer agent (claude-opus-5-5)
#   GEMINI_API_KEY="..."              required for ears without GPU quota (Gemini, audio in)
#   HF_TOKEN="hf_..."                 optional - Music Flamingo + MuScriptor Spaces (ZeroGPU quota)
npm start            # http://localhost:3000 ; GET /api/health shows keys, Live script version, ears status
bash tools/py/setup.sh   # optional: local open-source toolbelt (Demucs, basic-pitch, librosa, pedalboard), ~10 min
```

## Demo flow
Open http://localhost:3000, attach a beatbox and a hum (or a reference file), and type what you want: *"build a dusty boom bap beat around my beatbox at 90 bpm, bass from my hum, chop the vocal into a hook"*. The agent builds it in Live layer by layer, then takes follow-ups ("make the kick dirtier", "make a B scene", "lay it out: 8 bars of A then 8 of B", "technical feedback vs the reference"). The full 3-minute stage script with what the audience sees after each message is in **DEMO.md**. The legacy one-shot buttons (Synthesize / Generate / → Live) still work for testing single sounds and patterns.

## Tool roles (who does what)
| Component | Role | Where |
|---|---|---|
| **Claude Opus 5.5** (Anthropic API) | Reasoning and orchestration: the producer agent with 48 tools, the production playbook in its system prompt, and a quality gate (review_mix after every build, fix "high" issues before replying). Never touches audio itself. | `lib/agent.js`, `server.js /api/chat` |
| **Stability AI, Stable Audio 2.5** | Sounds: one-shots from a beatboxed hit or hum (audio-to-audio), multi-bar loops sliced into coherent kits, textures/pads, and audio-to-audio restyle of our own render. | `lib/stability.js`, tools synthesize_sound, generate_loop, restyle_mix |
| **Gemini** (audio-in) and **NVIDIA Music Flamingo** (HF Space) | Ears: production DNA from a reference (groove, tone, arrangement), mix critique, labeling chopped pieces, judging a generated sound against its prompt. Flamingo first when HF_TOKEN is set, Gemini as fallback / default. | `lib/ears.js`, tools listen, judge_sound, production_dna, critique_mix, label_pieces |
| **Open-source toolbelt** (`tools/py`, Python 3.11 venv) | Demucs stems, basic-pitch audio-to-MIDI (local, no quota), librosa tempo/key/beat grid/groove microtiming, pedalboard processing and master preview. Optional: tools answer "not installed" until `tools/py/setup.sh` runs. | `lib/pytools.js`, tools separate_stems, transcribe_audio, analyze_music, process_audio, master_preview |
| **Built-in DSP** (no model) | YIN pitch tracking for hums, onset + spectral-centroid beatbox classification, offline ffmpeg render of the layers, loudness/crest/band analysis, rubberband for tune/stretch. | `lib/melody.js`, `lib/rhythm.js`, `lib/render.js`, `lib/analyze.js`, ffmpeg + rubberband |
| **MuScriptor** (HF Space) | Polyphonic audio-to-MIDI fallback when basic-pitch is not installed. | `lib/transcribe.js` |
| **ADEHack 5.3** (Live 10 remote script) | Hands: 36 JSON-over-TCP commands on 127.0.0.1:9004 - tracks, clips (create / edit in place / quantize / duplicate), samples into Simpler (hot-swap), Simpler mode/warp/loop, devices + parameters, sends, mixer, scenes, transport, tempo ramps, arrangement recording with scene sequencing, MIDI capture. Full list: `ableton/README.md`. | `ableton/ADEHack/ADEHack.py`, `ableton/client.js` |

## Agent tools (lib/agent.js) - 48
**Hear / analyze:** analyze_recording · transcribe_audio · listen · judge_sound · analyze_audio · compare_audio · analyze_music · production_dna · critique_mix · label_pieces · review_mix · mix_balance
**Make sounds:** synthesize_sound · generate_loop · restyle_mix · slice_sample · chop_sample · layer_samples · tune_sample · shape_sample · separate_stems · process_audio · master_preview · render_preview
**Build in Live:** set_tempo · build_drum_layer · build_melody_layer · update_layer · replace_sound · remove_layer · create_scene · fire_scene · record_arrangement · capture_midi · set_track_color
**Shape & mix:** add_effect · set_param · list_devices · browse_library · set_mixer · set_send · list_tracks · show_live · play · stop
Attachments (beatbox, hum, reference files) persist for the whole chat session. Server glue: `POST /api/chat` (SSE), `POST /api/upload`, `GET /api/health`.

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
- `server.js` Express API (`/api/synth`, `/api/pattern`, `/api/reveal`, `/api/health`)
- `public/index.html` UI (mic recorder, step grid, browser audition)
- `lib/audio.js` ffmpeg pipeline (pad hum to the 6 s Stability minimum, slice one-shot, normalize)
- `lib/stability.js` Stable Audio 2 / 2.5 / 3 client
- `lib/pattern.js` description → pattern (Claude when key set, else rules) · `lib/midi.js` pattern → .mid
- `ableton/` Live 10 remote script (TCP 9004 JSON) for pushing clips straight into Live
- `scripts/test-*.mjs` offline tests: `node scripts/test-audio.mjs`, `node scripts/test-pattern.mjs`

Costs: Stable Audio 2.5 = 8 credits (~$0.08) per generation.

## Ableton Live 10 setup (one time, ~2 min)
1. `bash ableton/install.sh` copies ADEHack 5.3 into the Live 10 app bundle (it refuses if `ableton/VERSION` and the script disagree).
2. Fully quit and relaunch Live (remote scripts load at startup). Preferences › Link/MIDI › Control Surface 1 = **ADEHack** (Input/Output: None).
3. Preferences › Audio › pick an output device (otherwise Live is silent). Add two return tracks (A/B) if you want sends.
4. In Live's browser, Places › **Add Folder...** › `~/Music/Ableton/User Library/ADE Hack`. Live's own User Library index can be stale; an added Place is indexed immediately and the script searches it first.
5. Check: `node ableton/client.js raw '{"cmd":"version"}'` → `{"ok":true,"version":"5.3",...}`. The web UI's health badge compares the running script to `ableton/VERSION` and says **"restart to load script vX.Y"** after every reinstall.

Known Live 10 Standard limits: no Echo / Ping Pong Delay (10.1 merged them into **Delay**; the script aliases them), no Operator/Analog/Wavetable (Suite), no API to create group or return tracks, no compressor sidechain routing. Live caches samples by filename, so sounds rotate through numbered slot files per role.
