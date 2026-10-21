// One sentence from the producer -> a build plan for drums, pattern, melody and synth sound.
// Claude when ANTHROPIC_API_KEY is set, keyword heuristics otherwise.
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const PlanSchema = z.object({
  title: z.string(),
  bpm: z.number().min(40).max(300),
  bars: z.number().int().min(1).max(8),
  drum: z.object({
    name: z.string(),
    prompt: z.string(),
  }),
  drums: z.array(z.object({ role: z.enum(["kick", "snare", "clap", "hat_closed", "hat_open", "rim", "perc", "tom_low", "tom_high", "ride", "crash"]), prompt: z.string() })).min(1).max(5),
  pattern: z.object({ description: z.string() }),
  melody: z.object({ description: z.string(), key: z.string(), bars: z.number().int().min(1).max(8) }).nullable(),
  synth: z.object({ name: z.string(), prompt: z.string() }).nullable(),
});

const GENRE_BPM = [
  [/\b(dnb|drum and bass|jungle)\b/, 174], [/\btechno\b/, 132], [/\bhouse\b/, 124], [/\btrap\b/, 140],
  [/\bboom bap\b/, 90], [/\bhip ?hop\b/, 92], [/\b(dembow|reggaeton)\b/, 95], [/\bafrobeat/, 105],
  [/\b(garage|2-?step)\b/, 132], [/\bbreak(beat)?\b/, 140], [/\bdubstep\b/, 140], [/\bambient\b/, 80],
];
const DRUM_WORDS = ["kick", "snare", "clap", "hat", "hihat", "hi-hat", "rim", "tom", "perc", "808", "909"];
export const DEFAULT_DRUM_PROMPTS = {
  kick: "punchy kick drum, deep, tight, dry one-shot",
  snare: "punchy snare drum, tight, bright crack, dry one-shot",
  clap: "tight layered clap, short, bright, dry one-shot",
  hat_closed: "crisp closed hi-hat, short, metallic, dry one-shot",
  hat_open: "open hi-hat, sizzling, medium decay, dry one-shot",
  rim: "woody rimshot, short click, dry one-shot",
  perc: "short percussion hit, woody, dry one-shot",
  tom_low: "low floor tom, deep, round, dry one-shot",
  tom_high: "high tom, tight, punchy, dry one-shot",
  ride: "ride cymbal, bright ping, long decay",
  crash: "crash cymbal, bright, long decay",
};
function heuristicDrums(t) {
  const adj = (word) => { const m = t.match(new RegExp(`([\\w ,-]{0,40}\\b${word}\\w*\\b[\\w ,-]{0,20})`)); return m ? m[1].trim() : null; };
  const out = [];
  const add = (role, word) => { if (!out.some((d) => d.role === role)) out.push({ role, prompt: adj(word) ? `${adj(word)}, dry one-shot` : DEFAULT_DRUM_PROMPTS[role] }); };
  if (/\b(kick|808|boom)\b/.test(t)) add("kick", "kick");
  if (/\bsnare\b/.test(t)) add("snare", "snare");
  if (/\bclap\b/.test(t)) add("clap", "clap");
  if (/\b(hat|hihat|hi-hat|hats)\b/.test(t)) add(/\bopen hat/.test(t) ? "hat_open" : "hat_closed", "hat");
  if (/\brim/.test(t)) add("rim", "rim");
  if (!out.some((d) => d.role === "kick")) add("kick", "kick");
  if (!out.some((d) => d.role === "snare" || d.role === "clap")) add("snare", "snare");
  if (!out.some((d) => d.role.startsWith("hat"))) add("hat_closed", "hat");
  return out.slice(0, 5);
}
const SYNTH_WORDS = [
  [/\bsupersaw|saw\b/, "saw", "fat supersaw synth, single sustained note, bright, analog, no drums"],
  [/\bpad\b/, "pad", "warm analog synth pad, single sustained note, soft, lush, no drums"],
  [/\bpluck\b/, "pluck", "bright synth pluck, single note, short decay, clean, no drums"],
  [/\b(sub|808 bass|bass(line)?)\b/, "bass", "deep sub bass synth, single sustained note, clean low end, no drums"],
  [/\b(lead|synth|arp|arpeggio|chords?|stabs?|melody|keys|piano|rhodes)\b/, "synth", "analog synth lead, single sustained note, warm, clean, no drums"],
];

function heuristicPlan({ text = "", hasBeatbox = false, hasHum = false }) {
  const t = text.toLowerCase();
  const bpmMatch = t.match(/(\d{2,3})\s*bpm/);
  let bpm = bpmMatch ? Number(bpmMatch[1]) : (GENRE_BPM.find(([re]) => re.test(t)) || [, 120])[1];
  bpm = Math.min(300, Math.max(40, bpm));
  const barsMatch = t.match(/(\d)\s*bars?/);
  const bars = barsMatch ? Math.min(8, Math.max(1, Number(barsMatch[1]))) : 1;

  // drum sound: the first drum word plus the adjectives around it
  const drumWord = DRUM_WORDS.find((w) => t.includes(w)) || (hasBeatbox ? "drum" : "snare");
  const around = t.match(new RegExp(`([\\w ,-]{0,40}\\b${drumWord}\\w*\\b[\\w ,-]{0,30})`));
  const drumPrompt = `${around ? around[1].trim() : drumWord}, punchy, dry`;

  const keyMatch = t.match(/\b([a-g](?:#|b|♯|♭)?)\s*(minor|major|min|maj|m)\b/i);
  const key = keyMatch ? `${keyMatch[1].toUpperCase().replace("♯", "#").replace("♭", "b")} ${/maj/i.test(keyMatch[2]) ? "major" : "minor"}` : "C minor";
  const synthHit = SYNTH_WORDS.find(([re]) => re.test(t));
  const wantsMelody = hasHum || Boolean(synthHit) || keyMatch;

  return {
    title: text.trim().slice(0, 40) || "untitled",
    bpm, bars,
    drum: { name: drumWord.replace(/[^a-z0-9]/g, "") || "drum", prompt: drumPrompt },
    drums: heuristicDrums(t),
    pattern: { description: text || "four on the floor, snare on 2 and 4, offbeat hats" },
    melody: wantsMelody ? { description: text || `arp in ${key}`, key, bars: Math.max(bars, 2) } : null,
    synth: wantsMelody ? { name: synthHit ? synthHit[1] : "synth", prompt: synthHit ? synthHit[2] : SYNTH_WORDS[4][2] } : null,
  };
}

const SYSTEM = `You turn a music producer's one-line idea into a build plan for an Ableton Live session.
Return: title; bpm (infer from genre if not stated: house 124, techno 132, dnb 174, trap 140, boom bap 90, hip hop 92, reggaeton 95, garage 132); bars (1-8, default 1 for drums);
drum: the single most important drum sound (name like "snare"/"kick"/"clap" and a Stable Audio prompt: descriptive adjectives of the sound, e.g. "punchy acoustic snare, tight, bright crack, dry one-shot" - describe the sound, never give instructions);
drums: one entry per distinct drum sound the groove needs (usually kick, snare or clap, hat_closed, sometimes hat_open/rim/perc; 2-5 entries), each with role and a Stable Audio one-shot prompt in the same style, matching the genre;
pattern.description: a precise drum-groove description for a pattern generator (instruments, which 16th steps, dynamics, swing);
melody: null unless the idea implies a melodic/harmonic part (synth, saw, arp, bass, chords, pad, lead, a key is named, or the producer hummed a melody); otherwise description of the melodic line, key (e.g. "C minor"), bars (2-4);
synth: null unless melody is set; otherwise name and a Stable Audio prompt for ONE sustained single note of that synth sound ("fat supersaw synth, single sustained note, bright, no drums").
Keep prompts under 25 words. Only English.`;

async function claudePlan({ text, hasBeatbox, hasHum }) {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Idea: ${text || "(no text)"}\nProducer beatboxed a beat: ${hasBeatbox}\nProducer hummed a melody: ${hasHum}` }],
    output_config: { format: zodOutputFormat(PlanSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error(`no plan (${response.stop_reason})`);
  return response.parsed_output;
}

export async function makePlan(input) {
  if (process.env.ANTHROPIC_API_KEY) {
    try { return { plan: await claudePlan(input), source: "claude" }; }
    catch (err) { console.warn("[plan] Claude failed, using heuristics:", err?.message || err); }
  }
  return { plan: PlanSchema.parse(heuristicPlan(input)), source: "rules" };
}
