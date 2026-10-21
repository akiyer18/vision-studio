# Vision Studio product design

Oct 21, 2026 · @Aksh

## Vision

**Vision Studio is a producer's translator: describe what you hear in your head, in words, with your voice or with an instrument, and it turns that into sound, explains how it got there, and shows you how to make it yourself in Logic.**

The insight behind it: producers hear the music in their head, but building it in a DAW is slow and painful. Describing it in words, humming it, beatboxing it or playing it is easier. And a good tool should teach you, not just hand you a file.

## Three rooms, one verb each


| Room        | Verb               | What you bring                                                        | What you get                                                            |
| ----------- | ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Create**  | Make something new | Text, a sound (hum, beatbox, an instrument, a loop), or both together | Layers or one specific sound, plus how it was made                      |
| **Analyse** | Improve a track    | A track or a bounce from your DAW                                     | Feedback, alternatives, a comparison of what changed, and a genre guide |
| **Tweak**   | Reshape a sample   | One sample                                                            | New variations of that sample, and similar samples to explore           |


**Text and sound together:** yes. The system already sends text and audio features in the same turn, so "here's my beatbox, make it a dusty lo-fi kit" works out of the box. Make it the headline example.

### Create: make something new

1. **Bring the idea.** Type, record or drop a file, or combine them.
2. **Choose what you want:**
  - **Layers:** drums, chords, bass, melody, texture, all separately or as a mix.
  - **One specific sound,** in the style of a sample library request, such as "a snappy EDM snare" or "a warm 808". Defined by genre, duration, mood and **brightness** (how much high frequency content it has).
3. **The agent asks only what's missing,** at your level, and everything is skippable.
4. **Hear three variations,** pick one, or ask for another take.
5. **Learn from it:**
  - **How it was made:** the brief, the choices and the reasons.
  - **Make it in Logic:** step by step instructions to recreate the sound with Logic's own instruments and plugins.

### Analyse: improve a track

This is Valentina's requested workflow.

1. **Upload a track,** or a bounce from Logic.
2. **The analysis report:**
  - **The basics:** tempo, key, energy, brightness, how busy the rhythm is, and which instruments are present (from stem separation).
  - **Feedback in producer terms,** focused on instruments, rhythm and arrangement, for example "the hats mask the vocal range; the groove is very straight for this genre".
3. **Alternatives:** two or three versions generated from the track with Stable Audio, each guided by one suggestion: warmer, more swing, a lo-fi version.
4. **Comparison:** the original and each alternative side by side, with the AI explaining what changed and why.
5. **The genre guide:** the detected genre, a short history, and artists and tracks to study as references. Soundcharts supplies genres, similar artists and real tracks. Keep the history short and factual, because language models can invent details.

### Tweak: reshape a sample

1. Drop one sample.
2. Describe the change ("brighter", "punchier", "more vinyl") or use quick chips.
3. Set **how different** with one slider (Stable Audio's noise level, from "subtle" to "new sound").
4. Get three variations, each with an explanation of what changed.
5. Get suggestions for similar sounds to explore next.

## Everything explains itself

This runs across all three rooms and is what makes Vision Studio a teacher:

- Every result has a **"How this was made"** panel.
- Every alternative says **what changed**.
- Every created sound has **"Make it in Logic"** steps.
- The depth of explanation follows the user's level.

## How it maps onto what's built


| Need                                                               | Status      | What's needed                                                                                            |
| ------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------- |
| Create with text and sound together, the agent, the brief, prompts | Built       | Add the "one specific sound" mode and the level setting                                                  |
| Explain and "Make it in Logic"                                     | New, small  | One extra Claude call per result, using the brief and prompt                                             |
| Analysis report                                                    | New, medium | Extend the upload analysis (brightness, rhythm density, stem detection), then Claude writes the feedback |
| Alternatives and Tweak                                             | New, medium | One shared engine: Stable Audio audio to audio with a noise level                                        |
| Comparison                                                         | New, small  | Analysis features before and after, plus a Claude explanation                                            |
| Genre guide                                                        | New, small  | Soundcharts lookup, plus a short Claude summary                                                          |


Analyse and Tweak share one engine (audio in, guided variations out), so building one gives you most of the other.

## Hackathon scope


| Room        | For the demo                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------- |
| **Create**  | Fully live, including "one specific sound" and "Make it in Logic"                            |
| **Analyse** | Live if time allows: the report, one or two alternatives, the explanation and the genre card |
| **Tweak**   | Marked "Soon" in the sidebar, mentioned as the next step in the pitch                        |


Pitch line: "Hum it, describe it, or bring your track. Vision Studio makes the sound, explains how, and teaches you to make it yourself."

## Questions to settle as a team

1. Should the level be asked on first visit, or inferred from how people answer?
2. For "one specific sound", should we return one sound or the usual three variations?
3. In Analyse, do alternatives regenerate the whole track or only a selected section (inpainting)?
4. Which genres should the genre guide cover well for the demo? Pick two or three you and Valentina know deeply.

