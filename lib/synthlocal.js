// Deterministic local one-shots via ffmpeg: a clean sub/808 layer and a noise snap. Stable Audio is great at loops and
// music but asked for "a single kick" it returns a sub drone; the body of a kick is better made here and layered.
import { ffmpeg } from "./audio.js";

/** Pitch-enveloped sine kick/sub. f0 sweeps from `startHz` to `endHz` in `sweepMs`, amplitude decays over `decayMs`. */
export async function synthSub(outPath, { startHz = 160, endHz = 50, sweepMs = 35, decayMs = 420, clickDb = -14, gainDb = -4, drive = 0 } = {}) {
  const dur = (decayMs + 80) / 1000, k = Math.log(startHz / endHz) / (sweepMs / 1000);
  // phase(t) = 2π ∫ f(t) dt with f(t) = endHz + (startHz-endHz)·e^{-k t}
  const phase = `2*PI*(${endHz}*t + (${startHz - endHz})/${k.toFixed(6)}*(1-exp(-${k.toFixed(6)}*t)))`;
  const env = `exp(-t*${(5 / (decayMs / 1000)).toFixed(4)})`;
  const click = `(${Math.pow(10, clickDb / 20).toFixed(4)})*random(0)*exp(-t*600)`;   // 2-3 ms noise click for attack definition
  const expr = `(sin(${phase})*${env} + ${click})*${Math.pow(10, gainDb / 20).toFixed(4)}`;
  const af = [drive > 0 ? `aeval=${expr}|${expr}:c=stereo,volume=${drive}dB,alimiter=limit=0.95:level=false` : null].filter(Boolean).join(",");
  const args = ["-f", "lavfi", "-i", `aevalsrc=${expr}|${expr}:c=stereo:s=44100:d=${dur.toFixed(3)}`, "-af", `afade=t=out:st=${(dur - 0.03).toFixed(3)}:d=0.03${drive > 0 ? `,volume=${drive}dB,alimiter=limit=0.95:level=false` : ""}`, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outPath];
  await ffmpeg(args);
  return outPath;
}
/** 808-style: lower, longer, with a little drive. */
export const synth808 = (outPath, o = {}) => synthSub(outPath, { startHz: 120, endHz: 41, sweepMs: 60, decayMs: 900, clickDb: -18, drive: 6, ...o });
/** Short bright noise burst (snap / clap top layer). */
export async function synthSnap(outPath, { decayMs = 120, highpassHz = 1200, gainDb = -8 } = {}) {
  const dur = (decayMs + 40) / 1000;
  await ffmpeg(["-f", "lavfi", "-i", `anoisesrc=color=white:amplitude=0.8:duration=${dur.toFixed(3)}:seed=7`, "-af", `highpass=f=${highpassHz},aeval=val(0)*exp(-t*${(6 / (decayMs / 1000)).toFixed(3)}),volume=${gainDb}dB,aformat=channel_layouts=stereo`, "-ar", "44100", "-c:a", "pcm_s16le", outPath]);
  return outPath;
}
