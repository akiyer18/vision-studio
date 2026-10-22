# VISION STUDIO AI
## Product Vision and Training Mode Implementation Specification

## 1. Product Overview

Vision Studio AI is an educational AI production assistant designed to work directly inside a Digital Audio Workstation (DAW).

It helps music producers overcome creative blocks, understand their productions, explore new musical ideas, and develop their production and music theory skills while they are making music.

Vision Studio AI can analyse a user's production, identify areas for improvement, suggest alternative approaches, and generate specific musical elements or improvements. Crucially, it should explain what it changed, why it changed it, and how those changes affect the music.

The user should be able to hear the difference and, wherever supported, inspect how the result was created. This includes MIDI patterns, chord voicings, arrangement decisions, sound design, and audio processing such as EQ and compression.

The objective is not to replace the producer or take creative control away from them. It is to help them make better creative decisions and understand the techniques behind those decisions.

## 2. The Three Main Modes

The main Vision Studio AI dashboard should provide three distinct modes: Train, Analyze, and Create.

These modes should share the same underlying music context where technically possible, but each must have a clearly defined purpose.

### 2.1 TRAIN: Learn by Doing

Training Mode is an interactive learning environment that develops specific music production skills through practical exercises.

The user selects a training category and difficulty level, listens to a generated musical reference, recreates it inside their DAW, and compares their recreation against the reference.

Training Mode should help users understand how music is constructed rather than simply giving them a finished result.

The initial training categories are:

- Rhythm Training
- Harmony and Music Theory Training
- Sound Design Training
- Arrangement Training

The detailed exercises for Rhythm and Harmony are defined in this document. Sound Design and Arrangement are planned categories whose detailed exercise libraries will need to be specified separately.

### 2.2 ANALYZE: Understand and Improve Existing Music

Analyze Mode helps users understand what is happening in a track they have already created.

The system should inspect the available musical material and identify relevant areas for improvement, including:

- Rhythm and groove.
- Harmony and chord voicings.
- Arrangement and musical structure.
- Sound selection and sound design.
- Mixing and audio processing.

The analysis should be specific and actionable.

For example, rather than saying, "Your mix needs more clarity," the system should explain which elements are competing, where the problem is occurring, and what the user could try to improve it.

The workflow is:

**Analyze → Suggest → Apply**

The user should remain in control of whether a suggestion is applied.

When the required data is available, the system should let the user hear the proposed improvement and inspect the musical or processing changes that produced it.

### 2.3 CREATE: Explore Alternatives

Create Mode helps users overcome creative blocks by generating specific musical elements or alternative versions of existing material.

It should not default to generating an entire finished song. The emphasis is on helping the user improve or explore a particular part of their production.

For example, the user might say:

"I want this chorus to feel much bigger, but I don't want to add more instruments."

Vision Studio AI could suggest an alternative drum pattern, a different bass part, a new chord voicing, or a sound design treatment that creates a greater sense of impact.

The system should explain the creative reasoning behind its suggestions.

Where supported, users should be able to hear the alternative, compare it with their original, and inspect the MIDI, arrangement, or processing changes.

The workflow is:

**Describe the goal → Generate alternatives → Listen and compare → Inspect changes → Choose what to apply**

The user should be able to accept, reject, or modify suggestions.

---

# 3. Training Mode: Detailed Specification

## 3.1 Core Concept

Training Mode turns AI music generation into an interactive learning tool.

Instead of generating music for the user to consume, it generates short exercises designed to develop specific production skills.

The user listens to a reference, recreates it inside their DAW, and compares their result against the original.

The generated reference should be accompanied by structured musical information whenever possible. This may include MIDI, note positions, chord labels, tempo, bar count, and other relevant musical features.

This information is important for explaining how the original exercise was constructed and for making the comparison more reliable.

The core principle is:

**AI should not only help users make music. It should help them understand music and become better producers.**

## 3.2 Training User Flow

### Step 1: Choose a training category

Display four training categories:

**Rhythm Training**

Recreate drum patterns, bass lines, rhythmic variations, and grooves.

**Harmony Training**

Recreate chord progressions, inversions, voicings, and voice leading.

**Sound Design Training**

Recreate sounds and learn how their characteristics are produced.

**Arrangement Training**

Recreate musical structures, transitions, and the relationships between different sections of a track.

Each category should have a clear description explaining the skill the user will practise.

### Step 2: Choose the difficulty

Each category should support three difficulty levels.

**Beginner**

Focus on simple patterns, clearly identifiable musical elements, and minimal variation.

**Intermediate**

Introduce more complex rhythms, variations, inversions, voice leading, and other techniques relevant to the category.

**Advanced**

Introduce more sophisticated musical decisions, complex patterns, independent musical parts, and more demanding recreation tasks.

Difficulty must change the actual musical requirements of the exercise.

### Step 3: Generate the reference

Generate a short musical exercise using Stable Audio and the relevant category-specific prompt.

The generated exercise must follow the musical constraints defined for the selected training task.

Display the reference with playback controls so that users can listen to it repeatedly.

Where supported, provide MIDI or another structured representation of the generated music so that the underlying musical content can be inspected and compared.

### Step 4: Recreate the exercise

The user recreates the reference inside their DAW.

Display the exercise instructions throughout this stage so that the user can refer to the requirements while working.

The user should be able to submit their recreation in a supported format. Depending on the capabilities of the existing application, this might be an audio export, MIDI file, or another supported input.

Do not assume that the website can automatically access every DAW session. Inspect the existing integration and implement the submission flow around capabilities that are actually available.

### Step 5: Compare and learn

Compare the user's recreation with the reference.

Identify which elements match, which differ, and which are missing.

Explain the differences in terms relevant to the selected training category.

For example, the system should distinguish between reproducing the correct chord progression and reproducing the exact chord voicings. Similarly, it should distinguish between capturing the main drum groove and missing a specific fill.

The user should leave the exercise understanding what to improve and why.

---

# 4. Rhythm Training

Rhythm Training develops the user's ability to hear, understand, and recreate drum patterns and drum-and-bass grooves.

Provide two exercise types:

1. Drum Pattern Only
2. Drum Pattern + Bass Line

Each exercise type should support Beginner, Intermediate, and Advanced difficulty.

## 4.1 Drum Pattern Only

### Beginner

Generation prompt:

Create a 4-bar drum loop at 100 BPM. Kick on beats 1 and 3, snare on beats 2 and 4, with steady eighth-note hi-hats. Keep the pattern simple and consistent.

Learning objective:

Recognise and recreate a basic drum pattern with a steady pulse and consistent beat placement.

### Intermediate

Generation prompt:

Create a 4-bar drum loop at 100 BPM. Use a syncopated kick pattern, snare on beats 2 and 4, and sixteenth-note hi-hats with a few open hi-hats and velocity variations. Add one simple fill at the end of bar 4.

Learning objective:

Recreate syncopated kick patterns, hi-hat variations, velocity changes, and a basic drum fill.

### Advanced

Generation prompt:

Create a 4-bar drum loop at 100 BPM with a complex syncopated kick pattern, ghost notes around the main snare hits, varied sixteenth-note hi-hats with velocity and rhythmic variations, and a more detailed fill leading out of bar 4. Keep the groove musical rather than overly busy.

Learning objective:

Recreate complex grooves, ghost notes, rhythmic variation, and transitions between bars while maintaining a musical feel.

## 4.2 Drum Pattern + Bass Line

### Beginner

Generation prompt:

Create a 4-bar drum and bass loop at 100 BPM in A minor. Use a simple drum pattern with kick on beats 1 and 3, snare on beats 2 and 4, and steady eighth-note hi-hats. Add a simple bass line using root notes from A minor that follows the kick rhythm. Keep it repetitive and easy to identify by ear.

Learning objective:

Understand how a simple bass line follows and reinforces the rhythm established by the drums.

### Intermediate

Generation prompt:

Create a 4-bar drum and bass loop at 100 BPM in A minor. Use a syncopated kick pattern, snare on beats 2 and 4, and sixteenth-note hi-hats with some velocity variation. Add a bass line using notes from A minor that locks in with the kick but includes syncopation and rhythmic variation. Add a small variation in bar 4.

Learning objective:

Recreate a bass line that combines rhythmic variation with coordination between the bass and drums.

### Advanced

Generation prompt:

Create a 4-bar drum and bass loop at 100 BPM in A minor. Build a more complex groove with a syncopated kick, snare and ghost notes, and varied sixteenth-note hi-hats. Add an independent bass line in A minor using syncopation, rests, octave movement and rhythmic variation. Let the bass interact with the drums rather than simply following the kick, with a turnaround in bar 4.

Learning objective:

Understand how the bass and drums can operate as independent but coordinated musical parts.

## 4.3 Rhythm Analysis Requirements

The comparison system should analyse the following features where the submitted input supports them:

- Tempo and timing consistency.
- Kick and snare placement.
- Hi-hat subdivisions and rhythmic patterns.
- Syncopation and rhythmic variation.
- Velocity and accents when MIDI information is available.
- Ghost notes and drum fills.
- Bass notes, note lengths, rests, and octave movement.
- The rhythmic relationship between bass and drums.

The feedback should refer to specific bars, beats, or musical events whenever possible.

For example:

"The main kick and snare pattern is correct. However, the kick on beat 3 of bar 2 is missing, and the fill at the end of bar 4 does not match the reference."

Another example:

"Your bass line follows the kick consistently, but this exercise uses an independent bass rhythm in bar 3. Try keeping the kick pattern unchanged while moving the bass note to the offbeat."

These are examples of the intended feedback style, not fixed responses.

---

# 5. Harmony Training

Harmony Training teaches users to understand chord progressions, inversions, voice leading, and extended chord voicings.

The generated exercise should isolate the harmonic material so that the user can clearly hear and identify the chords.

## 5.1 Beginner: Basic Chord Progressions

Generation prompt:

Create a 4-bar chord progression at 100 BPM in C major using the Roman numeral progression I – V – vi – IV, with one chord per bar. Use simple root-position triads with no inversions, extensions, additional melodies, bass, or drums. Keep the rhythm simple and sustained so each chord is clearly identifiable.

Expected harmony: C – G – Am – F.

Learning objective:

Recognise the progression, identify the chords, and understand how Roman numerals relate to chord names within a key.

## 5.2 Intermediate: Inversions and Voice Leading

Generation prompt:

Create a 4-bar chord progression at 100 BPM in C major using I – V – vi – IV, with one chord per bar. Use chord inversions to create smooth voice leading, keeping common tones where possible and minimizing large jumps between voices. Use triads only, with no additional melodies, bass, or drums. Keep the rhythm simple so the differences in chord voicing are easy to hear and identify.

Expected harmony: C – G – Am – F, using inversions.

Learning objective:

Understand how chord inversions affect the position of notes and how voice leading creates smooth transitions between chords.

## 5.3 Advanced: Extended Voicings

Generation prompt:

Create a 4-bar chord progression at 100 BPM in E-flat major using vi – IV – I – V, with one chord per bar. Use inversions, smooth voice leading, and tasteful extended voicings with added color tones such as 7ths or 9ths. Keep the harmonic function of each chord clear while creating a more sophisticated progression. No additional melodies, bass, or drums.

Underlying harmony: Cm – A♭ – E♭ – B♭. Stable Audio has freedom in the voicings and extensions.

Learning objective:

Understand extended chords, harmonic colour, and sophisticated voice leading while maintaining the intended harmonic progression.

## 5.4 Harmony Analysis Requirements

The comparison system should evaluate:

- Chord progression and chord identity.
- Individual notes contained in each chord.
- Root position versus inversions.
- Voice leading between consecutive chords.
- Extensions such as sevenths and ninths.
- Tempo and chord duration.

The system must distinguish between harmonic correctness and voicing similarity.

For example, a user might reproduce C – G – Am – F correctly but use root-position triads instead of the inversions in the reference. The feedback should acknowledge that the progression is correct while explaining the difference in voicing.

For the advanced exercise, a different voicing may still be musically valid. The system should identify whether the underlying progression is correct before judging the exact notes against the reference.

---

# 6. Sound Design Training

Sound Design Training is part of the planned product scope, but the original Training Mode document does not define its exact exercise prompts.

The intended purpose is to teach users to recreate sounds and understand the characteristics that make those sounds distinctive.

Potential exercises could focus on:

- Attack, decay, sustain, and release.
- Filter and frequency characteristics.
- Modulation and movement.
- Distortion and effects.
- Transient characteristics.
- Changes in the sound over time.

The user should listen to a reference and attempt to recreate it with their own sound-design tools.

Where technically possible, the system should compare the reference and recreation using measurable audio characteristics and provide suggestions for improvement.

Do not claim that the system can identify exact synthesiser settings unless it has access to the relevant settings or can infer them reliably.

Detailed prompts and difficulty levels should be defined separately before implementing the full exercise library.

---

# 7. Arrangement Training

Arrangement Training is intended to teach users to understand and recreate musical structure.

The original document does not provide detailed prompts for this category, so its exact exercise requirements remain to be defined.

Potential exercises could ask users to recreate a short musical arrangement containing sections such as an introduction, verse, chorus, breakdown, or outro.

The comparison system could evaluate:

- Section order and duration.
- Timing of transitions.
- Entry and removal of musical layers.
- Changes in energy and density.
- Differences between the reference and the recreated arrangement.

Feedback should explain which sections or transitions differ and how those differences affect the overall musical structure.

---

# 8. Analysis and Feedback Architecture

Training Mode should use the same general analytical principles as Analyze Mode, while retaining its own educational objectives.

Analyze Mode examines an existing production and recommends improvements. Training Mode compares a user's recreation against a known reference and explains how to improve their skills.

The two modes can share technical components, but they should not be treated as identical workflows.

## 8.1 Analysis Pipeline

The recommended analysis pipeline is:

1. Retrieve the original reference and the requirements of the exercise.
2. Receive the user's submitted audio or MIDI.
3. Extract the musical features relevant to the exercise.
4. Compare the extracted features with the reference.
5. Identify matches, differences, and missing elements.
6. Generate educational feedback grounded in the comparison results.
7. Present the feedback alongside the reference and recreation where the interface supports it.

For MIDI inputs, compare note events, pitches, note durations, timing, velocity, and other available MIDI properties.

For audio inputs, use suitable audio analysis methods to estimate relevant musical features. Audio-based estimates should be treated as uncertain when the evidence is ambiguous.

An LLM can explain the findings in natural language, but should not invent measurements or claim that a musical event was detected when the analysis pipeline has not established it.

## 8.2 Feedback Format

Every completed exercise should aim to provide four types of feedback.

**What you got right**

Identify the musical elements that match the reference.

**What differs**

Identify the most relevant mismatches or missing elements.

**How to improve**

Provide practical, specific suggestions for correcting the differences.

**What to focus on next**

Recommend the most useful skill or musical concept for the user to practise.

An optional similarity score can be included if it is based on a defined and reliable comparison method. It should not replace detailed feedback.

The system should favour clear, actionable explanations over vague praise or generic criticism.

---

# 9. DAW Integration and Visibility

Vision Studio AI is intended to work directly inside the user's DAW. This is a central part of the product vision, not merely a place to export generated audio.

Users should be able to move between receiving guidance, hearing musical alternatives, and inspecting how those alternatives were constructed.

Where supported by the DAW integration, the system should make it possible to inspect or apply:

- MIDI patterns and note positions.
- Chord voicings and progressions.
- Arrangement changes.
- Individual musical parts.
- Sound design treatments.
- Processing changes such as EQ and compression.

The exact interaction model depends on the existing website, DAW integration, and available APIs.

Before implementing these capabilities, inspect the repository to determine whether Vision Studio AI currently runs as a DAW plugin, a connected application, a browser interface, or another integration.

Do not assume that a standalone website can automatically read or modify a user's DAW project. If direct integration is not available, implement a supported workflow using file import, file export, or another existing mechanism.

Any proposed change should be applied only when the user has chosen to accept it. Preserve the original material where possible so that the user can compare the original with the alternative.

---

# 10. Relationship Between Train, Analyze, and Create

The three modes should form a coherent learning and production experience.

**Train** develops the user's skills through structured exercises and reference comparisons.

**Analyze** helps the user understand an existing production and identifies possible improvements.

**Create** generates musical alternatives that help the user explore creative directions without handing over control of the entire production.

For example, a user working on a chorus could use Analyze to understand why the chorus lacks impact, Create to explore alternative drum patterns or chord voicings, and Train to practise the techniques involved.

This relationship should guide the architecture of the product. Shared analysis and generation components can support all three modes, but each mode must preserve its own purpose and interaction flow.

---

# 11. Implementation Instructions for Claude

Before making changes, inspect the existing repository and identify the current architecture, framework, UI components, audio generation integration, DAW integration, and any existing music analysis functionality.

Do not rebuild the application from scratch or introduce duplicate systems without first understanding what already exists.

Implement the feature in the following order.

### Phase 1: Understand the existing application

- Map the existing dashboard and navigation.
- Identify the current audio generation and playback flow.
- Identify available MIDI, audio upload, and analysis capabilities.
- Determine how the website interacts with the DAW.
- Reuse existing components and integrations where appropriate.

### Phase 2: Integrate the dashboard modes

Ensure that Train, Analyze, and Create are represented as distinct modes within the existing product.

Implement only the functionality supported by the current application and the requirements defined in this document. Clearly separate existing capabilities from features that still need to be developed.

### Phase 3: Implement Training Mode

Build the category and difficulty selection flow.

Prioritise Rhythm Training and Harmony Training because their exercise prompts and musical constraints are explicitly defined.

Preserve the supplied generation prompts and use them to configure the corresponding exercises.

Make the reference available for playback and retain structured musical information whenever possible.

### Phase 4: Implement comparison and feedback

Build the exercise submission and analysis workflow.

Use MIDI comparison where possible and appropriate audio analysis for audio-only submissions.

Generate feedback based on the measured differences between the reference and the user's recreation.

Handle unsupported input formats and analysis failures clearly.

### Phase 5: Connect the wider Vision Studio experience

Where the existing architecture supports it, connect the shared generation and analysis capabilities to Analyze and Create.

Allow users to hear alternatives, understand the reasoning behind suggestions, and inspect or apply changes through the available DAW integration.

Do not treat these advanced capabilities as complete merely because the interface has been created.

### Phase 6: Validate the implementation

Test the full user journey:

- Select a training category.
- Select a difficulty.
- Generate and play the reference.
- Submit a supported recreation.
- Compare the recreation with the reference.
- Review the resulting feedback.
- Recover gracefully from generation, upload, or analysis errors.

Also verify that the musical constraints of each specified Rhythm and Harmony exercise are preserved.

Keep the implementation modular so that new exercise templates, categories, and analysis methods can be added later.

---

# 12. Definition of Success

Vision Studio AI should help users become more capable music producers, not merely produce more audio.

A successful implementation allows a user to learn a musical concept through an exercise, understand an existing production through analysis, or explore a creative alternative without surrendering control of their work.

The user should be able to hear the result, understand the reasoning behind it, and inspect how it was made wherever the available integration permits.

**The guiding principle for every feature is simple: help the producer make better music while helping them understand how to do it themselves.**

---

# Addendum: Implementation Decisions (agreed for the hackathon build)

1. **MIDI is the ground truth.** Every exercise is first defined symbolically (drum hits on a 16 step grid per bar with velocities, bass notes with start, length and pitch, chords per bar with notes, inversion and extensions) and written as MIDI. That MIDI is rendered to audio with simple built in samples, then given production character with Stable Audio audio to audio at a low strength (about 0.25 to 0.35), using the generation prompt above as the sound prompt. Stable Audio alone cannot guarantee exact beat placement or chord voicings from text, so the comparison and feedback always use the MIDI definition.
2. **Verification.** After rendering, check the audio against the MIDI (drum onset timing within about 30 ms, chord chroma per bar). If verification fails, use the clean render and note it.
3. **Naming.** In the interface, "Drum Pattern + Bass Line" is shown as "Drums and bass line" so it is not confused with the drum and bass genre.
4. **Scope for the demo.** Rhythm Training (both types) and Harmony Training at all three levels are live. Sound Design and Arrangement are shown as Coming soon.
5. **DAW workflow.** The current product is a browser application with file based exchange: download the reference audio and MIDI into Logic, export the recreation as MIDI (preferred) or audio, upload it. No live DAW access is claimed.
6. **Feedback grounding.** The LLM receives only the structured comparison result and the exercise definition, and may only mention bars, beats and events present in that result.
