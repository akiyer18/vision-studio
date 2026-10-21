// Beatbox recording -> drum pattern: energy-flux onsets + spectral-centroid classification.
import { decodeMono16k, SR } from "./melody.js";
import { PatternSchema } from "./pattern.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const FRAME = 512;                 // 32 ms at 16 kHz
const MIN_GAP_S = 0.06;
const FEAT_LEN = 640;              // 40 ms feature window

/**
 * Onset detection on log-energy flux: d[i] = max(0, log(e[i]+eps) - log(e[i-1]+eps)) over 32 ms frames,
 * adaptive threshold max(mean + 1.5*std over a ±0.5 s window, 1.0 ≈ +8.7 dB), local maxima only, 60 ms min gap.
 * (Log compression keeps quiet hats detectable next to loud kicks; plain energy flux lets kicks inflate the std.)
 */
export function detectOnsets(x) {
  const n = Math.floor(x.length / FRAME);
  if (n < 2) return [];
  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * FRAME; j < (i + 1) * FRAME; j++) s += x[j] * x[j];
    energy[i] = s / FRAME;
  }
  const EPS = 1e-5;
  const flux = new Float64Array(n);
  for (let i = 1; i < n; i++) flux[i] = Math.max(0, Math.log(energy[i] + EPS) - Math.log(energy[i - 1] + EPS));
  let globalMax = 0;
  for (let i = 0; i < n; i++) globalMax = Math.max(globalMax, flux[i]);
  if (globalMax <= 0) return [];
  const half = Math.round(SR / FRAME / 2); // ~0.5 s each side
  const onsets = [];
  for (let i = 1; i < n - 1; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
    let mean = 0, cnt = 0;
    for (let j = lo; j <= hi; j++) { mean += flux[j]; cnt++; }
    mean /= cnt;
    let v = 0;
    for (let j = lo; j <= hi; j++) v += (flux[j] - mean) ** 2;
    const std = Math.sqrt(v / cnt);
    const thr = Math.max(mean + 1.5 * std, 1.0);
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
      // refine onset time: first sample above 30% of the frame peak, searching from the previous frame
      // (an attack that straddles a frame boundary is otherwise reported up to 32 ms late)
      const s0 = i * FRAME;
      let peak = 0;
      for (let j = s0; j < s0 + FRAME; j++) peak = Math.max(peak, Math.abs(x[j]));
      let k = Math.max(0, s0 - FRAME);
      while (k < s0 + FRAME && Math.abs(x[k]) < 0.3 * peak) k++;
      const time = k / SR;
      const last = onsets[onsets.length - 1];
      if (last && time - last.time < MIN_GAP_S) { if (flux[i] > last.flux) { last.time = time; last.flux = flux[i]; last.sample = k; } continue; }
      onsets.push({ time, flux: flux[i], sample: k });
    }
  }
  return onsets;
}

/**
 * Features over 40 ms from `start`: rms, zcr (crossings per sample), spectral centroid (Hz).
 * Centroid is power-weighted (|X|^2) over a naive DFT up to 8 kHz, with a half-Hann taper on the second half of the
 * window: the attack sits at the window start, and an un-tapered end would add a 1/f tail that drags kicks up to ~1 kHz.
 */
export function onsetFeatures(x, start) {
  const len = Math.min(FEAT_LEN, x.length - start);
  let s = 0, zc = 0;
  for (let i = 0; i < len; i++) {
    s += x[start + i] * x[start + i];
    if (i > 0 && (x[start + i] >= 0) !== (x[start + i - 1] >= 0)) zc++;
  }
  const rms = Math.sqrt(s / len), zcr = zc / len;
  const half = len >> 1;
  const win = new Float64Array(len);
  for (let i = 0; i < len; i++) win[i] = i < half ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - half)) / half));
  const bins = len >> 1;
  let num = 0, den = 0;
  for (let k = 1; k < bins; k++) {
    let re = 0, im = 0;
    const w = (2 * Math.PI * k) / len;
    for (let i = 0; i < len; i++) { const v = x[start + i] * win[i]; re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
    const pow = re * re + im * im;
    num += (k * SR / len) * pow; den += pow;
  }
  return { rms, zcr, centroid: den > 0 ? num / den : 0 };
}

/** centroid < 400 Hz -> kick, > 3000 Hz -> hat_closed, else snare (very low ZCR in the middle band -> kick). */
export function classifyOnset({ centroid, zcr }) {
  if (centroid < 400) return "kick";
  if (centroid > 3000) return "hat_closed";
  if (zcr < 0.04) return "kick";
  return "snare";
}

/** Estimate bpm from the median inter-onset interval, scaled by 1/2/4 into 70-180. */
export function estimateBpm(onsets) {
  if (onsets.length < 3) return 120;
  const iois = [];
  for (let i = 1; i < onsets.length; i++) iois.push(onsets[i].time - onsets[i - 1].time);
  iois.sort((a, b) => a - b);
  const med = iois[iois.length >> 1];
  if (!(med > 0)) return 120;
  const base = 60 / med;
  for (const m of [1, 2, 4, 0.5]) { const c = base * m; if (c >= 70 && c <= 180) return Math.round(c); }
  return 120;
}

/**
 * beatboxToPattern(wavPath, { bpm, bars }) -> { pattern, onsets:[{ time, instrument, energy, centroid, step }], bpm }
 */
export async function beatboxToPattern(wavPath, { bpm, bars } = {}) {
  const x = await decodeMono16k(wavPath);
  const raw = detectOnsets(x);
  const feats = raw.map((o) => {
    const f = onsetFeatures(x, o.sample);
    return { time: o.time, instrument: classifyOnset(f), energy: f.rms, centroid: Math.round(f.centroid), zcr: f.zcr };
  });
  const tempo = clamp(Math.round(Number(bpm) || estimateBpm(raw)), 40, 300);
  const stepsPerBar = 16, stepBeats = 0.25;
  const t0 = feats.length ? feats[0].time : 0; // grid origin = first hit (recordings start with silence)
  for (const o of feats) o.step = Math.round(((o.time - t0) * tempo) / 60 / stepBeats);
  const maxStep = feats.reduce((m, o) => Math.max(m, o.step), 0);
  const nBars = clamp(Math.round(Number(bars) || Math.ceil((maxStep + 1) / stepsPerBar)), 1, 8);
  const lanes = {};
  for (const o of feats) {
    if (o.step >= nBars * stepsPerBar) continue;
    const vel = clamp(Math.round(50 + 77 * Math.min(1, o.energy / 0.3)), 1, 127);
    const lane = (lanes[o.instrument] ??= new Map());
    lane.set(o.step, Math.max(lane.get(o.step) || 0, vel));
  }
  const pattern = PatternSchema.parse({
    name: "beatbox",
    bpm: tempo,
    bars: nBars,
    stepsPerBar,
    swing: 0,
    lanes: ["kick", "snare", "hat_closed"].filter((i) => lanes[i]).map((instrument) => ({
      instrument,
      steps: [...lanes[instrument].entries()].sort((a, b) => a[0] - b[0]).map(([step, velocity]) => ({ step, velocity })),
    })),
  });
  return { pattern, onsets: feats, bpm: tempo, origin: t0 };
}
