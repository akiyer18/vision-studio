// One-shots from Stable Audio the way the model can actually do them: ask for a SEQUENCE of separate hits, detect every
// onset, keep the ones that sound like the role, cut each with its natural tail (bounded by the next hit), and pick the
// best by role-specific features. One generation yields 5-12 usable, different hits: variations and round-robins for free.
import path from "node:path";
import { ffmpeg } from "./audio.js";
import { decodeMono16k } from "./melody.js";
import { detectOnsets, onsetFeatures, classifyOnset } from "./rhythm.js";
import { analyzeAudio } from "./analyze.js";

export const HIT_ROLES = ["kick", "snare", "clap", "hat_closed", "hat_open", "rim", "perc", "shaker", "snap", "cowbell", "conga", "tom_low", "tom_high", "ride", "crash", "fx"];
const CLASS_OF = { kick: ["kick"], snare: ["snare", "clap"], clap: ["clap", "snare"], hat_closed: ["hat_closed", "hat_open"], hat_open: ["hat_open", "hat_closed"], shaker: ["hat_closed", "hat_open", "perc"], snap: ["clap", "snare", "perc"], rim: ["perc", "snare", "rim"], perc: ["perc", "rim", "hat_closed", "snare"], cowbell: ["perc", "rim"], conga: ["perc", "tom_low", "kick"], tom_low: ["tom_low", "kick", "perc"], tom_high: ["tom_high", "perc", "snare"], ride: ["hat_open", "ride", "perc"], crash: ["hat_open", "crash", "perc"], fx: [] };
const MAX_TAIL = { kick: 0.9, snare: 0.55, clap: 0.5, hat_closed: 0.25, hat_open: 0.9, rim: 0.3, perc: 0.45, shaker: 0.3, snap: 0.3, cowbell: 0.4, conga: 0.5, tom_low: 0.8, tom_high: 0.6, ride: 1.2, crash: 2.0, fx: 2.0 };

/** How a hit should be described to Stable Audio: a sequence, never "a single hit" (that returns drones). */
/** Three phrasings: the model's seed decides whether it honours "separate hits", so callers generate two phrasings in parallel and pool. */
export const HITS_PHRASINGS = 3;
export function hitsPrompt({ role = "kick", character = "", genreTitle = "", count = 6, variant = 0 }) {
  const noun = { kick: "kick drum", snare: "snare drum", clap: "hand clap", hat_closed: "closed hi-hat", hat_open: "open hi-hat", rim: "rimshot", perc: "percussion", shaker: "shaker", snap: "finger snap", cowbell: "cowbell", conga: "conga", tom_low: "low tom", tom_high: "high tom", ride: "ride cymbal", crash: "crash cymbal", fx: "impact sound effect" }[role] || role;
  const ch = String(character || "").replace(/^(TrackType|Genre|Format):[^,]+,\s*/i, "").replace(/\b(a |one )?single (hit|shot)\b,?/gi, "").replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");
  const g = genreTitle ? `, Genre: ${genreTitle}` : "";
  const words = ["six", "six", "eight"][variant % HITS_PHRASINGS];
  if (variant % HITS_PHRASINGS === 1) return `TrackType: SFX${g}, drum machine ${noun} samples, ${words} separate ${ch ? ch + " " : ""}${noun} hits, one hit per second, silence between hits, dry, no music, no other drums`;
  if (variant % HITS_PHRASINGS === 2) return `TrackType: SFX${g}, ${noun} one-shot sample pack preview, ${words} different ${ch ? ch + " " : ""}${noun} hits played one at a time with silence in between, dry, close-miked, no music`;
  return `TrackType: SFX${g}, drum machine ${noun} one-shots, ${words} separate ${ch ? ch + " " : ""}${noun} hits with one second of silence between each hit, punchy attack, dry, no music, no other drums`;
}

/** Score a candidate hit for a role from its 16 kHz onset features (rms 0-1, centroid Hz, zcr) and the gap to the next hit. */
function scoreHit(role, f, gap) {
  const c = f.centroid || 0, r = f.rms || 0;
  const band = (lo, hi) => (c >= lo && c <= hi ? 1 : c < lo ? Math.max(0, 1 - (lo - c) / lo) : Math.max(0, 1 - (c - hi) / hi));
  let s = r;                                            // louder = more confident transient
  if (role === "kick") s += 1.2 * band(70, 450);
  else if (role === "snare" || role === "clap" || role === "snap") s += 1.2 * band(700, 4000);
  else if (role === "hat_closed" || role === "shaker") s += 1.2 * band(4500, 12000);
  else if (role === "hat_open" || role === "ride" || role === "crash") s += 1.2 * band(3500, 11000);
  else if (role === "rim" || role === "perc" || role === "cowbell" || role === "conga") s += 1.0 * band(400, 6000);
  else if (role === "tom_low") s += 1.0 * band(80, 500);
  else if (role === "tom_high") s += 1.0 * band(150, 900);
  s += 0.8 * Math.min(gap, MAX_TAIL[role] || 0.5) / (MAX_TAIL[role] || 0.5);   // room for the natural tail
  return s;
}

/**
 * extractHits(rawPath, { role, max, outDir, name }) -> { hits: [{ path, time, length, score, features }], picked, total }
 * Cuts every candidate of the role's class into its own stereo wav (natural tail, bounded by the next onset, short fade).
 */
export async function extractHits(rawPath, { role = "kick", max = 4, outDir, name = role, targetPeakDb = -3 } = {}) {
  // 100 ms of pre-roll: generations often open with a hit at t=0, which an onset detector cannot see without silence before it
  const PRE = 0.1;
  const padded = path.join(outDir, `${name}-pad.wav`);
  await ffmpeg(["-i", rawPath, "-af", `adelay=${PRE * 1000}|${PRE * 1000}`, "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", padded]);
  const x = await decodeMono16k(padded);
  const onsets = detectOnsets(x);
  rawPath = padded;
  const times = onsets.map((o) => o.time).sort((a, b) => a - b);
  const gapAfter = (t) => { const nx = times.find((v) => v > t + 0.03); return nx ? nx - t : 1.5; };
  const want = new Set(CLASS_OF[role] || []);
  const cands = [];
  for (const o of onsets) {
    const f = onsetFeatures(x, o.sample); const cls = classifyOnset(f);
    if (want.size && !want.has(cls)) continue;
    if ((f.rms || 0) < 0.05) continue;                                   // ghost noise, not a hit
    cands.push({ time: o.time, cls, f, gap: gapAfter(o.time), score: scoreHit(role, f, gapAfter(o.time)) });
  }
  // nothing matched the class (model mislabelled): fall back to every strong onset
  const pool = cands.length ? cands : onsets.map((o) => { const f = onsetFeatures(x, o.sample); return { time: o.time, cls: classifyOnset(f), f, gap: gapAfter(o.time), score: scoreHit(role, f, gapAfter(o.time)) }; }).filter((h) => (h.f.rms || 0) >= 0.08);
  pool.sort((a, b) => b.score - a.score);
  // de-duplicate near-identical hits (same machine, same sound): keep spread in time so variations differ a little
  const picked = []; for (const h of pool) { if (picked.length >= max) break; if (picked.some((p) => Math.abs(p.time - h.time) < 0.2)) continue; picked.push(h); }
  const hits = [];
  for (const [i, h] of picked.entries()) {
    const len = Math.max(0.06, Math.min(MAX_TAIL[role] || 0.5, h.gap - 0.008));
    const fade = Math.min(0.04, len / 4);
    const out = path.join(outDir, `${name}-${i ? String.fromCharCode(65 + i) : "A"}.wav`);
    await ffmpeg(["-ss", String(Math.max(0, h.time - 0.004)), "-i", rawPath, "-t", String(len), "-af", `afade=t=in:st=0:d=0.002,afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade}`, "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", out]);
    // normalize to the target peak (Stability renders hit 0 dBFS; summed layers at 0 dBFS clip Live's master)
    try { const a = await analyzeAudio(out); const peak = a.loudness?.peakDbfs; if (Number.isFinite(peak)) { const g = targetPeakDb - peak; if (Math.abs(g) > 0.5) { const tmp = out.replace(/\.wav$/, "-n.wav"); await ffmpeg(["-i", out, "-af", `volume=${g.toFixed(2)}dB`, "-c:a", "pcm_s16le", tmp]); await ffmpeg(["-i", tmp, "-c:a", "pcm_s16le", "-y", out]); } hits.push({ path: out, label: String.fromCharCode(65 + i), time: Number(h.time.toFixed(3)), length: Number(len.toFixed(3)), score: Number(h.score.toFixed(2)), cls: h.cls, centroidHz: Math.round(h.f.centroid || 0), subShare: a.spectrum?.bands?.sub?.share ?? null }); continue; } } catch {}
    hits.push({ path: out, label: String.fromCharCode(65 + i), time: Number(h.time.toFixed(3)), length: Number(len.toFixed(3)), score: Number(h.score.toFixed(2)), cls: h.cls, centroidHz: Math.round(h.f.centroid || 0) });
  }
  for (const h of hits) h.time = Number(Math.max(0, h.time - PRE).toFixed(3));
  return { hits, picked: hits[0] || null, total: onsets.length, matching: cands.length };
}
