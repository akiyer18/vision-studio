# Vision Studio spec

Single source of truth for Cursor. Every phase prompt refers to sections in this file.
If something is not covered here or in .cursor/rules, ask before deciding.

Vision Studio is a helper, not the author. The agent only works from what the producer said, played, or chose. It never changes a stated answer, never adds musical ideas the producer did not give, and every suggestion shows its reason so the producer can override it. Claude may only express what the user said or what was detected. It must never steer the song somewhere new.

## 1. Contracts (packages/contracts)

```
SlotSource      = "you" | "detected" | "guessed" | "reference"
OutputChoice    = "drums" | "chords" | "bass" | "melody" | "texture" | "all_layers" | "full_mix"
AnswerAction    = "answer" | "you_decide" | "skip" | "skip_all"
InputType       = "text_only" | "hum" | "vocal" | "instrument_loop" | "drum_loop" | "full_track" | "midi"

SlotValue       { value: string, source: SlotSource, reason: string, confidence: number 0..1 }
TraceStep       { step: string, detail: string }            // shown in the agent trace
AudioFeatures   { input_type: InputType, key?: string, mode?: string, bpm?: number,
                  chords?: string[], instruments?: string[], confidence: number }

SongBrief       { slots: Partial<Record<SlotName, SlotValue>>, output: OutputChoice[],
                  questions_asked: integer, skipped: SlotName[] }

Question        { slot: SlotName, text: string, options: string[], index: integer, max: integer }

TurnRequest     { session_id: string, text?: string, audio_features?: AudioFeatures,
                  answer?: { slot: SlotName, action: AnswerAction, value?: string },
                  output?: OutputChoice[], overrides?: Record<SlotName, string> }

LayerPrompt     { layer: string, prompt: string, negative: string,
                  seeds: [number, number, number], kb_sources: string[] }

TurnResponse    { status: "question" | "ready", question?: Question, brief: SongBrief,
                  prompts?: LayerPrompt[], progression?: { roman: string[], chords: string[] },
                  trace: TraceStep[] }

RenderJob       { session_id, layer, prompt, negative, bpm: integer, bars: integer (default 8),
                  seed: integer, variant: integer, take: integer (default 1), init_audio?, noise?: number, lora? }
RenderResult    { layer, variant: integer, path, seconds, bpm: integer, detected_key?, detected_bpm?: number }
```

Semantics:
- An absent SongBrief slot means that slot is not yet known.
- Source "detected" is for values read from uploaded audio, including a full track. Source "reference" is reserved for a song looked up by name later.
- "you_decide" fills the slot with the default, source "guessed", reason from the default rule.
- "skip" does the same and prefixes the reason with "skipped: ".
- "skip_all" fills every remaining slot with defaults and returns status "ready".
- Edited prompts in the UI are sent back as overrides of the LayerPrompt text at render time.

## 2. Slots (services/agent/slots.yaml)

| slot | impact | ask when | question | options |
| --- | --- | --- | --- | --- |
| output | 1.0 | only if the UI did not set it | What would help most right now? | drums, chords, all layers separately, full song |
| mood | 0.9 | not found in text, lyrics or reference | What feeling should this carry? | joyful, peaceful, longing, tense |
| energy | 0.8 | not found | Should it breathe slowly or make people move? | slow and breathing, steady, make people move |
| world | 0.7 | not found | What sonic world do you imagine? | warm and intimate, wide and cinematic, dark and electronic, bright and danceable |
| key | 0.5 | text input only, never when audio or MIDI gave a key | Any colour in mind for the harmony? | minor, major, not sure |
| style | 0.5 | no reference given | Is there an artist or song near this idea? | free text |
| palette | 0.3 | rarely | Any instruments you hear in it? | free text |
| structure | 0.2 | rarely | How long should it be? | 4 bars, 8 bars, 16 bars |
| must_keep | 0.4 | audio input only | What must stay exactly as it is? | everything, the melody, the rhythm, the chords |
| tempo | 0 | never | never asked | |

Asking rule: score = impact x (1 - confidence). Ask the highest score above 0.35. Max 5 questions.
Tempo is a real slot (value, source, reason, confidence) and it shows in the brief. It is never asked. A stated tempo wins over a measured one, and a measured tempo wins over a derived one (section 3 and section 10).
First question when the input is almost empty: "What is this song about?" (free text, then re run extraction).
Almost empty means no audio and no MIDI, and the text is blank or a single word that matches no keyword.
The question is filed under the mood slot, because a question has to name a slot. Answering major or minor on the key question keeps the preset root and changes the mode. "not sure" uses the preset key.

## 3. Defaults and presets

| mood | energy | world | key and mode | BPM | progression |
| --- | --- | --- | --- | --- | --- |
| joyful | make people move | bright and danceable | C major | 124 | I V vi IV |
| peaceful | slow and breathing | warm and intimate | C major (Lydian colour) | 72 | Imaj7 IVmaj7 |
| longing | slow and breathing | warm and intimate | D minor | 76 | i VI III VII |
| tense | steady | dark and electronic | E minor (Phrygian colour) | 110 | i bII |

Tempo, in order: what the producer said, then what the audio measured, then derivation. Derivation when neither is present: slow and breathing 76, steady 96, make people move 122,
then nudge halfway toward the mood preset BPM: round((energy BPM + preset BPM) / 2).
When those two BPMs already agree and the mood is longing, the reason is
"76 BPM because slow tempos read as sad". Every default carries a one line reason.
Mood with no signal defaults to peaceful. Energy, world, and key then follow that preset.
Output defaults to all_layers ("all layers separately"). full_mix is used only when chosen.
Other empty slots: style "no reference", palette "no preference", structure "8 bars",
must_keep "everything" when audio was uploaded and "nothing" otherwise.

Mock text extraction keywords (MockProvider, and the offline fallback when Bedrock is unavailable):
- longing: miss, lonely, sad, rain, lost, heart, night drive
- joyful: happy, sun, summer, dance, party, celebrate
- peaceful: calm, peace, morning, sea, soft, sleep
- tense: dark, fear, tense, storm, chase, anger
- energy high: dance, party, run, club, fast

## 4. Prompt compiler

Order (from the Stable Audio 3 prompt guide): track type, genre, instruments and rhythm, mood, arrangement and production, BPM.

```
Single layer: TrackType: Instrument, {layer descriptor}{ in KEY for tonal layers}, {mood words}, {energy words}, {bpm} BPM
Full mix:     TrackType: Music, {world mix descriptor} instrumental in {key}, {mood words}, {energy words}, {bpm} BPM
Negative:     the other layers plus vocals (full mix: vocals only)
```

Mood words: longing "melancholic, late night, intimate"; joyful "bright, uplifting, euphoric";
peaceful "calm, tender, soft"; tense "tense, brooding, urgent".
Energy words: slow "gentle dynamics, slow build"; steady "steady groove"; high "driving and energetic".

| world | drums | chords | bass | melody | texture | full mix |
| --- | --- | --- | --- | --- | --- | --- |
| warm and intimate | soft brushed drum kit, sparse lazy groove | warm felt piano chords with soft strings | deep round sub bass | gentle muted guitar lead | vinyl crackle and soft room ambience | felt piano, brushed drums and deep sub bass, warm tape production |
| wide and cinematic | big roomy toms and soft cymbal swells | wide string pads and grand piano chords | low cello and sub bass | airy synth lead | long reverb swells and risers | wide strings, grand piano and big reverb |
| dark and electronic | tight electronic kit, deep kick, crisp hats | dark analog synth pad chords | distorted sub bass | detuned saw lead | metallic hits and cold noise sweeps | dark synths, deep kick, distorted sub and cold reverb |
| bright and danceable | four on the floor kick, open hats, claps | bright plucked synth chords | punchy synth bass | catchy vocal chop style synth lead | white noise risers and sparkles | bright plucks, punchy kick and synth bass, clean modern production |

Anchor term for each layer and world. The anchor is the main instrument, it already appears in that descriptor, and a polished prompt must still contain it (section 10):

| world | drums | chords | bass | melody | texture | full mix |
| --- | --- | --- | --- | --- | --- | --- |
| warm and intimate | drum kit | piano | sub bass | guitar lead | vinyl crackle | piano |
| wide and cinematic | toms | string pads | cello | synth lead | reverb swells | strings |
| dark and electronic | kick | synth pad chords | sub bass | saw lead | metallic hits | kick |
| bright and danceable | four on the floor | plucked synth chords | synth bass | synth lead | risers | synth bass |

Wide cinematic drums use "toms" because that is the instrument named in the descriptor. Each layer gets three seeds. The base is a hash of layer, mood, world, key, and BPM, plus RenderJob.take.
Take 1 is the default and stays reproducible. A later take changes the seeds.
kb_sources lists the documents used (in mock mode: the preset and world names).

## 5. Theory engine

Progressions to chords: D minor i VI III VII = Dm Bb F C; E minor i VI III VII = Em C G D;
E minor i bII = Em F; C major I V vi IV = C G Am F; C major Imaj7 IVmaj7 = Cmaj7 Fmaj7.
Support any key by transposing. MIDI: chords as close voiced triads around C4, one chord per bar,
bass as roots around C2, velocity 80 to 100. Detected audio keys replace the preset key.

## 6. Audio and files

- WAV, 44.1 kHz, 16 bit, stereo. Length = bars x 4 x 60 / BPM (8 bars at 76 BPM = 25.26 s).
- The section name is verse. Names: verse_{layer}_{bpm}bpm_{bars}bars_v{n}.wav, for example verse_drums_76bpm_8bars_v1.wav.
- Session folder data/sessions/{session_id}/:
  - audio/: the upload. webm or opus is converted to 44.1 kHz stereo WAV with ffmpeg (brew install ffmpeg).
  - renders/: rendered WAVs.
  - midi/: verse_chords_{bpm}bpm_{bars}bars.mid and verse_bass_{bpm}bpm_{bars}bars.mid.
  - export/: the picked variation of each layer, variation 1 when that layer was not picked, and both MIDI files.
- POST /upload is multipart: session_id, input_type, and the file. Limit 50 MB. librosa reads tempo and key and the response is AudioFeatures. Basic Pitch for audio to MIDI comes later.
- POST /turn sends a TurnRequest.
- POST /render sends { session_id } and builds three RenderJobs per selected layer at take 1.
- POST /regenerate sends { session_id, layer } and re-renders that layer at the next take.
- POST /export sends { session_id, picks? }. picks maps a layer name to a variation number. The response is { files }.
- GET /files/{session_id}/{path} serves a file from that session folder, including renders/, midi/ and export/.
- Chords are close voiced: the lowest tone is the chord tone nearest C4 and the other tones stack above it. Bass is the root nearest C2. One chord per bar. A progression shorter than the bar count repeats. MIDI notes use velocity 90. Rendered bass moves velocity from 80 to 100 with the seed.
- MockRenderer: synthesized drums, sine pad chords, root note bass, and a filtered noise texture. Melody is the top tone of the chord voicing. Variations differ by seed (pattern density, voicing, filter).
- Full mix sums drums, chords, bass and texture. Each of those layers is peak-normalised to about −1 dBFS first. A limiter then holds the sum at about −0.1 dBFS, so the mix peak stays below 0 dBFS.

## 7. Design

The studio is a guided flow. One step is on screen. Colour marks a layer. Chrome stays quiet. The current step is derived from the session: idea until a turn exists, questions until the brief is ready, the prompt until a build starts, sound while takes are in and Play has not been pressed, and export after Play or once a folder listing exists. It is not stored as its own index.

| token | hex | use |
| --- | --- | --- |
| Desk | #3F3832 | ground, transport, conversation, trace |
| Lamp | #F6F1E8 | primary text on Desk, the Build button, the playhead, the focus ring |
| Dust | #C4B8A8 | secondary text on Desk |
| Rule | #6E655C | lane outlines, dividers, unset ticks. Never text |
| Fault | #F3C1B6 | errors on Desk |

Lane hues are for the lane rule, the clip fill, that layer's chip, and the trace mark. Labels on Desk stay Lamp.

| lane | hex | note |
| --- | --- | --- |
| Drums | #B84532 | |
| Chords | #D7A441 | light fill: waveform and the clip label use Desk |
| Bass | #1F6E5C | |
| Melody | #3D62C4 | |
| Texture | #7A4EA8 | |
| Full mix | none | Lamp on Desk, with a double rule |

Build is a Lamp button with Desk text. It is not a coloured accent.

Type: Instrument Sans for the interface, including the trace. Tabular numerals on tempo, bars, and seeds. Instrument Serif only for the tempo and the key. Body is `clamp(15px, 0.42vw + 10px, 22px)`. Lane names are `clamp(17px, 0.7vw + 8px, 32px)`. Tempo and key are `clamp(48px, 3.2vw, 112px)`. Sentence case. No all caps. No condensed face.

Focus is a 2px Lamp outline, offset 2px. One motion: when a build finishes, a Lamp playhead sweeps left to right and the lanes fill behind it. Reduced motion fills the lanes in place. Any other motion answers a user action.

The first screen says "Turn a feeling into editable layers for your song." Three doors: Describe an idea, Drop or record a sound, and Try a 30 second demo. The demo runs scenario A. Send the idea is the only primary button. While a reading waits for confirmation, Confirm this reading is the only primary.

A stepper at the top lists Idea, Questions, Prompt, Sound, and Export. Each line is the step name, a full stop, then what you do there. Questions reads "Questions. Answer a few, or skip them all." Only the current step's panel is visible. 1280×800 and 2560×1440 both have to work, and below 1024px the question and the brief stack. The type scales with the clamps above.

Each step has one primary button, and the label says what happens next: Send the idea, Skip all and build, Build, Play, Export to Logic. You decide, Skip this, Another take, Pick, and Start a new idea stay, and they are not a second primary. There is no Generate button.

Questions shows one card, "Question 1 of up to N", with You decide, Skip this, and Skip all and build. The brief sits beside it and fills slot by slot. A slot with no value is hidden. Set slots still show source and reason, and they stay click-to-edit. Guessed displays as Default. Reference stays reference. Tempo and key use the serif clamp when they are set. The trace stays open on this step, in Instrument Sans, as "{step}: {detail}", so the reasoning is on screen. Clicking a step highlights the brief value or the lane it touched. S skips this, and that meaning sits next to the card.

Prompt holds the layer choice, defaulting to all layers separately, then the prompt cards, then Build. Polish status appears on a card only when a trace step names that layer.

Sound shows the lanes and the clips. Play plays the chosen takes together and opens Export. Another take and Pick stay on the lane. Every clip has a 1px Lamp edge, and the lane label stays visible. When a build finishes, the Lamp playhead sweeps and the lanes fill behind it.

Export sends the takes to Logic, shows the folder path, and offers Start a new idea. An unpicked layer exports variation 1.

An empty view has a short title, one sentence of why, and one button for the next step. An error is the message plus Try again.

The first visit opens a short tour after 800 ms. It starts with what Vision Studio is and that it takes about 60 seconds, then one step for each visible stepper item: the step name in bold, then one sentence. Next, Back, and close. Finishing or closing stores that it was seen. Help holds Replay tour and Shortcuts. The tour is one component and uses no library. It does not mention a feature that is switched off.

Flags live in `apps/web/src/features.ts`: record, soloMute, fullMix, styleguideLink, and demo. The stepper, the tour, and the panels read that file. A hidden feature is not shown. Solo and mute are local when the flag is on. Mute drops that layer from playback and from the next full build. Solo keeps only that layer. The buttons use `aria-pressed`. Full mix follows the same clip rules and has no sixth hue.

Sound and Export load lazily, so wavesurfer loads with Sound. One store, and each panel selects its own data. Lane components are memoised.

Keyboard. Enter sends a written answer. S skips a question, or solos a focused lane when solo and mute are on. Shift+S skips all and builds. M mutes the focused lane when that flag is on. Space plays or stops on the sound step, and does nothing while typing. ? opens the shortcuts.

Copy stays plain: "Send the idea", "Confirm this reading", "Skip this", "Skip all and build", "You decide", "Build", "Play", "Another take", "Pick", "Export to Logic", "Try again", and "Start a new idea".

## 8. Definition of done per phase

| phase | done when |
| --- | --- |
| 1 contracts and mock agent | pytest passes for the five inputs; skip_all always returns ready with prompts |
| 2 API and mock renderer | curl from /turn through /render to /export produces playable WAVs in renders/ and MIDI of the right length; the full mix peaks below 0 dBFS |
| 3 design system and shell | /styleguide shows every component; layout works at 1440 px and 390 px |
| 4 input panel | text, file drop and recording all reach /turn; empty submit shows an inline message |
| 5 conversation and brief | a full run with one answer, one skip and skip all works; trace shows every step |
| 6 prompt studio | edited prompts reach /render; output picker changes the prompt cards |
| 7 results and export | three playable variations per layer; Pick and Another take work; export lists files |
| 8 polish and demo mode | the three demo scenarios run end to end with no network |

Phase 2 choices: the section name is verse. Uploads live in audio/, rendered WAVs in renders/, MIDI in midi/, and picked files in export/. Chord voicing puts the lowest tone nearest C4 with the other tones stacked above it. Bass roots sit nearest C2. One chord per bar, and a shorter progression repeats to fill the bars. MIDI velocity is 90. Rendered velocity stays inside 80 to 100. Melody is the top voice of that voicing. The full mix peak-normalises drums, chords, bass and texture to about −1 dBFS, sums them, and limits the sum to about −0.1 dBFS. POST /upload is a multipart form with session_id, input_type and the file. POST /turn sends a TurnRequest. POST /render sends { session_id }. POST /regenerate sends { session_id, layer }. POST /export sends { session_id, picks? } and returns { files }.

## 9. Dev commands

- make dev: runs the API on port 8000 and the web app on port 5173
- make test: pytest for services, typecheck and lint for apps/web
- make contracts: regenerates TypeScript types and Pydantic models
- Environment in .env (never committed): PROVIDER=mock, RENDERER=mock, AWS_PROFILE=vision, AWS_REGION=us-east-1, BEDROCK_MODEL_ID. The agent reads os.environ only. The API startup and `make dev` load the repo .env (uvicorn `--env-file`, and python-dotenv in the API). AWS_PROFILE is passed to boto3 only when it is set.

## 10. Bedrock provider

BedrockProvider sits behind the same Provider protocol and `run_turn` as MockProvider. `PROVIDER=mock` (the default) or `PROVIDER=bedrock`. The asking rule, defaults, theory engine, seeds, and compiler are the MockProvider code, imported, not copied.

Configuration, from the environment: `BEDROCK_MODEL_ID`, `AWS_REGION`, and `AWS_PROFILE` only when set. Otherwise boto3 uses the default credential chain, so the same client runs on AgentCore. The client is Bedrock Runtime Converse. Botocore connect timeout 2 seconds, read timeout 8 seconds, retries off (`total_max_attempts` 1). Inference config is temperature 0.2 and max tokens only: 600 for extraction, 300 per layer for polishing. Top p is not set.

Extraction sends the user's text, any AudioFeatures, and the current brief. The tool schema is adapted from `packages/contracts` slot JSON Schema: slot names and the value, confidence, and reason fields come from those files. `source` is replaced by `evidence` (`text` or `audio`). Mood, energy, and world values are enums of the section 2 options. Every slot, including tempo, is optional. The tool is forced with toolChoice. Code maps evidence to source: `you` for text, `detected` for audio. Output is not taken from Claude. The producer, or the asking rule, chooses it.

Merge, in order:
- Drop a slot with no evidence, no reason, or a confidence outside 0 to 1.
- Drop an invalid mood, energy, or world. Keep the previous value and say so in the trace.
- A slot with source `you`, and anything set through overrides, is locked. Claude cannot change it.
- A slot with source `detected` or `reference` can only be replaced by an explicit user statement (evidence `text`).
- A slot with source `guessed` (You decide, Skip, defaults) is replaced only when the new confidence is higher. The trace says why.
- When text and audio disagree, text wins. The trace names both values, for example "You said around 90 BPM, the audio measured 124, kept 90".
- A key that the theory engine cannot read is dropped.

Polishing runs after the compiler, one forced tool call for every layer. Wording only. Negative prompts are not sent and are not changed. A polished prompt is kept only when all of these hold:
- It still contains the TrackType tag, the template's BPM, the key when the template has one, and that layer's anchor (case insensitive).
- It contains no vocabulary word that is absent from both the template prompt and the brief. Words outside the vocabulary are allowed. Length is character count, and it must be between 0.6 and 1.5 times the template.
Otherwise the template is kept and the trace says why, for example "Kept the template for the bass prompt: it added trumpet".

Vocabulary is built at load time in `services/agent/src/agent/vocab.py` from the section 4 descriptors, mood words, and energy words, the section 2 option lists, the anchors, and `services/agent/vocab.yaml` for common instruments, genres, and moods that are not in the spec yet. Function words (and, with, the, and similar) are not vocabulary.

On any Bedrock error or timeout, including a missing model id, extraction falls back to the MockProvider keyword extractor and polishing keeps the template prompts. The trace says "Bedrock unavailable, used the offline extractor" or "Bedrock unavailable, kept the template prompts". The demo does not break because the network does.

Trace lines include "Claude read your idea", "Claude polished the drums prompt", "Kept your mood: joyful", and "Replaced the guessed mood peaceful with longing: …".

Tests stub the Bedrock client. The live test is marked `bedrock` and runs only when `RUN_BEDROCK=1`.