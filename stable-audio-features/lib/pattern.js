// Natural-language drum description -> pattern JSON. Claude when a key is set, rules otherwise.
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const GM_DRUM_NOTES = {
  kick: 36, snare: 38, clap: 39, rim: 37, hat_closed: 42, hat_open: 46,
  tom_low: 45, tom_high: 50, ride: 51, crash: 49, perc: 54,
  shaker: 70, snap: 75, cowbell: 56, conga: 63, vox: 60, fx: 55, texture: 57,
};

const INSTRUMENTS = Object.keys(GM_DRUM_NOTES);

export const PatternSchema = z.object({
  name: z.string(),
  bpm: z.number().min(40).max(300),
  bars: z.number().int().min(1).max(8),
  stepsPerBar: z.literal(16),
  swing: z.number().min(0).max(1),
  lanes: z.array(
    z.object({
      instrument: z.enum(INSTRUMENTS),
      steps: z.array(
        z.object({
          step: z.number().int().min(0).max(127),
          velocity: z.number().int().min(1).max(127),
        }),
      ),
    }),
  ),
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- rule-based parser ----------

/** Expand a one-bar list of [step, velocity] over `bars` bars. */
function tile(hits, bars) {
  const out = [];
  for (let b = 0; b < bars; b++) for (const [s, v] of hits) out.push({ step: b * 16 + s, velocity: v });
  return out;
}

const every = (interval, vel = 100, accentEvery = 0, accentVel = 115, offset = 0) => {
  const hits = [];
  for (let s = offset; s < 16; s += interval) {
    hits.push([s, accentEvery && (s / interval) % accentEvery === 0 ? accentVel : vel]);
  }
  return hits;
};

const FOUR_ON_FLOOR = [[0, 120], [4, 110], [8, 118], [12, 110]];
const BACKBEAT = [[4, 115], [12, 120]];
const OFFBEAT_HATS = [[2, 90], [6, 90], [10, 92], [14, 90]];
const HALF_TIME_SNARE = [[8, 120]];

// Keyword table: regex -> lane edits. Order matters (genre presets first, modifiers after).
const RULES = [
  { re: /\b(four|4)[ -]?(on|to)[ -]?the[ -]?floor\b|\bkick on every beat\b/, lanes: { kick: FOUR_ON_FLOOR } },
  { re: /\bhouse\b/, bpm: 124, lanes: { kick: FOUR_ON_FLOOR, clap: BACKBEAT, hat_open: OFFBEAT_HATS } },
  { re: /\btechno\b/, bpm: 132, lanes: { kick: FOUR_ON_FLOOR, hat_closed: OFFBEAT_HATS, rim: [[6, 70], [14, 70]] } },
  { re: /\b(dnb|drum ?(and|n|&) ?bass|jungle)\b/, bpm: 174, lanes: { kick: [[0, 120], [10, 110]], snare: [[4, 120], [12, 120]], hat_closed: every(2, 80, 2, 95) } },
  { re: /\b(breakbeat|amen|break)\b/, bpm: 140, lanes: { kick: [[0, 120], [10, 105]], snare: [[4, 118], [7, 60], [12, 120], [15, 55]], hat_closed: every(2, 85) } },
  { re: /\b(boom ?bap)\b/, bpm: 90, lanes: { kick: [[0, 120], [7, 100], [10, 110]], snare: BACKBEAT, hat_closed: every(2, 85, 2, 100) }, swing: 0.3 },
  { re: /\bhip ?hop\b/, bpm: 92, lanes: { kick: [[0, 120], [6, 95], [10, 110]], snare: BACKBEAT, hat_closed: every(2, 85) }, swing: 0.2 },
  { re: /\btrap\b/, bpm: 140, lanes: { kick: [[0, 120], [7, 110], [10, 105]], snare: HALF_TIME_SNARE, hat_closed: every(2, 85, 2, 100) } },
  { re: /\b(dembow|reggaeton)\b/, bpm: 95, lanes: { kick: FOUR_ON_FLOOR, snare: [[3, 110], [6, 115], [11, 110], [14, 115]], hat_closed: every(2, 80) } },
  { re: /\bafro ?beats?\b/, bpm: 105, lanes: { kick: [[0, 118], [6, 100], [8, 112], [14, 100]], rim: [[3, 90], [7, 85], [11, 90], [15, 85]], hat_closed: every(2, 75, 2, 90) } },
  { re: /\b(uk ?garage|2[ -]?step)\b/, bpm: 132, lanes: { kick: [[0, 120], [10, 110]], snare: BACKBEAT, hat_closed: every(2, 85, 2, 100) }, swing: 0.45 },
  // modifiers
  { re: /\bbackbeat\b|\bsnare on (the )?2 and 4\b|\bsnares? on 2 ?(and|&|\+) ?4\b/, lanes: { snare: BACKBEAT } },
  { re: /\bclaps?\b/, lanes: { clap: BACKBEAT } },
  { re: /\bhalf[ -]?time\b/, lanes: { snare: HALF_TIME_SNARE }, removeLanes: ["clap"] },
  { re: /\boff[ -]?beat (hi[ -]?)?hats?\b/, lanes: { hat_open: OFFBEAT_HATS } },
  { re: /\b(16th|sixteenth) (hi[ -]?)?hats?\b|\btrap (hi[ -]?)?hats?\b/, lanes: { hat_closed: [...every(1, 75, 4, 100).slice(0, 12), [12, 100], [13, 70], [14, 85], [15, 95]] } },
  { re: /\b(8th|eighth) (hi[ -]?)?hats?\b/, lanes: { hat_closed: every(2, 85, 2, 100) } },
  { re: /\bride\b/, lanes: { ride: every(2, 85, 2, 100) } },
  { re: /\bcrash\b/, lanes: { crash: [[0, 120]] } },
  { re: /\bghost (notes?|snares?)\b/, lanes: { snare: [...BACKBEAT, [7, 50], [15, 45], [10, 42]] } },
];

const DEFAULT_LANES = { kick: [[0, 120], [8, 112], [10, 100]], snare: BACKBEAT, hat_closed: every(2, 85, 2, 100) };

export function rulesToPattern({ description = "", bpm, bars }) {
  const text = description.toLowerCase();
  const bpmMatch = text.match(/\b(\d{2,3})\s*bpm\b/);
  const barsMatch = text.match(/\b(\d)\s*bars?\b/);
  let lanes = {};
  let swing = 0;
  let presetBpm;
  let matched = false;
  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    matched = true;
    if (rule.bpm && presetBpm === undefined) presetBpm = rule.bpm;
    if (rule.swing !== undefined) swing = rule.swing;
    for (const l of rule.removeLanes || []) delete lanes[l];
    Object.assign(lanes, rule.lanes);
  }
  if (!matched) lanes = DEFAULT_LANES;
  if (/\bswing|shuffle\b/.test(text) && !swing) swing = 0.35;
  if (/\bstraight\b/.test(text)) swing = 0;

  const finalBpm = clamp(Number(bpmMatch?.[1] ?? bpm ?? presetBpm ?? 120), 40, 300);
  const finalBars = clamp(Math.round(Number(barsMatch?.[1] ?? bars ?? 1)) || 1, 1, 8);
  return PatternSchema.parse({
    name: description.trim().slice(0, 40) || "beat",
    bpm: finalBpm,
    bars: finalBars,
    stepsPerBar: 16,
    swing,
    lanes: Object.entries(lanes).map(([instrument, hits]) => ({ instrument, steps: tile(hits, finalBars) })),
  });
}

// ---------- Claude ----------

const SYSTEM = `You turn a producer's natural-language description of a drum groove into a step-sequencer pattern.
Grid: 16 steps per bar (each step is a 16th note). Step 0 is beat 1, step 4 is beat 2, step 8 is beat 3, step 12 is beat 4. Steps are numbered continuously across bars (bar 2 starts at step 16).
Instruments (GM drum names): kick, snare, clap, rim, hat_closed, hat_open, tom_low, tom_high, ride, crash, perc.
Velocity: ghost notes 40-60, normal hits 85-105, accents 110-127. Vary velocities so it feels human.
Idioms: four on the floor = kick on steps 0,4,8,12. Backbeat = snare/clap on 4 and 12. Offbeat hats = open or closed hat on 2,6,10,14. 8th hats = every 2 steps. Trap hats = 16ths with rolls (extra 32nd feel implied by dense hits and velocity dips) usually on the last beat; trap snare is half-time on step 8. Boom bap = swung 8th hats, kick on 0 plus syncopated kicks (e.g. 7, 10), snare on 4 and 12. Breakbeat/amen = kick 0 and 10, snare 4 and 12 with ghost snares on 7 and 15. Half-time = snare only on step 8. Dembow/reggaeton = kick on every beat, snare on 3, 6, 11, 14. Afrobeat = syncopated kick, rim/perc on offbeat 16ths, light hats. UK garage = 2-step kick (0, 10), shuffled hats with swing ~0.4-0.5.
Respect any bpm, bar count, or swing the user states; otherwise choose genre-typical values. Keep the pattern tight and musical rather than cluttered. stepsPerBar is always 16.`;

async function claudeToPattern({ description, bpm, bars }) {
  const client = new Anthropic();
  const hints = [bpm ? `Default BPM if unspecified: ${bpm}.` : "", bars ? `Bars: ${bars}.` : ""].filter(Boolean).join(" ");
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `${description}\n${hints}`.trim() }],
    output_config: { format: zodOutputFormat(PatternSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude returned no pattern");
  const p = response.parsed_output;
  const maxStep = p.bars * 16 - 1;
  p.lanes = p.lanes.map((l) => ({ ...l, steps: l.steps.filter((s) => s.step <= maxStep) }));
  return PatternSchema.parse(p);
}

/** describeToPattern({ description, bpm, bars=1 }) -> { pattern, source: 'claude'|'rules' } */
export async function describeToPattern({ description = "", bpm, bars = 1 }) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return { pattern: await claudeToPattern({ description, bpm, bars }), source: "claude" };
    } catch (err) {
      console.warn("[pattern] Claude failed, using rules:", err?.message || err);
    }
  }
  return { pattern: rulesToPattern({ description, bpm, bars }), source: "rules" };
}
