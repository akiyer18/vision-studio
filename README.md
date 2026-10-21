# ADE Hack · AI Producing Assistant for Ableton

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

## Layout
- `server.js` Express API (`/api/synth`, `/api/pattern`, `/api/reveal`, `/api/health`)
- `public/index.html` UI (mic recorder, step grid, browser audition)
- `lib/audio.js` ffmpeg pipeline (pad hum to the 6 s Stability minimum, slice one-shot, normalize)
- `lib/stability.js` Stable Audio 2 / 2.5 / 3 client
- `lib/pattern.js` description → pattern (Claude when key set, else rules) · `lib/midi.js` pattern → .mid
- `ableton/` Live 10 remote script (TCP 9004 JSON) for pushing clips straight into Live
- `scripts/test-*.mjs` offline tests: `node scripts/test-audio.mjs`, `node scripts/test-pattern.mjs`

Costs: Stable Audio 2.5 = 8 credits (~$0.08) per generation.
