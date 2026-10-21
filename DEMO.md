# vision-studio — ADE Hack demo script (3 minutes)

AI producing assistant for Ableton Live 10. You talk, beatbox and hum; it builds the track in Live, listens to its own output, and fixes what it doesn't like.

## Setup checklist (do this 15 min before, in order)

1. `.env` has `STABILITY_API_KEY`, `ANTHROPIC_API_KEY`, `HF_TOKEN` (ears), `GEMINI_API_KEY` (ears fallback). Check: `GET http://localhost:3000/api/health`.
2. `cd ~/ade-hack && npm start` -> "ADE Hack running at http://localhost:3000". Open it in the browser, zoom 125%.
3. Live 10: fully quit and relaunch (remote scripts load at startup). Preferences > Link/MIDI > Control Surface = **ADEHack** (In/Out: None). Verify: `node ableton/client.js version` -> `5.0`. The UI shows "Live restart needed" if the running script is older than `ableton/VERSION`.
4. Live browser: Places must contain the **ADE Hack** folder (`~/Music/Ableton/User Library/ADE Hack`). If missing: Places > Add Folder..., then restart Live once more.
5. Live: new empty set, Session view, tempo 90, master at -6 dB, audio output to the room PA. Delete leftover tracks from rehearsals (`remove_layer` leaves nothing behind, but check).
6. Mic: test "attach a beat" (beatbox 4 bars) and "attach a melody" (hum 2 bars) once; both should show a duration under the buttons. Prepare a vocal wav (record one now, save it as `demo/vox.wav`) as the reference attachment, so step 1 does not depend on the room mic.
7. Ears: if the health line says "ZeroGPU quota exhausted", say so on stage and rely on the Gemini fallback. Never promise a listen.
8. Reset the chat (Reset button) so the transcript on screen starts empty. Have Live and the browser side by side on the projector.

## The sequence (type exactly this; the audience watches Live)

| # | You type / do | What the audience sees in Live |
|---|---|---|
| 1 | Click **attach a beat**, beatbox 4 bars of boom-bap. Click **attach a melody**, hum a 2-bar bassline. Attach `vox.wav` as a reference. | Nothing yet. The UI lists beat, hum and ref#1 with durations. |
| 2 | `build a dusty boom bap beat around my beatbox at 90 bpm, bass from my hum, and chop the vocal into a hook` | Tempo jumps to 90. Tracks appear one by one: Kick, Snare, Hats, Bass, Vox Chop. Each gets its own Stability-generated sample in a Simpler (watch the device chain fill), then a clip in scene 1. Session view switches on, the clip editor shows the notes. The loop plays. ~60-90 s. |
| 3 | `make the kick dirtier and warmer` | A Saturator lands on the Kick track with Drive pushed up. The agent reads the real parameter ranges back from Live before setting them. |
| 4 | `listen to the snare and tell me honestly if it fits, fix it if not` | Transcript shows the judge-by-ear loop: it renders the snare, asks the ears model, gets a score, and if the score is low it re-synthesizes and hot-swaps the sample inside the same Simpler (no second device appears). Say: "it just disagreed with itself and fixed it." |
| 5 | `make a B scene with half-time drums and the hats opening up` | Scene 2 appears below, clips duplicated and edited in place, then scene 2 fires on the next bar, in sync. |
| 6 | `lay it out for 16 bars, A then B` | Live flips to Arrangement, record mode turns on, scenes fire in order, recording stops itself after 16 bars. Press play in Live to prove it is real audio and MIDI in the timeline. |
| 7 | `give me technical feedback on the mix` | Text only: it lists the tracks with their devices and levels straight from Live and gives concrete suggestions. End on this; it shows it reads the set, not just writes to it. |

If a step fails live: say what failed, type `what is in my set right now?` (it reads the tracks and devices back from Live) and continue with the next step. The transcript shows every tool call with its result, so failures are visible and honest.

## 5 talking points (architecture)

1. **Claude producer agent, 31 tools.** Claude runs the session as an agent with tools like `build_drum_layer`, `add_effect`, `judge_sound`, `record_arrangement`. Every action in Live is a tool result the audience can read in the transcript.
2. **One Stability call per sound.** Each layer gets its own Stable Audio 2.5 audio-to-audio generation seeded by the beatbox hit or hum (short recordings are padded to the 6 s minimum), then sliced to a one-shot and dropped into a Simpler. No sample packs.
3. **Ears: NVIDIA Music Flamingo, Gemini as fallback.** The agent renders what it built and asks an audio-language model to describe and score it, then acts on the score. That closes the loop between generation and judgment.
4. **Live 10 remote script, no Max for Live.** A Python 2.7 control surface inside Live exposes a JSON-over-TCP protocol (33 commands: clips, devices, parameters, mixer, scenes, transport, arrangement record). Every API name was verified against Live's own bundled scripts.
5. **Offline render for measurement.** Before judging, the server renders the current layers to a wav with ffmpeg so loudness and spectral checks are deterministic and the ears model hears exactly the mix, not whatever the room mic picks up.

## 3 known limitations (say them out loud)

1. **Ears run on a shared ZeroGPU Space.** Quota can run out mid-demo; the agent then falls back to Gemini or skips the listen and says so.
2. **Live 10's API cannot create group tracks or route a compressor sidechain.** "Sidechain the bass to the kick" is out of scope until Live 11+; we say that instead of faking it.
3. **Simpler caches samples by filename.** Live will not reload a changed file with the same name, so sounds rotate through numbered slot files per role and the Place must be indexed once. Re-adding the folder is the known workaround.
