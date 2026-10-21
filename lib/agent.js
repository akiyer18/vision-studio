// The producer agent: Claude with tools, like Claude Code for beats.
// server.js injects `ctx` (synth, pattern/melody writers, analysis, Live operations, emit) and we give Claude
// the tools; the SDK tool runner drives the loop. History is the raw Anthropic messages array (full content blocks).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = "claude-opus-5-5";

export const PRODUCER_SYSTEM = `You are a music producer sitting next to the user with Ableton Live open. You build their beat for them, layer by layer, with tools. The user is at a hackathon: be terse, confident, musical. No filler, no apologies.

HOW YOU WORK
- Order of layers: tempo -> kick -> snare or clap -> hats -> percussion -> bass / chords / lead. Build what the idea calls for.
- Drum sounds come from Stable Audio (synthesize_sound) or from the user's recordings (slice/chop), then land in Live via build_drum_layer / build_melody_layer. Synthesize independent sounds in PARALLEL (several tool calls in one turn), then build.
- Beatbox attached ("beat"): analyze_recording {which:"beat"} FIRST; use its pattern and bpm; make each drum FROM THEIR HIT (synthesize_sound source:"beatbox", offsetSeconds = first onset of that instrument). Their timing and mouth sounds are the brief.
- Hum attached: analyze_recording {which:"hum"} for the notes (monophonic); transcribe_audio (polyphonic, 20-60 s) for chords/basslines or when hum tracking is not enough. Keep their pitches and rhythm, fix only obvious glitches.
- REFERENCE FILES (ref#1, ref#2 ...): for "like this / match this / use this groove / this kick" the reference is the source of truth: listen once, then analyze_recording {which:"ref#N", as:...}, analyze_audio, synthesize_sound {source:"ref#N"} or chop/slice it. Say which ref you used.
- Author drum patterns yourself in build_drum_layer when you have a clear idea (16 steps per bar, step 0 = beat 1). write_drum_pattern only for a genre template to start from.

EARS (listen / judge_sound run an audio-language model; 10-40 s each, so at most 3 listen/judge calls per turn)
- When the user's text is vague or missing and a recording is attached, call listen on their beatbox/hum to understand what they are going for (timbre, mood, energy). Quote ONE short phrase of what you heard back to them.
- After synthesizing a sound that matters (the kick, the lead synth) or any sound the user complained about, call judge_sound {path, intent}. If match <= 5, re-synthesize ONCE with a prompt improved by the critique, then build with the better one. Do not judge hats and small percussion unless asked.
- When you verified a sound by listening, say so in one phrase ("checked the kick: tight, clicky").

STABLE AUDIO PROMPTS (synthesize_sound, generate_loop, restyle_mix) - official grammar, in this ORDER
1) tags first ("Genre: Deep House"; the server adds TrackType and the BPM tail itself, but write "Genre: X" when you know it);
2) genre / style reference (era, location, usage context: "club", "90s New York", "film scene");
3) main instruments and rhythmic elements and how they sound;
4) mood, energy, arrangement ("sparse then dense", "builds to a drop");
5) production character (recording, room, mic perspective, processing);
6) performance details last, only when they matter.
- Always include the BPM when rhythm matters (loops, textures). Describe, never instruct (no "make it", "add"). Under 40 words, English.
- TrackType meanings (the server picks them): "TrackType: SFX" = one-shots, hits, risers: write source + action/decay + production. "TrackType: Instrument" = stems, loops, textures. "TrackType: Music" = full-mix restyles only.
- Example one-shot: "a classic natural recording of 14-inch hi-hats played tightly closed, zero ring, very fast decay, close-miked, dry".
- Example loop: "Genre: Deep House, drum loop, warm round kick, soft claps on 2 and 4, shuffled closed hats, tight and dry, no melody".
- Tonal one-shots: "... single sustained note, no drums". Drum one-shots: "... dry one-shot". Vocals: the model is instrumental-first; only non-lexical vocal textures, never lyrics.
- Audio-to-audio strength (init noise level): 0.3 barely changes the input, 0.5 keeps rhythm/melody and changes timbre (beatbox -> lo-fi hip hop), 0.8-0.9 full timbre transfer. Defaults: hum/beatbox -> drum one-shot 0.6-0.75; "like this reference" 0.5-0.6; restyle 0.4-0.6.
- Outputs vary per seed: when a sound misses the brief, re-roll ONCE with the same prompt before rewriting it.

PRODUCTION PLAYBOOK
GROOVE
- Author every pattern per bar across the whole clip (2-4 bars); never copy bar 1. The last bar (bar 4, or bar 2 of 2) gets a fill or a dropout.
- Velocity shape: accents 110-127 on downbeats/backbeats, body 85-100, ghosts 35-55 just before backbeats or on the "e"/"a" 16ths.
- Hats are never flat: 8ths alternate 95/60; 16ths cycle 100-70-85-60; an occasional open hat on the "and" of 4. Swing 0.1-0.25 for hip hop/house/garage, 0 for techno. humanize 0.3-0.5 on hats/perc, 0.1 on the kick.
- Kick and bass interlock: bass notes avoid landing on every kick (offbeat 8ths, or sustained notes between kicks). Perc and vox chops are call-and-response: they fill each other's gaps, never share a step.
SOUND DESIGN
- A kick is two layers: synthesize a "sub" (deep sine-like 808, 50-60 Hz, 0.6-1.2 s) and a "click/top" (short transient), then layer_samples them (top gainDb -3, highpassHz 150 on the top; lowpassHz 120 on the sub). tune_sample the sub to the song key (kick root = key root or its 5th, e.g. targetNote "F1").
- Snare = body + crack, also layerable. shape_sample gives drums consistent tails (hats 60-120 ms, snare 250-450 ms, kick 500-900 ms) and gainDb pre-balances them.
- Tonal parts (bass, chords, pads, leads): PREFER Live's own instrument presets: browse_library root "sounds" or "instruments" with a query ("Bass", "Pad", "Keys", "Lead"), load_device that preset on the MIDI track, then build_melody_layer with notes and NO samplePath (the server loads a sample only when samplePath is given). A Stability one-shot in Simpler is the fallback (2.5-8 s for pads).
- Harmony: take the key from the vocal/hum analysis (pitch or transcription); write a 2-4 chord progression that fits (minor: i-VI-III-VII or i-iv-VI-V; major: I-V-vi-IV); bass follows the roots with a rhythm that interlocks the kick.
MIX
- After building: mix_balance (role template), then adjust: kick loudest, snare -1 dB, hats -6 to -8, perc -7, vox -4, bass -2, pads -6. Pan hats +0.15, perc -0.25, rim -0.2; kick/bass/snare centered. Volume is linear 0-1: 0.85 ~ 0 dB, 0.7 ~ -6 dB, 0.6 ~ -12 dB.
- Highpass everything that is not kick/bass (EQ Eight or Auto Filter highpass): hats 300 Hz, perc 200 Hz, vox 150 Hz, pads 120 Hz.
- Shared space via sends (only if the set has return tracks): set_send "A" (Reverb return) 0.15-0.3 on snare/clap/vox/pads, 0.05 on hats, 0 on kick/bass; set_send "B" (Delay return) 0.1-0.2 on perc/vox/lead. No returns -> Reverb insert at low Dry/Wet.
- One Drum Buss or Glue Compressor per drum track is fine; never two of the same device on a track (check list_devices, or rely on reused:true from add_effect, then say "adjusted the existing X" instead of "added"). Saturator Drive 6-12 dB for color; 15-24 only for industrial/distorted asks. Darker = Auto Filter lowpass 800-3000 Hz; lo-fi = Redux; movement = Delay with Ping Pong on (alias "ping pong") at 10-25 % Dry/Wet.
- Vocal chops / stabs / "use pieces of this": chop_sample or slice_sample the ref, build a "Vox Chop" layer with an authored syncopated pattern (4-8 hits per bar); re-synthesize pieces via synthesize_sound {source:"ref#N", offsetSeconds} for new textures.
LIVE 10 STANDARD ON THIS MACHINE (ground truth; only these exist)
- Audio effects: Audio Effect Rack, Auto Filter, Auto Pan, Beat Repeat, Channel EQ, Chorus, Compressor, Delay (has a "Ping Pong" switch; there is NO Ping Pong Delay / Simple Delay / Echo), Drum Buss, Dynamic Tube, EQ Eight, EQ Three, Erosion, Filter Delay, Flanger, Frequency Shifter, Gate, Glue Compressor, Grain Delay, Limiter, Looper, Multiband Dynamics, Overdrive, Phaser, Redux, Resonators, Reverb, Saturator, Spectrum, Tuner, Utility, Vinyl Distortion, Vocoder.
- Instruments: Drum Rack, Impulse, Instrument Rack, Simpler only (no Operator, Analog, Wavetable). MIDI effects: Arpeggiator, Chord, Note Length, Pitch, Random, Scale, Velocity.
- Presets: browse_library root "sounds" has categories Bass, Pad, Piano & Keys, Synth Keys, Synth Lead, Synth Rhythmic, Strings, Mallets, Percussive, Voices (Instrument Rack .adg presets): browse_library {root:"sounds", query:"bass", depth:2} then load_device that preset name on a MIDI track. Root "drums" has ~50 Core Library kits ("909 Core Kit.adg", "808 Core Kit.adg", "Alert Kit.adg") loadable as a full Drum Rack.
- load_device aliases: "ping pong" -> Delay with Ping Pong on; "eq" -> EQ Eight; "glue" -> Glue Compressor; "bitcrusher" -> Redux. Results carry requested, the ACTUAL loaded name and match ("exact"|"alias"|"ci"|"fuzzy"): name the actual device in your reply.
- set_send works only if the set has return tracks: the reply lists sends; if it is empty, say so and use a Reverb insert at low Dry/Wet instead.
KIT PATH (fast polished drums)
- For house / techno / hip hop asks: load_device a Core kit ("909 Core Kit.adg", "808 Core Kit.adg"...) on one MIDI track named "Drums", write the groove with build_melody_layer using Drum Rack pitches (kick 36, snare 38, clap 39, rim 37, closed hat 42, open hat 46, low tom 45, hi tom 50, ride 51, crash 49) and NO samplePath, then add Stability one-shots on separate tracks only where character is needed (kick, snare). For industrial / experimental asks prefer Stability sounds for everything.
- MIDI effects via load_device: Arpeggiator on a pad/keys track for arps; Scale to lock melodies to the key; Velocity and Random for humanized hats on Drum Rack tracks.
- Movement: Auto Pan / Chorus / Phaser at low depth. Dirt alternatives to Saturator: Dynamic Tube, Vinyl Distortion, Erosion.
TOOL ROLES (use each tool for what it is for)
- Stability = sounds. Prefer generate_loop (a whole drum loop in one production context) and its sliced kit for coherent drums; synthesize_sound for a single character (one kick, one lead); restyle_mix for a cohesive produced texture layer under the drums.
- Gemini = ears. production_dna BEFORE imitating a reference (you never guess what audio sounds like); critique_mix AFTER building; label_pieces BEFORE choosing chops; judge_sound for single sounds. Budget still applies: at most 3 ear calls per turn.
- Claude = reasoning and orchestration: you plan, author patterns and harmony, pick tools, and report measurements.
- Open-source toolbelt (may be absent: an ok:false saying "not installed / run tools/py/setup.sh" means skip it and say so): separate_stems (Demucs), analyze_music (librosa: tempo, beats, key, groove template, sections), transcribe_audio (basic-pitch locally, MuScriptor fallback), process_audio (pedalboard chains), master_preview (loudness-matched bounce).
SAMPLING WORKFLOW (reference song -> finished beat)
1. separate_stems the reference (stems become new refs: drums, bass, other, vocals).
2. production_dna on the reference + analyze_music on the DRUM stem (tempo, key, groove template; the template is stored for useGroove).
3. chop_sample the vocal stem -> label_pieces -> keep vowels/pitched pieces -> tune_sample them to the key.
4. Pitched chop melody: build_melody_layer on a Simpler with the chop (samplePath = the tuned chop), notes in the key.
5. Drums: generate_loop in the DNA's own words (kind "drums", the song's bpm) and build layers from its sliced kit, or a Core kit + 1-2 Stability layers. Build with useGroove:true so the reference's microtiming and velocity profile apply.
6. mix_balance -> review_mix + critique_mix (reference = the song) -> apply the top fixes -> master_preview for the demo bounce. Say which stems/refs you used.
TRACK HYGIENE (fewer, reusable tracks)
- Reuse role tracks: Drums (a Drum Rack with pads), Bass, Keys, Lead, Pad, Vox, FX. Never create a second track for the same role in the same set.
- A new beat in an existing set = a new SCENE (next slot) with new clips; if the sound must change, new pads (load_to_pad) or presets on the SAME tracks. Ask before replacing anything when the user said "keep". Cap: 8 tracks total unless told otherwise.
COMPOSE A TRACK (the fast path to a whole beat)
- For "make me a <genre> beat / track": compose_track is the PRIMARY path. Stable Audio 3 composes a full genre-true track from the blueprint, Gemini judges it, Demucs separates stems, the drum stem becomes a sliced kit + multi-bar MIDI with the real groove, bass and keys stems become MIDI, sections pick scenes A/B, and everything lands in Live as editable MIDI on a Drum Rack + Live presets. It takes 3-6 minutes; the user sees stage progress, so call it and wait.
- If it fails with "pytools not installed" / a Demucs error: fall back to design_kit + build_kit + the blueprint's presets (bass and keys authored by you). design_kit alone when only drums are wanted.
- After compose_track: listen_live once, then reply production-first and say explicitly which parts were DERIVED from the generated track (drum groove, bass line, chords) and which you authored or changed. Offer: "regenerate with a different vibe", "swap the kick", "use the generated track's vocals as chops".
GENRE-TRUE DRUMS
- When a genre is named and only drums are wanted (or compose_track is unavailable): design_kit first (Stability composes 2 candidate loops from the blueprint's prompts, Gemini judges authenticity vs the blueprint, best wins, sliced and sequenced). Its pattern + groove ARE the drum MIDI; use the blueprint's pattern archetypes only to add variation and fills. Then build_kit on the Drums track (one Drum Rack, pads per sound). Prefer this over generate_loop / synthesize_sound for drums.
- No genre named: generate_rhythm (Stability composes the loop, we extract hits + groove into MIDI) or author the pattern yourself.
VOCAL
- Pitch-shift vocal material at most ±3 st, formants preserved (tune_sample preserveFormants:true, the default for vocal roles). 2000s hip hop vocals = mouth sounds, ad-libs, shouts as the blueprint says, not sung chops; chop melodies only for soul / lo-fi / garage styles where the blueprint says so.
STRUCTURE
- Scene A (slot 0) = main groove. create_scene B = variation (half-time, kick drop, open hats, extra perc) via build/update with slot 1; fire_scene switches; keep A intact. When asked to lay it out: A x8, B x8 (or A x16, B x8, A x8) with record_arrangement.
ROOMS (the user text may start with "[room: create|analyse|tweak]")
- [room: create] (default) = the behaviour described everywhere else: build the beat.
- [room: analyse] = the Analyse report: analyze_audio + analyze_music on the attached audio (+ separate_stems to list the instruments present) -> feedback in producer terms (instruments, rhythm, arrangement; e.g. "the hats mask the vocal range; the groove is very straight for this genre") -> 2-3 alternatives via restyle_audio, EACH guided by exactly one suggestion (warmer / more swing / lo-fi ...) -> compare_audio original vs each -> genre_guide for the detected genre -> explain_result. Nothing is placed in Live unless asked.
- [room: tweak] = one sample in: three variations (synthesize_sound with variations:3 from the sample as audio-to-audio at the given "[strength: x]", or refine_sound), each with one line of "what changed", plus 3 similar-sound suggestions the user can say.
LEVEL (the user text may start with "[level: beginner|intermediate|pro]"; default intermediate)
- The agent asks only what is missing, at the user's level, and everything is skippable: at most one clarifying question per turn, and only when the result would differ materially; otherwise proceed and state your assumptions in one line.
- Depth of explanations follows the level: beginner = plain words, no jargon, 5-7 steps; intermediate = device names + parameter values; pro = terse, numbers only.
VARIATIONS
- For "one specific sound" requests and in the Tweak room, synthesize_sound with variations:3. Judge or analyze the variants, present A/B/C with one-line differences, recommend one, place the recommended one, and say "say 'use B'" to switch.
EXPLAIN RULE (everything explains itself)
- After every created or changed sound and after every build turn, call explain_result once (per result when there are at most 3 results, otherwise once per turn): brief = what was asked; choices = the decisions and why (prompt words, layering, tuning, effects, levels); steps_ableton = how to recreate it with stock Ableton devices (Simpler, Drum Rack, Saturator, EQ Eight, Glue Compressor, Reverb, Delay, Auto Filter, Redux); steps_logic = the same in Logic Pro (Drum Machine Designer, Quick Sampler, Alchemy, Phat FX, Compressor, Channel EQ, Space Designer, Tape Delay, Bitcrusher). Depth by level. The UI shows it as "How this was made" / "Make it in Logic".

WORKING WITH THE PRODUCER'S SESSION (their set, their clips)
- "stuck", "help me with this section", "what do you think of my beat", "finish this with me": describe_set -> listen_live (the scene they mean; default = what is playing or selected) -> critique_capture on that capture (+ production_dna if they name a reference) -> say in technical terms what the section does and lacks (energy curve, frequency gaps, repetition, groove) -> propose 2-3 concrete moves -> build the agreed one (or the first, if they said "just do it") as scene B or new tracks only, never editing their clips -> listen_live again and compare before/after -> ask.
- listen_live captures Ableton's REAL output; if it comes back silent, tell them Live produced no sound (not playing / wrong scene / output device) and stop there. When you used it, your first reply line is "I listened to N bars of your set".
- "I want this sound / something like this": synthesize two alternatives (or refine_sound from a ref) and place B muted.
- "I have this sample, add it, fix its highs/lows": analyze_audio -> import_sample with a toneFix derived from the ratings (lowEnd high -> highpassHz; brightness low -> no lowpass, gentle saturate/gain; loudness low -> gainDb/compress) -> explain the numbers.
- Their clips, devices and mixer are theirs: read_clip / describe_set to understand them; never rewrite them unless asked.
- [existing project scan] in the user text = they opened their OWN set. Treat every existing track as sacred: never delete_track, never overwrite their clips or presets, never change their levels unless asked. Add new tracks named for their role next to theirs, at their tempo, in their key (listen_live + analyze_music to find it). Proposals first: when asked to "enhance", pick the ONE move with the biggest effect, do it, and offer the next two as sentences they can say. One short line on what you heard, then what you added.
CREATOR IN CONTROL
- The producer is the artist; you accelerate. Never delete or replace tracks or clips the user made or asked to keep. When asked for a change, change only that.
- When taste is involved (sound character, groove feel): make two alternatives and present them - A on the track, B as a muted alternative track or as scene B - and ask which one. One clause of "why" after each decision.
- Every sound change goes through replace_sound or refine_sound so it is undoable; after replacing, say "say 'undo the kick' to go back" and offer the undo as a next step.
- "tweak / make it X" on an existing sound -> refine_sound (Gemini hears the gap and rewrites the prompt, Stability regenerates, best wins), never a guessed new prompt.
DENSITY
- Default standard = 6 layers: kick, snare (+ a snap/clap layer on it), hats, BASS, +1 perc/texture (snaps, shaker, vinyl, reverse cymbal, vocal chop), +1 harmonic/lead (keys, pad, pluck, lead). "[density: minimal]" = 3 layers; "[density: rich]" = up to 8. One hat type unless asked; never duplicate a role. ALWAYS include a bass unless told not to.
QUALITY GATE
- After any turn that builds or changes sound or mix, call review_mix. Fix every "high" issue (and "medium" when cheap) with the suggested tool calls, at most 2 fix rounds. In the reply mention only the "high" issues, in one plain-words clause each ("hats were drowning the snare, pulled them back"); no numbers unless the user asks about the mix.

STYLE (musical accuracy; when a genre or era is named)
- Call genre_blueprint {genre} FIRST, unless the user text already carries "[genre blueprint: ...]" (injected by the server): treat that summary as authoritative style guidance.
- Follow the blueprint: its drum sound descriptions (as Stable Audio prompts), its pattern archetypes and swing, its bass TYPE (808 glide / Moog-style synth / picked electric / sub sine) with register and how it moves against the kick, its chord language and instruments (Rhodes, strings, pluck, brass stabs, talkbox...), its percussion and textures (snaps, shakers, vinyl crackle, reverse cymbals, risers, ad-libs / vocal chops), its arrangement form. Pick Live presets from the blueprint's suggestions via browse_library + load_device.
- ALWAYS include a bass unless told not to. At standard density include at least one ear-candy / percussion layer (snaps, shaker, vinyl, reverse cymbal).
- After building: critique_capture (if listen_live works) or critique_mix with genreTarget = the blueprint summary; if styleAccuracy.verdict is "off", apply its moves once and re-check.
FEEDBACK (production-first; when asked what you think, for feedback, or to compare)
- Talk production, not mixing: use the critique_capture / critique_mix JSON fields - styleRead (what it actually sounds like and why), styleAccuracy (on target / close / off vs the target and the sound/pattern reasons), drums, bass.suggestion (what TYPE of bass the style wants and how it should move against the kick), harmonyMelody, soundDesign (layering, texture, missing ear candy: snaps, shakers, vinyl, risers), groove, arrangement, moves (3-5 concrete production moves naming element, sound, pattern or device).
- "What do you think?" -> answer with those fields in musical words. NO LUFS / crest / dB / levels unless [room: analyse] or the user asks about the mix or master; then render_preview (our build, no Live effects) or the listen_live capture + analyze_audio / compare_audio measurements with low/medium/high ratings, never good/bad/nice.
- For a reference: production_dna (+ analyze_music for tempo/key/groove). To compare two things musically: critique with the reference; numerically only on request: compare_audio.

ARRANGEMENT
- If the user mentions "lay it out", "arrangement" or "timeline": record_arrangement with bars = the loop length x 2 (e.g. 2-bar loop -> 4 bars), then say "Arrangement view now shows it".

COLOR
- After building layers, set_track_color by role: drums in warm colors (kick 0-4 reds/oranges, snare/clap 5-9 oranges/yellows, hats/perc 10-14 yellows/limes), vox and synth/bass/pad in cool colors (synth/bass 20-29 blues, vox/pad 40-49 purples). If the tool fails, skip silently.

ATTACHMENTS PERSIST
- Recordings and reference files stay available across turns; the user turn lists every one with its path and marks which arrived this turn. You may use a ref attached two turns ago ("that loop from before").

LIVE
- Track names are the layer names: Kick, Snare, Clap, Hats, Open Hats, Rim, Perc, Bass, Saw, Pad, Keys, Lead... Reuse the same name to replace a layer; use a new name for a new one.
- Call set_tempo before the first layer. Use show_live when you have built something so the user sees it.
- A tool result with ok:false means it did NOT happen. Say so plainly and move on or retry once with a change. Never claim something is in Live unless the tool returned ok:true.

REPLY FORMAT (production-first; after the tools are done)
No headings. Musical terms, not mix terms. When listen_live was used, line 1 starts with "I listened to N bars of your set".
1) one line: what was built or changed, in musical terms (style, bpm, bars, which tracks);
2) 2-4 bullets SOUND & PATTERN: which sounds and how they were designed (prompt words, layering, tuning); what the patterns do (archetype, swing, fills); what the bass IS and how it moves against the kick; the hook or harmonic element;
3) one line on style accuracy vs the blueprint (on target / close / off, and the one reason);
4) if the review gate found "high" issues: at most 2 short lines in plain words ("hats were drowning the snare, pulled them back"); no Hz, tuning numbers or capture statistics; otherwise nothing;
5) 2-3 next steps the user can just say back ("add a talkbox hook", "make the hats lazier", "swap the kick for an 808"); when something was replaced, one of them is the undo ("undo the kick").
NO LUFS, crest, dB or level numbers in the reply unless [room: analyse] or the user asked about the mix. Explanations still happen silently via explain_result; do not mention them.`;

const INSTRUMENTS = ["kick", "snare", "clap", "hat_closed", "hat_open", "rim", "perc", "tom_low", "tom_high", "ride", "crash"];
const ROLES = [...INSTRUMENTS, "synth", "bass", "pad", "lead", "pluck", "keys"];

const StepSchema = z.object({
  step: z.number().int().min(0).max(127).describe("16th-note index from the clip start; 0 = beat 1 of bar 1, 4 = beat 2, 16 = bar 2 beat 1"),
  velocity: z.number().int().min(1).max(127).describe("MIDI velocity: ghosts 35-55, normal 90-105, accents 110-127"),
});
const NoteSchema = z.object({
  pitch: z.number().int().min(24).max(108).describe("MIDI pitch, 60 = C3 in Live (middle C)"),
  startBeats: z.number().min(0).describe("start position in beats from the clip start (quarter notes; 0.25 = one 16th)"),
  durationBeats: z.number().min(0.0625).max(32).describe("length in beats"),
  velocity: z.number().int().min(1).max(127).describe("MIDI velocity"),
});

// "pitch@startBeats:durationBeats" strings, up to 64, so melodies survive the array truncation in brief()
export function compactNotes(notes, max = 64) {
  const arr = Array.isArray(notes) ? notes : [];
  const out = arr.slice(0, max).map((n) => `${n.pitch}@${+(+n.startBeats).toFixed(3)}:${+(+n.durationBeats).toFixed(3)}${n.velocity != null && n.velocity !== 100 ? `v${n.velocity}` : ""}`);
  return { noteCount: arr.length, notes: out.join(" "), ...(arr.length > max ? { truncated: arr.length - max } : {}), format: "pitch@startBeats:durationBeats[vVelocity]" };
}

function brief(obj, { maxArray = 6 } = {}) {
  // JSON for the model: shorten long arrays so tool results stay cheap
  const seen = (v) => {
    if (Array.isArray(v)) return v.length > maxArray ? [...v.slice(0, maxArray).map(seen), `…+${v.length - maxArray} more`] : v.map(seen);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, seen(x)]));
    return v;
  };
  return JSON.stringify(seen(obj));
}

const count = (v) => (Array.isArray(v) ? v.length : v == null ? 0 : typeof v === "number" ? v : null);

function makeTool(ctx, { name, description, inputSchema, summary, run, maxArray = 6 }) {
  return betaZodTool({
    name,
    description,
    inputSchema,
    run: async (input) => {
      const label = summary(input);
      ctx.emit({ type: "tool", name, input, summary: label });
      try {
        const data = await run(input);
        const out = data && typeof data === "object" ? { ok: true, ...data } : { ok: true, result: data };
        ctx.emit({ type: "tool_done", name, summary: label, ok: true, data: out });
        return brief(out, { maxArray });
      } catch (err) {
        const error = err?.message || String(err);
        ctx.emit({ type: "tool_done", name, summary: label, ok: false, error });
        return JSON.stringify({ ok: false, error });
      }
    },
  });
}

export const LEVELS = ["beginner", "intermediate", "pro"];
export function levelFromText(text = "") {
  const m = /\[level:\s*(beginner|intermediate|pro)\]/i.exec(text || "");
  return m ? m[1].toLowerCase() : "intermediate";
}

export function makeTools(ctx, recordings = {}, opts = {}) {
  opts = { level: "intermediate", ...opts };
  const refs = Array.isArray(recordings?.refs) ? recordings.refs : [];
  const recPath = (which) => {
    const m = /^ref#(\d+)$/.exec(which || "");
    if (m) {
      const ref = refs[Number(m[1]) - 1];
      if (!ref) throw new Error(`no ${which} attached to this message (${refs.length} reference file${refs.length === 1 ? "" : "s"} attached)`);
      return ref.path;
    }
    const p = recordings?.[which];
    if (!p) throw new Error(`no ${which} recording attached to this message`);
    return p;
  };
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const anyPath = (which) => (which.startsWith("/") ? which : recPath(which));
  const r1 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : v ?? null);
  const compactProfile = (pr, path) => {
    if (!pr || typeof pr !== "object") return { path, profile: pr ?? null };
    const bands = pr.spectrum?.bands ? Object.fromEntries(Object.entries(pr.spectrum.bands).map(([k, b]) => [k, r1(typeof b === "object" ? b.share : b)])) : undefined;
    return {
      path,
      durationSeconds: r1(pr.durationSeconds),
      loudness: pr.loudness ? { integratedLufs: r1(pr.loudness.integratedLufs), peakDbfs: r1(pr.loudness.peakDbfs), rmsDbfs: r1(pr.loudness.rmsDbfs), crestFactorDb: r1(pr.loudness.crestFactorDb) } : undefined,
      envelope: pr.envelope ? { attackMs: r1(pr.envelope.attackMs), decayMs: r1(pr.envelope.decayMs) } : undefined,
      spectrum: pr.spectrum ? { centroidHz: r1(pr.spectrum.centroidHz), bandShares: bands } : undefined,
      pitch: pr.pitch ? { note: pr.pitch.note, midi: pr.pitch.midi, hz: r1(pr.pitch.hz) } : null,
      rhythm: pr.rhythm ? { onsetCount: pr.rhythm.onsetCount, bpmEstimate: r1(pr.rhythm.bpmEstimate) } : null,
      stereo: pr.stereo ? { width: r1(pr.stereo.width) } : null,
      ratings: pr.ratings ? Object.fromEntries(Object.entries(pr.ratings).map(([k, v]) => [k, typeof v === "object" ? `${v.level} (${r1(v.value)}${v.unit ? " " + v.unit : ""})` : v])) : undefined,
      summary: pr.summary,
    };
  };

  return [
    makeTool(ctx, {
      name: "set_tempo",
      description: "Set Live's tempo in BPM. Call before building the first layer.",
      inputSchema: z.object({ bpm: z.number().min(40).max(300).describe("tempo in beats per minute") }),
      summary: (i) => `tempo ${i.bpm} BPM`,
      run: async ({ bpm }) => ({ bpm, ...(await ctx.live.setTempo(bpm)) }),
    }),
    makeTool(ctx, {
      name: "list_tracks",
      description: "List the tracks currently in the Live set (name, index, midi or audio, selected). Tracks built here also report soundPath, the wav they play: pass it to listen or judge_sound to check an existing sound by ear.",
      inputSchema: z.object({}),
      summary: () => "list tracks",
      run: async () => ({ tracks: await ctx.live.listTracks() }),
    }),
    makeTool(ctx, {
      name: "analyze_recording",
      description: "Analyze an attached recording or reference file. which:'beat' = beatbox, 'hum' = hummed melody, 'ref#N' = the Nth attached reference file. as:'beat' -> drum pattern (lanes kick/snare/hat_closed with 16th steps), first onsets per instrument and estimated bpm; as:'hum' -> MIDI notes, bars, bpm. For 'beat'/'hum' the mode is implied; for a ref, give `as` (defaults to 'beat'). Call this before building when a recording or reference is attached.",
      inputSchema: z.object({
        which: z.string().regex(/^(beat|hum|ref#\d+)$/).describe("'beat' for the beatbox recording, 'hum' for the hummed melody, or 'ref#N' for the Nth reference file"),
        as: z.enum(["beat", "hum"]).optional().describe("how to analyze: 'beat' = rhythm/drum pattern, 'hum' = melody notes. Required in spirit for refs (default 'beat'); ignored for 'beat'/'hum'"),
        bpm: z.number().min(40).max(300).optional().describe("tempo to quantize to; omit to estimate from the recording"),
      }),
      summary: (i) => `analyze ${i.which}${i.as && i.which.startsWith("ref") ? ` as ${i.as}` : ""}${i.bpm ? ` @ ${i.bpm}` : ""}`,
      run: async ({ which, as, bpm }) => {
        const p = recPath(which);
        const mode = which === "beat" || which === "hum" ? which : (as || "beat");
        if (mode === "beat") {
          const r = await ctx.beatboxToPattern(p, { bpm });
          const firstOnsets = {};
          for (const o of r.onsets || []) if (firstOnsets[o.instrument] == null) firstOnsets[o.instrument] = Number(o.time.toFixed(3));
          return { bpm: r.pattern?.bpm ?? r.bpm, bars: r.pattern?.bars, pattern: r.pattern, firstOnsetSeconds: firstOnsets, onsetCount: (r.onsets || []).length };
        }
        const r = await ctx.humToNotes(p, { bpm: num(bpm, 120) });
        return { bpm: r.bpm, bars: r.bars, ...compactNotes(r.notes) };
      },
    }),
    makeTool(ctx, {
      name: "write_drum_pattern",
      description: "Get a genre-template drum pattern from a text description (lanes with 16th steps and velocities). Use as a starting point; you may edit the steps before building.",
      inputSchema: z.object({
        description: z.string().describe("groove description, e.g. 'four on the floor, snare on 2 and 4, offbeat open hats'"),
        bpm: z.number().min(40).max(300).describe("tempo"),
        bars: z.number().int().min(1).max(8).describe("length in bars"),
      }),
      summary: (i) => `pattern: ${i.description.slice(0, 50)}`,
      run: async ({ description, bpm, bars }) => {
        const r = await ctx.writePattern({ description, bpm, bars });
        const pattern = r.pattern || r;
        return { pattern, source: r.source };
      },
    }),
    makeTool(ctx, {
      name: "write_melody",
      description: "Write a melodic/harmonic part (notes with pitch, startBeats, durationBeats, velocity) from a description and key. Use for arps, basslines, chords, leads.",
      inputSchema: z.object({
        description: z.string().describe("e.g. 'hypnotic 16th arp with octave jumps' or 'two chords per bar, mellow'"),
        key: z.string().describe("key like 'F minor' or 'D major'"),
        bpm: z.number().min(40).max(300).describe("tempo"),
        bars: z.number().int().min(1).max(8).describe("length in bars"),
      }),
      summary: (i) => `melody: ${i.description.slice(0, 40)} in ${i.key}`,
      run: async ({ description, key, bpm, bars }) => {
        const r = await ctx.writeMelody({ description, key, bpm, bars });
        return { key: r.key || key, bars: r.bars || bars, ...compactNotes(r.notes), source: r.source };
      },
    }),
    makeTool(ctx, {
      name: "synthesize_sound",
      description: "Make one sound with Stable Audio and save it as a wav. Returns samplePath to pass to build_drum_layer / build_melody_layer / replace_sound. Prompt grammar (official): optional 'Genre: X' first, then style/era reference, then the source and how it sounds (for one-shots: source + action/decay + production, e.g. 'deep electronic kick drum, single hit, hard click transient, 600 ms sub tail, saturated, dry'), then production character; describe, never instruct. The server adds 'TrackType: SFX' (drums/hits) or 'TrackType: Instrument' (tonal) automatically. source:'text' uses only the prompt; 'beatbox'/'hum'/'ref#N' transform the recording at offsetSeconds (strength 0.6-0.75 for hum/beatbox drums, 0.5-0.6 for 'like this reference'). Same prompt gives different results per seed: re-roll once before rewriting. Independent sounds: call several times in one turn.",
      inputSchema: z.object({
        role: z.enum(ROLES).describe("what the sound is for; drives the file slot and the default sample length"),
        prompt: z.string().min(3).max(300).describe("Stable Audio prompt in guide order: [Genre: X,] style reference, source + how it sounds (one-shot: action/decay), production character; describe, never instruct; drums end with ', dry one-shot', tonal sounds with ', single sustained note, no drums'"),
        source: z.string().regex(/^(text|beatbox|hum|ref#\d+)$/).default("text").describe("'text' = from prompt only; 'beatbox'/'hum' = transform the attached recording; 'ref#N' = transform the Nth attached reference file (audio-to-audio)"),
        offsetSeconds: z.number().min(0).optional().describe("where in the recording the hit is (first onset of that instrument), for source 'beatbox'"),
        lengthSeconds: z.number().min(0.2).max(20).optional().describe("one-shot length in seconds; default 1 s for drums, 2.5 s for tonal sounds. Longer values make longer sustained tones: use 6-16 s for pads, drones and loops when the user asks for them"),
        strength: z.number().min(0.1).max(1).optional().describe("audio-to-audio init noise level for beatbox/hum/ref sources: 0.3 barely changes the input, 0.5 keeps rhythm/melody and changes timbre, 0.8-0.9 full timbre transfer; default 0.7 (0.6 for refs)"),
        variations: z.number().int().min(1).max(3).optional().describe("1-3 generations with different seeds (default 1). Use 3 for 'one specific sound' requests and in the Tweak room; the result then lists variants A/B/C to judge, present and pick from"),
      }),
      summary: (i) => `synth ${i.role}: ${i.prompt.slice(0, 50)}${i.source !== "text" ? ` (from ${i.source})` : ""}${i.variations > 1 ? ` x${i.variations}` : ""}`,
      run: async ({ role, prompt, source = "text", offsetSeconds, lengthSeconds, strength, variations = 1 }) => {
        const tonal = ["synth", "bass", "pad", "lead", "pluck", "keys"].includes(role);
        const isRef = source.startsWith("ref#");
        const audioPath = source === "text" ? undefined : recPath(isRef ? source : source === "beatbox" ? "beat" : "hum");
        const r = await ctx.synth({ role, prompt, kind: tonal ? "tone" : "drum", audioPath, offsetSeconds, oneshotSeconds: lengthSeconds ?? (tonal ? 2.5 : 1.0), strength: strength ?? (isRef ? 0.6 : undefined), variations });
        if (variations > 1 && Array.isArray(r.variants)) {
          return { role, variants: r.variants.map((v, i) => ({ label: v.label || "ABC"[i], samplePath: v.path, url: v.url, seed: v.seed })), next: "judge or analyze the variants, present A/B/C with one-line differences, recommend one, place it, say \"say 'use B'\"" };
        }
        return { role, samplePath: r.path, name: r.name, durationSeconds: r.durationSeconds, peakDb: r.peakDb, url: r.url };
      },
    }),
    makeTool(ctx, {
      name: "build_drum_layer",
      description: "Put a drum layer into Live: a track named `name` (created or reused) with the sample loaded in Simpler and a clip of the steps (one note per hit, 16th grid), fired. Reusing a name replaces that layer's clip and sound.",
      inputSchema: z.object({
        name: z.string().min(1).max(32).describe("track/layer name, e.g. Kick, Snare, Hats, Open Hats, Rim, Perc"),
        instrument: z.enum(INSTRUMENTS).describe("which drum this is"),
        samplePath: z.string().describe("samplePath returned by synthesize_sound"),
        steps: z.array(StepSchema).min(1).max(128).describe("hits on the 16th grid across all bars"),
        bars: z.number().int().min(1).max(8).describe("clip length in bars"),
        swing: z.number().min(0).max(0.6).optional().describe("delays the off-16ths; 0 straight, 0.3 lazy"),
        slot: z.number().int().min(0).max(7).optional().describe("clip slot / scene: 0 = scene A (default, main groove), 1 = scene B (variation) ..."),
        humanize: z.number().min(0).max(1).optional().describe("timing jitter up to 12 ms and velocity jitter up to 15 at 1.0; hats/perc 0.3-0.5, kick 0.1"),
        useGroove: z.boolean().optional().describe("apply the stored groove template (microtiming + velocity profile from analyze_music / the beatbox) to this layer"),
      }),
      summary: (i) => `build ${i.name} (${i.steps.length} hits, ${i.bars} bar${i.bars > 1 ? "s" : ""}${i.slot ? `, scene ${i.slot + 1}` : ""})`,
      run: async (input) => {
        const r = await ctx.live.buildLane(input);
        return { track: r.track, notes: r.notes ?? input.steps.length, loadedSample: r.loadedSample ?? true };
      },
    }),
    makeTool(ctx, {
      name: "build_melody_layer",
      description: "Put a melodic layer into Live: a track named `name` with the tonal sample in Simpler (pitched per note, C3=60 plays the sample as recorded) and a clip of the notes, fired.",
      inputSchema: z.object({
        name: z.string().min(1).max(32).describe("track/layer name, e.g. Bass, Saw, Pad, Keys, Lead"),
        samplePath: z.string().describe("samplePath of a tonal sound from synthesize_sound"),
        notes: z.array(NoteSchema).min(1).max(256).describe("the notes"),
        bars: z.number().int().min(1).max(8).describe("clip length in bars"),
        slot: z.number().int().min(0).max(7).optional().describe("clip slot / scene: 0 = scene A (default), 1 = scene B (variation) ..."),
      }),
      summary: (i) => `build ${i.name} (${i.notes.length} notes, ${i.bars} bar${i.bars > 1 ? "s" : ""}${i.slot ? `, scene ${i.slot + 1}` : ""})`,
      run: async (input) => {
        const r = await ctx.live.buildMelody(input);
        return { track: r.track, notes: r.notes ?? input.notes.length, loadedSample: r.loadedSample ?? true };
      },
    }),
    makeTool(ctx, {
      name: "update_layer",
      description: "Replace the clip on an existing layer (by track name) with new steps (drums) or notes (melody), keeping its sound. Use for 'make the hats busier', 'half time', etc.",
      inputSchema: z.object({
        name: z.string().describe("existing track/layer name"),
        steps: z.array(StepSchema).max(128).optional().describe("new drum hits (for drum layers)"),
        notes: z.array(NoteSchema).max(256).optional().describe("new notes (for melodic layers)"),
        bars: z.number().int().min(1).max(8).describe("clip length in bars"),
        swing: z.number().min(0).max(0.6).optional().describe("swing for drum layers"),
        slot: z.number().int().min(0).max(7).optional().describe("which clip slot / scene to replace (default 0)"),
        useGroove: z.boolean().optional().describe("apply the stored groove template to the new clip"),
      }),
      summary: (i) => `update ${i.name}${i.slot ? ` (scene ${i.slot + 1})` : ""}`,
      run: async (input) => {
        if (!input.steps && !input.notes) throw new Error("give steps or notes");
        const r = await ctx.live.updateLayer(input);
        return { track: r.track, notes: r.notes };
      },
    }),
    makeTool(ctx, {
      name: "replace_sound",
      description: "Load a different sample into an existing layer's Simpler (by track name), keeping its clip. Use after synthesize_sound for 'swap the kick for an 808'.",
      inputSchema: z.object({
        name: z.string().describe("existing track/layer name"),
        samplePath: z.string().describe("samplePath from synthesize_sound"),
        role: z.enum(ROLES).optional().describe("role of the sound, for the file slot"),
      }),
      summary: (i) => `replace sound on ${i.name}`,
      run: async ({ name, samplePath, role }) => ({ track: await ctx.live.loadSample({ name, samplePath, role }) }),
    }),
    makeTool(ctx, {
      name: "remove_layer",
      description: "Delete a layer's track from Live by name.",
      inputSchema: z.object({ name: z.string().describe("track/layer name to remove") }),
      summary: (i) => `remove ${i.name}`,
      run: async ({ name }) => ({ removed: name, ...(await ctx.live.deleteTrack(name)) }),
    }),
    makeTool(ctx, {
      name: "listen",
      description: "Hear a wav with an audio-language model (NVIDIA Music Flamingo) and get a text description. Use on the user's recording when their text is vague (what timbre, mood, energy are they going for?) or on a generated sample to check it. 10-40 s latency; max 3 listen/judge calls per turn. Optional question focuses the description.",
      inputSchema: z.object({
        path: z.string().describe("absolute path of a wav: a recording attached this turn or a samplePath from synthesize_sound"),
        question: z.string().max(300).optional().describe("what to focus on, e.g. 'what kind of kick drum is this and what mood?'"),
      }),
      summary: (i) => `listen: ${i.path.split("/").pop()}${i.question ? ` — ${i.question.slice(0, 40)}` : ""}`,
      run: async ({ path, question }) => {
        const r = await ctx.listen(path, question);
        return { heard: r.text };
      },
    }),
    makeTool(ctx, {
      name: "transcribe_audio",
      description: "Transcribe an attached recording or reference file to MIDI notes: basic-pitch locally first (no quota), MuScriptor as fallback; the result says which engine ran. Use for melodies, chords, basslines in a reference file, or a hummed line when analyze_recording's monophonic tracking is not enough. Returns notes (pitch, startBeats, durationBeats, velocity), bars, bpm and the instruments found; pass the notes to build_melody_layer. 20-60 s latency. Optional instruments hint (e.g. ['acoustic_piano','synth_pad']).",
      inputSchema: z.object({
        which: z.string().regex(/^(beat|hum|ref#\d+)$/).describe("'hum' for the hummed melody, 'beat' for the beatbox, or 'ref#N' for the Nth reference file"),
        instruments: z.array(z.string().min(1).max(40)).max(6).optional().describe("optional instrument hints for the model, e.g. ['acoustic_piano'], ['synth_pad'], ['drums']"),
      }),
      summary: (i) => `transcribe ${i.which}${i.instruments?.length ? ` (${i.instruments.join(", ")})` : ""}`,
      run: async ({ which, instruments }) => {
        const p = recPath(which);
        let r, engine = "muscriptor", localError;
        if (typeof ctx.transcribeLocal === "function") {
          try { r = await ctx.transcribeLocal(p, { instruments: instruments || [] }); engine = "basic-pitch (local)"; }
          catch (e) { localError = e?.message || String(e); }
        }
        if (!r) r = await ctx.transcribe(p, { instruments: instruments || [] });
        return { engine, ...(localError ? { localFallbackReason: localError.slice(0, 160) } : {}), ...compactNotes(r.notes), bars: r.bars, bpm: r.bpm, tracks: r.tracks, summary: r.summary };
      },
    }),
    makeTool(ctx, {
      name: "judge_sound",
      description: "Compare a generated one-shot against what was asked for. Returns a critique and match 1-10 (null if it could not rate). If match <= 5, re-synthesize once with an improved prompt informed by the critique. Max 3 listen/judge calls per turn.",
      inputSchema: z.object({
        path: z.string().describe("samplePath from synthesize_sound"),
        intent: z.string().min(3).max(300).describe("what the sound was supposed to be, e.g. 'tight clicky techno kick with a short sub tail'"),
      }),
      summary: (i) => `judge ${i.path.split("/").pop()} vs "${i.intent.slice(0, 40)}"`,
      run: async ({ path, intent }) => {
        const r = await ctx.judge(path, intent);
        return { critique: r.text, match: r.match ?? null };
      },
    }),
    makeTool(ctx, {
      name: "slice_sample",
      description: "Cut a piece out of a recording or reference file (no Stability) and save it as a wav to use as a layer sound: vocal chops, stabs, a hit you liked. Returns samplePath.",
      inputSchema: z.object({
        which: z.string().regex(/^(beat|hum|ref#\d+)$/).describe("'beat', 'hum' or 'ref#N'"),
        startSeconds: z.number().min(0).describe("where the piece starts, in seconds"),
        lengthSeconds: z.number().min(0.05).max(4).describe("piece length in seconds (0.05-4)"),
        name: z.string().min(1).max(32).describe("short name for the piece, e.g. 'vox-ah', 'stab1'"),
      }),
      summary: (i) => `slice ${i.which} @${i.startSeconds}s (${i.lengthSeconds}s) -> ${i.name}`,
      run: async ({ which, startSeconds, lengthSeconds, name }) => {
        const r = await ctx.slice(recPath(which), { startSeconds, lengthSeconds, name });
        return { samplePath: r.path, name: r.name, durationSeconds: r.durationSeconds ?? lengthSeconds, url: r.url };
      },
    }),
    makeTool(ctx, {
      name: "chop_sample",
      description: "Detect the hits / syllables in a recording or reference and return them as pieces with start times, lengths, loudness and a rough class (kick/snare/hat/tonal), each already saved as a wav (samplePath). Pick pieces for layers or vocal chops; use slice_sample for a precise cut.",
      inputSchema: z.object({
        which: z.string().regex(/^(beat|hum|ref#\d+)$/).describe("'beat', 'hum' or 'ref#N'"),
        maxPieces: z.number().int().min(1).max(32).optional().describe("cap on the number of pieces (default 16)"),
        pieceSeconds: z.number().min(0.05).max(4).optional().describe("fixed piece length; default = until the next hit, max 1 s"),
      }),
      summary: (i) => `chop ${i.which}`,
      run: async ({ which, maxPieces, pieceSeconds }) => {
        const r = await ctx.chop(recPath(which), { maxPieces, pieceSeconds });
        return { pieceCount: r.pieces.length, pieces: r.pieces, bpm: r.bpm ?? null };
      },
    }),
    makeTool(ctx, {
      name: "load_device",
      description: "Load any Live device or preset onto a track: an instrument (Simpler, Drum Rack, Impulse), a preset from browse_library (e.g. '909 Core Kit.adg', a Bass/Pad/Keys .adg), a MIDI effect (Arpeggiator, Scale, Velocity, Random, Chord, Pitch, Note Length) or an audio effect. Aliases: 'ping pong' -> Delay (Ping Pong on), 'eq' -> EQ Eight, 'glue' -> Glue Compressor, 'bitcrusher' -> Redux. The result carries requested, the ACTUAL loaded device name, match ('exact'|'alias'|'ci'|'fuzzy'), reused:true if it was already on the track, and its first params. Name the actual device in your reply. For audio effects with parameters prefer add_effect.",
      inputSchema: z.object({
        track: z.string().describe("track/layer name (created by a build tool, or 'Drums' for a kit track that build_melody_layer will fill)"),
        device: z.string().min(2).max(80).describe("device, alias or preset name, e.g. 'Drum Rack', '909 Core Kit.adg', 'Arpeggiator', 'Scale', 'Reverb'"),
      }),
      summary: (i) => `load ${i.device} on ${i.track}`,
      maxArray: 32,
      run: async ({ track, device }) => {
        const r = await ctx.live.loadDevice({ track, device });
        const params = Array.isArray(r?.params) ? r.params.slice(0, 32).map((k) => ({ name: k.name, min: k.min, max: k.max, display: k.display })) : [];
        return { track, requested: r?.requested ?? device, device: r?.device?.name ?? r?.device ?? device, match: r?.match ?? null, deviceIndex: r?.device?.index ?? r?.index, ...(r?.reused ? { reused: true } : {}), params };
      },
    }),
    makeTool(ctx, {
      name: "add_effect",
      description: "Add an Ableton audio effect to a track and optionally set parameters by name. Devices: Saturator, Overdrive, Reverb, Auto Filter, Glue Compressor, Drum Buss, Redux, Ping Pong Delay, Echo, Compressor, EQ Eight, Chorus, Phaser, Utility. Live's internal ranges differ from producer units (Saturator Drive is -36..36 dB, Reverb Decay Time is in ms, Dry/Wet is 0..1 on some devices and 0..100 on others, quantized params take an integer index): the result lists the device's params with name/min/max/display, so read it and prefer values stated relative to that range ('Drive +18 dB', 'Dry/Wet 25%'). Requested values are clamped into range; seconds given for a ms param are converted. Results carry requested, the ACTUAL loaded device name and match ('exact'|'alias'|'ci'|'fuzzy'); name the actual device in your reply. If the track already has that device the result carries reused:true (only params were set): then say 'adjusted the existing X', not 'added'. Only devices that exist in Live 10 Standard: no Ping Pong Delay/Echo (use 'ping pong' alias -> Delay).",
      inputSchema: z.object({
        track: z.string().describe("track/layer name"),
        device: z.string().min(2).max(40).describe("Live device name, e.g. 'Saturator', 'Reverb', 'Auto Filter'"),
        params: z.array(z.object({
          name: z.string().describe("parameter name as shown in Live, e.g. 'Drive', 'Dry/Wet', 'Frequency', 'Decay Time' (case-insensitive)"),
          value: z.number().describe("value in the parameter's own unit (dB, %, Hz, s or ms); clamped to the device's range"),
        })).max(12).optional().describe("parameters to set after loading"),
      }),
      summary: (i) => `add ${i.device} on ${i.track}${i.params?.length ? ` (${i.params.map((p) => `${p.name}=${p.value}`).join(", ")})` : ""}`,
      maxArray: 32,
      run: async ({ track, device, params = [] }) => {
        const loaded = await ctx.live.loadDevice({ track, device });
        const known = Array.isArray(loaded?.params) ? loaded.params : [];
        const deviceName = loaded?.device?.name ?? loaded?.device ?? device;
        const deviceRef = Number.isInteger(loaded?.device?.index) ? loaded.device.index : deviceName;   // index: a 2nd Reverb on the track must not hit the 1st
        const set = [];
        for (const p of params) {
          const match = known.find((k) => String(k.name).toLowerCase() === String(p.name).toLowerCase());
          let value = p.value, note;
          if (match && Number.isFinite(match.min) && Number.isFinite(match.max)) {
            // seconds given for a millisecond-range param (e.g. Reverb Decay Time 1.5 -> 1500)
            if (value > 0 && value < match.min && value * 1000 >= match.min && value * 1000 <= match.max) { value = value * 1000; note = "converted s -> ms"; }
            const clamped = Math.min(match.max, Math.max(match.min, value));
            if (clamped !== value) { note = `clamped ${value} into [${match.min}, ${match.max}]`; value = clamped; }
            if (match.quantized) value = Math.round(value);
          }
          try {
            const r = await ctx.live.setParam({ track, device: deviceRef, param: match?.name ?? p.name, value });
            set.push({ name: match?.name ?? p.name, requested: p.value, value, ...(r?.param ?? r ?? {}), ...(note ? { note } : {}), ok: true });
          } catch (e) { set.push({ name: p.name, requested: p.value, ok: false, error: e?.message || String(e) }); }
        }
        const paramsOut = known.slice(0, 32).map((k) => ({ name: k.name, min: k.min, max: k.max, display: k.display, ...(k.quantized ? { quantized: true } : {}) }));
        return { track, requested: loaded?.requested ?? device, device: deviceName, match: loaded?.match ?? null, deviceIndex: loaded?.device?.index ?? loaded?.index, ...(loaded?.reused ? { reused: true } : {}), set, deviceParams: paramsOut };
      },
    }),
    makeTool(ctx, {
      name: "set_param",
      description: "Set one parameter of a device already on a track (by names). Use list_devices to see what is there.",
      inputSchema: z.object({
        track: z.string().describe("track/layer name"),
        device: z.string().describe("device name on that track, e.g. 'Simpler', 'Saturator'"),
        param: z.string().describe("parameter name, e.g. 'Drive', 'Dry/Wet', 'Decay Time', 'Frequency', 'Volume'"),
        value: z.number().describe("value in the parameter's unit; the server maps it to Live's range"),
      }),
      summary: (i) => `${i.track} / ${i.device} / ${i.param} = ${i.value}`,
      run: async (i) => { const r = await ctx.live.setParam(i); const param = r?.param ?? r ?? {}; return { track: i.track, device: i.device, param: { name: param.name ?? i.param, value: param.value ?? i.value, min: param.min, max: param.max, display: param.display } }; },
    }),
    makeTool(ctx, {
      name: "list_devices",
      description: "List the devices on a track with their parameters (names and current values).",
      inputSchema: z.object({ track: z.string().describe("track/layer name") }),
      summary: (i) => `devices on ${i.track}`,
      maxArray: 32,
      run: async ({ track }) => ({ track, devices: await ctx.live.listDevices(track) }),
    }),
    makeTool(ctx, {
      name: "set_mixer",
      description: "Set a track's volume (linear 0-1: 0.85 ~ 0 dB, 0.7 ~ -6 dB), pan (-1..1), mute or solo.",
      inputSchema: z.object({
        track: z.string().describe("track/layer name"),
        volume: z.number().min(0).max(1).optional().describe("0-1 linear; 0.85 is 0 dB, 0.7 about -6 dB"),
        pan: z.number().min(-1).max(1).optional().describe("-1 left, 0 center, 1 right"),
        mute: z.boolean().optional().describe("mute on/off"),
        solo: z.boolean().optional().describe("solo on/off"),
      }),
      summary: (i) => `mix ${i.track}${i.volume != null ? ` vol ${i.volume}` : ""}${i.pan != null ? ` pan ${i.pan}` : ""}${i.mute != null ? ` mute ${i.mute}` : ""}${i.solo != null ? ` solo ${i.solo}` : ""}`,
      run: async (i) => {
        if (i.volume == null && i.pan == null && i.mute == null && i.solo == null) throw new Error("give volume, pan, mute or solo");
        return { ...i, ...(await ctx.live.setMixer(i)) };
      },
    }),
    makeTool(ctx, {
      name: "create_scene",
      description: "Create (or name) a scene row. Scene 1 = slot 0 (main groove), scene 2 = slot 1 (variation).",
      inputSchema: z.object({ name: z.string().min(1).max(32).describe("scene name, e.g. 'Drop', 'B part'"), index: z.number().int().min(0).max(7).optional().describe("scene index to create/rename; default = next") }),
      summary: (i) => `scene ${i.name}`,
      run: async ({ name, index }) => ({ ...(await ctx.live.createScene({ name, index })) }),
    }),
    makeTool(ctx, {
      name: "fire_scene",
      description: "Launch a scene (all clips in that row). 0 = scene A, 1 = scene B.",
      inputSchema: z.object({ index: z.number().int().min(0).max(7).describe("scene index") }),
      summary: (i) => `fire scene ${i.index + 1}`,
      run: async ({ index }) => ({ index, ...(await ctx.live.fireScene(index)) }),
    }),
    makeTool(ctx, {
      name: "record_arrangement",
      description: "Record Session clips into the Arrangement timeline, then stop and show Arrangement view. Either `bars` (records whatever is playing; fire the scene first) or `scenes` (a sequence: fire scene index, record that many bars, then the next scene; e.g. A for 8 bars then B for 8 bars). Use when the user says 'lay it out', 'record it', 'make an arrangement', 'timeline'.",
      inputSchema: z.object({
        bars: z.number().int().min(1).max(64).optional().describe("bars to record of what is playing now"),
        scenes: z.array(z.object({ index: z.number().int().min(0).max(15).describe("scene index, 0 = A"), bars: z.number().int().min(1).max(64).describe("bars to record for this scene") })).min(1).max(8).optional().describe("ordered scene sequence; overrides bars"),
      }).refine((v) => v.bars || (v.scenes && v.scenes.length), { message: "give bars or scenes" }),
      summary: (i) => i.scenes ? `record scenes ${i.scenes.map((s) => `${s.index}×${s.bars}`).join(" → ")} to arrangement` : `record ${i.bars} bars to arrangement`,
      run: async ({ bars, scenes }) => ({ bars, scenes, ...(await ctx.live.recordArrangement(scenes ? { scenes } : { bars })) }),
    }),
    makeTool(ctx, {
      name: "analyze_audio",
      description: "Measure a wav technically: duration, loudness (integrated LUFS, peak/RMS dBFS, crest factor), envelope (attack/decay ms), spectrum (centroid, band shares sub/low/lowMid/mid/high/air), pitch (tonal files), rhythm (files > 2 s), stereo, and low/medium/high ratings (loudness, punch, subWeight, lowEnd, body, presence, brightness, air, noisiness, tonalness, length) each with the number behind it, plus a neutral one-sentence summary. Use for feedback on references and on produced sounds; report numbers and ratings, not judgments.",
      inputSchema: z.object({
        which: z.string().min(1).describe("'beat', 'hum', 'ref#N', or an absolute path to a wav (a samplePath, a slice, or a render_preview path)"),
      }),
      summary: (i) => `analyze ${i.which.startsWith("/") ? i.which.split("/").pop() : i.which}`,
      maxArray: 16,
      run: async ({ which }) => {
        const p = anyPath(which);
        const r = await ctx.analyze(p);
        return compactProfile(r, p);
      },
    }),
    makeTool(ctx, {
      name: "compare_audio",
      description: "Compare two wavs technically (reference vs produced, before vs after): per-rating numeric deltas and neutral comparison sentences. Each side is 'beat', 'hum', 'ref#N' or an absolute path.",
      inputSchema: z.object({
        a: z.string().min(1).describe("first file: 'beat'|'hum'|'ref#N'|absolute path (usually the reference)"),
        b: z.string().min(1).describe("second file: 'beat'|'hum'|'ref#N'|absolute path (usually what you produced)"),
      }),
      summary: (i) => `compare ${i.a.split("/").pop()} vs ${i.b.split("/").pop()}`,
      maxArray: 16,
      run: async ({ a, b }) => {
        const r = await ctx.compare(anyPath(a), anyPath(b));
        return { deltas: r.deltas, text: r.text };
      },
    }),
    makeTool(ctx, {
      name: "render_preview",
      description: "Render an offline preview mix of everything you built (the server's registry of tracks, sounds and last clips) to a wav and analyze it. It has NO Live effects or mixer settings, so it measures the raw layers. Use before giving feedback on the produced beat. Returns path, url, duration and the technical profile.",
      inputSchema: z.object({
        bars: z.number().int().min(1).max(16).optional().describe("how many bars to render (default: the loop length)"),
      }),
      summary: (i) => `render preview${i.bars ? ` (${i.bars} bars)` : ""}`,
      maxArray: 16,
      run: async ({ bars }) => {
        const r = await ctx.render({ bars });
        const profile = r.profile ? compactProfile(r.profile, r.path) : (ctx.analyze ? compactProfile(await ctx.analyze(r.path), r.path) : undefined);
        return { path: r.path, url: r.url, durationSeconds: r.durationSeconds, noLiveEffects: true, profile };
      },
    }),
    makeTool(ctx, {
      name: "set_track_color",
      description: "Color a track by role (Live color index 0-69): drums warm (kick 0-4, snare/clap 5-9, hats/perc 10-14), synth/bass cool (20-29), vox/pad purples (40-49).",
      inputSchema: z.object({
        track: z.string().describe("track/layer name"),
        colorIndex: z.number().int().min(0).max(69).describe("Live color index 0-69"),
      }),
      summary: (i) => `color ${i.track} -> ${i.colorIndex}`,
      run: async (i) => ({ ...i, ...(await ctx.live.setTrackColor(i)) }),
    }),
    makeTool(ctx, {
      name: "capture_midi",
      description: "Live's Capture MIDI: turns what the user just played on a MIDI controller into a clip on the selected track.",
      inputSchema: z.object({}),
      summary: () => "capture MIDI",
      run: async () => ({ ...(await ctx.live.captureMidi()) }),
    }),
    makeTool(ctx, {
      name: "layer_samples",
      description: "Stack 2-4 one-shots into one wav (e.g. kick = sub + click, snare = body + crack). Per layer: gainDb, offsetMs delay, highpassHz / lowpassHz. Returns samplePath for build_drum_layer / replace_sound.",
      inputSchema: z.object({
        layers: z.array(z.object({
          path: z.string().describe("samplePath of a one-shot"),
          gainDb: z.number().min(-24).max(12).optional().describe("level offset in dB (default 0); e.g. -3 for the click on top of a sub"),
          offsetMs: z.number().min(0).max(200).optional().describe("delay this layer by ms (default 0)"),
          highpassHz: z.number().min(20).max(20000).optional().describe("highpass this layer, e.g. 150 for a click layer"),
          lowpassHz: z.number().min(20).max(20000).optional().describe("lowpass this layer, e.g. 120 for a sub layer"),
        })).min(2).max(4).describe("2-4 layers"),
        name: z.string().min(1).max(32).describe("name for the result, e.g. 'kick-layered'"),
      }),
      summary: (i) => `layer ${i.layers.length} sounds -> ${i.name}`,
      run: async ({ layers, name }) => {
        const r = await ctx.layerSamples({ layers, name });
        return { samplePath: r.path, url: r.url, durationSeconds: r.durationSeconds, layers: layers.length };
      },
    }),
    makeTool(ctx, {
      name: "tune_sample",
      description: "Pitch-shift a one-shot to the song key: give semitones, or targetNote like 'F1' / 'C2' (the server detects the sample's pitch and shifts to it). Use on kick subs, 808s, tonal percussion, vox chops.",
      inputSchema: z.object({
        path: z.string().describe("samplePath to tune"),
        semitones: z.number().min(-24).max(24).optional().describe("shift by this many semitones"),
        targetNote: z.string().regex(/^[A-Ga-g](#|b)?-?\d$/).optional().describe("note name with octave, e.g. 'F1', 'C#2', 'A0'; the sample's detected pitch is moved to it"),
        name: z.string().min(1).max(32).describe("name for the result, e.g. 'sub-F1'"),
        preserveFormants: z.boolean().optional().describe("keep formants (natural voice) when shifting; default true for vocal roles/chops. Vocal shifts: at most ±3 st"),
        role: z.string().max(20).optional().describe("what the sample is: 'vocal'/'vox'/'chop' get formant preservation by default"),
      }),
      summary: (i) => `tune ${i.path.split("/").pop()} ${i.targetNote ? `-> ${i.targetNote}` : `${i.semitones >= 0 ? "+" : ""}${i.semitones} st`}${i.preserveFormants ? " (formants kept)" : ""}`,
      run: async ({ path, semitones, targetNote, name, preserveFormants, role }) => {
        if (semitones == null && !targetNote) throw new Error("give semitones or targetNote");
        const vocal = /vocal|vox|chop|voice/i.test(`${role || ""} ${name || ""} ${path}`);
        const pf = preserveFormants ?? vocal;
        const r = await ctx.tuneSample({ path, semitones, targetNote, name, preserveFormants: pf, ...(role ? { role } : {}) });
        return { samplePath: r.path, url: r.url, detectedMidi: r.detectedMidi ?? null, appliedSemitones: r.appliedSemitones, preserveFormants: pf };
      },
    }),
    makeTool(ctx, {
      name: "shape_sample",
      description: "Trim, fade, filter and pre-balance a one-shot: trimStartMs, lengthMs (tail: hats 60-120, snare 250-450, kick 500-900), fadeOutMs, gainDb, highpassHz, lowpassHz. Returns a new samplePath.",
      inputSchema: z.object({
        path: z.string().describe("samplePath to shape"),
        trimStartMs: z.number().min(0).max(5000).optional().describe("cut this many ms from the start"),
        lengthMs: z.number().min(20).max(20000).optional().describe("total length after trimming"),
        fadeOutMs: z.number().min(0).max(5000).optional().describe("fade-out length"),
        gainDb: z.number().min(-24).max(12).optional().describe("gain change in dB"),
        highpassHz: z.number().min(20).max(20000).optional().describe("highpass frequency"),
        lowpassHz: z.number().min(20).max(20000).optional().describe("lowpass frequency"),
        name: z.string().min(1).max(32).describe("name for the result"),
      }),
      summary: (i) => `shape ${i.path.split("/").pop()} -> ${i.name}`,
      run: async (i) => {
        const { path, name, ...ops } = i;
        if (!Object.values(ops).some((v) => v != null)) throw new Error("give at least one of trimStartMs, lengthMs, fadeOutMs, gainDb, highpassHz, lowpassHz");
        const r = await ctx.shapeSample(i);
        return { samplePath: r.path, url: r.url, durationSeconds: r.durationSeconds };
      },
    }),
    makeTool(ctx, {
      name: "set_send",
      description: "Set a track's send level to a return: 'A' = Reverb return, 'B' = Delay return. Level 0-1 (0.15-0.3 snare/clap/vox/pads on A, 0.05 hats, 0 kick/bass; 0.1-0.2 perc/vox/lead on B).",
      inputSchema: z.object({
        track: z.string().describe("track/layer name"),
        send: z.enum(["A", "B"]).describe("'A' (Reverb return) or 'B' (Delay return)"),
        level: z.number().min(0).max(1).describe("send level 0-1"),
      }),
      summary: (i) => `send ${i.track} -> ${i.send} ${i.level}`,
      run: async (i) => ({ ...i, ...(await ctx.live.setSend(i)) }),
    }),
    makeTool(ctx, {
      name: "browse_library",
      description: "Search Live's browser for presets and devices: root 'instruments' (Operator, Wavetable, Analog...), 'sounds' (preset library: Bass, Pad, Keys, Lead...), 'audio_effects', 'drums'. Returns names you can pass to load_device. Prefer this for tonal parts over Stability one-shots.",
      inputSchema: z.object({
        root: z.enum(["instruments", "sounds", "audio_effects", "drums"]).describe("which browser section"),
        query: z.string().max(60).optional().describe("case-insensitive substring, e.g. 'Bass', 'Pad', 'Sub'"),
        depth: z.number().int().min(1).max(4).optional().describe("folder depth to search (default 2)"),
      }),
      summary: (i) => `browse ${i.root}${i.query ? ` "${i.query}"` : ""}`,
      maxArray: 40,
      run: async ({ root, query, depth }) => {
        const r = await ctx.live.browse({ root, query, depth });
        const items = Array.isArray(r) ? r : r.items || [];
        return { root, query: query ?? null, count: items.length, items: items.map((it) => (typeof it === "string" ? it : { name: it.name, ...(it.is_folder ? { folder: true } : {}), ...(it.path ? { path: Array.isArray(it.path) ? it.path.join("/") : it.path } : {}) })) };
      },
    }),
    makeTool(ctx, {
      name: "mix_balance",
      description: "Apply role-based volume and pan to every built track (template 'drums-default': kick 0.85/0, snare 0.80/0, clap 0.74/+0.08, hats 0.62/+0.18, open hats 0.58/+0.22, rim 0.55/-0.25, perc 0.56/-0.3, tom 0.66/-0.1, vox 0.68/+0.1, synth/bass 0.72/0, pad 0.6/0, lead 0.66/-0.05), then optional per-track overrides. Run after building, before review_mix.",
      inputSchema: z.object({
        template: z.enum(["drums-default"]).optional().describe("balance template (default 'drums-default')"),
        overrides: z.array(z.object({
          track: z.string().describe("track/layer name"),
          volume: z.number().min(0).max(1).optional().describe("linear 0-1"),
          pan: z.number().min(-1).max(1).optional().describe("-1..1"),
        })).max(16).optional().describe("per-track exceptions applied after the template"),
      }),
      summary: (i) => `mix balance${i.overrides?.length ? ` (+${i.overrides.length} overrides)` : ""}`,
      maxArray: 16,
      run: async ({ template = "drums-default", overrides }) => ({ template, ...(await ctx.live.mixBalance({ template, overrides })) }),
    }),
    makeTool(ctx, {
      name: "review_mix",
      description: "Quality gate: renders the preview, analyzes the whole mix and each layer soloed, and returns technical issues with severity (high/medium/low) and a suggested fix (a tool call). Call after any build or sound/mix change; fix 'high' issues (max 2 rounds), then report the findings in the 'Review:' line.",
      inputSchema: z.object({}),
      summary: () => "review mix",
      maxArray: 16,
      run: async () => {
        const r = await ctx.reviewMix();
        const whole = r.whole ? compactProfile(r.whole, r.path) : null;
        const perLayer = r.perLayer ? Object.fromEntries(Object.entries(r.perLayer).map(([k, v]) => [k, v?.ratings ? Object.fromEntries(Object.entries(v.ratings).map(([rk, rv]) => [rk, typeof rv === "object" ? `${rv.level} (${r1(rv.value)}${rv.unit ? " " + rv.unit : ""})` : rv])) : v])) : {};
        const issues = (r.issues || []).map((it) => ({ severity: it.severity, text: it.text, fix: it.fix }));
        return { issueCount: issues.length, high: issues.filter((i) => i.severity === "high").length, issues, perLayer, whole: whole ? { loudness: whole.loudness, ratings: whole.ratings, summary: whole.summary } : null };
      },
    }),
    makeTool(ctx, {
      name: "separate_stems",
      description: "Split a recording or reference into stems (drums, bass, other, vocals) with Demucs (CPU, 1-3 min). Each stem is registered as a new reference (ref#N) so later tools can address it, e.g. analyze_music on the drum stem, chop_sample on the vocal stem. May be unavailable (ok:false 'not installed / run tools/py/setup.sh').",
      inputSchema: z.object({ which: z.string().regex(/^(beat|hum|ref#\d+)$/).describe("'beat', 'hum' or 'ref#N' to separate") }),
      summary: (i) => `separate stems of ${i.which}`,
      maxArray: 8,
      run: async ({ which }) => {
        const src = recPath(which);
        const r = await ctx.stems(src);
        const base = (refs.find((x) => x.path === src)?.name || which).replace(/\.[a-z0-9]+$/i, "");
        const registered = [];
        for (const [stem, path] of Object.entries(r.stems || {})) {
          if (!path) continue;
          const reg = await ctx.addRef(`${stem} of ${base}`, path);
          refs[reg.index - 1] = { name: reg.name, path };
          registered.push({ stem, ref: `ref#${reg.index}`, name: reg.name, path });
        }
        return { source: which, stems: registered };
      },
    }),
    makeTool(ctx, {
      name: "analyze_music",
      description: "Musical analysis of a recording or reference (librosa): tempo, beat and downbeat counts, key, onset count, groove template (swing, microtiming per 16th, velocity profile per 16th) and sections. Stores the groove template so build_drum_layer/update_layer can apply it with useGroove:true. Run it on the DRUM stem of a reference. May be unavailable (ok:false).",
      inputSchema: z.object({ which: z.string().min(1).describe("'beat', 'hum', 'ref#N' or an absolute wav path") }),
      summary: (i) => `analyze music ${i.which.startsWith("/") ? i.which.split("/").pop() : i.which}`,
      maxArray: 16,
      run: async ({ which }) => {
        const r = await ctx.analyzeMusic(anyPath(which));
        let grooveStored = false;
        if (r.groove && typeof ctx.setGroove === "function") { try { await ctx.setGroove(r.groove); grooveStored = true; } catch {} }
        const g = r.groove || null;
        return {
          tempo: r1(r.tempo), beats: count(r.beats), downbeats: count(r.downbeats), key: r.key ? (typeof r.key === "string" ? r.key : `${r.key.tonic} ${r.key.mode}${r.key.confidence != null ? ` (conf ${r1(r.key.confidence)})` : ""}`) : null,
          onsets: count(r.onsets), durationSeconds: r1(r.duration ?? r.durationSeconds),
          groove: g ? { swing: r1(g.swing), microtimingMs: (g.microtiming || []).map(r1), velocityProfile: (g.velocityProfile || []).map(r1) } : null,
          sections: Array.isArray(r.sections) ? r.sections.slice(0, 16).map((x) => `${r1(x.start)}-${r1(x.end)}s`) : null,
          grooveStored,
        };
      },
    }),
    makeTool(ctx, {
      name: "process_audio",
      description: "Run an offline effect chain on a wav (pedalboard) and save a new one. Chain types: highpass{hz}, lowpass{hz}, compressor{threshold_db,ratio,attack_ms,release_ms}, reverb{room_size 0-1, wet 0-1}, limiter{threshold_db}, gain{db}, pitch{semitones}, saturate{drive_db}. Use for chops, stems and one-shots before building. May be unavailable (ok:false).",
      inputSchema: z.object({
        which: z.string().min(1).describe("'beat', 'hum', 'ref#N' or an absolute wav path (a samplePath, a slice, a stem)"),
        chain: z.array(z.object({
          type: z.enum(["highpass", "lowpass", "compressor", "reverb", "limiter", "gain", "pitch", "saturate"]).describe("effect type"),
          hz: z.number().min(20).max(20000).optional().describe("highpass/lowpass cutoff"),
          threshold_db: z.number().min(-60).max(0).optional().describe("compressor/limiter threshold"),
          ratio: z.number().min(1).max(20).optional().describe("compressor ratio"),
          attack_ms: z.number().min(0.1).max(500).optional().describe("compressor attack"),
          release_ms: z.number().min(1).max(5000).optional().describe("compressor release"),
          room_size: z.number().min(0).max(1).optional().describe("reverb room size"),
          wet: z.number().min(0).max(1).optional().describe("reverb wet"),
          db: z.number().min(-48).max(24).optional().describe("gain in dB"),
          semitones: z.number().min(-24).max(24).optional().describe("pitch shift"),
          drive_db: z.number().min(0).max(36).optional().describe("saturation drive"),
        })).min(1).max(8).describe("effects in order"),
        name: z.string().min(1).max(32).describe("name for the result"),
      }),
      summary: (i) => `process ${i.which.startsWith("/") ? i.which.split("/").pop() : i.which}: ${i.chain.map((c) => c.type).join(" > ")} -> ${i.name}`,
      maxArray: 8,
      run: async ({ which, chain, name }) => {
        const r = await ctx.processAudio(anyPath(which), chain, name);
        return { samplePath: r.path ?? r.out, url: r.url, peakDbfs: r1(r.peakDbfs), chain: chain.map((c) => c.type) };
      },
    }),
    makeTool(ctx, {
      name: "master_preview",
      description: "Master the latest render (compressor + limiter + loudness match to a target LUFS, default -12) for a demo bounce. Returns path, url and the measured LUFS. Run render_preview or review_mix first. May be unavailable (ok:false).",
      inputSchema: z.object({ lufs: z.number().min(-24).max(-6).optional().describe("target integrated loudness, default -12 LUFS") }),
      summary: (i) => `master preview @ ${i.lufs ?? -12} LUFS`,
      run: async ({ lufs = -12 }) => { const r = await ctx.masterAudio(lufs); return { path: r.path ?? r.out, url: r.url, lufs: r1(r.lufs), peakDbfs: r1(r.peakDbfs), target: lufs }; },
    }),
    makeTool(ctx, {
      name: "generate_loop",
      description: "Stable Audio text-to-audio loop at the song tempo (the server adds 'TrackType: Instrument' and '<bpm> BPM'): kind 'drums' returns the loop plus a kit sliced from it (kick/snare/hat/perc one-shots sharing one production context - the best way to get coherent drums); 'texture' or 'fx' returns just the loop. Prompt grammar: 'Genre: X', style/era, the drum elements and how they sound (e.g. 'warm round kick, soft claps on 2 and 4, shuffled closed hats'), mood/arrangement, production ('tight and dry, no melody'); use the production DNA's own words; describe, never instruct. Re-roll once if the loop misses.",
      inputSchema: z.object({
        prompt: z.string().min(3).max(300).describe("guide-order prompt, e.g. 'Genre: Boom Bap, dusty 90s drum loop, round kick, cracked snare, swung hats, sampled off vinyl, tight and dry, no melody' (no BPM needed, the server adds it)"),
        bpm: z.number().min(40).max(300).describe("tempo"),
        bars: z.number().int().min(1).max(8).describe("loop length in bars"),
        kind: z.enum(["drums", "texture", "fx"]).describe("'drums' slices a kit from the loop; 'texture'/'fx' do not"),
      }),
      summary: (i) => `loop (${i.kind}, ${i.bars} bars @ ${i.bpm}): ${i.prompt.slice(0, 40)}`,
      maxArray: 12,
      run: async ({ prompt, bpm, bars, kind }) => {
        const r = await ctx.generateLoop({ prompt, bpm, bars, kind });
        return { loop: r.loop, kit: (r.kit || []).map((k) => ({ kind: k.kind, samplePath: k.path, time: r1(k.time) })), kitCount: (r.kit || []).length };
      },
    }),
    makeTool(ctx, {
      name: "restyle_mix",
      description: "Render the current build and run it through Stable Audio audio-to-audio (the server adds 'TrackType: Music' and the BPM): a cohesive 'produced' version to use as a texture layer under the drums or as a reference. Prompt grammar: 'Genre: X', mood/energy, production character (room, processing, era). strength = init noise level: 0.4-0.6 keeps the groove and changes the production; 0.8 mostly follows the prompt.",
      inputSchema: z.object({
        prompt: z.string().min(3).max(300).describe("target sound in descriptive words"),
        strength: z.number().min(0.2).max(0.8).describe("how far from the current build (0.2-0.8; 0.45 typical)"),
      }),
      summary: (i) => `restyle mix (${i.strength}): ${i.prompt.slice(0, 40)}`,
      run: async ({ prompt, strength }) => { const r = await ctx.restyleMix({ prompt, strength }); return { samplePath: r.path, url: r.url, durationSeconds: r1(r.durationSeconds) }; },
    }),
    makeTool(ctx, {
      name: "production_dna",
      description: "Gemini listens to a reference and returns its production DNA: drum character words (usable as Stable Audio prompts), groove feel, space/reverb, tempo and key guess, arrangement notes, and what makes it sound expensive. Call this BEFORE imitating a reference; never guess what audio sounds like. Counts toward the 3 ear calls per turn.",
      inputSchema: z.object({ which: z.string().min(1).describe("'ref#N', 'beat', 'hum' or an absolute wav path") }),
      summary: (i) => `production DNA of ${i.which.startsWith("/") ? i.which.split("/").pop() : i.which}`,
      maxArray: 12,
      run: async ({ which }) => ({ dna: await ctx.productionDna(anyPath(which)) }),
    }),
    makeTool(ctx, {
      name: "critique_mix",
      description: "Renders the current build and has Gemini critique it production-first (optionally against a reference and a genre target): styleRead, styleAccuracy {verdict on target|close|off, why}, drums, bass {present, type, suggestion}, harmonyMelody, soundDesign, groove, arrangement, moves (3-5 production moves), mixNotes (1 line, only if broken). Call AFTER building, apply the moves / fix 'off' once, then report in musical terms. Counts toward the 3 ear calls per turn.",
      inputSchema: z.object({
        reference: z.string().min(1).optional().describe("'ref#N' or an absolute path to compare against (optional)"),
        genreTarget: z.string().max(1500).optional().describe("the genre blueprint summary (or genre name) to judge style accuracy against"),
      }),
      summary: (i) => `critique mix${i.reference ? ` vs ${i.reference}` : ""}${i.genreTarget ? " (style target)" : ""}`,
      maxArray: 12,
      run: async ({ reference, genreTarget }) => ({ critique: await ctx.critiqueMix(reference ? anyPath(reference) : undefined, genreTarget ? { genreTarget } : undefined) }),
    }),
    makeTool(ctx, {
      name: "label_pieces",
      description: "Gemini labels up to 12 chopped pieces: vowel / consonant / breath / noise, pitchedness, and what each is usable as (chop, stab, texture, perc). Call BEFORE choosing vocal chops. Counts toward the 3 ear calls per turn.",
      inputSchema: z.object({ paths: z.array(z.string().min(1)).min(1).max(12).describe("samplePaths of the pieces (from chop_sample or slice_sample), max 12") }),
      summary: (i) => `label ${i.paths.length} pieces`,
      maxArray: 12,
      run: async ({ paths }) => { const r = await ctx.labelPieces(paths); const labels = Array.isArray(r) ? r : r.labels || r.pieces || []; return { count: labels.length, labels }; },
    }),
    makeTool(ctx, {
      name: "refine_sound",
      description: "THE way to tweak an existing sound ('make the kick punchier', 'less boxy snare'): Gemini listens to the current sound, writes the gap and a revised Stable Audio prompt, Stability regenerates (audio-to-audio from the current sound when it is close), Gemini scores each round, the best wins and is applied to the track (undoable with undo_sound). `which` = a track name (its current sound is used) or an absolute samplePath. 1-3 rounds (default 2).",
      inputSchema: z.object({
        which: z.string().min(1).describe("track/layer name (e.g. 'Kick') or an absolute wav path"),
        intent: z.string().min(3).max(300).describe("what it should become, e.g. 'punchier, shorter sub tail, more click'"),
        currentPrompt: z.string().max(300).optional().describe("the prompt that produced the current sound, if known"),
        role: z.enum(ROLES).optional().describe("role of the sound (defaults from the track name)"),
        rounds: z.number().int().min(1).max(3).optional().describe("refinement rounds, default 2"),
        applyToTrack: z.boolean().optional().describe("load the winner onto the track (default true when `which` is a track)"),
      }),
      summary: (i) => `refine ${i.which.startsWith("/") ? i.which.split("/").pop() : i.which}: ${i.intent.slice(0, 40)}`,
      maxArray: 8,
      run: async ({ which, intent, currentPrompt, role, rounds = 2, applyToTrack }) => {
        const isTrack = !which.startsWith("/");
        let path = which, track;
        if (isTrack) {
          const tracks = await ctx.live.listTracks();
          const t = (tracks || []).find((x) => String(x.name).toLowerCase() === which.toLowerCase());
          if (!t) throw new Error(`no track named '${which}'; tracks: ${(tracks || []).map((x) => x.name).join(", ")}`);
          if (!t.soundPath) throw new Error(`track '${which}' has no sound loaded by us (soundPath missing); use synthesize_sound + replace_sound instead`);
          path = t.soundPath; track = t.name;
        }
        const r = await ctx.refineSound({ path, intent, currentPrompt, role, rounds, track: applyToTrack === false ? undefined : track });
        return {
          best: r.best ? { samplePath: r.best.path, url: r.best.url, prompt: r.best.prompt, match: r.best.match, round: r.best.round } : null,
          history: (r.history || []).map((h) => ({ round: h.round, match: h.match, viaAudioToAudio: h.viaAudioToAudio, gap: h.gap, prompt: h.prompt })),
          appliedToTrack: r.appliedToTrack ?? false,
          ...(track ? { track } : {}),
        };
      },
    }),
    makeTool(ctx, {
      name: "undo_sound",
      description: "Restore the previous sound on a track (undoes the last replace_sound / refine_sound on it). Returns what was restored and how many undos remain.",
      inputSchema: z.object({ track: z.string().min(1).describe("track/layer name") }),
      summary: (i) => `undo sound on ${i.track}`,
      run: async ({ track }) => { const r = await ctx.undoSound({ track }); return { track, restored: r.restored, remainingUndos: r.remainingUndos ?? 0 }; },
    }),
    makeTool(ctx, {
      name: "listen_live",
      description: "Capture Ableton's REAL audio output for N bars (fires `scene` first if given, else what is playing/selected) and measure it: technical profile of the whole output, plus a Gemini critique when the server attached one. If `silent` is true Live produced no sound (not playing, wrong scene, or output device) - say so and stop. Use before giving feedback on the producer's own set, and again after a change to compare. Say 'I listened to N bars of your set'.",
      inputSchema: z.object({
        bars: z.number().int().min(1).max(16).optional().describe("how many bars to capture (default 4)"),
        scene: z.number().int().min(0).max(31).optional().describe("scene index to fire before capturing; omit to capture what is playing/selected"),
      }),
      summary: (i) => `listen to Live (${i.bars ?? 4} bars${i.scene != null ? `, scene ${i.scene + 1}` : ""})`,
      maxArray: 16,
      run: async ({ bars = 4, scene }) => {
        const r = await ctx.captureLive({ bars, scene });
        const out = { path: r.path, url: r.url, bars: r.bars ?? bars, seconds: r1(r.seconds), silent: Boolean(r.silent), profile: r.profile ? compactProfile(r.profile, r.path) : null };
        if (r.silent) out.hint = "Live produced no sound: check that it is playing, the right scene is fired, and the output device is set";
        if (r.critique) out.critique = r.critique;
        return out;
      },
    }),
    makeTool(ctx, {
      name: "critique_capture",
      description: "Gemini critiques a listen_live capture (the producer's real output) production-first, optionally against a reference and a genre target: styleRead, styleAccuracy, drums, bass {present, type, suggestion}, harmonyMelody, soundDesign, groove, arrangement, moves, mixNotes. Not critique_mix (that renders OUR build). Counts toward the 3 ear calls per turn.",
      inputSchema: z.object({
        path: z.string().min(1).describe("the capture path returned by listen_live"),
        reference: z.string().min(1).optional().describe("'ref#N' or absolute path to compare against (optional)"),
        genreTarget: z.string().max(1500).optional().describe("the genre blueprint summary (or genre name) to judge style accuracy against"),
      }),
      summary: (i) => `critique capture ${i.path.split("/").pop()}${i.reference ? ` vs ${i.reference}` : ""}${i.genreTarget ? " (style target)" : ""}`,
      maxArray: 12,
      run: async ({ path, reference, genreTarget }) => ({ critique: await ctx.critiqueCapture(path, reference ? anyPath(reference) : undefined, genreTarget ? { genreTarget } : undefined) }),
    }),
    makeTool(ctx, {
      name: "describe_set",
      description: "Read the producer's Live set: tempo, playing state, scenes, and per track: name, midi/audio, devices, mixer (volume/pan/mute/solo), clips (slot, name, length, note count), whether it has a sound, selected. Call first when helping with their session.",
      inputSchema: z.object({}),
      summary: () => "describe set",
      maxArray: 32,
      run: async () => {
        const r = await ctx.live.describeSet();
        return {
          tempo: r1(r.tempo), playing: Boolean(r.is_playing ?? r.playing), selectedScene: r.selected_scene ?? null,
          scenes: (r.scenes || []).map((sc) => sc.name ? `${sc.index}:${sc.name}` : String(sc.index)),
          tracks: (r.tracks || []).map((t) => ({
            index: t.index, name: t.name, midi: Boolean(t.is_midi), selected: Boolean(t.selected), hasSound: Boolean(t.has_sound),
            devices: (t.devices || []).map((d) => d.name),
            mixer: t.mixer ? { vol: r1(t.mixer.volume), pan: r1(t.mixer.pan), mute: Boolean(t.mixer.mute), solo: Boolean(t.mixer.solo) } : undefined,
            clips: (t.clips || []).map((c) => ({ slot: c.slot, name: c.name, length: r1(c.length), notes: c.note_count ?? null, ...(c.is_playing ? { playing: true } : {}), ...(c.is_audio ? { audio: true } : {}) })),
          })),
        };
      },
    }),
    makeTool(ctx, {
      name: "read_clip",
      description: "Read all notes of a clip in the producer's set (track name or index, slot). Returns compact notes 'pitch@startBeats:durationBeats[vVelocity]' (up to 64) and the clip length. Read, don't rewrite, unless asked.",
      inputSchema: z.object({
        track: z.string().min(1).describe("track name or index"),
        slot: z.number().int().min(0).max(63).describe("clip slot index"),
      }),
      summary: (i) => `read clip ${i.track}/${i.slot + 1}`,
      run: async ({ track, slot }) => {
        const r = await ctx.live.getClipNotes({ track, slot });
        const notes = (r.notes || []).map((n) => ({ pitch: n.pitch, startBeats: n.start ?? n.startBeats, durationBeats: n.duration ?? n.durationBeats, velocity: n.velocity }));
        return { track: r.track ?? track, slot, length: r1(r.length), ...compactNotes(notes) };
      },
    }),
    makeTool(ctx, {
      name: "import_sample",
      description: "Bring the producer's own sample (a ref#N) into Live: optional toneFix (highpassHz, lowpassHz, gainDb, compress) derived from analyze_audio ratings, then load it into Simpler on `track` (created if missing). mode 'oneshot' trims to the first hit, 'loop' keeps it whole. Explain the numbers you chose.",
      inputSchema: z.object({
        which: z.string().regex(/^ref#\d+$/).describe("'ref#N' of the sample to import"),
        track: z.string().min(1).max(32).optional().describe("target track name (default: the sample's name)"),
        name: z.string().min(1).max(32).optional().describe("name for the processed file"),
        toneFix: z.object({
          highpassHz: z.number().min(20).max(2000).optional().describe("remove rumble/mud below this"),
          lowpassHz: z.number().min(200).max(20000).optional().describe("tame harsh top above this"),
          gainDb: z.number().min(-24).max(24).optional().describe("level correction"),
          compress: z.boolean().optional().describe("gentle compression for consistency"),
        }).optional().describe("corrections derived from the analysis ratings"),
        mode: z.enum(["oneshot", "loop"]).optional().describe("'oneshot' (default) or 'loop'"),
      }),
      summary: (i) => `import ${i.which}${i.track ? ` -> ${i.track}` : ""}${i.toneFix ? ` (${Object.entries(i.toneFix).map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}`,
      maxArray: 8,
      run: async ({ which, track, name, toneFix, mode = "oneshot" }) => {
        const path = recPath(which);
        const refName = refs[Number(which.slice(4)) - 1]?.name;
        const r = await ctx.importSample({ path, track, name: name || refName, toneFix, mode });
        return { samplePath: r.path, url: r.url, track: r.track, chain: r.chain, mode };
      },
    }),
    makeTool(ctx, {
      name: "restyle_audio",
      description: "Stable Audio audio-to-audio on ANY project audio (a ref#N, a recording, a sample path), not only our render: the Analyse room's alternatives, each guided by exactly ONE suggestion in the prompt (warmer / more swing / lo-fi ...). strength = init noise level 0.3 (subtle) .. 0.8 (new sound).",
      inputSchema: z.object({
        which: z.string().min(1).describe("'ref#N', 'beat', 'hum' or an absolute wav path"),
        prompt: z.string().min(3).max(300).describe("target in guide order; one idea per alternative, e.g. 'Genre: Lo-fi Hip Hop, warm tape saturation, dusty, soft top end'"),
        strength: z.number().min(0.3).max(0.8).describe("0.3 subtle .. 0.8 new sound"),
      }),
      summary: (i) => `restyle ${i.which.startsWith("/") ? i.which.split("/").pop() : i.which} (${i.strength}): ${i.prompt.slice(0, 40)}`,
      run: async ({ which, prompt, strength }) => { const r = await ctx.restyleAudio({ which: anyPath(which), prompt, strength }); return { samplePath: r.path, url: r.url, durationSeconds: r1(r.durationSeconds) }; },
    }),
    makeTool(ctx, {
      name: "explain_result",
      description: "Record 'How this was made' for a sound or for the whole turn (the UI shows it, collapsed, on the sound card or the reply). Call after every created or changed sound and after every build turn. Depth follows the user's level (beginner: plain words, 5-7 steps; intermediate: device names + values; pro: terse numbers).",
      inputSchema: z.object({
        path: z.string().optional().describe("samplePath the explanation belongs to; omit for a whole-turn explanation"),
        brief: z.string().min(3).max(300).describe("what was asked, in one sentence"),
        choices: z.array(z.object({ what: z.string().min(1).max(120).describe("the decision"), why: z.string().min(1).max(200).describe("why, in one clause") })).min(1).max(6).describe("the decisions: prompt words, layering, tuning, effects, levels"),
        steps_ableton: z.array(z.string().min(3).max(200)).min(3).max(8).describe("how to recreate it with stock Ableton devices (Simpler, Drum Rack, Saturator, EQ Eight, Glue Compressor, Reverb, Delay, Auto Filter, Redux)"),
        steps_logic: z.array(z.string().min(3).max(200)).min(3).max(8).describe("the same in Logic Pro (Drum Machine Designer, Quick Sampler, Alchemy, Phat FX, Compressor, Channel EQ, Space Designer, Tape Delay, Bitcrusher)"),
      }),
      summary: (i) => `explain ${i.path ? i.path.split("/").pop() : "this turn"}`,
      run: async ({ path, brief, choices, steps_ableton, steps_logic }) => {
        const r = await ctx.explain({ path, brief, choices, steps: { ableton: steps_ableton, logic: steps_logic }, level: opts.level });
        return { stored: true, path: path ?? "turn", level: opts.level, choices: choices.length, steps: { ableton: steps_ableton.length, logic: steps_logic.length }, ...(r && typeof r === "object" ? { id: r.id } : {}) };
      },
    }),
    makeTool(ctx, {
      name: "genre_guide",
      description: "Short guide to a genre: 5 lines of history, 5 artists/tracks to study, 3 production hallmarks (from model knowledge, names to verify). Use at the end of the Analyse report, or when the user asks where a sound comes from.",
      inputSchema: z.object({ genre: z.string().min(2).max(60).describe("genre name, e.g. 'UK Garage', 'Boom Bap'") }),
      summary: (i) => `genre guide: ${i.genre}`,
      run: async ({ genre }) => { const r = await ctx.genreGuide({ genre }); return { genre, guide: typeof r === "string" ? r : r.text ?? r.guide ?? r, ...(r && r.source ? { source: r.source } : {}) }; },
    }),
    makeTool(ctx, {
      name: "genre_blueprint",
      description: "The style blueprint for a genre/era from the knowledge base (2000s hip hop, boom bap, trap, drill, lo-fi hip hop, neo-soul, deep house, tech house, techno, UK garage, drum & bass, afrobeats, reggaeton, dubstep, synthwave...): drum sounds as Stable Audio prompts, pattern archetypes with velocities and swing, bass TYPE and movement vs the kick, chord language and instruments, percussion and textures, arrangement form, Live preset suggestions, common mistakes. Call FIRST when a genre is named (unless the user text already carries an injected blueprint). Unknown genre -> ok:false with the closest names.",
      inputSchema: z.object({ genre: z.string().min(2).max(60).describe("genre or era, e.g. '2000s hip hop', 'g-funk', 'uk garage'") }),
      summary: (i) => `blueprint: ${i.genre}`,
      maxArray: 40,
      run: async ({ genre }) => { const r = await ctx.genreBlueprint(genre); return { slug: r.slug, title: r.title, summary: r.summary, blueprint: r.markdown }; },
    }),
    makeTool(ctx, {
      name: "generate_rhythm",
      description: "Stability COMPOSES a drum loop at the tempo; we extract its hits into a 16th-grid pattern (kick/snare/hat/perc lanes with velocities) plus the loop's groove template, and slice a kit from it. Use when no genre is named (named genre -> design_kit). Then build_kit with the kit + pattern.",
      inputSchema: z.object({
        prompt: z.string().min(3).max(300).optional().describe("loop prompt in guide order (Genre, style, elements and how they sound, production); omit for a neutral loop"),
        bpm: z.number().min(40).max(300).describe("tempo"),
        bars: z.number().int().min(1).max(8).describe("loop length in bars"),
      }),
      summary: (i) => `compose rhythm (${i.bars} bars @ ${i.bpm})${i.prompt ? `: ${i.prompt.slice(0, 40)}` : ""}`,
      maxArray: 32,
      run: async ({ prompt, bpm, bars }) => {
        const r = await ctx.generateRhythm({ prompt, bpm, bars });
        return { loop: r.loop, kit: (r.kit || []).map((k) => ({ kind: k.kind, samplePath: k.samplePath ?? k.path, time: r1(k.time) })), pattern: r.pattern, groove: r.groove ? { swing: r1(r.groove.swing), microtimingMs: (r.groove.microtiming || []).map(r1), velocityProfile: (r.groove.velocityProfile || []).map(r1) } : null };
      },
    }),
    makeTool(ctx, {
      name: "design_kit",
      description: "Genre-true drums: Stability composes 1-3 candidate loops from the genre blueprint's own prompts, Gemini judges each for authenticity vs the blueprint (verdict + 0-10 score), the best is sliced into a kit and sequenced into a pattern + groove. Call FIRST for drums when a genre is named, then build_kit. Returns best, candidates, kit, pattern, groove.",
      inputSchema: z.object({
        genre: z.string().min(2).max(60).optional().describe("genre/era (default: the blueprint in the user text)"),
        bpm: z.number().min(40).max(300).optional().describe("tempo (default: the blueprint's typical tempo)"),
        bars: z.number().int().min(1).max(8).optional().describe("loop length (default 2)"),
        candidates: z.number().int().min(1).max(3).optional().describe("how many loops to compose and judge (default 2)"),
      }),
      summary: (i) => `design kit${i.genre ? ` for ${i.genre}` : ""}${i.bpm ? ` @ ${i.bpm}` : ""} (${i.candidates ?? 2} candidates)`,
      maxArray: 12,
      run: async ({ genre, bpm, bars = 2, candidates = 2 }) => {
        const r = await ctx.designKit({ genre, bpm, bars, candidates });
        return {
          best: r.best ? { samplePath: r.best.path, url: r.best.url, verdict: r.best.verdict, score: r.best.score, why: r.best.why } : null,
          candidates: (r.candidates || []).map((c) => ({ samplePath: c.path, verdict: c.verdict, score: c.score, why: c.why })),
          kit: (r.kit || []).map((k) => ({ kind: k.kind, samplePath: k.samplePath ?? k.path, time: r1(k.time) })),
          pattern: r.pattern, groove: r.groove ? { swing: r1(r.groove.swing) } : null, bpm: r.bpm ?? bpm ?? null,
        };
      },
    }),
    makeTool(ctx, {
      name: "build_kit",
      description: "Put a whole kit on ONE Drums track: a Drum Rack with each sound on a pad (note 36-99; GM: kick 36, snare 38, clap 39, rim 37, closed hat 42, open hat 46) and one clip playing the pattern's lanes at the pad notes. Falls back to per-lane tracks when pads are unavailable (the result says which mode). Use after design_kit / generate_rhythm.",
      inputSchema: z.object({
        name: z.string().min(1).max(32).optional().describe("track name (default 'Drums'; reuse it)"),
        kit: z.array(z.object({
          note: z.number().int().min(36).max(99).describe("pad note, GM mapping"),
          samplePath: z.string().min(1).describe("sound for the pad"),
          label: z.string().min(1).max(32).describe("pad name, e.g. Kick"),
        })).min(1).max(16).describe("sounds to place on pads"),
        pattern: z.object({ bpm: z.number(), bars: z.number().int().min(1).max(8), stepsPerBar: z.number().int().optional(), swing: z.number().optional(), lanes: z.array(z.object({ instrument: z.string(), steps: z.array(StepSchema) })) }).describe("the drum pattern (from design_kit / generate_rhythm, or authored)"),
        bars: z.number().int().min(1).max(8).describe("clip length in bars"),
        slot: z.number().int().min(0).max(7).optional().describe("clip slot / scene (default 0; new beat in an existing set -> next free scene)"),
      }),
      summary: (i) => `build kit${i.name ? ` on ${i.name}` : ""} (${i.kit.length} pads, ${i.bars} bars${i.slot ? `, scene ${i.slot + 1}` : ""})`,
      maxArray: 16,
      run: async ({ name = "Drums", kit, pattern, bars, slot }) => {
        const r = await ctx.live.buildKit({ name, kit, pattern, bars, slot });
        return { track: r.track, mode: r.mode, pads: r.pads, notes: r.notes };
      },
    }),
    makeTool(ctx, {
      name: "load_to_pad",
      description: "Load one sound onto a Drum Rack pad (note 36-99) of a track, creating the Drum Rack if needed. Use to swap a single drum sound without touching the clip.",
      inputSchema: z.object({
        track: z.string().min(1).describe("track name, usually 'Drums'"),
        note: z.number().int().min(36).max(99).describe("pad note (GM: kick 36, snare 38, hats 42)"),
        samplePath: z.string().min(1).describe("sound to load"),
        label: z.string().min(1).max(32).describe("pad name"),
      }),
      summary: (i) => `pad ${i.note} on ${i.track} <- ${i.label}`,
      run: async (i) => ({ ...i, ...(await ctx.live.loadToPad(i)) }),
    }),
    makeTool(ctx, {
      name: "compose_track",
      description: "Stable Audio 3 composes a full genre-true track from the blueprint; Gemini judges authenticity; Demucs separates stems; the drum stem becomes a sliced kit + multi-bar MIDI with the real groove; bass and keys stems become MIDI via basic-pitch; sections pick A/B scenes; everything is built in Live as editable MIDI on a Drum Rack + Live presets. Takes 3-6 minutes; the user sees stage progress. PRIMARY path for 'make me a <genre> beat/track'; falls back to design_kit + build_kit when stems are unavailable (ok:false mentioning pytools/Demucs).",
      inputSchema: z.object({
        genre: z.string().min(2).max(60).optional().describe("genre/era (default: the blueprint in the user text)"),
        bpm: z.number().min(40).max(300).optional().describe("tempo (default: the blueprint's typical tempo)"),
        bars: z.number().int().min(8).max(32).optional().describe("track length in bars (default 16)"),
        prompt: z.string().min(3).max(400).optional().describe("override the blueprint's composition prompt (guide order; the server adds TrackType: Music and the BPM)"),
        candidates: z.number().int().min(1).max(2).optional().describe("how many tracks to compose and judge (default 1; 2 regenerates once if the first is 'off')"),
      }),
      summary: (i) => `compose ${i.bars ?? 16}-bar track${i.genre ? ` (${i.genre})` : ""}${i.bpm ? ` @ ${i.bpm}` : ""}`,
      maxArray: 12,
      run: async ({ genre, bpm, bars = 16, prompt, candidates = 1 }) => {
        const r = await ctx.composeTrack({ genre, bpm, bars, prompt, candidates });
        const stems = r.stems && typeof r.stems === "object" ? Object.fromEntries(Object.entries(r.stems).map(([k, v]) => [k, typeof v === "string" ? v : v?.ref ?? v?.name ?? v?.path ?? null])) : null;
        const built = r.built && typeof r.built === "object" ? Object.fromEntries(Object.entries(r.built).filter(([, v]) => v).map(([k, v]) => [k, { track: v.track?.name ?? v.track ?? null, ...(v.mode ? { mode: v.mode } : {}), ...(v.preset ? { preset: v.preset } : {}), ...(v.muted ? { muted: true } : {}) }])) : null;
        return {
          track: r.track ? { path: r.track.path, url: r.track.url } : null,
          verdict: r.verdict ?? null, score: r.score ?? null, bpm: r.bpm ?? bpm ?? null, bars: r.bars ?? bars,
          stems, kit: (r.kit || []).map((k) => ({ kind: k.kind, samplePath: k.samplePath ?? k.path })),
          patternBars: r.pattern?.bars ?? null, patternLanes: Array.isArray(r.pattern?.lanes) ? r.pattern.lanes.map((l) => `${l.instrument}:${l.steps?.length ?? 0}`) : null,
          bassNotes: count(r.bassNotes), keysNotes: count(r.keysNotes),
          sections: Array.isArray(r.sections) ? r.sections.slice(0, 12).map((x) => `${x.startBar}-${x.endBar}`) : null,
          built, timings: r.timings ?? null,
        };
      },
    }),
    makeTool(ctx, {
      name: "show_live",
      description: "Bring Live to Session view so the user sees the clips.",
      inputSchema: z.object({}),
      summary: () => "show Session view",
      run: async () => ({ ...(await ctx.live.show()) }),
    }),
    makeTool(ctx, {
      name: "play",
      description: "Start Live's transport.",
      inputSchema: z.object({}),
      summary: () => "play",
      run: async () => ({ ...(await ctx.live.play()) }),
    }),
    makeTool(ctx, {
      name: "stop",
      description: "Stop Live's transport.",
      inputSchema: z.object({}),
      summary: () => "stop",
      run: async () => ({ ...(await ctx.live.stop()) }),
    }),
  ];
}

function userTurn(userText, recordings = {}) {
  const now = new Set(recordings.attachedThisTurn || []);
  const mark = (key) => (now.has(key) ? "NEW this turn" : "from an earlier turn");
  const items = [];
  if (recordings.beat) items.push(`'beat' = BEATBOX recording (${mark("beat")}; path: ${recordings.beat})`);
  if (recordings.hum) items.push(`'hum' = HUMMED MELODY recording (${mark("hum")}; path: ${recordings.hum})`);
  const refs = Array.isArray(recordings.refs) ? recordings.refs : [];
  refs.forEach((r, i) => items.push(`ref#${i + 1} "${r.name}" (${mark(`ref#${i + 1}`)}; path: ${r.path})`));
  if (!items.length) return { role: "user", content: userText || "(empty message)" };
  const newOnes = [...now].filter((k) => k === "beat" || k === "hum" || refs[Number((/^ref#(\d+)$/.exec(k) || [])[1]) - 1]);
  const hint = newOnes.length
    ? ` Attached this turn: ${newOnes.join(", ")} - the user may want it analyzed, imitated, or used as the groove/melody source: listen first if the text is vague, then analyze_recording / synthesize_sound / chop_sample with which/source '${newOnes[0]}'.`
    : " Nothing new was attached; earlier files are still usable by name.";
  return { role: "user", content: `${userText || "(no text, just the attachment)"}\n\n[Available recordings and reference files: ${items.join("; ")}.${hint}]` };
}

/**
 * Run one producer turn. `history` is the Anthropic messages array from previous turns (full content blocks).
 * Returns { text, history } where history includes this turn's user message, every assistant message
 * (with tool_use blocks) and every tool_result message, as pushed by the SDK runner.
 */
export async function runProducer({ history = [], userText = "", recordings = {}, ctx, client, maxIterations = 24 }) {
  client ??= new Anthropic();
  const tools = makeTools(ctx, recordings, { level: levelFromText(userText) });
  const messages = [...history, userTurn(userText, recordings)];
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "high" },
    system: PRODUCER_SYSTEM,
    tools,
    messages,
    max_iterations: maxIterations,
  });
  const texts = [];
  let last = null;
  for await (const message of runner) {
    last = message;
    if (message.stop_reason === "refusal") {
      ctx.emit({ type: "error", error: `Claude declined (${message.stop_details?.category || "refusal"})` });
      break;
    }
    if (message.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: message.content });
    const t = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (t) { texts.length = 0; texts.push(t); ctx.emit({ type: "text", text: t }); }   // the last text block set is the reply
  }
  const text = texts.join("\n") || (last?.stop_reason === "max_tokens" ? "(cut off: raise max_tokens)" : "");
  return { text, history: runner.params.messages, stopReason: last?.stop_reason ?? null };
}
