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
cd ~/ade-hack
# put your real key in .env:  STABILITY_API_KEY="sk-..."
# optional, for smarter patterns: ANTHROPIC_API_KEY="sk-ant-..."
npm start            # http://localhost:3000
```

## Demo flow
1. **Hear it**: name = "snare", mode = One-shot, hit Record, beatbox one snare, Stop, describe it ("punchy acoustic snare, bright crack"), Synthesize. ~5–15 s later you get `snare-<ts>.wav` (one-shot) and `snare-full-<ts>.wav` (6 s loop).
2. **Pattern**: "four on the floor, snare on 2 and 4, offbeat hats", 124 BPM, Generate. Press Play to audition with your new snare. `snare-pattern-<ts>.mid` is saved.
3. In Live: User Library › ADE Hack → drag the `.wav` onto a MIDI track (Simpler) or a Drum Rack pad, drag the `.mid` onto that track. Use "Single sample" mapping for Simpler, "Drum Rack" mapping for GM pads.

## Agent tools (lib/agent.js)
set_tempo · list_tracks · analyze_recording (beatbox → pattern + per-hit onsets, hum → notes) · write_drum_pattern · write_melody ·
synthesize_sound (Stable Audio one-shot, from text or from a hit in your recording) · build_drum_layer · build_melody_layer ·
update_layer · replace_sound · remove_layer · show_live · play · stop. Server glue: `POST /api/chat` (SSE), `POST /api/upload`.

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
1. `bash ableton/install.sh` copies the ADEHack remote script into the Live 10 app bundle.
2. Fully quit and relaunch Live. Preferences › Link/MIDI › Control Surface 1 = **ADEHack** (Input/Output: None).
3. Preferences › Audio › pick an output device (otherwise Live is silent).
4. In Live's browser, Places › **Add Folder...** › `~/Music/Ableton/User Library/ADE Hack`. Live's own User Library index can be stale on fresh installs; an added Place is indexed immediately and the script searches it first.
5. Check: `node ableton/client.js ping` → `{"ok":true,"tempo":...}`.

Then in the web app: select a MIDI track in Live, press **→ Live** on a sample (loads it into Simpler on that track) and **→ Live** on a pattern (sets tempo, creates and fires the clip). Use the "Single sample" MIDI mapping for Simpler, "Drum Rack" mapping for GM pads.
