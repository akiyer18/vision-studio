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

# ---- v5: technical analysis, preview render, density, arrangement layout ----

## lib/analyze.js (no deps; ffmpeg for decode + ebur128/astats)
- analyzeAudio(path) -> {
    durationSeconds, sampleRate,
    loudness: { integratedLufs, loudnessRange, peakDbfs, rmsDbfs, crestFactorDb },           // ffmpeg ebur128 + astats (or computed)
    envelope: { attackMs (time to peak), decayMs (peak -> -20 dB), sustainRatio },
    spectrum: { centroidHz, rolloff85Hz, flatness, bands: { sub:[20,60], low:[60,250], lowMid:[250,800], mid:[800,2500], high:[2500,8000], air:[8000,20000] } each { db (relative to total), share (0..1) } },
    pitch: { hz, midi, note, confidence } | null (YIN on the loudest 200 ms, tonal only),
    rhythm: { onsetCount, bpmEstimate } | null (files > 2 s),
    stereo: { width (0..1), correlation } | null (mono input -> null),
    ratings: { loudness, punch, subWeight, lowEnd, body, presence, brightness, air, noisiness, tonalness, length } each 'low'|'medium'|'high' with the number it is based on,
    summary: one neutral technical sentence (no good/bad words) }
  Decode at 44.1 kHz stereo via ffmpeg f32le; FFT (radix-2, 4096, Hann, hop 1024) in JS. Thresholds documented at top of file (e.g. crest < 10 dB low, 10-16 medium, > 16 high; centroid < 1 kHz low, 1-3 kHz medium, > 3 kHz high; integrated LUFS < -20 low, -20..-12 medium, > -12 high).
- compareProfiles(a, b) -> { deltas: {...per rating numeric difference}, text: neutral comparison sentences ("reference has 6 dB more sub-band energy; produced kick decays 120 ms faster") }

## lib/render.js (offline preview mix of what the agent built, so the produced beat can be measured)
- renderPreview({ bpm, bars, layers:[{ name, samplePath, steps?:[{step,velocity}], notes?:[{pitch,startBeats,durationBeats,velocity}], gainDb?:0 }], outPath }) -> { path, durationSeconds }
  Decode each sample to 44.1k stereo float, place hits (velocity -> linear gain v/127), pitched notes via linear resampling (rate = 2^((pitch-60)/12)), sum, soft-limit at -1 dBFS, write 16-bit stereo wav. No Live effects (say so in the UI).

## agent tools (lib/agent.js v5)
- analyze_audio { which:'beat'|'hum'|'ref#N'|path } -> ctx.analyze(path) -> the profile (compact: ratings + key numbers + summary)
- compare_audio { a, b } -> ctx.compare(pathA, pathB)
- render_preview { bars? } -> ctx.render(...) builds from the registry (tracks + their sounds + the last clips) -> { path, url } and auto-runs analyze_audio on it
- System prompt: DENSITY rule (default "standard": kick, snare or clap, hats, at most one perc/vox layer; "minimal": 3 layers; "rich": up to 7); never duplicate roles (one hat type unless asked); FEEDBACK rule: when the user asks what you think / for feedback / to compare, answer with measurements and low/medium/high ratings, never good/bad/nice; for references run analyze_audio (and listen only if ears available), for produced beats run render_preview then analyze; when "lay it out"/"arrangement" is mentioned call record_arrangement; color-code tracks by role with set_track_color when available.

## server/UI
- ctx.analyze / ctx.compare / ctx.render wired; POST /api/analyze {path|uploadId} and POST /api/live/arrange {bars}; UI: Density select in the composer (prefixes the message with "[density: minimal]"), "Lay out in Arrangement" button, analysis cards rendered from tool_done events of analyze_audio (ratings grid).

# ---- v6: production quality (groove, sound design, mix, structure) ----

## server ctx additions
- layerSamples({ layers:[{ path, gainDb=0, offsetMs=0, highpassHz?, lowpassHz? }], name }) -> one-shot wav (ffmpeg amix with per-layer filters) -> { path, url, durationSeconds }   // kick = sub + click
- tuneSample({ path, semitones | targetMidi, name }) -> pitch-shifted wav (ffmpeg rubberband if available else asetrate+aresample) -> { path, url, detectedMidi?, appliedSemitones }
- shapeSample({ path, trimStartMs?, lengthMs?, fadeOutMs?, gainDb?, highpassHz?, lowpassHz?, name }) -> wav
- live.loadDevice: if a device with the same name already exists on the track, return it with `reused:true` and its params instead of adding a second one (add_effect then only sets params)
- live.setSend({ track, send:'A'|'B'|index, level 0..1 }) ; live.browse({ root:'instruments'|'sounds'|'audio_effects'|'drums', query? }) -> names (peer cmds)
- live.mixBalance({ template:'drums-default' | explicit }) -> applies role-based volume/pan via set_mixer to all registry tracks: kick 0.85/0, snare 0.80/0, clap 0.74/+0.08, hat_closed 0.62/+0.18, hat_open 0.58/+0.22, rim 0.55/-0.25, perc 0.56/-0.3, tom 0.66/-0.1, vox 0.68/+0.1, synth/bass 0.72/0, pad 0.6/0, lead 0.66/-0.05
- reviewMix() -> render_preview + analyze whole + analyze each layer soloed (render with one layer) -> { whole: profile, perLayer: {name: {ratings subset: subWeight, lowEnd, brightness, loudness}}, issues:[{ severity:'high'|'medium'|'low', text (technical, neutral), fix: suggested tool call }] } with rules: two layers both 'high' sub -> masking; hats louder than snare by > 3 dB -> level; whole crest < 10 dB -> over-limited; any layer with loudness 'high' and role perc/hat -> level; brightness 'low' everywhere -> no top end; etc.

## ableton/ (ADEHack 5.2)
- {"cmd":"set_send","track":...,"send":"A"|"B"|int,"level":0..1} -> {ok, sends:[{index,name,level}]}  (track.mixer_device.sends[i].value)
- browse: add roots "instruments","sounds","audio_effects","drums","midi_effects" with optional "query" (case-insensitive substring) and "depth" (default 2) -> {ok, root, items:[{name, is_folder, path:[...]}]} capped at 200
- load_device: exact match should prefer DEVICES (class) over presets; also accept "Ping Pong Delay"/"Echo"/"Simple Delay" (debug why they returned not found on this install: list the actual audio_effects names)

## lib/agent.js v6
- effort 'high'; analyze_recording(hum) returns up to 64 notes compactly; new tools: layer_samples, tune_sample, shape_sample, set_send, browse_library, mix_balance, review_mix; build_drum_layer gains humanize (0..1: timing jitter up to 12 ms and velocity jitter up to 15 at 1.0) applied server-side in stepsToNotes.
- PRODUCTION PLAYBOOK in the system prompt (coordinator supplies the text).
- QUALITY GATE: after any build/modify turn, run review_mix and fix 'high' issues before replying (max 2 fix rounds); report what the review found in technical terms.

# ---- v7: use each tool for what it is for + open-source toolbelt ----
Roles: Stability = sounds (loops, textures, restyle, one-shots as fallback) · Gemini = ears (production DNA, critique, labeling) · Claude = reasoning/orchestration · open-source (Demucs, basic-pitch, librosa, pedalboard, ffmpeg, rubberband) = analysis & processing.

## tools/py (Python 3.11 via uv; all permissive/open licenses; CPU only; 8 GB RAM Intel Mac)
- `tools/py/pyproject.toml` deps: demucs (MIT), basic-pitch (Apache-2.0), librosa (ISC), pedalboard (GPL-3), soundfile, numpy, torch CPU. Setup script `tools/py/setup.sh` (uv venv .venv --python 3.11; uv pip install ...). Pre-download demucs `htdemucs` weights in setup.
- CLI `tools/py/.venv/bin/python tools/py/adetools.py <cmd> --json ...` (always prints one JSON object on stdout):
  - `stems --in file --out dir [--model htdemucs] [--two-stems vocals|drums]` -> { stems: { drums, bass, other, vocals }: paths } (use --segment 7 to cap memory)
  - `analyze --in file` -> { tempo, beats:[sec], downbeats:[sec]|null, key:{ tonic, mode, confidence }, onsets:[{ time, strength }], groove:{ swing (0..1 estimate from 8th-note offbeat delay), microtiming:[deviation ms per 16th position 0..15 averaged], velocityProfile:[0..1 per 16th position] }, sections:[{ start, end }] (librosa segment/novelty, optional), duration }
  - `transcribe --in file [--onset 0.5] [--frame 0.3] [--min-note-ms 60]` -> { notes:[{ pitch, startSeconds, durationSeconds, velocity }], midiPath } via basic-pitch (local, no quota)
  - `process --in file --out file --chain '[{"type":"highpass","hz":200},{"type":"compressor","threshold_db":-18,"ratio":4,"attack_ms":5,"release_ms":80},{"type":"reverb","room_size":0.3,"wet":0.15},{"type":"limiter","threshold_db":-1},{"type":"gain","db":-3},{"type":"pitch","semitones":-2},{"type":"lowpass","hz":120},{"type":"saturate","drive_db":12}]'` -> { out, peakDbfs } via pedalboard
  - `master --in file --out file [--lufs -12]` -> { out, lufs, peakDbfs } (pedalboard compressor + limiter + loudness match)
- `lib/pytools.js` (Node): `pyAvailable()`, `stems(file, opts)`, `analyzeMusic(file)`, `transcribeLocal(file, opts)`, `processAudio(file, chain, outName)`, `masterAudio(file, lufs)`; spawns the venv python with a 10-minute timeout; errors carry stderr tail. Degrade gracefully when the venv is missing (clear "run tools/py/setup.sh" message).

## server ctx additions
- generateLoop({ prompt, bpm, bars=2, kind:'drums'|'texture'|'fx' }) -> Stability text-to-audio with duration = bars*4*60/bpm (min 6 s, loop prompt suffix "drum loop, {bpm} BPM, tight, dry, no vocals") -> { loop:{path,url}, kit:[{ kind:'kick'|'snare'|'hat_closed'|'perc', path, time }] } where the kit is sliced from the loop at onsets (classify) so all one-shots share one production context; for texture/fx no slicing.
- restyleMix({ prompt, strength=0.45, bars }) -> render current build -> Stability audio-to-audio -> { path, url } (a cohesive "produced" version to use as a texture layer under the drums or as reference)
- ears: productionDna(refPath) -> structured JSON via Gemini (drums: kick/snare/hat character words usable as Stable Audio prompts; groove: swing/feel; space: reverb/room; tempo/key guess; arrangement notes; 3 "what makes it sound expensive" observations); critiqueMix(renderPath, refPath?) -> structured JSON { groove, drums, lowEnd, topEnd, space, dynamics, arrangement, topFixes:[{ what, how (tool-level) }] } neutral/technical; labelPieces(paths[]) -> per piece { vowel|consonant|breath|noise, pitchedness, usableAs }
- groove templates: stepsToNotes(steps, swing, humanize, bpm, groove?) applies groove.microtiming[step%16] ms offsets and velocityProfile scaling when a template is given; lastBuild.groove stores the extracted template (from analyze on the reference drum stem or the beatbox)

## agent tools (lib/agent.js v7)
- separate_stems { which } -> ctx.stems -> stem paths registered as refs (ref#N "vocals of X") so later tools can address them
- analyze_music { which } -> ctx.analyzeMusic (tempo/beats/key/groove/sections) and stores groove template (ctx.setGroove)
- transcribe_audio: try local basic-pitch first (ctx.transcribeLocal), MuScriptor fallback
- process_audio { which|path, chain[], name } -> ctx.processAudio (pedalboard) ; master_preview { lufs } -> ctx.masterAudio on the latest render
- generate_loop { prompt, bpm, bars, kind } -> ctx.generateLoop ; restyle_mix { prompt, strength } -> ctx.restyleMix
- production_dna { which } -> ctx.productionDna ; critique_mix { reference? } -> ctx.critiqueMix(render, ref) ; label_pieces { paths[] } -> ctx.labelPieces
- build_drum_layer / update_layer: `useGroove: true` applies lastBuild.groove template
- PLAYBOOK: "TOOL ROLES" and "SAMPLING WORKFLOW" (reference song -> separate_stems -> production_dna + analyze_music on the drum stem (groove template) -> chop vocals (chop_sample) -> label_pieces -> tune chops to key -> pitched chop melody via build_melody_layer on a Simpler with the chop -> drums: generate_loop in the DNA's words and slice the kit, or Core kit + Stability layers -> apply groove template -> mix_balance -> review_mix + critique_mix -> fix -> master_preview for the demo bounce). Claude never guesses what a reference sounds like: it asks Gemini (production_dna) first.

# ---- v9: hear and read the producer's own session ----
## tools/capture (Swift, MIT AudioTee vendored) + lib/capture.js
- Build: `tools/capture/build.sh` clones https://github.com/makeusabrew/audiotee (MIT) into tools/capture/audiotee and runs `swift build -c release`; binary path exported by lib/capture.js (`captureAvailable()`).
- `captureLive({ seconds, pid?, outPath })` -> finds Ableton Live's pid (pgrep -f "MacOS/Live$"), spawns audiotee `--include-processes <pid> --stereo --sample-rate 44100 --chunk-duration 0.2`, pipes stdout (s16le stereo 44.1k after SRC, else f32le) into ffmpeg -> 44.1k stereo wav; stops after `seconds`; returns { path, seconds, pid, peakDbfs }. Errors: Live not running; permission denied (macOS "System Audio Recording" for the terminal/app hosting node) -> message with the exact System Settings path; silent capture (peak < -60 dBFS) -> { silent:true } with hint (Live not playing / wrong output device).
## ableton/ (ADEHack 5.4)
- {"cmd":"describe_set"} -> {ok, tempo, is_playing, loop:{on,start,length}, signature, scenes:[{index,name}], tracks:[{index,name,is_midi,color_index,mixer:{volume,pan,mute,solo,arm,sends:[...]}, devices:[{index,name,class_name,is_active}], clips:[{slot,name,length,is_playing,note_count,notes_preview:[{pitch,start,duration,velocity}] (first 16), is_audio, file_path?}], has_sound (any device), selected}], selected_scene, master:{volume}}
- {"cmd":"get_clip_notes","track":...,"slot":N} -> {ok, track, slot, length, notes:[{pitch,start,duration,velocity,mute}]} (all notes, cap 2000)
- {"cmd":"play_scene_for","index":N,"seconds":S} -> fires scene, schedules stop after S seconds -> {ok, stops_in_seconds}; {"cmd":"play_for","seconds":S} same for current playback (song.start_playing())
## server ctx
- captureLive({ bars=4, scene?, fromSelected? }) -> seconds = bars*4*60/bpm (+0.5 pre-roll) -> if scene given fire it (or play) via play_scene_for/play_for -> captureLive -> analyzeAudio -> { path, url, profile, bars, seconds, silent }
- live.describeSet() / live.getClipNotes({track, slot}) / importSample({ path, track, name, toneFix:{highpassHz?,lowpassHz?,gainDb?,compress?}, mode:'oneshot'|'loop' }) -> process (pedalboard chain or shape) -> load into Simpler on `track` (create if missing) -> { path, url, track, chain }
## lib/agent.js v9 tools
- listen_live { bars 1-16 (default 4), scene? } -> ctx.captureLive -> technical profile of what Live actually outputs + (if ears available) Gemini critique via ctx.critiqueCapture(path) = ears.critiqueMix on the capture; say explicitly "I listened to Live's output".
- describe_set {} -> ctx.live.describeSet (compact: tracks with devices, clip names/lengths/note counts, mixer); read_clip { track, slot } -> full notes compact.
- import_sample { which (ref#N), track?, name, toneFix?: { highpassHz, lowpassHz, gainDb, compress }, mode } -> ctx.importSample.
- PLAYBOOK "WORKING WITH THE PRODUCER'S SESSION": 'stuck', 'help me with this section', 'what do you think of my beat', 'finish this with me' -> describe_set -> listen_live (the scene they mean, default what is playing/selected) -> critique on the capture (+ production_dna if they name a reference) -> say in technical terms what the section does and lacks (energy curve, frequency gaps, repetition, groove) -> propose 2-3 moves -> build the agreed (or the first, if they said just do it) as scene B / new tracks only, never editing their clips -> listen_live again and compare before/after -> ask. 'I want this sound / something like this' -> synthesize 2 alternatives (or refine_sound from a ref) and place muted B. 'I have this sample, add it, fix its highs/lows' -> analyze_audio -> import_sample with a toneFix derived from the ratings (lowEnd high -> highpass; brightness low -> gentle high shelf via lowpass off / saturate) -> explain the numbers. The producer's clips, devices and mixer are theirs: read them, don't rewrite them unless asked.

# ---- v10: align with "Vision Studio product design" (Oct 21, @Aksh): rooms, explain-itself, level, variations, Analyse flow ----
## UI
- Room tabs above the composer: Create | Analyse | Tweak. Selecting a room prefixes the message with "[room: create|analyse|tweak]" and swaps the composer placeholder + chips; Analyse shows the attach button prominently; Tweak shows a strength slider ("how different": subtle 0.3 .. new sound 0.8) sent as "[strength: 0.5]".
- Level select next to Density: beginner | intermediate | pro -> prefix "[level: x]". Depth of explanations follows it.
- Every sound card and every assistant reply can carry a "How this was made" panel: rendered from `explanation` events (type:'explanation', {path?, brief, choices:[...], steps:{ableton:[...], logic:[...]}, level}). Collapsed by default, one click to open. Variation groups: events {type:'variations', group, items:[{path,url,label,match?}]} render as A/B/C cards with a "use this" button that calls /api/live/sample with the path (track from the group).
## server
- synthesize(...) gains `variations` (1-3): runs N generations with different seeds in parallel, returns files for each (kind 'oneshot', label A/B/C); ctx.synth({ variations }) returns { variants:[{path,url,seed,label}] } when > 1.
- ctx.restyleAudio({ which path, prompt, strength }) -> Stability audio-to-audio on ANY project audio (uploads/refs), not only our render -> { path, url }.
- ctx.explain({ path?, brief, choices, steps, level }) -> stores in lastBuild.explanations[path||'turn'] (persisted) and emits the 'explanation' event; GET /api/explanations.
- ctx.genreGuide({ genre }) -> Claude text (claude-opus-5-5, short: 5 lines history, 5 artists/tracks to study, 3 production hallmarks) with the line "from model knowledge, verify names" unless SOUNDCHARTS_API_KEY is set (then not implemented yet: say so).
## lib/agent.js v10 tools + rules
- synthesize_sound gains variations 1-3 (default 1; use 3 for "one specific sound" requests and in Tweak room) and returns variants; after judging (ears) or analysis, the agent presents A/B/C with one-line differences and recommends one; places the recommended one, says "say 'use B'".
- restyle_audio { which, prompt, strength } -> ctx.restyleAudio (Analyse room alternatives: each alternative guided by ONE suggestion: warmer / more swing / lo-fi ...).
- explain_result { path?, brief, choices:[{what, why}], steps_ableton:[...], steps_logic:[...] } -> ctx.explain. RULE: after every created or changed sound and after every build, call explain_result once (per result or per turn) with depth by [level]: beginner = plain words + 5-7 steps, intermediate = device names + parameter values, pro = terse, numbers only.
- genre_guide { genre } -> ctx.genreGuide.
- ROOMS: [room: create] = default behaviour; [room: analyse] = the Analyse report flow: analyze_audio + analyze_music (+ separate_stems to list instruments present) -> feedback in producer terms (instruments, rhythm, arrangement; e.g. "the hats mask the vocal range; the groove is very straight for this genre") -> 2-3 alternatives via restyle_audio each guided by one suggestion -> compare_audio original vs each -> genre_guide -> explain_result; [room: tweak] = one sample in: 3 variations (synthesize_sound from the sample with the given strength as audio-to-audio, or refine_sound), each with "what changed", plus 3 similar-sound suggestions.
- LEVEL: default intermediate; "The agent asks only what's missing, at your level, and everything is skippable": at most one clarifying question, and only when the result would differ materially; otherwise proceed with stated assumptions.

# ---- v11: musical accuracy + production-first feedback (feedback from a real producer, 2026-10-21 17:10) ----
Producer feedback: style not accurate (2000s hip hop sounded generic); no bass / no guidance on bass TYPE; wants more snaps/percussion and sound design; feedback must be about production (sonic/pattern/synth/arrangement), not mixing/mastering; too much irrelevant info; MIDI should appear on the Arrangement timeline.

## knowledge/ (research deliverable) + lib/knowledge.js
- knowledge/genres/<slug>.md, one per style, written from web research (cite sources at the bottom): 2000s hip hop (East Coast boom-bap evolution, West Coast G-funk/Dr. Dre 2001 era, Dirty South/crunk, Timbaland/Neptunes minimal syncopation), 90s boom bap, trap, drill, lo-fi hip hop, neo-soul, deep house, tech house, techno (Berlin/Detroit), UK garage/2-step, drum & bass/jungle, afrobeats, reggaeton/dembow, dubstep/UK bass, synthwave. Each file has the SAME sections: Era & tempo range · Drum machine / sample sources and HOW each element sounds (kick, snare/clap/snap, hats, perc) written as Stable Audio-ready descriptions (SFX form) · Pattern archetypes: 2-4 named 16-step maps per element with velocities (e.g. "kick: 0:120 7:100 10:110 | snare: 4:118 12:118 | snaps on 4,12 layered w/ snare | hats 8ths 95/60 w/ 16th fills on 14-15") and the typical swing · Bass: TYPE (808 glide / Moog-style synth / picked electric / sub sine), register, pattern relationship to the kick, typical Live preset names to try · Harmony & keys: chord language, typical progressions, voicings, instruments (Rhodes, strings, pluck, brass stabs, whistle lead, talkbox...) · Hooks & melodic devices · Textures & FX (vinyl crackle, risers, reverse cymbals, vocal chops, ad-libs) · Arrangement form (intro/verse/hook lengths, drops, fills every N bars) · Mix signature (2 lines max) · Reference artists/tracks (names only, "verify") · Common mistakes that make it sound generic.
- knowledge/live-presets.md: for each genre above, concrete Live 10 Standard Core Library preset/kit names (from browse_library on this install) that fit: drum kits (e.g. "808 Core Kit.adg"), bass presets, keys/pads/leads, plus MIDI effect ideas.
- lib/knowledge.js: `listGenres()`, `matchGenre(text) -> slug|null` (aliases: "2000s hip hop", "y2k rap", "g-funk", "boom bap", "lofi", "lo-fi"...), `getBlueprint(slug) -> { slug, title, markdown, summary (<= 1200 chars for prompt injection) }`.
- server: when the user text matches a genre (or [genre: x] prefix), inject "[genre blueprint: <summary>]" into the user turn; agent tool genre_blueprint { genre } returns the full markdown.

## ears.js (production-first prompts)
- critiqueMix / critiqueCapture rewritten: output JSON { styleRead: "<what genre/era it actually sounds like and why>", styleAccuracy: { target: "<genre if given>", verdict: "on target|close|off", why: "<sound/pattern reasons>" }, drums: "<kick/snare/hat character + pattern feel>", bass: { present: bool, type: "<what it is>", suggestion: "<what TYPE of bass this style wants and how it should move vs the kick>" }, harmonyMelody: "<instrument choices, chord language, hook presence>", soundDesign: "<layering, texture, ear candy missing: snaps, shakers, vinyl, risers>", groove: "<swing, pocket, variation, fills>", arrangement: "<repetition, sections, energy>", moves: [3-5 concrete PRODUCTION moves, each naming the element, the sound, the pattern or the device], mixNotes: "<1 line max, only if something is clearly broken>" } — no LUFS/crest/dB unless asked; `{ mixDetail: true }` option adds the old technical section.
- optional `genreTarget` param (the blueprint summary) so Gemini judges style accuracy against it.

## lib/agent.js v11
- REPLY FORMAT (production-first): line 1 what was built/changed in musical terms; then 2-4 bullets on SOUND & PATTERN (which sounds, how they were designed, what the patterns do, what the bass is and how it moves, hook); 1 line on style accuracy vs the blueprint; next steps as before; NO mix/LUFS/crest/dB numbers unless [room: analyse] or the user asks about the mix; the review gate still runs but only its 'high' issues are mentioned, in words ("hats were drowning the snare, pulled them back").
- FEEDBACK rule rewritten: production-first using critique_capture / critique_mix JSON (styleRead, bass suggestion, moves); measurements only on request.
- STYLE rule: when a genre is named, call genre_blueprint first (or use the injected summary), follow its drum sounds, pattern archetypes, bass TYPE, chord language, percussion/textures (snaps, shakers, vinyl), arrangement; choose Live presets from knowledge/live-presets.md; always include a bass unless told not to; add at least one ear-candy/percussion layer at standard density.
- DENSITY standard = kick, snare (+snap/clap layer), hats, bass, +1 perc/texture, +1 harmonic/lead = 6 (hip hop/pop); minimal = 3; rich up to 8.
## server/UI
- Arrangement mode default ON (new installs), rating cards hidden under a "measurements" toggle and never shown for sounds/captures unless [room: analyse]; profileCard handles string ratings "high (17.3 dB crest)"; capture: pre-roll until Live reports is_playing and the tap has non-silent audio, then record N bars; trim leading silence before analysis.

# ---- v12: Stability composes rhythms; genre-true kits via Gemini judging; fewer tracks (Drum Rack); more genres; vocal pitching ----
## ableton/ (ADEHack 5.6) — Drum Rack pads
- {"cmd":"load_to_pad","track":...,"note":36..99,"path":"/abs.wav","name"?:"Kick"} -> ensure a Drum Rack on the track (load_device "Drum Rack" if none), select the rack and select_drum_pad for `note` (RackDevice.view.selected_drum_pad = drum_pads[note]), then browser.load_item(sample) so Live creates the Simpler chain in that pad; set chain name; reply {ok, track, note, pad:{name, has_chain}, device_index}. If Live refuses pad-targeted load, fall back to: hotswap_target = pad's existing Simpler when the pad already has one; else report ok:false with the exact behaviour observed so we know. Also {"cmd":"pad_info","track":...} -> {ok, pads:[{note,name,has_chain,sample}]}.
## server ctx
- loopToPattern(loopPath, { bpm, bars }) -> onsets (pytools analyze when available, else rhythm.js) -> lanes kick/snare/hat_closed/perc(+hat_open if detected) with velocities from onset strength, quantized to 16ths, plus groove { swing, microtiming[16], velocityProfile[16] } -> PatternSchema
- generateRhythm({ prompt, genre, bpm, bars }) -> generateLoop(kind drums) -> loopToPattern -> { loop, kit (sliced sounds), pattern, groove } ; setGroove(groove)
- designKit({ genre, bpm, bars, candidates=2 }) -> blueprint summary -> 2 Stability loops with blueprint-derived prompts (different seeds/wording) -> Gemini judges each vs blueprint (critiqueMix with genreTarget -> styleAccuracy.verdict + a 0-10 "authenticity" score asked explicitly) -> pick best -> slice kit + loopToPattern -> { best, candidates:[{path, verdict, score, why}], kit, pattern, groove }
- tuneSample gains { preserveFormants } (rubberband formant=preserved) — default true when role is vocal/vox/chop; clamp vocal shifts to ±3 st unless `allowLarge`
- live.buildKit({ name:'Drums', kit:[{ note, samplePath, label }], pattern (GM-mapped or lane->note map), bars, slot }) -> load_to_pad for each sound, one clip on the Drum Rack track with per-lane notes at the pad notes; falls back to per-lane tracks when load_to_pad is unavailable, reporting which path was used
## knowledge round 2 (research fork)
- Add blueprints: jazz-hop/jazz, soul-rnb (90s/2000s R&B + neo), edm-bigroom-progressive, future-bass, pop (modern), funk-disco, ambient, trance; aliases "rap" -> hiphop-2000s (unless era given), "r&b", "edm", "big room", "nu-disco"...
- Each blueprint gains a "Stable Audio loop prompts" section: 3 proven prompt bodies for a genre-true drum loop (guide grammar) + 1 texture/pad prompt + 1 bass/one-shot prompt set.
## lib/agent.js v12
- Tools: generate_rhythm { prompt?, bpm, bars } -> ctx.generateRhythm; design_kit { genre?, bpm?, bars?, candidates 1-3 } -> ctx.designKit; build_kit { name?, kit:[{note,samplePath,label}], pattern, bars, slot? } -> ctx.live.buildKit; load_to_pad { track, note, samplePath, label }.
- TRACK HYGIENE rule: reuse role tracks (Drums (Drum Rack), Bass, Keys, Lead, Pad, Vox, FX); never create a second track for the same role in the same set; a new beat in an existing set = new SCENE with new clips and (if the sound must change) new pads/presets on the same tracks; ask before replacing when the user said "keep"; cap: 8 tracks total unless told otherwise.
- GENRE-TRUE DRUMS rule: when a genre is named, prefer design_kit (Stability candidates judged by Gemini vs the blueprint) over generate_loop/synthesize_sound; use its pattern + groove as the drum MIDI; blueprint pattern archetypes only to add variation/fills.
- VOCAL rule: pitch-shift vocal material at most ±3 st (formants preserved); 2000s hip hop vocals = mouth sounds / ad-libs / shouts (blueprint), not sung chops; chop melodies only for soul/lofi/garage styles where the blueprint says so.

# ---- v13: compose a full track with Stable Audio 3, deconstruct it into an editable Live session ----
## server ctx.composeTrack({ genre, bpm?, bars=16 (8-32), prompt?, candidates=1 })
1. prompt: `TrackType: Music, Genre: <title>, <blueprint loop prompt body>, full arrangement with intro, verse and hook, <bpm> BPM` (or user prompt) -> textToAudio stable-audio-3, duration = bars*4*60/bpm (clamp 20..180 s) -> candidate(s); Gemini critiqueMix(genreTarget) -> verdict/score; pick best (regenerate once if 'off' and candidates>1).
2. stems via pytools (Demucs htdemucs, segment 7) -> drums/bass/other/vocals (register as refs "drums of <track>" etc.).
3. drums stem -> sliceKitFromAudio (kick/snare/clap/hat_closed/hat_open/perc best hits, 2 alternates) + loopToPattern(drums stem, bars) -> full-length multi-bar pattern + groove.
4. bass stem -> transcribeLocal (onset 0.6, frame 0.4, min 80 ms) -> monophonic cleanup (keep the lowest note per onset, pitches 28-55, quantize to 16ths, min 1/16) -> bass notes.
5. other stem -> transcribeLocal -> polyphonic notes (pitches 48-84, quantize to 8ths, cap 6 simultaneous) -> keys/chord notes; optional: vocals stem -> chop pieces registered for later use.
6. analyzeMusic(full track) -> sections -> convert to bar ranges; choose A = section containing bar 1-8 (or bars 1-8), B = the most different later section (or bars 9-16).
7. Build: Drums via buildKit (Drum Rack; slot 0 = A bars, slot 1 = B bars pattern slices), Bass via buildMelody with blueprint preset (load_device) and A/B note slices, Keys likewise; optional Texture = other stem as a warped loop layer (buildLoopLayer, muted by default); set tempo; scene names "<Genre> A" / "<Genre> B"; mix_balance; set colors; return { track:{path,url}, verdict, stems, kit, pattern, bassNotes, keysNotes, sections, built:{...} , timings }.
- Progress: emit tool_done events per stage ("composing 16 bars", "judging", "separating stems", "extracting drums MIDI", ...), since this takes 3-6 minutes on this Mac.
## agent tool compose_track { genre?, bpm?, bars 8-32, prompt?, candidates 1-2 } ; PLAYBOOK: for "make me a <genre> beat/track" with Demucs available, compose_track is the primary path (then refine with the usual tools); design_kit when only drums are wanted; say what was derived from the generated track vs authored.

# ---- v14 (22 Oct 2026, final day): capture from bar 1, tempo intent, enhance v2, no stacking, slot pool, Gemini keys, Training mode ----
## ableton/ (ADEHack 5.8)
- {"cmd":"set_position","beat":<float>} -> song.current_song_time = beat (0.0 = bar 1); reply {ok, position:<beats>, bar:<int>, beat_in_bar, beats_per_bar, is_playing, readback}. Alias {"cmd":"jump","bar":<int>} (bar N -> (N-1)*beats_per_bar; both accept either field, beat wins). position / bar come from the REQUESTED beats; `readback` is the raw current_song_time, which Live 10 reports stale while the transport is stopped (the seek itself lands). play_for / session_record with from_* reply the same way.
- arrangement_record / session_record / play_for accept optional from_beat | from_bar: seek first, then record/play, so captures start at bar 1 instead of the playhead.
- {"cmd":"set_tempo","bpm":<n>,"warp_clips":true} -> before changing tempo, warp every unwarped audio clip at the CURRENT tempo (Session slots always; Arrangement clips only where Track.arrangement_clips exists, Live 11+; beats mode when the clip or track name has a whole drum word, complex_pro otherwise, complex as fallback) -> {ok, previous_tempo, tempo, warped:[{track, clip, where:"session"|"arrangement", slot|start_time, mode}], unwarped_left:[{..., error}], arrangement_scanned:<bool>, note?}. On Live 10 arrangement_scanned is false and the note says Arrangement audio keeps its speed. bpm outside 20..999 -> ok:false. Without the flag: {ok, previous_tempo, tempo}.
- VERSION 5.8; version/ping reply lists the new cmds. Everything from 5.7 (non-destructive recording/loading/clip creation, name-first lookup, undo, clip_info, set_clip_warp, load_audio_clip, meters, set_arm, session_record) unchanged.
## server ctx (makeCtx)
- live.setPosition(beat) / live.jump(bar) -> the commands above. scriptAtLeast('5.8') gates them; older scripts: captures run from the playhead and the result carries note "capture from playhead (script < 5.8)".
- setTempo({ bpm, warpClips }) (old positional setTempo(bpm) still works) -> 5.8: set_tempo warp_clips; older: describe_set full -> set_clip_warp on each unwarped audio clip -> set_tempo. Returns { bpm, warped, unwarpedLeft }.
- enhanceProject v2: capture 8-16 bars from bar 1 -> Gemini describes -> Claude writes the Stable Audio prompt -> whole-mix audio-to-audio = "AI Enhance" (reference + seed) -> Demucs stems of the capture -> per-stem audio-to-audio: drums 0.8 -> "AI Tops" warped loop clip, other 0.6 -> "AI Texture" clip, bass -> transcribed MIDI on a Live bass preset "AI Bass", clean hit-pipeline "AI Kit" -> each layer compareAuthenticity vs its original stem (order-swapped A/B; one more take when the original wins at confidence >= 0.7, the better take kept) -> result { capture:{url, seconds, bars, from}, heard, prompt, strength, enhanced:{url, path, ref, clip}, built:{tops, texture, kit, bass} (each {track, loop, bars, strength, seededFrom, score, retried?} | {skipped} | {error}), stems, stemPeaks, scores, layers:[{track, status:"built"|"skipped"|"error", role?, score:0-10 (judge confidence x10), verdict:"better"|"weaker"|"even", confidence, lite, judge:<provider>, why, scoreNote, error?}], presentation:{audible, muted, verified, warning?}, scoreNote?, audition, note, listening, ms }. New tracks only (AI Enhance, AI Tops, AI Texture, AI Kit, AI Bass; kits built with fire:false and muted immediately); user faders untouched.
- No stacking: every enhance layer starts muted except the audited one; after the build describe_set asserts mute/solo and fills `presentation`.
- Slot pool: SLOT_POOL env (default 8) indexed slot files per role; nextSlot(role) recycles the oldest slot not loaded in any Live track (sample/pad registry) when the pool is exhausted; errors only when every slot is in use ("remove_layer or replace_sound first").
## lib/ears.js
- Keys: GEMINI_API_KEY + GEMINI_API_KEYS (comma list); daily-quota errors block (key, model) pairs and rotate to the next key on the same model before falling to lite models. GEMINI_PAID=1 | GEMINI_TIER=paid: no lite fallback, hard error instead.
- Exports: earsStatus() (string, unchanged for the health badge) + geminiStatus() -> { activeKeyIndex, keysTotal, flashAvailable, blocked:[{key, model, until}], badKeys:[<index>], tier } + geminiStatusText() -> one line ("ok (key 1/1, flash)", "flash quota out on all N key(s): lite judges only, lower confidence", "every Gemini key was rejected ..."). A key answering 401/403/credits is marked bad for the run and skipped on every model; its error no longer blocks the lite fallback. LITE_SCORE_NOTE = scoreNote = "lite judge, lower confidence" when a lite model answered, absent otherwise.
## lib/agent.js
- set_tempo { bpm, warpClips? (default true), confirmed? }; TEMPO INTENT rule, enforced in the tool: in a set with user tracks and no confirmed:true it returns { ok:false, needsConfirmation:true, userTracks:[...], message } and nothing moves; the agent passes confirmed:true only when the user named a BPM / said "slow it down / speed it up / change the tempo", otherwise asks in one line; reports unwarpedLeft; never during enhance_project or project scan.
- set_position { bar } -> ctx.live.jump(bar) (guarded for < 5.8). Capturing tools document "recording starts at bar 1 on 5.8+".
- CREATOR IN CONTROL: every layer build ends with quoted "keep" / "another take" / "undo" (UI turns them into chips); enhance replies say what is audible from `presentation`.
- GENRE HISTORY: first mention of a genre in a session -> 2 sentences of history + 3 references from the blueprint (lib/knowledge.getBlueprint exposes "history" and "artists" sections when the file has them).
## server routes
- POST /api/training/start { level:"beginner"|"intermediate"|"advanced", genre?, bpm? } -> { id, audioUrl:"/training-audio/<id>.wav", level, genre, title, bpm, key (intermediate+), bars, layers, seconds, hints, brief } (STABILITY_LOOP_MODEL, default stable-audio-3; beginner 4 bars drums, intermediate 8 bars drums+bass, advanced 8 bars drums+bass+chords/texture; hints shrink with level).
- POST /api/training/check { id, bars?, deep? } -> captureLive from bar 1 (5.8+) -> { id, level, capture:{url, seconds, bpm}, tempo:{target, attempt, diff}, drums:{bars, groups, overall, yours} | {error}, bass:{measured, agreement, coverage, rootMatch, targetRoot, attemptRoot, targetNotes, yourNotes} | {measured:false, note|error}, ears:{closer, heard, lite, scoreNote} | {error} | null, note? ("recorded from the playhead (ADEHack < 5.8)..."), score 0-100, closest:[...], off:[...], nextHint, scoreNote?, attempts, best } (tempo + kick/backbeat/hats F1 at +-1 step via loopToPattern + bass pitch-class match per beat for intermediate+ via Demucs + basic-pitch + Gemini critiqueMix vs the target).
- POST /api/training/reveal { id } -> builds the target's parts on muted tracks (Target Drums = sliced kit + MIDI grid; Target Bass = transcribed notes on the blueprint's bass preset, intermediate+; Target Keys = other stem as a warped clip, advanced; Target Mix = the whole example as a clip) -> { id, built:{tracks:[...], drums?, bass?, drumsError?, bassError?, keysError?, mixError?, stemsError?}, muted:[...], how:[...], howText, presentation:{audible:[], muted:[...]}, note }.
- GET /api/training/levels -> { levels }, GET /api/training/:id -> publicView(session) (never targetPath / workPath / stems; pattern, patternWords, bassNotes, key, prompt only once revealed, beginner sees patternWords, intermediate sees key), GET /api/training/:id/progress -> { id, busy, progress:[{at, label}] }; `/training-audio` static. Errors are { error } with 500 (404 for an unknown id).
- Mounted by `mountTraining(app, { makeCtx, tmpDir: TMP })` from lib/training.js (server.js:1987; the ctx methods it uses are listed at the top of that file).
- GET /api/health additionally reports `gemini: geminiStatus()` (object, see lib/ears.js) and `geminiStatus: geminiStatusText()` (one line) plus the 5.8 handshake (`live.running`, `live.installed`, `live.restartNeeded`).
## public/index.html
- Layer cards: Play (solo + play via audition), Keep (unmute), Another (refine / another take), Undo (undo_sound / remove_layer); buttons disabled while a turn runs. Audible/muted state per layer + "what you are hearing" line from `presentation`. scoreNote / judge-model badge next to every score. Projector mode toggle (localStorage, P key). "Training" link to /training.html. Through /api/chat as canned sentences: layer Play / Keep / Another / Undo, the quick-action chips (Play it, Listen and judge, Keep it, ...), quoted-move chips, "Listen to Live" and the project card's moves. Direct endpoints: Show in Live -> POST /api/live/show, Lay out in Arrangement -> POST /api/live/arrange {bars:8}, Work on my Live project -> POST /api/project/scan, Reset -> POST /api/chat/reset, Arrangement mode -> POST /api/settings, file attachments -> POST /api/upload; a dropped stream recovers from GET /api/chat/last.
