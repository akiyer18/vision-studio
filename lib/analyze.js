// Technical audio profile for one-shots, loops and references: measurements + low/medium/high ratings.
// No npm deps. ffmpeg decodes (44.1 kHz stereo f32le) and measures EBU R128 loudness; everything else is computed here.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { estimateBpm } from "./rhythm.js";

const execFileP = promisify(execFile);
export const SR = 44100;
const FFT_N = 4096, HOP = 1024;
const SILENCE_DB = -60;                 // frames quieter than this are left out of the spectrum average
const RHYTHM_MIN_SECONDS = 1.5;         // onset/bpm analysis only makes sense on material at least this long

/**
 * Rating thresholds. value < low -> 'low'; value > high -> 'high'; otherwise 'medium'.
 * metric = where the number comes from in the profile; unit is reported with every rating.
 */
export const RATING_THRESHOLDS = {
  loudness:   { metric: "loudness.integratedLufs", unit: "LUFS",  low: -20,   high: -12 },   // integrated program loudness
  punch:      { metric: "loudness.crestFactorDb",  unit: "dB",    low: 10,    high: 16 },    // peak - RMS: transient-to-body ratio
  subWeight:  { metric: "spectrum.bands.sub.share",    unit: "share", low: 0.08, high: 0.25 }, // 20-60 Hz share of total energy
  lowEnd:     { metric: "spectrum.bands.low.share",    unit: "share", low: 0.15, high: 0.40 }, // 60-250 Hz
  body:       { metric: "spectrum.bands.lowMid.share", unit: "share", low: 0.12, high: 0.35 }, // 250-800 Hz
  presence:   { metric: "spectrum.bands.mid.share",    unit: "share", low: 0.10, high: 0.30 }, // 800-2500 Hz
  brightness: { metric: "spectrum.centroidHz",         unit: "Hz",    low: 1000, high: 3000 }, // spectral centroid
  air:        { metric: "spectrum.bands.air.share",    unit: "share", low: 0.03, high: 0.12 }, // 8-20 kHz
  noisiness:  { metric: "spectrum.flatness",           unit: "",      low: 0.10, high: 0.30 }, // spectral flatness (1 = white noise)
  tonalness:  { metric: "pitch.confidence",            unit: "",      low: 0.30, high: 0.70 }, // YIN periodicity confidence
  length:     { metric: "durationSeconds",             unit: "s",     low: 0.3,  high: 2.0 },
};
export const BANDS = { sub: [20, 60], low: [60, 250], lowMid: [250, 800], mid: [800, 2500], high: [2500, 8000], air: [8000, 20000] };
const FORBIDDEN = /\b(good|bad|nice|weak|better|worse|great|poor|strong|beautiful|ugly|amazing|terrible)\b/i;

// ---------- decode ----------
export async function decodeStereo44k(path) {
  const { stdout } = await execFileP("ffmpeg", ["-i", path, "-ac", "2", "-ar", String(SR), "-f", "f32le", "-loglevel", "error", "-"], { encoding: "buffer", maxBuffer: 1 << 30 });
  const buf = Buffer.from(stdout);
  const inter = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 8)));
  const n = inter.length >> 1;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = inter[2 * i]; R[i] = inter[2 * i + 1]; }
  return { L, R };
}
async function probe(path) {
  try {
    const { stdout } = await execFileP("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate", "-of", "json", path]);
    const s = JSON.parse(stdout).streams?.[0] || {};
    return { channels: Number(s.channels) || 1, sampleRate: Number(s.sample_rate) || SR };
  } catch { return { channels: 2, sampleRate: SR }; }
}

// ---------- FFT (radix-2, iterative) ----------
const twiddleCache = new Map();
function twiddles(n) {
  if (twiddleCache.has(n)) return twiddleCache.get(n);
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
  const t = { cos, sin }; twiddleCache.set(n, t); return t;
}
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {               // bit reversal
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len, half = len >> 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sin[k * step];
        const a = i + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}
const hann = (() => { const w = new Float64Array(FFT_N); for (let i = 0; i < FFT_N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_N - 1)); return w; })();

/** Averaged power spectrum (bins 0..N/2) over all non-silent frames. */
export function averagePowerSpectrum(x) {
  const bins = FFT_N / 2 + 1, acc = new Float64Array(bins);
  const re = new Float64Array(FFT_N), im = new Float64Array(FFT_N);
  let frames = 0;
  const total = x.length < FFT_N ? 1 : Math.floor((x.length - FFT_N) / HOP) + 1;
  for (let f = 0; f < total; f++) {
    const start = f * HOP;
    let e = 0;
    for (let i = 0; i < FFT_N; i++) { const v = start + i < x.length ? x[start + i] : 0; re[i] = v * hann[i]; im[i] = 0; e += v * v; }
    if (10 * Math.log10(e / FFT_N + 1e-20) < SILENCE_DB) continue;
    fft(re, im);
    for (let k = 0; k < bins; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (frames) for (let k = 0; k < bins; k++) acc[k] /= frames;
  return acc;
}

export function spectrumFeatures(power) {
  const bins = power.length, hzPerBin = SR / FFT_N;
  const lo = Math.ceil(20 / hzPerBin), hi = Math.min(bins - 1, Math.floor(20000 / hzPerBin));
  let total = 0, weighted = 0;
  for (let k = lo; k <= hi; k++) { total += power[k]; weighted += power[k] * k * hzPerBin; }
  const centroidHz = total > 0 ? weighted / total : 0;
  let cum = 0, rolloff85Hz = 0;
  for (let k = lo; k <= hi; k++) { cum += power[k]; if (cum >= 0.85 * total) { rolloff85Hz = k * hzPerBin; break; } }
  // flatness over 20 Hz - 16 kHz
  const fhi = Math.min(bins - 1, Math.floor(16000 / hzPerBin));
  let logSum = 0, linSum = 0, cnt = 0;
  for (let k = lo; k <= fhi; k++) { const p = power[k] + 1e-18; logSum += Math.log(p); linSum += p; cnt++; }
  const flatness = cnt ? Math.exp(logSum / cnt) / (linSum / cnt) : 0;
  const bands = {};
  for (const [name, [f0, f1]] of Object.entries(BANDS)) {
    let s = 0;
    for (let k = Math.ceil(f0 / hzPerBin); k <= Math.min(hi, Math.floor(f1 / hzPerBin)); k++) if (k * hzPerBin > f0 || name === "sub") s += power[k];
    const share = total > 0 ? s / total : 0;
    bands[name] = { share: round(share, 4), db: round(10 * Math.log10(share + 1e-12), 1) };
  }
  return { centroidHz: round(centroidHz, 1), rolloff85Hz: round(rolloff85Hz, 1), flatness: round(flatness, 4), bands };
}

// ---------- envelope / dynamics ----------
export function envelopeFeatures(mono) {
  const win = Math.round(SR * 0.002), hop = Math.round(SR * 0.001);
  const n = Math.max(1, Math.floor((mono.length - win) / hop) + 1);
  const env = new Float64Array(n);
  let peakIdx = 0, peakVal = 0, sumSq = 0, peakSample = 0;
  for (let i = 0; i < mono.length; i++) { const a = Math.abs(mono[i]); if (a > peakSample) peakSample = a; sumSq += mono[i] * mono[i]; }
  for (let f = 0; f < n; f++) {
    let s = 0; const st = f * hop;
    for (let i = 0; i < win; i++) { const v = mono[st + i] || 0; s += v * v; }
    env[f] = Math.sqrt(s / win);
    if (env[f] > peakVal) { peakVal = env[f]; peakIdx = f; }
  }
  const peakDb = 20 * Math.log10(peakVal + 1e-12);
  let onset = 0;                                       // first frame within 30 dB of the envelope peak
  for (let f = 0; f <= peakIdx; f++) if (20 * Math.log10(env[f] + 1e-12) >= peakDb - 30) { onset = f; break; }
  const attackMs = (peakIdx - onset) * hop / SR * 1000;
  let decayIdx = n - 1;                                // first frame after the peak that falls 20 dB below it
  for (let f = peakIdx; f < n; f++) if (20 * Math.log10(env[f] + 1e-12) <= peakDb - 20) { decayIdx = f; break; }
  const decayMs = (decayIdx - peakIdx) * hop / SR * 1000;
  let mid = 0, cnt = 0;                                // mean level of the middle half of the file relative to the peak
  for (let f = Math.floor(n * 0.25); f < Math.floor(n * 0.75); f++) { mid += env[f]; cnt++; }
  const sustainRatio = cnt && peakVal > 0 ? mid / cnt / peakVal : 0;
  const rmsDbfs = 20 * Math.log10(Math.sqrt(sumSq / Math.max(1, mono.length)) + 1e-12);
  const peakDbfs = 20 * Math.log10(peakSample + 1e-12);
  return { attackMs: round(attackMs, 1), decayMs: round(decayMs, 1), sustainRatio: round(sustainRatio, 3), peakDbfs: round(peakDbfs, 2), rmsDbfs: round(rmsDbfs, 2), crestFactorDb: round(peakDbfs - rmsDbfs, 2) };
}

async function ebur128(path) {
  try {
    const { stderr } = await execFileP("ffmpeg", ["-nostats", "-i", path, "-af", "ebur128=framelog=verbose", "-f", "null", "-"], { maxBuffer: 1 << 26 });
    const I = stderr.match(/\n\s*I:\s+(-?[\d.]+)\s+LUFS/), LRA = stderr.match(/\n\s*LRA:\s+(-?[\d.]+)\s+LU/);
    if (!I) return null;
    return { integratedLufs: Number(I[1]), loudnessRange: LRA ? Number(LRA[1]) : null };
  } catch { return null; }
}

// ---------- pitch (YIN on the loudest 200 ms) ----------
const F_MIN = 40, F_MAX = 2000, YIN_W = 2048;
export function pitchFeatures(mono) {
  const seg = Math.round(SR * 0.2);
  if (mono.length < YIN_W + Math.ceil(SR / F_MIN)) return null;
  // loudest 200 ms window
  let best = 0, bestE = -1;
  const hop = Math.round(SR * 0.02);
  for (let s = 0; s + seg <= mono.length; s += hop) { let e = 0; for (let i = s; i < s + seg; i++) e += mono[i] * mono[i]; if (e > bestE) { bestE = e; best = s; } }
  if (bestE <= 0) return null;
  const tauMin = Math.floor(SR / F_MAX), tauMax = Math.ceil(SR / F_MIN);
  const start = Math.min(best, mono.length - (YIN_W + tauMax));
  if (start < 0) return null;
  const d = new Float64Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) { let s = 0; for (let j = 0; j < YIN_W; j++) { const diff = mono[start + j] - mono[start + j + tau]; s += diff * diff; } d[tau] = s; }
  const cmnd = new Float64Array(tauMax + 1); let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cmnd[tau] = tau < tauMin ? 1 : (d[tau] * tau) / (run || 1e-12); }
  let pick = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) if (cmnd[tau] < 0.15) { while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++; pick = tau; break; }
  if (pick < 0) { let m = 1e9; for (let tau = tauMin; tau <= tauMax; tau++) if (cmnd[tau] < m) { m = cmnd[tau]; pick = tau; } }
  const confidence = Math.max(0, Math.min(1, 1 - cmnd[pick]));
  if (confidence < 0.3) return { hz: null, midi: null, note: null, confidence: round(confidence, 3) };
  let t = pick;
  if (pick > tauMin && pick < tauMax) { const a = cmnd[pick - 1], b = cmnd[pick], c = cmnd[pick + 1]; const den = a - 2 * b + c; if (Math.abs(den) > 1e-12) t = pick + 0.5 * (a - c) / den; }
  const hz = SR / t, midi = 69 + 12 * Math.log2(hz / 440);
  return { hz: round(hz, 2), midi: round(midi, 2), note: noteName(Math.round(midi)), confidence: round(confidence, 3) };
}
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

// ---------- onsets (44.1 kHz, level-rise detector) ----------
// 5.8 ms frames; an onset is a rise of >= ONSET_RISE_DB above the quietest frame of the preceding 50 ms, at a level above
// ONSET_FLOOR_DBFS, with a 50 ms minimum gap. Unlike the beatbox detector (adaptive flux on 32 ms frames) this still sees a
// hat inside a kick tail and is not thrown off by digital silence between hits (rendered previews have no noise floor).
const ONSET_FRAME = 256, ONSET_RISE_DB = 8, ONSET_FLOOR_DBFS = -50, ONSET_GAP_S = 0.05, ONSET_LOOKBACK = 9;
export function detectOnsets44k(mono) {
  const n = Math.floor(mono.length / ONSET_FRAME);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * ONSET_FRAME; j < (i + 1) * ONSET_FRAME; j++) s += mono[j] * mono[j]; env[i] = 10 * Math.log10(s / ONSET_FRAME + 1e-12); }
  const onsets = [];
  let armed = true;
  for (let i = 0; i < n; i++) {
    let floor = i - ONSET_LOOKBACK < 0 ? -120 : Infinity;   // before the file starts there is silence, so a hit at sample 0 counts
    for (let j = Math.max(0, i - ONSET_LOOKBACK); j < i; j++) floor = Math.min(floor, env[j]);
    const rise = env[i] - floor;
    if (armed && env[i] > ONSET_FLOOR_DBFS && rise >= ONSET_RISE_DB) {
      const time = i * ONSET_FRAME / SR;
      const last = onsets[onsets.length - 1];
      if (!last || time - last.time >= ONSET_GAP_S) onsets.push({ time: round(time, 4), riseDb: round(rise, 1), levelDbfs: round(env[i], 1) });
      armed = false;
    } else if (!armed && (i > 0 && env[i] < env[i - 1] - 1)) armed = true;   // re-arm once the level starts falling again
  }
  return onsets;
}

// ---------- stereo ----------
export function stereoFeatures(L, R) {
  let diff = 0, sm = 0, ss = 0, sl = 0, sr = 0, slr = 0, sll = 0, srr = 0;
  const n = L.length;
  for (let i = 0; i < n; i++) {
    diff = Math.max(diff, Math.abs(L[i] - R[i]));
    const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2;
    sm += m * m; ss += s * s; sl += L[i]; sr += R[i]; slr += L[i] * R[i]; sll += L[i] * L[i]; srr += R[i] * R[i];
  }
  if (!n || diff < 1e-6) return { width: 0, correlation: 1, mono: true };   // identical channels = dual-mono: report it as width 0, never hide it
  const width = Math.sqrt(ss) / (Math.sqrt(sm + ss) || 1e-12);
  const cov = slr / n - (sl / n) * (sr / n), vl = sll / n - (sl / n) ** 2, vr = srr / n - (sr / n) ** 2;
  const correlation = cov / (Math.sqrt(vl * vr) || 1e-12);
  return { width: round(width, 3), correlation: round(Math.max(-1, Math.min(1, correlation)), 3) };
}

// ---------- ratings ----------
const getPath = (obj, p) => p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
export function rate(profile) {
  const out = {};
  for (const [name, th] of Object.entries(RATING_THRESHOLDS)) {
    const raw = getPath(profile, th.metric);
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : (name === "tonalness" ? 0 : null);
    const level = value == null ? "low" : value < th.low ? "low" : value > th.high ? "high" : "medium";
    out[name] = { level, value: value == null ? null : round(value, 3), unit: th.unit };
  }
  return out;
}
const pct = (v) => `${Math.round(v * 100)}%`;
export function summarize(p) {
  const r = p.ratings, parts = [];
  parts.push(`${p.durationSeconds.toFixed(2)} s ${p.durationSeconds < 2 ? "one-shot" : "clip"}`);
  if (p.loudness.integratedLufs != null) parts.push(`${p.loudness.integratedLufs.toFixed(1)} LUFS integrated (${r.loudness.level})`);
  parts.push(`crest ${p.loudness.crestFactorDb.toFixed(1)} dB (punch ${r.punch.level})`);
  parts.push(`attack ${p.envelope.attackMs} ms, decay ${p.envelope.decayMs} ms`);
  parts.push(`centroid ${Math.round(p.spectrum.centroidHz)} Hz (brightness ${r.brightness.level})`);
  parts.push(`sub ${pct(p.spectrum.bands.sub.share)} (${r.subWeight.level}), low ${pct(p.spectrum.bands.low.share)} (${r.lowEnd.level}), air ${pct(p.spectrum.bands.air.share)} (${r.air.level})`);
  parts.push(`flatness ${p.spectrum.flatness.toFixed(2)} (noisiness ${r.noisiness.level})`);
  if (p.pitch?.note) parts.push(`pitch ${p.pitch.note} at ${p.pitch.hz} Hz (tonalness ${r.tonalness.level})`); else parts.push(`no stable pitch (tonalness ${r.tonalness.level})`);
  if (p.rhythm) parts.push(`${p.rhythm.onsetCount} onsets, ~${p.rhythm.bpmEstimate} BPM`);
  if (p.stereo) parts.push(`stereo width ${p.stereo.width}, correlation ${p.stereo.correlation}`); else parts.push("mono");
  return parts.join("; ") + ".";
}

/** Full technical profile of an audio file. */
export async function analyzeAudio(path) {
  const [{ L, R }, info, lufs] = await Promise.all([decodeStereo44k(path), probe(path), ebur128(path)]);
  const n = L.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) / 2;
  const durationSeconds = round(n / SR, 3);
  const env = envelopeFeatures(mono);
  const spectrum = spectrumFeatures(averagePowerSpectrum(mono));
  const pitch = pitchFeatures(mono);
  const stereo = info.channels >= 2 ? stereoFeatures(L, R) : { width: 0, correlation: 1, mono: true };
  let rhythm = null;
  if (durationSeconds >= RHYTHM_MIN_SECONDS) {
    const onsets = detectOnsets44k(mono);
    rhythm = { onsetCount: onsets.length, bpmEstimate: onsets.length >= 3 ? estimateBpm(onsets) : null, onsets: onsets.slice(0, 64) };
  }
  const profile = {
    path, durationSeconds, sampleRate: info.sampleRate, channels: info.channels,
    loudness: { integratedLufs: lufs?.integratedLufs ?? round(env.rmsDbfs - 0.7, 1), loudnessRange: lufs?.loudnessRange ?? null, loudnessSource: lufs ? "ebur128" : "rms-estimate", peakDbfs: env.peakDbfs, rmsDbfs: env.rmsDbfs, crestFactorDb: env.crestFactorDb },
    envelope: { attackMs: env.attackMs, decayMs: env.decayMs, sustainRatio: env.sustainRatio },
    spectrum, pitch, rhythm, stereo,
  };
  profile.ratings = rate(profile);
  profile.summary = summarize(profile);
  return profile;
}

/** Numeric deltas (b - a) for every rating plus neutral comparison sentences. */
export function compareProfiles(a, b, { nameA = "A", nameB = "B" } = {}) {
  const deltas = {};
  for (const name of Object.keys(RATING_THRESHOLDS)) {
    const va = a.ratings?.[name]?.value, vb = b.ratings?.[name]?.value;
    deltas[name] = { a: va ?? null, b: vb ?? null, delta: va != null && vb != null ? round(vb - va, 3) : null, unit: RATING_THRESHOLDS[name].unit, levels: `${a.ratings?.[name]?.level} -> ${b.ratings?.[name]?.level}` };
  }
  const sentences = [];
  const dbDiff = (band) => round(b.spectrum.bands[band].db - a.spectrum.bands[band].db, 1);
  const moreLess = (d, unit, what) => d === 0 ? null : `${nameB} has ${Math.abs(d)} ${unit} ${d > 0 ? "more" : "less"} ${what} than ${nameA}`;
  const cands = [
    { k: Math.abs(dbDiff("sub")), s: moreLess(dbDiff("sub"), "dB", "sub-band energy (20-60 Hz)") },
    { k: Math.abs(dbDiff("low")), s: moreLess(dbDiff("low"), "dB", "low-band energy (60-250 Hz)") },
    { k: Math.abs(dbDiff("air")), s: moreLess(dbDiff("air"), "dB", "air-band energy (8-20 kHz)") },
    { k: Math.abs(b.spectrum.centroidHz - a.spectrum.centroidHz) / 500, s: `${nameB}'s spectral centroid is ${Math.round(b.spectrum.centroidHz)} Hz against ${Math.round(a.spectrum.centroidHz)} Hz for ${nameA}` },
    { k: Math.abs(b.envelope.decayMs - a.envelope.decayMs) / 100, s: `${nameB} decays ${Math.abs(Math.round(b.envelope.decayMs - a.envelope.decayMs))} ms ${b.envelope.decayMs < a.envelope.decayMs ? "faster" : "slower"} than ${nameA}` },
    { k: Math.abs(b.loudness.crestFactorDb - a.loudness.crestFactorDb) / 3, s: `crest factor ${b.loudness.crestFactorDb} dB for ${nameB} versus ${a.loudness.crestFactorDb} dB for ${nameA}` },
    { k: a.loudness.integratedLufs != null && b.loudness.integratedLufs != null ? Math.abs(b.loudness.integratedLufs - a.loudness.integratedLufs) / 3 : 0, s: `${nameB} measures ${b.loudness.integratedLufs} LUFS integrated, ${nameA} ${a.loudness.integratedLufs} LUFS` },
  ].filter((c) => c.s && Number.isFinite(c.k)).sort((x, y) => y.k - x.k);
  for (const c of cands) { if (sentences.length >= 4) break; sentences.push(c.s + "."); }
  if (sentences.length < 2) sentences.push(`${nameA} and ${nameB} measure within the same rating bands on every metric.`);
  const text = sentences.join(" ");
  if (FORBIDDEN.test(text)) throw new Error("compareProfiles produced a non-neutral word");   // guard: ratings stay technical
  return { deltas, text };
}

function round(v, d) { const m = 10 ** d; return Math.round(v * m) / m; }
