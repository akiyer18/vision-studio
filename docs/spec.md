# Vision Studio spec

Single source of truth for Cursor. Every phase prompt refers to sections in this file.
If something is not covered here or in .cursor/rules, ask before deciding.

Vision Studio is a helper, not the author. The agent only works from what the producer said, played, or chose. It never changes a stated answer, never adds musical ideas the producer did not give, and every suggestion shows its reason so the producer can override it. Claude may only express what the user said or what was detected. It must never steer the song somewhere new.

## 1. Contracts (packages/contracts)

```
SlotSource      = "you" | "detected" | "guessed" | "reference"
SlotName        = "output" | "mood" | "energy" | "world" | "key" | "style" | "palette" | "structure" | "must_keep" | "tempo" | "sound" | "genre" | "brightness" | "pattern" | "production" | "progression" | "meter" | "intent"
OutputChoice    = "drums" | "chords" | "bass" | "melody" | "texture" | "all_layers" | "full_mix"
AnswerAction    = "answer" | "you_decide" | "skip" | "skip_all"
InputType       = "text_only" | "hum" | "vocal" | "instrument_loop" | "drum_loop" | "full_track" | "midi"

SlotValue       { value: string, source: SlotSource, reason: string, confidence: number 0..1 }
TraceStep       { step: string, detail: string }            // shown in the agent trace
AudioFeatures   { input_type: InputType, key?: string, mode?: string, bpm?: number,
                  chords?: string[], instruments?: string[], confidence: number, path?: string }

SongBrief       { slots: Partial<Record<SlotName, SlotValue>>, output: OutputChoice[],
                  questions_asked: integer, skipped: SlotName[],
                  facets?: FacetAnswer[], arc?: Arc,
                  audio_intent?: "transform" | "extend" | "accompany",
                  noise?: number, coverage?: number }

FacetAnswer     { id: string, layer: string, label: string, value: string,
                  descriptor: string, options: string[] }
Arc             { label: string, start: string, end: string, description?: string }

Question        { slot: SlotName, text: string, options: string[], index: integer, max: integer,
                  facet?: string, why?: string }

TurnRequest     { session_id: string, request_id?: string, text?: string, audio_features?: AudioFeatures,
                  answer?: { slot: SlotName, action: AnswerAction, value?: string, facet?: string },
                  output?: OutputChoice[], overrides?: Record<SlotName, string>,
                  mode?: "full" | "one_sound", reference?: Record<SlotName, string>,
                  deepen?: boolean, build_now?: boolean, write_prompts?: boolean,
                  back_to_questions?: boolean, review?: boolean, noise?: number }

LayerPrompt     { layer: string, prompt: string, negative: string,
                  seeds: [number, number, number], kb_sources: string[] }

TurnResponse    { status: "question" | "review" | "ready", question?: Question, brief: SongBrief,
                  prompts?: LayerPrompt[], progression?: { roman: string[], chords: string[] },
                  trace: TraceStep[], summary?: string, intro?: string }

RenderJob       { session_id, layer, prompt, negative, bpm: integer, bars: integer (default 8),
                  seed: integer, variant: integer, take: integer (default 1), init_audio?, noise?: number, lora? }
RenderResult    { layer, variant: integer, path, seconds, bpm: integer, detected_key?, detected_bpm?: number }
```

Semantics:
- An absent SongBrief slot means that slot is not yet known.
- Source "detected" is for values read from uploaded audio, including a full track. Source "reference" is a value taken from a genre file. It stays available for a song looked up by name later.
- mode is absent or "full" for a full idea. "one_sound" asks only the one-sound slots in section 11.
- reference stores genre traits as source "reference" and locks them so a later guess cannot replace them.
- "you_decide" fills the slot with the default, source "guessed", reason from the default rule.
- "skip" does the same and prefixes the reason with "skipped: ".
- "skip_all" fills every remaining slot with defaults and returns status "review". Prompts are written only when write_prompts is sent, which returns status "ready".
- build_now returns status "review" from whatever has been said so far. back_to_questions leaves the review and continues the interview. review=true lets an override change a locked fact, and the fact stays source you.
- A locked fact is a slot with source you. Tempo, key, progression, bar count, named instruments, named sound types, and time signature are locked when the producer states them. Claude, defaults, and the preset tables cannot replace a locked slot.
- audio_intent is transform, extend, or accompany. noise is the "how different" amount for transform, default 0.5. coverage is the fraction of askable slots that are filled or skipped.
- deepen asks up to three more facet questions after a review or a ready brief. It can be sent again.
- A facet answer is stored on the brief, not in the slot named by the question. The question's slot is only the carrier.
- An arc is a musical journey: a start state, an end state, and a short description. Section prompts use the start and the end. The brief shows the label, for example "Dark to bright". Structure never stores the journey. It only stores a bar count.
- request_id is a client id for one turn. The same id for the same session returns the response already produced and does not run the turn again.
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
| progression | 0 | never | never asked | |
| meter | 0 | never | never asked | |
| intent | 0 | never by the score | asked once, only when audio has no clear intent | Reshape it, Continue it, Build around it |

Asking rule, used by MockProvider and whenever Bedrock fails: score = impact x (1 - confidence). Ask the highest score above 0.35. The interview stops when coverage is complete, when the producer presses Build now, or after Skip all. The hard maximum is 10 questions. Bedrock replaces the order with the adaptive interviewer in section 10. The section 2 question text stays the fallback wording. Each question carries a one-line reason, Question.why.
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
Other empty slots: style "no reference", palette "no preference", structure "8 bars"
(or "16 bars" when the idea has an arc, unless the producer stated a count),
must_keep "everything" when audio was uploaded and "nothing" otherwise.
Before a brief is reviewed, complete_brief fills any gap: tempo (stated, then detected, then derived), an integer bar count, a key with a mode, and an output. Each fill carries a reason. A locked slot is left as the producer stated it, including on the review card. The trace for a locked fact is "Kept your tempo: 105 BPM", and the same shape for key, progression, bar count, instruments, sound, and time signature.

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
One sound:    section 11. One layer, TrackType SFX or Instrument, not the table above.
```

Mood words: longing "melancholic, late night, intimate"; joyful "bright, uplifting, euphoric";
peaceful "calm, tender, soft"; tense "tense, brooding, urgent".
Energy words: slow "gentle dynamics, slow build"; steady "steady groove"; high "driving and energetic".
A missing or unrecognised mood, energy, or world uses the peaceful, steady, and warm and intimate words. The compiler does not raise.

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

Filled facet descriptors are added on the instrument and rhythm side of that order, after the layer descriptor and before the mood words. Reference descriptors, when Claude has written them, go in the arrangement position, immediately before the BPM. An empty facet list leaves the template unchanged.

When the idea moves from one state to another, each selected layer is written twice: Section A uses the start mood, energy, and world, and Section B uses the end. The layer ids are `{layer}_a` and `{layer}_b`. The mock renderer plays each section with that layer's sound. Artist and song names are never interpolated. See section 11.

Prompt writer. After review, Claude writes one prompt and one negative prompt per layer from the reviewed brief and the conversation, in the order above, at most about 60 words. Code checks each prompt: every locked tempo, key and mode, progression, and named instrument appears, the layer's anchor is present, no artist or song name appears, and no word contradicts the brief. If that check fails twice, the deterministic template is kept. The trace says "Kept the template: …". A progression the producer named is written as those chord symbols, not as a transposed preset.

## 5. Theory engine

A progression the producer named, such as C, Am, F, G, is used as those symbols. It is not transposed. Preset progressions still transpose: D minor i VI III VII = Dm Bb F C; E minor i VI III VII = Em C G D;
E minor i bII = Em F; C major I V vi IV = C G Am F; C major Imaj7 IVmaj7 = Cmaj7 Fmaj7.
Support any key by transposing. MIDI: chords as close voiced triads around C4, one chord per bar,
bass as roots around C2, velocity 80 to 100. Detected audio keys replace the preset key.

## 6. Audio and files

- WAV, 44.1 kHz, 16 bit, stereo. Length = bars x 4 x 60 / BPM (8 bars at 76 BPM = 25.26 s).
- The section name is verse. Names: verse_{layer}_{bpm}bpm_{bars}bars_v{n}.wav, for example verse_drums_76bpm_8bars_v1.wav.
- Session folder data/sessions/{session_id}/:
  - audio/: the upload. Allowed types are wav, mp3, m4a, aiff, webm, and mid. mp3, m4a, aiff, and webm are converted to 44.1 kHz stereo WAV with ffmpeg (brew install ffmpeg). A recording longer than 5 minutes is refused. The stored name is random.
  - renders/: rendered WAVs.
  - midi/: verse_chords_{bpm}bpm_{bars}bars.mid and verse_bass_{bpm}bpm_{bars}bars.mid.
  - export/: the picked variation of each layer, variation 1 when that layer was not picked, and both MIDI files.
- POST /upload is multipart: session_id, input_type, and the file. Limit 50 MB. librosa reads tempo and key and the response is AudioFeatures. Basic Pitch for audio to MIDI comes later.
- POST /turn sends a TurnRequest.
- POST /render sends { session_id } and builds three RenderJobs per selected layer at take 1.
- POST /regenerate sends { session_id, layer } and re-renders that layer at the next take.
- POST /export sends { session_id, picks? }. picks maps a layer name to a variation number. The response is { files }.
- GET /files/{session_id}/{path} serves a file from that session folder, including renders/, midi/ and export/. session_id is a UUID. The path cannot leave that folder.
- Chords are close voiced: the lowest tone is the chord tone nearest C4 and the other tones stack above it. Bass is the root nearest C2. One chord per bar. A progression shorter than the bar count repeats. MIDI notes use velocity 90. Rendered bass moves velocity from 80 to 100 with the seed.
- MockRenderer: synthesized drums, sine pad chords, root note bass, and a filtered noise texture. Melody is the top tone of the chord voicing. Variations differ by seed (pattern density, voicing, filter).
- Full mix sums drums, chords, bass and texture. Each of those layers is peak-normalised to about −1 dBFS first. A limiter then holds the sum at about −0.1 dBFS, so the mix peak stays below 0 dBFS.

## 7. Design

Create fills the viewport. At 1280 by 800, 1440 by 900, and 1920 by 1080 the page does not scroll. The conversation thread and the results list scroll inside their cards. The brief column can scroll when the trace is open, so a collapsed trace still stays in the document. The document title is "Vision Studio". The favicon is a violet waveform.

The sidebar is 248px, flush to the left edge. It stays on Create and Genres. Home is its own full-bleed page. Create in conversation is a centred column, at most 760px, with 32px of space between the fact row and the thread. The header sits above that column. Brief, layers, and the trace live in a right-hand drawer, not beside the thread. There is no insight strip. When the review or the results are on screen, they use the main area up to 1680px. Under 1024px the sidebar collapses to icons with tooltips and the page may scroll. At 1280px the sidebar labels stay.

The ground is `#0A0A12`, with film grain at 2% opacity and a soft violet radial glow behind the main area. Cards are `#12121C`, with a 1px border `rgba(167,139,250,0.12)` and an inner gradient from `rgba(139,92,246,0.06)` at the top to transparent. Raised controls are `#1A1A27`. Hover surfaces are `#20202F`. Primary text is `#EEEDF7`. Secondary text is `#A6A3BF`. On violet `#8B5CF6`, text is `#0A0A12`, because white on that violet is about 3.6 to 1 and the near-black pair is about 4.7 to 1. On the deep fill `#2E1F5E`, text is `#EEEDF7`. `#6F6C8A` is only for non-text marks such as an empty sparkline or an idle status light. On a card it is about 3.8 to 1, so readable muted copy uses `#7E7A9C`, which is about 4.6 to 1. Cyan `#5EEAD4` is only for detected values and success, including the ready light.

| token | value | use |
| --- | --- | --- |
| Background | #0A0A12 | the ground, and text on a filled violet control |
| Card | #12121C | sidebar, cards, the player |
| Raised | #1A1A27 | inputs and controls |
| Hover | #20202F | hover surfaces |
| Ink | #EEEDF7 | primary text |
| Secondary | #A6A3BF | labels and hints |
| Muted | #7E7A9C | readable quiet copy |
| Quiet | #6F6C8A | non-text marks only |
| Violet | #8B5CF6 | the accent and filled primary actions |
| Light violet | #A78BFA | gradients, glows, focus, the thinking light |
| Deep violet | #2E1F5E | filled backgrounds, such as your message |
| Cyan | #5EEAD4 | detected values, success, the ready light |

Status lights sit next to the session word. Idle uses the quiet mark colour. Thinking is `#A78BFA` and pulses. Ready is `#5EEAD4`. Error is `#F87171`. The words stay idle, thinking, building, ready, and error. Building uses the thinking light. While the agent is thinking or rendering, a thin animated diagonal stripe runs along the top edge of that card. Reduced motion holds the light and the thinking dots steady and stops the stripe. Readout numbers have a faint violet glow. Nothing else glows. Focus is a 1px light violet ring. Hover changes the surface over 150ms. A filled violet control lightens to `#A78BFA` on hover and keeps the dark text.

Lane colours are slightly desaturated and appear only on audio, waveforms, and a selected layer pill. A waveform runs from violet `#8B5CF6` into the lane colour. Full mix uses the light violet, not a sixth hue.

| lane | hex |
| --- | --- |
| Drums | #F07167 |
| Chords | #F2C14E |
| Bass | #4FD1A5 |
| Melody | #7AA2FF |
| Texture | #C084FC |

General Sans is the interface. Martian Mono is the readout values, file names, and the trace. Both are self hosted, so the app works offline. Sentence case. No all caps. Tabular numbers. The eyebrow is 12px medium in light violet. The page title is 30px semibold. Card titles are 15px semibold. Body is 14px with line height 1.55. Small text is 12px. Readout values are 26px. Icons are 16px, from lucide, with an 8px gap to the label. Every icon button has a label or a tooltip.

Spacing is 4, 8, 12, 16, 24, and 32. Cards are 16px radius with 20px padding. The readout tiles are 112px tall, so they use 12px vertical padding and 20px horizontal padding and the number still fits. Controls are 10px radius. Pills are fully round.

`/` is the home page. A minimal bar has the wordmark, Create, Genres, and How it works, and a Start creating button. The hero is the full viewport on a slow violet and indigo gradient. Reduced motion holds that gradient still. The headline is General Sans at about 88px, weight 500, letter spacing −0.035em, and types through "Make dark industrial drums at 94 BPM", "Turn my voice memo into neo soul chords", and "Build a lofi bed for my instrumental". The subline is "Describe what you hear in your head. Get editable layers for Logic." The same composer as Create sits in the hero, with attach, record, and a Create button. Submitting opens Create with that idea already sent. Two tilted preview cards sit at the edges, each with a waveform and a demo play control. Below the hero: Describe, Refine together, and Build and export, then Create and Genres as large cards and Analyse and Tweak as smaller Coming soon cards with a disabled Open button. The credits line is "Built with Stable Audio 3, AWS Bedrock and Soundcharts." Moving between Home and Create fades and lifts 12px over 220ms. Reduced motion plays no movement.

The sidebar holds a small waveform mark beside the words Vision Studio. That wordmark is the tour's welcome target. Home is the first item, then the rooms, each with an icon and a label: Create, Genres, Analyse with a Soon pill, and Tweak with a Soon pill. Analyse and Tweak are not clickable while those flags are off. Recent ideas follow, each with a small waveform icon. At the bottom, a tip reads "Press Build now at any time, your details stay exactly as you said them", then Help.

The page header eyebrow is "Create". The title is "Shape your idea". The subtitle is "Describe it, record it, or drop a file. I ask only what is missing." On the right are a Brief button, the session status with its light, and one Build now button. The Brief button shows how many details are filled and opens the drawer. It is the tour's brief target. Build now is the filled violet primary. It returns the review at any time and is disabled while a turn, a render, or a recording is in flight. It carries the tour target, because the render Build does not exist until prompts are ready. The only button whose text is exactly "Build" is the primary button on the review footer once prompts exist. It renders the layers and is disabled while a request is in flight.

One slim row sits above the conversation: Tempo, Key, Bars, and Coverage. A label shows on its own until the value is known. Nothing is labelled auto. Coverage, once it is a number, shows the percent.

The brief drawer holds the brief, the layer choice, and the trace. It stays in the document when closed, so the trace text is still there. Before any detail is known, the brief shows one line: "Details appear here as we talk." It does not list tempo, key, or bars. Those live only in the fact row. Other filled slots are grouped as Locked, From you, Detected, and Defaults, and empty groups are hidden. A fact you stated for palette, sound, meter, or progression shows a lock icon. Filled slots stay click-to-edit. Facets sit under their layer. Layer pills follow in the same card. They are colourless until selected, then filled with a tint of the lane colour. The choice defaults to all layers separately until you change it. The pill for that choice reads "All layers". The trace is collapsed by default, and can open. A trace line can still mark the matching row.

The conversation sits in the centred column. Before any input, an agent message states the contract: a few short questions, your details stay as you said them, and Build now works at any time. The example chips sit in that thread: Rainy night drive, Summer festival, Calm morning, and Try the demo when the demo flag is on. They are not under the composer. Messages are bubbles. The agent is on the left with the waveform mark. You are on the right, in the deep violet fill. An answered question is an agent bubble plus a user bubble. The thread scrolls to the newest message. If you have scrolled up, a "Jump to latest" pill appears. That label is not a demo label. New agent messages are announced from the question, which is the only `article` with `aria-live="polite"`. The thread itself is a log. There is no question counter.

The first reply reflects the producer's words, adds a one-line draft of what is already known, and asks at most one question. The layer choice, All layers until it is changed, is sent with a full idea, so the interviewer does not ask which layers to make. A question uses compact pills in one or two rows. The free-text field appears after Something else, or immediately when the question has no options. You decide, Skip this, and Skip all and build are one row of quiet text buttons. The skip-all control keeps that full label. Thinking is an agent bubble with three pulsing dots and the latest trace line, or "Thinking" when there is no trace yet. Reduced motion holds the dots steady.

The composer is docked at the bottom of the conversation card, and the same field is placed in the home hero. On Home the submit control reads Create. On Create, Send is a round violet button. Its accessible name, and the text inside it, is "Send the idea". "A full idea" and "One sound" are a compact segmented switch on Create. Attach and Record, when record is on, are 32px icon buttons with tooltips. Send is disabled while a request is in flight. There is one field, and its text is not cleared when the session id changes. The field is two lines tall and grows to six. Shift and Enter inserts a line. One violet ring appears on the whole field when focus is inside it. The text area has no outline of its own.

When the brief is ready, the conversation steps aside. A full-width review takes the main area, and the brief collapses to one summary row. The review shows the concept and the arc, locked facts as editable chips with lock icons, then one wide card per layer. Each card has its facet chips, a prompt field at least four lines tall with no inner scrollbar, and the leave-out list as removable chips. The prompt field ids stay `thread-{layer}-prompt` and `thread-{layer}-negative`. Prompts are not rendered inside a chat bubble. The sticky footer reads Back to conversation, Go deeper, and, once the prompts exist, Build. Until then the primary button is Write prompts. Back to conversation uses the same return as Back to questions.

After Build, the main area becomes the results view. It lists one row per layer: a lane colour dot, the layer name, a waveform from violet into the lane colour, take buttons 1, 2, and 3, Pick, Another take, and a download icon. The download name stays available to a screen reader. Every variation stays in the document, with `data-variant`, including the ones not on screen. While the takes are still arriving, the card shows skeletons of the same height. A player row at the bottom of the main area offers Play together and Export to Logic, then the export folder. While the layers are playing, the button reads Stop and its accessible name is "Stop the layers". Variation 1 is used for any layer that was not picked. Start a new idea clears the session. Try again stays on the action that failed.

An error sits in the panel it belongs to, with Try again.

The first visit opens a tour after 800 ms. It says what Vision Studio is and that it takes about 60 seconds, then highlights the sidebar, the input, the brief, and Build now. Next, Back, and close. Finishing or closing stores that it was seen. Help holds Replay tour and Shortcuts. The tour does not mention a feature that is switched off.

Flags live in `apps/web/src/features.ts`: record, soloMute, fullMix, styleguideLink, demo, create, genre, analyser, edits, and soundcharts. Create and Genre deep dive are on. Analyser and edits are off, so Analyse and Tweak show a Soon pill and are not clickable. Soundcharts is off. Solo and mute are local when the flag is on. Mute drops that layer from playback and from the next full build. Solo keeps only that layer. The buttons use `aria-pressed`. Recent ideas are kept in localStorage, up to 20, newest first. The first turn of a session saves the title, date, brief, prompts, selected layers, and any render paths. Opening one restores that session on screen without another agent turn. If a render file is gone, that layer says Build again. Rename and delete sit on the row.

The layer rows and the player load lazily, so wavesurfer loads with them. One store, and each panel selects its own data. Lane rows are memoised. Colours, spacing, radius, and type live as CSS variables, and Tailwind reads them from the same theme.

Keyboard. Enter sends. Shift and Enter inserts a line. S skips a question, or solos a focused lane when solo and mute are on. Shift+S skips all and builds. M mutes the focused lane when that flag is on. Space plays or stops, and does nothing while typing. ? opens the shortcuts.

While a turn or a render is in flight, Send, Enter, the answer pills, You decide, Skip this, Skip all and build, Build now, and Record wait. A failure brings the controls back and offers Try again. While a reading waits for confirmation, Confirm this reading is the button, and the reading stays on screen. The reading still says "BPM" and names the key, including "A minor" when that is what was heard. The trace still contains "bpm:" after that reading is confirmed. Enter sends. Every turn sends a new request id. A repeat of that id returns the same response.

Copy the demos click stays plain: "Send the idea", "Confirm this reading", "Skip this", "Skip all and build", "You decide", "Build", "Another take", "Pick", "Play together", "Export to Logic", "Try again", and "Start a new idea". "Write prompts", "Back to conversation", "Go deeper", and "Build now" are extra labels and are not a second "Build".

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
- Environment in .env (never committed): PROVIDER=mock, RENDERER=mock or RENDERER=stability_api, AWS_PROFILE=vision, AWS_REGION=us-east-1, BEDROCK_MODEL_ID. Stable Audio URLs and field names live in services/api/stability.yaml and the STABILITY_* variables. They stay blank until the hackathon API documentation names them. The agent reads os.environ only. The API startup and `make dev` load the repo .env (uvicorn `--env-file`, and python-dotenv in the API). AWS_PROFILE is passed to boto3 only when it is set.

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

Adaptive interviewer. After every user message or answer, one forced tool call sends Claude the conversation so far, the current brief, the detected audio features, the slot schema with allowed values, and the questions still remaining. Claude returns either next_question (slot, a short question that refers to what the producer already said, 2 to 4 options, and a one-line reason) or ready (a one-line summary of the brief). The summary is TurnResponse.summary.

Guardrails in code, always: never ask a slot filled with source you or detected; never ask tempo; stop when coverage is complete, on Build now, or after Skip all, and never ask more than 10 questions; options for a closed slot must be labels from section 2; You decide, Skip this, and Skip all still work. One sound still only asks its five slots. If Claude's mood contradicts the producer's words (a calm mood after "aggressive"), keep the mood those words imply and say so in the trace. If the proposal fails a guardrail, the trace says why and the asking rule chooses instead. If the interviewer call fails, the trace says "Bedrock unavailable, used the asking rule". Claude's ready decision returns status review, with the summary kept. write_prompts is what compiles.

Both providers read facts from the text before Claude or the keyword extractor: "105bpm" is tempo 105, source you, "Heard 105 BPM in your words" and "Kept your tempo: 105 BPM"; "F minor" is the key; "8 bars" is the structure; "4/4" is the meter; "C, Am, F, G" is the progression; a named instrument or sound type is palette or sound. A stated tempo still beats a measured one. Nothing overwrites a locked fact.

Before status review, and again before prompts are written, complete_brief checks the brief. A locked slot is not replaced. Tempo otherwise stays the stated number, then the detected number, then the derived number. Bars stay a positive integer the producer stated, otherwise 16 when there is an arc, otherwise 8. Key always includes a mode unless the producer locked a key that cannot be read. Output is set. Structure holds only that bar count when it was not locked as something else. A journey found in the structure slot is moved to the arc and the bar count is kept. The same completion runs before every render, so a missing bar count or tempo cannot fail the render.

Facet questions. The catalog is `kb/facets`, one YAML file per layer and one for one-sound types. A facet has an id, a question, an intent, allowed values with the short descriptor used in prompts, a condition, and an importance. A condition `kick_character~distorted` applies only when that answer contains the fragment. The interviewer may return a facet on the same tool call. A separate forced call, used once the section 2 slots that still score above 0.35 are filled or when the producer goes deeper, asks Claude to choose the applicable facet that most changes the sound, phrase the question, and pick 2 to 4 of its values. Code refuses a facet that does not apply, an option that is not one of its values, and a facet already asked. A refusal falls back to importance order and the facet's own question. Free text that matches no value is mapped by Claude to the closest label, or stored as a descriptor. If that call fails, the words are stored as the descriptor. The trace for a failed facet call is "Bedrock unavailable, used the facet order".

An artist or song name is kept as a reference and is not passed to the compiler. Claude may turn it into musical descriptors. The trace says "Used musical descriptors instead of {name}". If that call fails, the name still stays out of the prompt.

Trace lines include "Claude read your idea", "Claude polished the drums prompt", "Kept your mood: joyful", and "Replaced the guessed mood peaceful with longing: …".

Tests stub the Bedrock client. The live test is marked `bedrock` and runs only when `RUN_BEDROCK=1`.

## 11. Functionality

Vision Studio is a producer's translator. The producer describes what they hear, in words, with their voice, or with an instrument. The product makes that sound, explains how it got there, and teaches them to make it themselves in Logic. Text and sound can arrive in the same turn. "Here's my beatbox, make it a dusty lo-fi kit" is the headline example.

There is no level setting. Nothing in the interface, the brief, or the agent changes with Beginner, Producer, or Pro. Detail comes from facets, which branch from the answers, and from Go deeper. Bedrock asks the next most valuable question for the chosen layers and facets, using the conversation and the locked facts, and stops when coverage is complete, when the producer presses Build now, or after Skip all. The hard maximum is 10 (section 10). MockProvider, and Bedrock when it fails, use the section 2 question text and the asking rule, then facet importance order and the facet question text.

The first agent message states the contract: Vision Studio asks a few short questions to match what the producer hears, details stay exactly as given, and Build now works at any point. Each later question shows one line, "Why I am asking", under the question. The thread is messages: agent messages on the left with the waveform mark, the producer's messages on the right. An answered question is an agent bubble with the question and a user bubble with the answer. The active question is a wide card that contains the chips. Thinking is an agent bubble with the stepped indicator. The composer stays locked while a turn is in flight. Build now sits beside the composer for the whole session. After the first turn, the composer placeholder is "Answer, or add a detail". Trace lines are plain sentences, for example "Heard 105 BPM in your words", "Kept your tempo: 105 BPM", and "Asked about texture because the style was unclear".

When coverage is complete or Build now is pressed, the agent runs complete_brief and posts a Review card: locked facts with a lock mark, chosen details, defaults marked default, the arc, the audio intent, and the layers. Every value can be edited there. Editing a locked fact is allowed only on that card and the fact stays locked. The buttons are Write prompts and Back to conversation. Write prompts shows one wide editable card per layer, and Build on that review renders them.

Four rooms. The sidebar reads them from `features.ts`. A room whose flag is off shows a small Soon pill and is not clickable.

| Room | Flag | Verb | Bring | Get |
| --- | --- | --- | --- | --- |
| Create | create, on | Make something new | Text, a sound, or both | Layers or one sound, plus how it was made |
| Genre deep dive | genre, on | Study a genre | Nothing. The files are already there | History, traits, references, and a path into Create |
| Analyse | analyser, off | Improve a track | A track or a bounce | Feedback, alternatives, and a comparison |
| Tweak | edits, off | Reshape a sample | One sample | New variations of that sample |

Create:

1. Bring the idea. Type, record, drop a file, or combine them. MIDI is not offered in the interface.
2. Choose a full idea or one sound, with the composer toggle "A full idea" or "One sound". A full idea then chooses layers: drums, chords, bass, melody, texture, all separately, or a mix.
3. The agent asks only what is missing. Every question can be answered, decided, skipped, or skipped entirely.
4. Hear three variations. Pick one, or ask for another take.
5. Learn from the result. Under the layer cards, collapsed by default: "How this was made" and "Make it in Logic".

Facets. Files in `kb/facets` describe drums (kick, snare, hats, percussion, groove), bass (sub, 808, reese, synth bass), chords (instrument, voicing, rhythm), melody (instrument, register, movement), texture (ambience, foley, risers, vinyl), and the one-sound types (kick, snare, clap, hat, 808, pad, pluck, riser, impact). Kick character includes punchy club, deep boomy, distorted industrial, and clicky tight. Distortion is asked only after a distorted character, and its values are gritty saturation and full clipping. Tail, tuning, and transient follow.

Facet questions start once the selected layers, or the one-sound type, are known and the section 2 questions that still score above 0.35 are done. That keeps the demo's output, key, and style questions in place. The hard maximum is 10. After the prompts are written, Go deeper asks up to three more facet questions and can be pressed again. The transport button Build renders. The layers card does not add a second Build.

The brief shows filled facets under each selected layer as a compact row, for example "Kick: distorted industrial, full clipping, short tight". Clicking a row edits a value.

An idea that says "from dark to bright" stores an arc and is written as Section A and Section B. The brief shows "Dark to bright". A release such as "agony and tension, release into a positive breath at the end" is an arc too: the start state, the end state, and a short description. The structure slot stays a bar count, 16 bars when the journey was not given a length. A stated bar count still wins. The end state "a positive breath" reads as peaceful, because it is a breath rather than a dance. Names that look like an artist or a song, including "like Billie Eilish", stay a reference. Descriptors may be written instead. The name is never sent to the compiler.

One sound is a sample-library request, such as "a snappy EDM snare" or "a warm 808". It asks only what is missing among sound type, genre, duration, mood, and brightness, still one at a time, and still within the hard maximum of 10. MockProvider asks them in that order. Bedrock may ask any of those five that are still empty. Duration uses the structure slot and its existing question. Sound type, genre, and brightness use the questions in section 2. The other slots are not asked. The same answer, You decide, Skip this, and Skip all and build rules apply. You decide and Skip use these defaults: sound "pad", genre "no genre", brightness "balanced", plus the section 3 defaults for duration and mood. Skip all fills whatever of those five is still empty, then the remaining section 3 defaults, and returns the review. Write prompts then returns the one prompt.

Audio. When a file is uploaded or recorded, Claude classifies the intention as transform, extend, or accompany from the producer's words. If it is unclear, the agent asks once: "Should I reshape your recording, continue it, or build new layers around it?" Transform uses audio to audio on that file with the how-different amount. Extend continues from that file. Accompany writes new layers at the detected tempo and key and does not send the upload as source audio. The theory engine uses a stated progression as the chord symbols, renders those notes to MIDI and to a chord stem, and passes that stem as init audio for the chords layer so the notes stay pinned.

Stable Audio. RENDERER=stability_api selects StabilityAPIRenderer behind the Renderer interface. Endpoint URLs, field names, and the API key come from .env and services/api/stability.yaml. They are not hard coded. Text to audio sends the prompt, the negative prompt, the duration, and the seed. Audio to audio sends the source file, the prompt, the negative prompt, the duration, and the noise amount. Duration is bars times 4 times 60 divided by the BPM. Results are saved as WAV under renders. Trim to the bar count, loudness, and the key and tempo check still run. If the URL, the key, or a field name is missing, or the call fails, MockRenderer runs and the trace says the mock was used. A debug panel, visible only with ?debug=1, shows the uploaded file, its detected features, and the payload sent to the renderer, without the API key.

The prompt is one layer named sound:

```
TrackType: SFX or Instrument, {sound}{ in KEY when Instrument}, {genre}, {brightness words}, {mood words}, {energy words}, {bpm} BPM
Negative: vocals
```

TrackType is SFX when the sound type contains snare or riser. Otherwise it is Instrument, which is the section 4 type for a single layer. Brightness words: dark "dark, few highs"; balanced "balanced highs"; bright "bright, airy highs". The layer returns three variations.

MIDI stays out of the interface. There is no MIDI section, card, or download, and the composer does not accept a MIDI file. The backend still writes chord and bass MIDI. Export to Logic still copies those files into the export folder. The export confirmation lists them in the same file list as the audio, with no separate MIDI heading.

Explain runs on a Create result. One Claude call through the Bedrock provider writes both "How this was made" (the brief, the choices, and the reasons from the trace) and "Make it in Logic" (steps that use Logic's own instruments and plugins). When Bedrock is off or the call fails, a template is shown instead. The template lists each filled slot as "{label}: {value}. {reason}.", then "Choices: " and the trace details, then one Logic step per prompt: "In Logic, add a {layer} track and shape it with Logic's instruments and plugins until it matches: {prompt}."

Genre deep dive. The list is on the left of the page and the detail is on the right. Content comes from one markdown file per genre in `kb/genres`, not from the model. Each file is marked DRAFT for editing and has a short history, then traits: tempo range, a working BPM inside that range, typical keys, signature instruments, a drum pattern, and production techniques, then reference artists and tracks. The first files are lofi hip hop, house, techno, drum and bass, ambient, trap, synthwave, and neo soul.

The detail shows the history, the traits as a compact grid, and the references. Claude may only rephrase the history for readability. The traits and the references stay the file fields. When Bedrock is off or the call fails, the history is the file text.

Use in Create opens Create, prefills the traits as slots with source reference, and adds one thread line, "Using {title}." The prefill is: genre the title, tempo the working BPM, key the first typical key, palette the instruments, pattern the drum pattern, production the production techniques. Pattern and production are never asked. They exist so this prefill has a slot.

Soundcharts is `features.soundcharts`, off by default. While it is off, the detail does not show similar artists and does not call Soundcharts. No similar-artist list is invented.

Analyse, when it is built later: upload a track, report the basics and feedback, offer two or three alternatives, and compare them. Tweak, when it is built later: one sample, a change, three variations, and similar sounds. Neither room is clickable while its flag is off.

Hackathon scope:

| Room | Demo |
| --- | --- |
| Create | Live, including one sound, the explanation, and Make it in Logic |
| Genre deep dive | Live, from the curated files, with Use in Create |
| Analyse | Soon |
| Tweak | Soon |

Pitch line: "Hum it, describe it, or bring your track. Vision Studio makes the sound, explains how, and teaches you to make it yourself."
