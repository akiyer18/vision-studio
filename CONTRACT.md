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

# ---- v3: the producer agent (Claude with tools, like Claude Code for beats) ----

## lib/agent.js
- `runProducer({ history, userText, recordings, ctx }) -> { text, history }`
   Uses @anthropic-ai/sdk `client.beta.messages.toolRunner` with `betaZodTool` tools (model "claude-opus-5-5", max_tokens 16000, omit `thinking`, output_config: { effort: 'medium' }, max_iterations ~24).
   `history` is the Anthropic messages array from previous turns (append full `response.content` blocks, never just text); return the updated array.
   `recordings` = { beat?: absolutePath(wav), hum?: absolutePath(wav) } for this turn (may be empty).
   Every tool `run` calls `ctx.emit({ type:'tool', name, input, summary })` at start and `ctx.emit({ type:'tool_done', name, summary, data? })` at end so the UI can show progress; the model receives a concise JSON string result.
- Tools (names exact):
   - set_tempo { bpm } -> ctx.live.setTempo
   - list_tracks {} -> ctx.live.listTracks
   - analyze_recording { which:'beat'|'hum', bpm? } -> beat: ctx.beatboxToPattern(path,{bpm}) returns { pattern, onsets:[{time,instrument}] , bpm }; hum: ctx.humToNotes(path,{bpm}) returns { notes, bars, bpm }
   - write_drum_pattern { description, bpm, bars } -> ctx.writePattern -> pattern JSON (Claude may instead author the pattern itself with build_drum_layer)
   - write_melody { description, key, bpm, bars } -> ctx.writeMelody -> { notes, bars, key }
   - synthesize_sound { role (kick|snare|clap|hat_closed|hat_open|rim|perc|tom_low|tom_high|synth|bass|pad|lead|pluck|keys), prompt, source:'text'|'beatbox'|'hum', offsetSeconds?, lengthSeconds? } -> ctx.synth(...) -> { path, name, durationSeconds, peakDb }
   - build_drum_layer { name, instrument, samplePath, steps:[{step,velocity}], bars, swing? } -> ctx.live.buildLane(...) creates/reuses the track named `name`, loads sample via slot pool, creates+fires a one-note (C3) clip from steps (16ths) -> { track:{index,name}, notes }
   - build_melody_layer { name, samplePath, notes:[{pitch,startBeats,durationBeats,velocity}], bars } -> ctx.live.buildMelody(...) -> { track, notes }
   - update_layer { name, steps?|notes?, bars } -> replace the clip on the existing track (ctx.live.updateLayer)
   - replace_sound { name, samplePath } -> ctx.live.loadSample onto that track
   - remove_layer { name } -> ctx.live.deleteTrack
   - show_live {} -> Session view; play {} / stop {}
- System prompt (write it well): you are a producer sitting next to the user with Ableton open; build beats layer by layer (tempo -> kick -> snare/clap -> hats -> perc -> bass/chords/lead); use parallel tool calls for independent sounds; Stable Audio prompts are descriptive adjectives (no instructions), for drums add "dry one-shot", for tonal sounds "single sustained note, no drums"; when the user beatboxed, analyze_recording first and build sounds from their hits (source:'beatbox' + offsetSeconds of the first onset of that instrument); keep pattern grids 16 steps per bar with musical velocities (ghosts 35-55, accents 110-127); after building, reply in 3-6 short lines: what was added (track names), one thing you noticed, and 2-3 concrete next-step suggestions phrased as things the user can just say. Never claim something is in Live unless the tool returned ok.
- Export also `PRODUCER_SYSTEM` and `makeTools(ctx, recordings)` for testing.

## server.js glue
- ctx built from existing internals: synth (wraps the /api/synth pipeline as a function), writePattern, writeMelody, beatboxToPattern, humToNotes, live.* (sendToLive wrappers + slot pool + lastBuild registry keyed by track name), emit -> SSE.
- POST /api/upload multipart audio -> { id, path(wav) }   (converted with toWav)
- POST /api/chat json { text, beatId?, humId?, reset? } -> text/event-stream: events {type:'tool'|'tool_done'|'text'|'error'|'done', ...}; history kept in server memory (single session), `reset:true` clears it.

# ---- v4: producer agent gets hands (sample surgery, devices, mixer, variations, arrangement) ----

## ableton/ protocol additions (ADEHack.py v4)
- {"cmd":"load_device","track":int|name,"name":"Saturator"|"Reverb"|"Auto Filter"|"Compressor"|"EQ Eight"|"Overdrive"|"Redux"|"Erosion"|"Ping Pong Delay"|"Echo"|"Glue Compressor"|"Drum Buss"|"Utility"|<any Core Library device/preset name>}
    -> search browser.audio_effects (and browser.instruments for instrument names) recursively by exact then case-insensitive name; select the track; browser.load_item(item) APPENDS the device at the end of the chain (do not hot-swap). Reply {ok, track, device:{index,name,class_name}, params:[{index,name,value,min,max}]} (first 32 params).
- {"cmd":"set_device_param","track":...,"device":int|name,"param":int|name,"value":number} -> clamp to min/max, set device.parameters[i].value; reply {ok, param:{name,value,min,max}}
- {"cmd":"list_devices","track":...} exists; extend each device with params:[{index,name,value,min,max}] when "params":true
- {"cmd":"set_mixer","track":...,"volume":0..1?,"pan":-1..1?,"mute":bool?,"solo":bool?,"arm":bool?} -> track.mixer_device.volume.value / panning.value, track.mute/solo/arm; reply {ok, mixer:{volume,pan,mute,solo,arm}}
- {"cmd":"delete_device","track":...,"device":int|name} -> {ok}
- create_clip already takes "slot" (0-based scene index); add {"cmd":"create_scene","index":-1,"name":"B"} -> song.create_scene(index), set name; {"cmd":"fire_scene","index":N}; {"cmd":"list_scenes"} -> [{index,name}]
- {"cmd":"stop_clip","track":...,"slot":N} -> clip_slot.stop()

## server ctx additions (makeCtx)
- slice(refPath, { startSeconds, lengthSeconds, name, fadeMs=5 }) -> one-shot wav in OUT_DIR (ffmpeg -ss/-t, afade in/out, normalize) -> { path, name, durationSeconds }
- chop(refPath, { maxPieces=8, pieceSeconds=0.35, name }) -> onsets via lib/rhythm detectOnsets, one wav per onset -> [{ path, name, time, instrument }]
- live.loadDevice({ track, name }) / live.setParam({ track, device, param, value }) / live.listDevices({ track, params }) / live.setMixer({ track, ...}) / live.deleteDevice / live.createScene / live.fireScene / live.listScenes / live.recordArrangement({ bars })
- Attachments persist for the whole chat session: recordings passed to runProducer every turn = all beat/hum/refs seen so far (latest beat/hum win), with `attachedThisTurn: string[]` listing the ones that arrived with this message.

## lib/agent.js v4 tools
- slice_sample { which:'beat'|'hum'|'ref#N', startSeconds, lengthSeconds (0.05-4), name } -> ctx.slice -> use as a layer sound (vox chops, stabs) without Stability
- chop_sample { which, maxPieces?, pieceSeconds? } -> ctx.chop -> list of hits with times + classification; the agent then picks pieces for layers
- add_effect { track, device, params?: [{ name, value }] } -> ctx.live.loadDevice then setParam for each; describe common recipes in the system prompt: dirtier = Saturator (Drive 12-24 dB) or Overdrive; wider/space = Reverb (Decay 1-3 s, Dry/Wet 15-30%); darker = Auto Filter lowpass (Frequency 800-3000 Hz); glue = Glue Compressor / Drum Buss on drums; lo-fi = Redux; movement = Ping Pong Delay / Echo on perc at low Dry/Wet
- set_param { track, device, param, value }, list_devices { track }
- set_mixer { track, volume?: 0..1 (0.85 = 0 dB), pan?, mute?, solo? }
- build_drum_layer / build_melody_layer / update_layer gain optional `slot` (0 = scene A, 1 = scene B ...) for variations; create_scene { name }, fire_scene { index }
- record_arrangement { bars } -> ctx.live.recordArrangement (records what is playing in Session into the Arrangement for N bars; then stops)
- System prompt: attachments stay available across turns (ref names + paths listed each turn); when asked for vocal chops: chop_sample or slice_sample the reference and build a layer from the pieces (optionally run pieces through synthesize_sound source ref#N for new textures); "dirtier/warmer/wider/darker/punchier" map to add_effect recipes before re-synthesizing; keep listen/judge budget; variations go in scene B via slot 1; reply format unchanged.
