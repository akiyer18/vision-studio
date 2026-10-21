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

The studio is a liquid-glass dashboard. A left sidebar, a conversational canvas, and a right rail sit on a deep violet ground. Colour marks a layer. Chrome stays quiet. The sidebar is 240px and the rail is 320px. Canvas content sits in a centred column no wider than 760px. The empty home fits at 1280×800 and 1440×900 without page scrolling. After a conversation starts, only the thread scrolls.

| token | value | use |
| --- | --- | --- |
| Background | #0B0A1A | ground, with two soft radial gradients, violet #5B3FD6 and blue #2B4FD8, at low opacity, plus a very subtle noise texture |
| Glass | rgba(255,255,255,0.06) | sidebar, composer, brief, reasoning, layers, and the tour popover. Border rgba(255,255,255,0.12), a 1px top highlight rgba(255,255,255,0.18), blur 20px, saturate 140%. At most six glass surfaces on screen at once |
| Ink | #F4F2FF | primary text. On the violet accent, text is #0B0A1A so contrast stays at least 4.5 to 1 |
| Secondary | #B8B3D9 | supporting text |
| Muted | #8A84B3 | labels and quiet controls |
| Accent | #8B6CFF | primary actions and the focus ring. A soft glow on hover only |
| Success | #4FD1C5 | ready status |
| Warning | #F5B971 | caution |
| Error | #FF8A8A | errors |

Lane hues fill that layer's card and its chip. Ink on a lane card is #0B0A1A. Full mix has no sixth hue: a dark card with a double light rule.

| lane | hex |
| --- | --- |
| Drums | #FF6B57 |
| Chords | #F5C451 |
| Bass | #3FD0A8 |
| Melody | #6C8CFF |
| Texture | #B07CFF |

Radius: 24px for large cards, 16px for inner cards, 12px for inputs, full round for chips and pills. Geist Sans for the interface. Geist Mono for BPM, key, seeds, and file names. The greeting is 56px semibold at 1440px and wider, 44px on smaller screens, letter-spacing −0.03em, with a vertical gradient from #F4F2FF to #C9C2FF. Section titles are 15px semibold. Body is 15px with line-height 1.5. Secondary copy is 13px. Tempo and key are 28px semibold with tabular numbers. Spacing uses an 8px grid. Sentence case. No all caps.

Focus is a 2px accent outline, offset 2px. Motion is short: the greeting leaves as the thread arrives, messages arrive, brief rows fill, and layer cards appear. Reduced motion switches those to instant changes.

Before any input the canvas centres one group: "What are you feeling today?" with a short subline, then a glass composer, then the quick start chips, then three how-it-works cards. The greeting sits 24px above the composer. The other parts sit 16px apart. The composer is two lines tall when empty and grows to six as the idea is typed. Attach and the microphone, when record is on, sit inside on the left. The round violet send button sits inside on the right. Its accessible name is "Send the idea". Quick start chips: Rainy night drive, Summer festival, Calm morning, and Try the demo when the demo flag is on. The how-it-works cards are 88px tall, in one row, and are not glass: Describe it, Answer or skip, Hear your layers.

After sending, the greeting and those cards leave. The user's idea is a bubble. The agent's question is one message, with option chips, a "{n} of up to {max}" pill, and You decide, Skip this, and Skip all and build as quiet buttons. The composer stays docked for a follow-up answer. Enter sends. While a reading waits for confirmation, Confirm this reading is the button, and the reading stays on screen.

Before any input the rail shows one Getting started card, with the same three steps as the how-it-works cards, and the Layers card. When the first turn returns, Getting started leaves and Song brief and Agent reasoning animate in. Song brief shows tempo and key at 28px in Geist Mono, then each filled slot as a row with its value, a source badge (You, Detected, Default, or Reference), and a thin confidence bar. Unset slots are hidden. Values stay click-to-edit. Agent reasoning lists the live trace as "{step}: {detail}", the newest step arriving with a small icon, and the list can collapse. Layers holds chips for drums, chords, bass, melody, and texture, plus All layers and Full mix when that flag is on, on at most two rows. An unselected chip is a neutral outline. A selected chip fills with a 20 percent tint of its lane colour and a solid lane-colour dot. The helper reads "Pick layers, then build." Build is the single primary action, disabled with a tooltip until there is an idea. The choice defaults to all layers separately until the user changes it.

After Build the thread shows Your layers. Each layer is a card in its lane colour, with a waveform, play, tabs for variations 1 to 3, Pick, and Another take. Every variation stays in the document. A slim player at the bottom of the canvas offers Play together and Export to Logic, then the export folder. Variation 1 is used for any layer that was not picked. Start a new idea clears the session.

An empty card has one sentence and one button. An error sits in the card it belongs to, with Try again.

The first visit opens a glass tour after 800 ms. It says what Vision Studio is and that it takes about 60 seconds, then highlights the sidebar, the composer, the brief card, and the Build button. Next, Back, and close. Finishing or closing stores that it was seen. Help, in the sidebar, holds Replay tour and Shortcuts. The tour does not mention a feature that is switched off.

Flags live in `apps/web/src/features.ts`: record, soloMute, fullMix, styleguideLink, demo, analyser, and edits. Analyser and edits are off, so Song analyser and Song edits show a Soon pill and are not clickable. Solo and mute are local when the flag is on. Mute drops that layer from playback and from the next full build. Solo keeps only that layer. The buttons use `aria-pressed`. Recent ideas are remembered in localStorage.

Under 1200px the rail becomes a tabbed panel above the composer. Under 768px the sidebar is a drawer opened from a menu button, and the thread is full width.

The layer cards and the player load lazily, so wavesurfer loads with them. One store, and each panel selects its own data. Lane cards are memoised.

Keyboard. Enter sends. S skips a question, or solos a focused lane when solo and mute are on. Shift+S skips all and builds. M mutes the focused lane when that flag is on. Space plays or stops, and does nothing while typing. ? opens the shortcuts.

Copy the demos click stays plain: "Send the idea", "Confirm this reading", "Skip this", "Skip all and build", "You decide", "Build", "Another take", "Pick", "Play together", "Export to Logic", "Try again", and "Start a new idea".

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

## 11. Functionality

Vision Studio is a producer's translator. The producer describes what they hear, in words, with their voice, or with an instrument. The product makes that sound, explains how it got there, and teaches them to make it themselves in Logic. Text and sound can arrive in the same turn. "Here's my beatbox, make it a dusty lo-fi kit" is the headline example.

Three rooms, one verb each.

| Room | Verb | Bring | Get |
| --- | --- | --- | --- |
| Create | Make something new | Text, a sound (hum, beatbox, an instrument, a loop), or both | Layers or one specific sound, plus how it was made |
| Analyse | Improve a track | A track or a bounce from the DAW | Feedback, alternatives, a comparison of what changed, and a genre guide |
| Tweak | Reshape a sample | One sample | New variations of that sample, and similar samples to explore |

Create:

1. Bring the idea. Type, record, drop a file, or combine them.
2. Choose layers or one specific sound. Layers are drums, chords, bass, melody, texture, all separately, or a mix.
3. The agent asks only what is missing, at the producer's level. Every question can be answered, decided, skipped, or skipped entirely.
4. Hear three variations. Pick one, or ask for another take.
5. Learn from the result: how it was made, and how to make it in Logic.

One specific sound is a sample-library request, such as "a snappy EDM snare" or "a warm 808". It is defined by genre, duration, mood, and brightness. Brightness is how much high-frequency content the sound has.

Analyse:

1. Upload a track, or a bounce from Logic.
2. The report gives the basics and feedback. Basics are tempo, key, energy, brightness, how busy the rhythm is, and which instruments are present. Feedback is in producer terms and stays on instruments, rhythm, and arrangement.
3. Alternatives are two or three versions of the track. Each one follows a single suggestion, such as warmer, more swing, or a lo-fi version.
4. Comparison plays the original and each alternative side by side, and says what changed and why.
5. The genre guide names the detected genre, gives a short factual history, and lists artists and tracks to study. History stays short and factual.

Tweak:

1. Drop one sample.
2. Describe the change, such as "brighter", "punchier", or "more vinyl", or use a quick chip.
3. Set how different the result should be, from a subtle change to a new sound.
4. Hear three variations. Each one explains what changed.
5. See similar sounds to explore next.

Level is Beginner, Producer, or Pro. It changes three things: how many questions are asked and how they are worded, how deep the explanations go, and which controls are visible. The same result is explained more simply at Beginner and more technically at Pro.

Explain runs in every room. Every result has a "How this was made" panel: the brief, the choices, and the reasons. Every alternative says what changed. Every created sound has "Make it in Logic" steps that recreate it with Logic's own instruments and plugins. Those steps come from the brief and the prompt. Explanation depth follows the level.

Hackathon scope:

| Room | Demo |
| --- | --- |
| Create | Live, including one specific sound and Make it in Logic |
| Analyse | Live if time allows: the report, one or two alternatives, the explanation, and the genre card |
| Tweak | Marked Soon in the sidebar, and named as the next step in the pitch |

Analyse and Tweak share one path: audio in, guided variations out. Pitch line: "Hum it, describe it, or bring your track. Vision Studio makes the sound, explains how, and teaches you to make it yourself."
