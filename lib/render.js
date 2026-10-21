// Offline preview mix of what the agent built: places one-shots on a 16th grid (and pitched notes), sums, soft-limits,
// writes 44.1 kHz 16-bit stereo WAV. No Live effects are applied - the preview measures the raw layers.
import fs from "node:fs/promises";
import { decodeStereo44k, SR } from "./analyze.js";

const TARGET_PEAK = Math.pow(10, -1 / 20);   // -1 dBFS

function wavHeader(frames, channels = 2, sampleRate = SR, bits = 16) {
  const blockAlign = channels * bits / 8, dataBytes = frames * blockAlign;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + dataBytes, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * blockAlign, 28); h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bits, 34);
  h.write("data", 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

function layerBars(layer) {
  let bars = 1;
  if (layer.steps?.length) bars = Math.max(bars, Math.ceil((Math.max(...layer.steps.map((s) => s.step)) + 1) / 16));
  if (layer.notes?.length) bars = Math.max(bars, Math.ceil(Math.max(...layer.notes.map((n) => n.startBeats + n.durationBeats)) / 4));
  return bars;
}

/** Add `src` (stereo) into mix at sample `at`, resampled by `rate`, limited to `maxLen` output samples, scaled by gain. */
function place(mixL, mixR, src, at, gain, rate = 1, maxLen = Infinity) {
  const outLen = Math.min(maxLen, Math.floor((src.L.length - 1) / rate), mixL.length - at);
  for (let i = 0; i < outLen; i++) {
    const pos = i * rate, i0 = Math.floor(pos), frac = pos - i0, i1 = Math.min(i0 + 1, src.L.length - 1);
    mixL[at + i] += (src.L[i0] * (1 - frac) + src.L[i1] * frac) * gain;
    mixR[at + i] += (src.R[i0] * (1 - frac) + src.R[i1] * frac) * gain;
  }
}

/**
 * renderPreview({ bpm, bars, layers:[{ name, samplePath, steps?, notes?, gainDb? }], outPath }) -> { path, durationSeconds }
 */
export async function renderPreview({ bpm = 120, bars, layers = [], outPath }) {
  if (!outPath) throw new Error("renderPreview: outPath required");
  if (!layers.length) throw new Error("renderPreview: no layers");
  const totalBars = bars || Math.max(1, ...layers.map(layerBars));
  const beat = 60 / bpm, frames = Math.round(totalBars * 4 * beat * SR);
  const mixL = new Float64Array(frames), mixR = new Float64Array(frames);
  for (const layer of layers) {
    if (!layer.samplePath) continue;
    const src = await decodeStereo44k(layer.samplePath);
    if (!src.L.length) continue;
    const gainDb = Number(layer.gainDb) || 0, g0 = Math.pow(10, gainDb / 20);
    for (const s of layer.steps || []) {
      const at = Math.round(s.step * 0.25 * beat * SR);
      if (at >= frames) continue;
      place(mixL, mixR, src, at, (Math.max(1, Math.min(127, s.velocity)) / 127) * g0);
    }
    for (const n of layer.notes || []) {
      const at = Math.round(n.startBeats * beat * SR);
      if (at >= frames) continue;
      const rate = Math.pow(2, (n.pitch - 60) / 12);
      const maxLen = Math.round((n.durationBeats * beat + 0.05) * SR);   // note length + 50 ms release
      place(mixL, mixR, src, at, (Math.max(1, Math.min(127, n.velocity)) / 127) * g0, rate, maxLen);
    }
  }
  // soft limiter: only engages when the sum exceeds -1 dBFS; tanh keeps |y| <= TARGET_PEAK
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]));
  if (peak > TARGET_PEAK) {
    const k = TARGET_PEAK;
    for (let i = 0; i < frames; i++) { mixL[i] = k * Math.tanh(mixL[i] / k); mixR[i] = k * Math.tanh(mixR[i] / k); }
  }
  const pcm = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixL[i])) * 32767), i * 4);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixR[i])) * 32767), i * 4 + 2);
  }
  await fs.writeFile(outPath, Buffer.concat([wavHeader(frames), pcm]));
  return { path: outPath, durationSeconds: frames / SR, bars: totalBars, bpm, limited: peak > TARGET_PEAK };
}
