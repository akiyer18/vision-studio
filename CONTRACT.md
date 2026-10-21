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

# ---- v2 additions (melody / rhythm / multi-track) ----

## lib/melody.js (no deps; ffmpeg decodes audio to raw mono float32 16 kHz via `ffmpeg -i in -ac 1 -ar 16000 -f f32le -`)
- humToNotes(wavPath, { bpm, stepsPerBar=16, minSteps=1 }) -> { notes:[{ pitch:int 36..96, startBeats, durationBeats, velocity }], bars:int, bpm }
   frame-wise pitch detection (autocorrelation / YIN-style, frame 2048, hop 256, RMS gate), hz -> nearest MIDI semitone, median-smooth,
   quantize onsets/offsets to the 16th grid at bpm, merge consecutive same-pitch frames into notes, drop notes shorter than minSteps, bars = ceil(total beats / 4).
- describeToMelody({ description, bpm, bars=2, key }) -> { notes, source:'claude'|'rules', key }
   rules: parse key (e.g. "C minor", "F# major", default C minor), style words: arp/arpeggio (8th or 16th arps over i-VI-III-VII), bassline (root notes, octave 2, 8ths), stabs/chords (3-note chords on 1 and 3.5), lead/melody (stepwise scale motion, mostly 8ths), "octave up/down". Claude path like describeToPattern when ANTHROPIC_API_KEY set.
- notesToMidi(notes, { bpm, ppq=96, channel=0 }) -> Buffer  (reuse lib/midi.js buildMidi)

## lib/rhythm.js
- beatboxToPattern(wavPath, { bpm, bars }) -> { pattern (PatternSchema-valid), onsets:[{ time, instrument, energy }] }
   onset detection = spectral/energy flux peaks with min 60 ms gap; per-onset features over 40 ms: RMS, spectral centroid, zero-crossing rate;
   classify: centroid < 400 Hz -> kick, 400-3000 Hz with high ZCR -> snare, > 3000 Hz -> hat_closed; quantize to 16ths at bpm; bars = given or ceil(duration beats / 4) (1-8).
   If bpm missing: estimate from inter-onset intervals (median IOI -> 60/IOI * {1,2,4} chosen into 70-180).

## server.js additions
- POST /api/melody  multipart: audio (optional), description, bpm, bars, key, name  -> { notes, bars, bpm, source:'hum'|'claude'|'rules', midi:{name,url,path} }
- POST /api/rhythm  multipart: audio (required), bpm (optional), bars (optional), name -> { pattern, onsets, midi }
- POST /api/live/melody json { notes, bpm, bars, track?, slot?, fire? } -> create_clip with pitched notes (channel 1)
- POST /api/live/build json { bpm, drums:{ pattern, mapping, samplePath? }, synth:{ samplePath, notes, bars } } ->
    create_midi_track "Drums" + load sample (if given) + create_clip(pattern), create_midi_track "Saw" + load sample + create_clip(notes), set_tempo; returns per-step results
- /api/live/sample and all load_sample calls: retry up to 6x with 700 ms sleep when Live replies "not found" (index lag for freshly written files)

## ableton/ protocol additions (ADEHack.py v3)
- {"cmd":"list_tracks"} -> {ok, tracks:[{index,name,is_midi,selected}]}
- {"cmd":"create_midi_track","name":"Saw","index":-1} -> {ok,index,name}   (song.create_midi_track(index); then set .name; select it)
- {"cmd":"select_track","track": int|name} -> {ok,index,name}   (song.view.selected_track = track)
- load_sample: optional "track": int|name -> select it first; internal retry: poll browser roots for up to 3 s (every 0.25 s via schedule_message, non-blocking) before replying not found
- create_clip: "track" accepts int|name|"selected"; optional "name" sets clip.name; replaces an existing clip in that slot (delete_clip first)
