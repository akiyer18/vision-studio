# ADE Hack - build contract (all agents follow this)

Project: ~/ade-hack  (Node 18, ESM "type":"module", deps installed: express multer dotenv @anthropic-ai/sdk zod)
Env: ~/ade-hack/.env -> STABILITY_API_KEY (required), ANTHROPIC_API_KEY (optional), ADE_OUT_DIR (optional)
Output dir (what Ableton sees): process.env.ADE_OUT_DIR || "$HOME/Music/Ableton/User Library/ADE Hack"
Temp dir: ~/ade-hack/.tmp (gitignored)
Tools on machine: ffmpeg + ffprobe at /usr/local/bin. No sox. Node 18 has global fetch/FormData/Blob.

## lib/audio.js  (ffmpeg helpers; all async, all take/return absolute paths)
- toWav(inputPath, outputPath)                 -> any browser recording (webm/opus, mp4/aac, wav) -> 44.1k mono 16-bit wav
- durationSeconds(path)                        -> number (ffprobe)
- makeOneShotLoop(inWav, outWav, {hitSeconds=0.45, gridSeconds=0.5, totalSeconds=6.5}) -> trims leading silence, keeps first hit, fades, tiles it on the grid so output is >= 6 s (Stability minimum)
- makeLoopInput(inWav, outWav, {minSeconds=6.5}) -> loops the whole recording until >= 6 s
- sliceFirstHit(inWav, outWav, {seconds=1.0})  -> cuts the first transient of generated audio into a one-shot with fade-out
- normalize(inWav, outWav)                     -> peak-normalize to -1 dBFS

## lib/stability.js
- audioToAudio({ wavPath, prompt, strength=0.7, duration=6, model='stable-audio-2.5', seed=0, steps }) -> { buffer: Buffer (wav bytes), seed }
   POST https://api.stability.ai/v2beta/audio/stable-audio-2/audio-to-audio  multipart; headers authorization: Bearer KEY, accept: audio/*; fields prompt, audio(file), output_format=wav, duration, strength, model, seed, steps
   If model==='stable-audio-3': POST /v2beta/audio/stable-audio/audio-to-audio (202 -> {id}) then poll GET /v2beta/audio/results/{id} every 2 s (202 = wait, 200 = wav bytes)
- textToAudio({ prompt, duration=6, model='stable-audio-2.5', seed=0 }) -> { buffer, seed }   (same shape, /text-to-audio)
- Errors: throw Error(`Stability ${status}: ${body}`)

## lib/pattern.js
- describeToPattern({ description, bpm, bars=1 }) -> { pattern, source: 'claude'|'rules' }
   Uses Claude (model claude-opus-5-5, @anthropic-ai/sdk messages.parse + zodOutputFormat) when process.env.ANTHROPIC_API_KEY is set, else rule-based keyword parser. Never throws on missing key.
- PatternSchema (zod) exported. Pattern shape:
   { name: string, bpm: number, bars: number, stepsPerBar: 16, swing: 0..1,
     lanes: [ { instrument: 'kick'|'snare'|'clap'|'rim'|'hat_closed'|'hat_open'|'tom_low'|'tom_high'|'ride'|'crash'|'perc', steps: [ { step: int (0 .. bars*16-1), velocity: 1..127 } ] } ] }
- GM_DRUM_NOTES = { kick:36, snare:38, clap:39, rim:37, hat_closed:42, hat_open:46, tom_low:45, tom_high:50, ride:51, crash:49, perc:54 }

## lib/midi.js  (no deps; hand-written SMF format 0, PPQ 96)
- patternToMidi(pattern, { mapping='gm'|'single', singleNote=60 }) -> Buffer
   'gm' maps instruments via GM_DRUM_NOTES (Drum Rack pads); 'single' puts every hit on singleNote (for one sample in Simpler, C3=60)
   Step length = 1/16 note; note duration = 1/32; swing shifts odd 16ths later by swing*0.5*(16th)
- buildMidi({ bpm, ppq=96, notes: [{ pitch, startBeats, durationBeats, velocity }] }) -> Buffer

## server.js (Express, port 3000) + public/index.html
- GET  /api/health          -> { stabilityKey:boolean, anthropicKey:boolean, outDir }
- POST /api/synth  multipart: audio (file, optional), prompt, mode ('oneshot'|'loop'|'text'), strength, model, name
        -> { files: [{ name, url, path, kind:'oneshot'|'loop'|'raw' }], seed }
- POST /api/pattern json: { description, bpm, bars, name, mapping }
        -> { pattern, source, midi: { name, url, path } }
- POST /api/reveal json: { path } -> opens Finder at the file (open -R)
- GET  /out/<file>           -> serves files from the output dir
File naming: `${slug(name)}-${Date.now()}.wav|.mid`

## ableton/ (Live 10 Standard, Python 2.7 Remote Script - stretch)
- MIDI Remote Script "ADEHack" that listens on TCP 127.0.0.1:9004 for newline-delimited JSON:
   {"cmd":"create_clip","track":int|"selected","slot":int,"bpm":120,"notes":[{"pitch":36,"start":0.0,"duration":0.125,"velocity":100}],"length":4.0}
   {"cmd":"load_sample","path":"/abs/path.wav"}   -> loads file from User Library into the selected track via Live.Application.get_application().browser.load_item
   {"cmd":"set_tempo","bpm":128}
- Install path: /Applications/Ableton Live 10 Standard.app/Contents/App-Resources/MIDI Remote Scripts/ADEHack/  (or ~/Music/Ableton/User Library/Remote Scripts/ADEHack/)
