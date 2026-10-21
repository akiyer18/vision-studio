// Short producer instruction ("faster", "double the hats", "octave up") -> partial state changes.
// Claude when ANTHROPIC_API_KEY is set, keyword rules otherwise. null fields mean "unchanged".
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PatternSchema } from "./pattern.js";
import { NoteSchema } from "./melody.js";

const DRUM_ROLES = ["kick", "snare", "clap", "hat", "perc", "tom", "rim"];

export const TweakMelodySchema = z.object({
  notes: z.array(NoteSchema),
  bars: z.number().int().min(1).max(8),
  key: z.string().nullable(),
});

export const TweakSchema = z.object({
  summary: z.string(),
  bpm: z.number().min(40).max(300).nullable(),
  pattern: PatternSchema.nullable(),
  melody: TweakMelodySchema.nullable(),
  drums: z.array(z.object({ role: z.enum(DRUM_ROLES), prompt: z.string() })).nullable(),
  synth: z.object({ prompt: z.string() }).nullable(),
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clone = (o) => JSON.parse(JSON.stringify(o));
const EMPTY = { bpm: null, pattern: null, melody: null, drums: null, synth: null };

// ---------- lane helpers (operate on every bar of the pattern) ----------

const barSteps = (pattern) => pattern.bars * 16;

/** Replace or create a lane with hits tiled over all bars. hits = [[stepInBar, velocity], ...] */
function setLane(pattern, instrument, hits) {
  const steps = [];
  for (let b = 0; b < pattern.bars; b++) for (const [s, v] of hits) steps.push({ step: b * 16 + s, velocity: v });
  const lane = pattern.lanes.find((l) => l.instrument === instrument);
  if (lane) lane.steps = steps;
  else pattern.lanes.push({ instrument, steps });
}

function dropLanes(pattern, instruments) {
  pattern.lanes = pattern.lanes.filter((l) => !instruments.includes(l.instrument));
}

/** Add hits (tiled per bar) to a lane, keeping existing steps; a hit on an existing step overrides velocity. */
function addHits(pattern, instrument, hits) {
  let lane = pattern.lanes.find((l) => l.instrument === instrument);
  if (!lane) { lane = { instrument, steps: [] }; pattern.lanes.push(lane); }
  for (let b = 0; b < pattern.bars; b++) {
    for (const [s, v] of hits) {
      const step = b * 16 + s;
      const existing = lane.steps.find((h) => h.step === step);
      if (existing) existing.velocity = v;
      else lane.steps.push({ step, velocity: v });
    }
  }
  lane.steps.sort((a, b) => a.step - b.step);
}

/** Keep only the hits whose step-in-bar is in `keep`. */
function filterLane(pattern, instrument, keep) {
  const lane = pattern.lanes.find((l) => l.instrument === instrument);
  if (lane) lane.steps = lane.steps.filter((h) => keep.includes(h.step % 16));
}

const sixteenths = () => Array.from({ length: 16 }, (_, s) => [s, s % 4 === 0 ? 110 : s % 2 === 0 ? 95 : 70]);
const eighths = () => [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, s % 4 === 0 ? 105 : 85]);
const OFFBEATS = [[2, 90], [6, 90], [10, 92], [14, 90]];
const BACKBEAT = [[4, 115], [12, 120]];
const FOUR_ON_FLOOR = [[0, 120], [4, 110], [8, 118], [12, 110]];
const GHOSTS = [[7, 45], [10, 42], [15, 45]];

// ---------- rule table ----------
// Each rule: regex on the lowercased text, a human summary, and an apply(ctx) that mutates ctx.changes.
// ctx = { text, state, changes, pattern(), melody() }  -- pattern()/melody() lazily clone the current one.

const RULES = [
  // tempo
  { re: /(\d{2,3})\s*bpm/, name: "set bpm", apply: (c, m) => { c.changes.bpm = clamp(Number(m[1]), 40, 300); } },
  { re: /\bdouble[ -]?time\b/, name: "double time", apply: (c) => { c.changes.bpm = clamp((c.changes.bpm ?? c.state.bpm ?? 120) * 2, 40, 300); } },
  { re: /\b(faster|quicker|speed (it )?up|more tempo)\b(?!\s+(the\s+)?(hi-?hats?|hats?)\b)/, name: "faster", apply: (c) => { c.changes.bpm = clamp((c.changes.bpm ?? c.state.bpm ?? 120) + 8, 40, 300); } },
  { re: /\b(slower|slow (it )?down|less tempo)\b/, name: "slower", apply: (c) => { c.changes.bpm = clamp((c.changes.bpm ?? c.state.bpm ?? 120) - 8, 40, 300); } },
  // half time (feel, not tempo)
  { re: /\bhalf[ -]?time\b/, name: "half time", apply: (c) => { const p = c.pattern(); setLane(p, "snare", [[8, 120]]); dropLanes(p, ["clap"]); } },
  // swing
  { re: /\b(more|extra) (swing|shuffle|groove)\b|\bswing it more\b/, name: "more swing", apply: (c) => { const p = c.pattern(); p.swing = clamp((p.swing || 0) + 0.15, 0, 0.6); } },
  { re: /\b(less|reduce) (swing|shuffle)\b/, name: "less swing", apply: (c) => { const p = c.pattern(); p.swing = clamp((p.swing || 0) - 0.15, 0, 1); } },
  { re: /\b(straight|quantize[d]?|no swing|unswung)\b/, name: "straight", apply: (c) => { c.pattern().swing = 0; } },
  { re: /^(?!.*\b(more|less|extra|reduce|no|straight)\b).*\b(swing|shuffle|swung)\b/, name: "swing", apply: (c) => { const p = c.pattern(); if (!p.swing) p.swing = 0.35; } },
  // hats
  { re: /\b(remove|no|kill|drop|delete) (the )?(hi-?hats?|hats?)\b/, name: "remove hats", apply: (c) => { dropLanes(c.pattern(), ["hat_closed", "hat_open"]); } },
  { re: /\b(double|faster|busier|more|16th|sixteenth|trap) (the )?(hi-?hats?|hats?)\b|\bhats? (on )?(every )?16ths?\b/, name: "16th hats", apply: (c) => { setLane(c.pattern(), "hat_closed", sixteenths()); } },
  { re: /\b(8th|eighth) (note )?(hi-?hats?|hats?)\b|\bhats? on (the )?8ths?\b/, name: "8th hats", apply: (c) => { setLane(c.pattern(), "hat_closed", eighths()); } },
  { re: /\b(fewer|less|sparser|simpler|calmer) (hi-?hats?|hats?)\b/, name: "fewer hats", apply: (c) => {
      const p = c.pattern();
      const lane = p.lanes.find((l) => l.instrument === "hat_closed");
      if (lane && lane.steps.some((h) => h.step % 2 === 1)) filterLane(p, "hat_closed", [0, 2, 4, 6, 8, 10, 12, 14]);
      else if (lane) filterLane(p, "hat_closed", [2, 6, 10, 14]);
    } },
  { re: /\b(open|off-?beat) (hi-?hats?|hats?)\b|\bhats? on (the )?off-?beats?\b/, name: "offbeat open hats", apply: (c) => { setLane(c.pattern(), "hat_open", OFFBEATS); } },
  // clap / snare
  { re: /\b(remove|no|kill|drop|delete) (the )?claps?\b/, name: "remove clap", apply: (c) => { dropLanes(c.pattern(), ["clap"]); } },
  { re: /\b(add|put|with) (a )?claps?( on (2|two) and (4|four))?\b|\bclaps? on (2|two) and (4|four)\b/, name: "add clap", apply: (c) => { setLane(c.pattern(), "clap", BACKBEAT); } },
  { re: /\b(remove|no|kill|drop|delete) (the )?snares?\b/, name: "remove snare", apply: (c) => { dropLanes(c.pattern(), ["snare"]); } },
  { re: /\bsnares? on (2|two) and (4|four)\b|\bbackbeat\b/, name: "backbeat", apply: (c) => { setLane(c.pattern(), "snare", BACKBEAT); } },
  { re: /\bghost (notes?|snares?)\b/, name: "ghost notes", apply: (c) => { const p = c.pattern(); if (!p.lanes.find((l) => l.instrument === "snare")) setLane(p, "snare", BACKBEAT); addHits(p, "snare", GHOSTS); } },
  // kick
  { re: /\b(four|4)[ -]?(on|to)[ -]?the[ -]?floor\b|\bkick on every beat\b/, name: "four on the floor", apply: (c) => { setLane(c.pattern(), "kick", FOUR_ON_FLOOR); } },
  { re: /\b(very |much )?(busier|busy|more|extra|double) (the )?kicks?\b|\bkick (busier|more)\b/, name: "busier kick", apply: (c, m) => {
      const p = c.pattern(); const hits = [[10, 108]]; if (/very|much/.test(m[0])) hits.push([7, 100]);
      if (!p.lanes.find((l) => l.instrument === "kick")) setLane(p, "kick", [[0, 120], [8, 118]]);
      addHits(p, "kick", hits);
    } },
  { re: /\b(sparser|less|fewer|simpler|minimal) (the )?kicks?\b|\bkick (sparser|less)\b/, name: "sparser kick", apply: (c) => { filterLane(c.pattern(), "kick", [0, 8]); } },
  // melody
  { re: /\b(an? )?octave (up|higher)\b|\btranspose (the )?(melody )?up (an? )?octave\b/, name: "octave up", apply: (c) => { const m = c.melody(); if (m) transpose(m, 12); } },
  { re: /\b(an? )?octave (down|lower)\b|\btranspose (the )?(melody )?down (an? )?octave\b/, name: "octave down", apply: (c) => { const m = c.melody(); if (m) transpose(m, -12); } },
  { re: /\btranspose (the )?(melody )?(up|down) (\d{1,2})( semitones?| steps?| half[ -]?steps?)?\b/, name: "transpose", apply: (c, m) => { const mel = c.melody(); if (mel) transpose(mel, (m[3] === "down" ? -1 : 1) * Number(m[4])); } },
  { re: /\b(simpler|sparser|less busy|fewer notes) (in the )?(melody|notes|arp|lead)\b|\b(melody|arp) simpler\b/, name: "simpler melody", apply: (c) => { const m = c.melody(); if (m) m.notes = m.notes.filter((_, i) => i % 2 === 0); } },
  { re: /\blonger notes\b|\b(sustain|hold) (the )?notes\b/, name: "longer notes", apply: (c) => {
      const m = c.melody(); if (!m) return; const end = m.bars * 4;
      for (const n of m.notes) n.durationBeats = Math.max(0.25, Math.min(n.durationBeats * 2, end - n.startBeats));
    } },
  // re-synthesize sounds
  { re: /\b(change|make|turn|swap|replace) (the )?(kick|snare|clap|hat|hi-?hat|perc|tom|rim)s? (?:(?:to|into|sound|sound like|more) )?(.+)$/, name: "re-synth drum", apply: (c, m) => {
      const role = m[3].replace(/^hi-?hat$/, "hat");
      c.changes.drums = [...(c.changes.drums || []), { role, prompt: `${m[4].trim().replace(/[.!]+$/, "")}, punchy, dry one-shot` }];
    } },
  { re: /\b(make|turn|change) (the )?(saw|synth|pad|bass|lead|pluck|keys|rhodes|melody sound) (.+)$/, name: "re-synth synth", apply: (c, m) => {
      const base = c.state.plan?.synth?.prompt || `${m[3]} synth, single sustained note`;
      c.changes.synth = { prompt: `${m[4].trim().replace(/[.!]+$/, "")} ${base}`.slice(0, 200) };
    } },
];

function transpose(melody, semis) {
  for (const n of melody.notes) n.pitch = clamp(n.pitch + semis, 36, 96);
}

// ---------- rules entry point ----------

export function rulesTweak({ text = "", state = {} }) {
  const lower = String(text).toLowerCase().trim();
  const changes = { summary: "", ...EMPTY };
  const ctx = {
    text: lower, state, changes,
    pattern() { if (!changes.pattern) changes.pattern = state.pattern ? clone(state.pattern) : emptyPattern(state.bpm); return changes.pattern; },
    melody() {
      if (changes.melody) return changes.melody;
      if (!state.melody?.notes) return null;
      changes.melody = { notes: clone(state.melody.notes), bars: state.melody.bars || 1, key: state.melody.key ?? null };
      return changes.melody;
    },
  };
  const applied = [];
  for (const rule of RULES) {
    const m = rule.re.exec(lower);
    if (!m) continue;
    try { rule.apply(ctx, m); applied.push(rule.name); } catch (err) { console.warn("[tweak] rule failed", rule.name, err?.message); }
  }
  if (changes.pattern) {
    const maxStep = barSteps(changes.pattern) - 1;
    for (const lane of changes.pattern.lanes) lane.steps = lane.steps.filter((h) => h.step <= maxStep);
    changes.pattern.lanes = changes.pattern.lanes.filter((l) => l.steps.length);
    if (changes.bpm != null) changes.pattern.bpm = changes.bpm;
  }
  changes.summary = applied.length ? applied.join(", ") : `No change understood: "${text}"`;
  return TweakSchema.parse(changes);
}

function emptyPattern(bpm) {
  return { name: "tweak", bpm: clamp(bpm || 120, 40, 300), bars: 1, stepsPerBar: 16, swing: 0, lanes: [] };
}

// ---------- Claude path ----------

const SYSTEM = `You are a drum programmer and arranger editing a producer's current session from one short instruction.
You receive the current state as JSON: bpm, a drum pattern (16 steps per bar, step index 0..bars*16-1, velocities 1-127, swing 0-1,
instruments: kick snare clap rim hat_closed hat_open tom_low tom_high ride crash perc), optionally a melody (notes with pitch 36-96,
startBeats, durationBeats, velocity; bars), and the plan (sound prompts).
Return ONLY what changes, each as a complete replacement: if any drum lane changes, return the FULL new pattern (all lanes, all bars);
if the melody changes, return the full new melody; bpm only if the tempo changes. Everything that is unchanged must be null.
"drums" is for re-synthesizing a drum sound: role (kick|snare|clap|hat|perc|tom|rim) + a Stable Audio prompt. "synth" re-synthesizes the melodic sound.
Sound prompts describe the sound with adjectives (instruments, texture, mood), never instructions, under 25 words, English only.
Musical conventions: half time = snare on step 8 of each bar; ghost notes = velocity 35-50; accents 110-127; "double the hats" = every 16th with 8th accents.
summary: one short sentence of what you changed.`;

async function claudeTweak({ text, state }) {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Instruction: ${text}\n\nCurrent state:\n${JSON.stringify(state)}` }],
    output_config: { format: zodOutputFormat(TweakSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error(`no tweak (${response.stop_reason})`);
  return response.parsed_output;
}

export async function applyTweak({ text = "", state = {} }) {
  if (process.env.ANTHROPIC_API_KEY) {
    try { return { changes: TweakSchema.parse(await claudeTweak({ text, state })), source: "claude" }; }
    catch (err) { console.warn("[tweak] Claude failed, using rules:", err?.message || err); }
  }
  return { changes: rulesTweak({ text, state }), source: "rules" };
}
