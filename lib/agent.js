// The producer agent: Claude with tools, like Claude Code for beats.
// server.js injects `ctx` (synth, pattern/melody writers, analysis, Live operations, emit) and we give Claude
// the tools; the SDK tool runner drives the loop. History is the raw Anthropic messages array (full content blocks).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = "claude-opus-5-5";

export const PRODUCER_SYSTEM = `You are a music producer sitting next to the user with Ableton Live open. You build their beat for them, layer by layer, with tools. The user is at a hackathon: be terse, confident, musical. No filler, no apologies.

HOW YOU WORK
- Order of layers: tempo -> kick -> snare or clap -> hats -> percussion -> bass / chords / lead. Build what the idea calls for; you do not need every layer.
- Every sound is synthesized with Stable Audio via synthesize_sound, then placed in Live with build_drum_layer or build_melody_layer. Synthesize independent sounds in PARALLEL (several tool calls in one turn), then build the layers.
- If the user recorded a beatbox (a "beat" recording is attached), call analyze_recording {which:"beat"} FIRST. Use its pattern and bpm. Make each drum sound FROM THEIR HIT: synthesize_sound with source:"beatbox" and offsetSeconds = the time of the first onset of that instrument. Their timing and their mouth sounds are the brief.
- If the user hummed a melody (a "hum" recording is attached), analyze_recording {which:"hum"} gives you the notes; keep their pitches and rhythm, fix only obvious glitches.
- REFERENCE FILES: the user can attach audio files (listed as ref#1, ref#2 ... with their names). When the text says "like this", "match this", "use this groove", "this kick", the reference is the source of truth: listen to it (one call) to learn its character, then analyze_recording {which:"ref#N", as:"beat"|"hum"} for its groove or melody and/or synthesize_sound {source:"ref#N"} to make sounds from it. In your reply say which ref you used ("built from ref#1 'loop.wav'").
- transcribe_audio (polyphonic audio -> MIDI, 20-60 s) is the best way to get a melody, chords or a bassline out of a reference file or a hummed line when analyze_recording's monophonic hum tracking is not enough; feed its notes to build_melody_layer.
- Author drum patterns yourself in build_drum_layer when you have a clear idea (16 steps per bar, step 0 = beat 1). Use write_drum_pattern only when you want a genre template to start from.
- Velocities: accents 110-127, normal 90-105, ghost notes 35-55. Hats breathe: alternate 70-100. Swing 0-0.6 (0.3 is a lazy hip hop feel).

EARS (listen / judge_sound run an audio-language model; 10-40 s each, so at most 3 listen/judge calls per turn)
- When the user's text is vague or missing and a recording is attached, call listen on their beatbox/hum to understand what they are going for (timbre, mood, energy). Quote ONE short phrase of what you heard back to them.
- After synthesizing a sound that matters (the kick, the lead synth) or any sound the user complained about, call judge_sound {path, intent}. If match <= 5, re-synthesize ONCE with a prompt improved by the critique, then build with the better one. Do not judge hats and small percussion unless asked.
- When you verified a sound by listening, say so in one phrase ("checked the kick: tight, clicky").

STABLE AUDIO PROMPTS (the "prompt" of synthesize_sound)
- Describe the sound with adjectives and nouns; never give instructions. Under 25 words. English only.
- Drums: end with ", dry one-shot". Example: "punchy acoustic snare, tight, bright crack, slight room, dry one-shot".
- Tonal sounds (synth, bass, pad, lead, keys): end with ", single sustained note, no drums". Example: "fat detuned supersaw, bright, analog, single sustained note, no drums".
- Match the genre: techno kicks are tight and clicky, boom bap kicks dusty and round, trap snares cracked and layered.

ATTACHMENTS PERSIST
- Recordings and reference files stay available across turns; the user turn lists every one with its path and marks which arrived this turn. You may use a ref attached two turns ago ("that loop from before").

EFFECTS AND MIX (add_effect / set_param / set_mixer; say what you set)
- "dirtier / warmer / crunchy" -> Saturator (Drive 12-24 dB) or Overdrive on that track, before re-synthesizing the sound.
- "wider / more space / roomy" -> Reverb (Decay 1-3 s, Dry/Wet 15-30 %).
- "darker / muffled / filtered" -> Auto Filter lowpass (Frequency 800-3000 Hz).
- "glue / tighter drums / punchier bus" -> Glue Compressor or Drum Buss on the drum tracks.
- "lo-fi / crushed" -> Redux. "movement / bounce" -> Ping Pong Delay or Echo on perc or hats at low Dry/Wet (10-25 %).
- Mixer volume is linear 0-1: 0.85 ~ 0 dB, 0.7 ~ -6 dB, 0.6 ~ -12 dB. Drums ~0.8, bass ~0.75, pads ~0.65. Pan -1..1.

VOCAL CHOPS AND SAMPLE PIECES (no Stability needed)
- When asked for vocal chops, stabs or "use pieces of this": chop_sample the ref (it returns hits with times) or slice_sample a specific moment; build a layer named e.g. "Vox Chop" with slice paths and a pattern you author (16th grid, syncopated, 4-8 hits per bar). For new textures, run a piece through synthesize_sound {source:"ref#N", offsetSeconds} instead.

VARIATIONS AND ARRANGEMENT
- Scene A is slot 0 (the main groove). Variations ("a drop", "a fill version", "a B part") go to slot 1 (scene B) on the same tracks via build/update with slot:1; create_scene names it, fire_scene switches. Keep scene A intact.
- "lay it out" / "record it" / "make an arrangement" -> record_arrangement {bars} records what plays in Session into the Arrangement for N bars (fire the scene you want first).

LIVE
- Track names are the layer names: Kick, Snare, Clap, Hats, Open Hats, Rim, Perc, Bass, Saw, Pad, Keys, Lead... Reuse the same name to replace a layer; use a new name for a new one.
- Call set_tempo before the first layer. Use show_live when you have built something so the user sees it.
- A tool result with ok:false means it did NOT happen. Say so plainly and move on or retry once with a change. Never claim something is in Live unless the tool returned ok:true.

REPLY FORMAT (after the tools are done)
3-6 short lines, no headings:
1) what is now in Live (track names, bpm, bars) - one or two lines;
2) one thing you noticed or chose and why (one line);
3) 2-3 next steps the user can just say back, e.g. "add a rolling bassline", "make the hats lazier", "swap the kick for an 808". Phrase them as plain commands.`;

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

function brief(obj, { maxArray = 6 } = {}) {
  // JSON for the model: shorten long arrays so tool results stay cheap
  const seen = (v) => {
    if (Array.isArray(v)) return v.length > maxArray ? [...v.slice(0, maxArray).map(seen), `…+${v.length - maxArray} more`] : v.map(seen);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, seen(x)]));
    return v;
  };
  return JSON.stringify(seen(obj));
}

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

export function makeTools(ctx, recordings = {}) {
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
        return { bpm: r.bpm, bars: r.bars, noteCount: r.notes.length, notes: r.notes };
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
        return { key: r.key || key, bars: r.bars || bars, noteCount: r.notes.length, notes: r.notes, source: r.source };
      },
    }),
    makeTool(ctx, {
      name: "synthesize_sound",
      description: "Make one sound with Stable Audio and save it as a wav. Returns samplePath to pass to build_drum_layer / build_melody_layer / replace_sound. source:'text' uses only the prompt; 'beatbox' or 'hum' transforms the user's recording at offsetSeconds (use the first onset time of that instrument from analyze_recording). Independent sounds: call several times in one turn.",
      inputSchema: z.object({
        role: z.enum(ROLES).describe("what the sound is for; drives the file slot and the default sample length"),
        prompt: z.string().min(3).max(300).describe("Stable Audio prompt: adjectives + nouns, no instructions; drums end with ', dry one-shot', tonal sounds with ', single sustained note, no drums'"),
        source: z.string().regex(/^(text|beatbox|hum|ref#\d+)$/).default("text").describe("'text' = from prompt only; 'beatbox'/'hum' = transform the attached recording; 'ref#N' = transform the Nth attached reference file (audio-to-audio)"),
        offsetSeconds: z.number().min(0).optional().describe("where in the recording the hit is (first onset of that instrument), for source 'beatbox'"),
        lengthSeconds: z.number().min(0.2).max(20).optional().describe("one-shot length in seconds; default 1 s for drums, 2.5 s for tonal sounds. Longer values make longer sustained tones: use 6-16 s for pads, drones and loops when the user asks for them"),
        strength: z.number().min(0.1).max(1).optional().describe("for beatbox/hum/ref sources: 0.3 keeps the recording's character, 0.9 mostly follows the prompt; default 0.7 (0.6 for refs, to stay close to the reference)"),
      }),
      summary: (i) => `synth ${i.role}: ${i.prompt.slice(0, 50)}${i.source !== "text" ? ` (from ${i.source})` : ""}`,
      run: async ({ role, prompt, source = "text", offsetSeconds, lengthSeconds, strength }) => {
        const tonal = ["synth", "bass", "pad", "lead", "pluck", "keys"].includes(role);
        const isRef = source.startsWith("ref#");
        const audioPath = source === "text" ? undefined : recPath(isRef ? source : source === "beatbox" ? "beat" : "hum");
        const r = await ctx.synth({ role, prompt, kind: tonal ? "tone" : "drum", audioPath, offsetSeconds, oneshotSeconds: lengthSeconds ?? (tonal ? 2.5 : 1.0), strength: strength ?? (isRef ? 0.6 : undefined) });
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
      description: "Transcribe an attached recording or reference file to MIDI notes with a polyphonic music-transcription model (MuScriptor). Use for melodies, chords, basslines in a reference file, or a hummed line when analyze_recording's monophonic tracking is not enough. Returns notes (pitch, startBeats, durationBeats, velocity), bars, bpm and the instruments found; pass the notes to build_melody_layer. 20-60 s latency. Optional instruments hint (e.g. ['acoustic_piano','synth_pad']).",
      inputSchema: z.object({
        which: z.string().regex(/^(beat|hum|ref#\d+)$/).describe("'hum' for the hummed melody, 'beat' for the beatbox, or 'ref#N' for the Nth reference file"),
        instruments: z.array(z.string().min(1).max(40)).max(6).optional().describe("optional instrument hints for the model, e.g. ['acoustic_piano'], ['synth_pad'], ['drums']"),
      }),
      summary: (i) => `transcribe ${i.which}${i.instruments?.length ? ` (${i.instruments.join(", ")})` : ""}`,
      run: async ({ which, instruments }) => {
        const p = recPath(which);
        const r = await ctx.transcribe(p, { instruments: instruments || [] });
        return { noteCount: r.notes.length, notes: r.notes, bars: r.bars, bpm: r.bpm, tracks: r.tracks, summary: r.summary };
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
      name: "add_effect",
      description: "Add an Ableton audio effect to a track and optionally set parameters by name. Devices: Saturator, Overdrive, Reverb, Auto Filter, Glue Compressor, Drum Buss, Redux, Ping Pong Delay, Echo, Compressor, EQ Eight, Chorus, Phaser, Utility. Live's internal ranges differ from producer units (Saturator Drive is -36..36 dB, Reverb Decay Time is in ms, Dry/Wet is 0..1 on some devices and 0..100 on others, quantized params take an integer index): the result lists the device's params with name/min/max/display, so read it and prefer values stated relative to that range ('Drive +18 dB', 'Dry/Wet 25%'). Requested values are clamped into range; seconds given for a ms param are converted.",
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
        return { track, device: deviceName, deviceIndex: loaded?.device?.index ?? loaded?.index, set, deviceParams: paramsOut };
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
      description: "Record what is currently playing in Session view into the Arrangement for N bars, then stop. Fire the scene you want first. Use when the user says 'lay it out', 'record it', 'make an arrangement'.",
      inputSchema: z.object({ bars: z.number().int().min(1).max(64).describe("how many bars to record") }),
      summary: (i) => `record ${i.bars} bars to arrangement`,
      run: async ({ bars }) => ({ bars, ...(await ctx.live.recordArrangement({ bars })) }),
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
  const tools = makeTools(ctx, recordings);
  const messages = [...history, userTurn(userText, recordings)];
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
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
