# Vision Studio spec

Single source of truth for Cursor. Every phase prompt refers to sections in this file.
If something is not covered here or in .cursor/rules, ask before deciding.

## 1. Contracts (packages/contracts)

```
SlotSource      = "you" | "detected" | "guessed"
OutputChoice    = "drums" | "chords" | "bass" | "melody" | "texture" | "all_layers" | "full_mix"
AnswerAction    = "answer" | "you_decide" | "skip" | "skip_all"
InputType       = "text_only" | "hum" | "vocal" | "instrument_loop" | "drum_loop" | "full_track" | "midi"

SlotValue       { value: string, source: SlotSource, reason: string, confidence: number 0..1 }
TraceStep       { step: string, detail: string }            // shown in the agent trace
AudioFeatures   { input_type: InputType, key?: string, mode?: string, bpm?: number,
                  chords?: string[], instruments?: string[], confidence: number }

SongBrief       { slots: Record<SlotName, SlotValue>, output: OutputChoice[],
                  questions_asked: number, skipped: SlotName[] }

Question        { slot: SlotName, text: string, options: string[], index: number, max: number }

TurnRequest     { session_id: string, text?: string, audio_features?: AudioFeatures,
                  answer?: { slot: SlotName, action: AnswerAction, value?: string },
                  output?: OutputChoice[], overrides?: Record<SlotName, string> }

LayerPrompt     { layer: string, prompt: string, negative: string,
                  seeds: [number, number, number], kb_sources: string[] }

TurnResponse    { status: "question" | "ready", question?: Question, brief: SongBrief,
                  prompts?: LayerPrompt[], progression?: { roman: string[], chords: string[] },
                  trace: TraceStep[] }

RenderJob       { session_id, layer, prompt, negative, bpm, bars (default 8), seed, variant,
                  init_audio?, noise?, lora? }
RenderResult    { layer, variant, path, seconds, bpm, detected_key?, detected_bpm? }
```

Semantics:
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

Asking rule: score = impact x (1 - confidence). Ask the highest score above 0.35. Max 5 questions.
Tempo is never asked. It is detected from audio or derived (section 3).
First question when the input is almost empty: "What is this song about?" (free text, then re run extraction).

## 3. Defaults and presets

| mood | energy | world | key and mode | BPM | progression |
| --- | --- | --- | --- | --- | --- |
| joyful | make people move | bright and danceable | C major | 124 | I V vi IV |
| peaceful | slow and breathing | warm and intimate | C major (Lydian colour) | 72 | Imaj7 IVmaj7 |
| longing | slow and breathing | warm and intimate | D minor | 76 | i VI III VII |
| tense | steady | dark and electronic | E minor (Phrygian colour) | 110 | i bII |

Tempo derivation when not detected: slow and breathing 76, steady 96, make people move 122,
then nudge toward the mood preset BPM. Every default carries a one line reason, for example
"76 BPM because slow tempos read as sad". Mood with no signal defaults to peaceful.

Mock text extraction keywords (MockProvider only, replaced by Bedrock later):
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

Each layer gets three seeds. kb_sources lists the documents used (in mock mode: the preset and world names).

## 5. Theory engine

Progressions to chords: D minor i VI III VII = Dm Bb F C; E minor i VI III VII = Em C G D;
E minor i bII = Em F; C major I V vi IV = C G Am F; C major Imaj7 IVmaj7 = Cmaj7 Fmaj7.
Support any key by transposing. MIDI: chords as close voiced triads around C4, one chord per bar,
bass as roots around C2, velocity 80 to 100. Detected audio keys replace the preset key.

## 6. Audio and files

- WAV, 44.1 kHz, 16 bit, stereo. Length = bars x 4 x 60 / BPM (8 bars at 76 BPM = 25.26 s).
- Names: {section}_{layer}_{bpm}bpm_{bars}bars_v{n}.wav, for example verse_drums_76bpm_8bars_v1.wav
- Session folder: data/sessions/{session_id}/ with audio/, midi/ and export/
- Browser recordings arrive as webm or opus; convert to WAV with ffmpeg on the server (brew install ffmpeg).
- Upload limit 50 MB. Analysis: librosa for tempo and key; Basic Pitch for audio to MIDI later.
- MockRenderer: synthesized drums, sine pad chords from section 5, root note bass, a filtered noise texture;
  variations differ by seed (pattern density, voicing, filter).

## 7. Design

Brief: a studio at night. The interface should feel like sitting at a mixing console after midnight, not like a finance dashboard.

| token | hex | use |
| --- | --- | --- |
| studio night | #16131A | page background |
| walnut glass | rgba(242, 233, 220, 0.06) with 1px border rgba(242, 233, 220, 0.10) | panels, backdrop blur 24px |
| tape cream | #F2E9DC | primary text |
| dust | #A89F95 | secondary text |
| VU amber | #F2A541 | user actions, meters, focus |
| signal violet | #9B8CFF | everything the agent says or does |
| clip red | #F0624D | errors only |

Background: two or three very soft, slowly drifting warm blurs (amber and violet at low opacity) behind the panels. No photos.

Type:
- Instrument Sans for the interface.
- Instrument Serif for large values and headings (the big "76 BPM" and "D minor" in the brief).
- JetBrains Mono only inside the agent trace, because that is the machine speaking.

Signature element, the one bold thing: the song brief is drawn as a row of console channel strips.
Each slot is a strip with its value in large serif, a source badge (you, detected, guessed) and a vertical
VU style meter showing confidence, filling up as the agent learns. Everything else stays quiet.

Rules: sentence case, no all caps labels, no text on busy backgrounds, contrast of at least 4.5:1,
visible keyboard focus, prefers reduced motion respected, one orchestrated motion moment
(the brief strips filling up), otherwise motion only in response to actions.

Copy: plain verbs. Buttons say what happens: "Send to Stable Audio", "Another take", "Export to Logic".

## 8. Definition of done per phase

| phase | done when |
| --- | --- |
| 1 contracts and mock agent | pytest passes for the five inputs; skip_all always returns ready with prompts |
| 2 API and mock renderer | curl from /turn to /export produces playable WAVs and a MIDI file of the right length |
| 3 design system and shell | /styleguide shows every component; layout works at 1440 px and 390 px |
| 4 input panel | text, file drop and recording all reach /turn; empty submit shows an inline message |
| 5 conversation and brief | a full run with one answer, one skip and skip all works; trace shows every step |
| 6 prompt studio | edited prompts reach /render; output picker changes the prompt cards |
| 7 results and export | three playable variations per layer; Pick and Another take work; export lists files |
| 8 polish and demo mode | the three demo scenarios run end to end with no network |

## 9. Dev commands

- make dev: runs the API on port 8000 and the web app on port 5173
- make test: pytest for services, typecheck and lint for apps/web
- make contracts: regenerates TypeScript types and Pydantic models
- Environment in .env (never committed): PROVIDER=mock, RENDERER=mock, AWS_PROFILE=vision, AWS_REGION=us-east-1