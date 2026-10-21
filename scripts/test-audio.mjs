// Usage: node scripts/test-audio.mjs [--live]   (--live calls Stability only if a real key is in .env)
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ffmpeg, toWav, durationSeconds, makeOneShotLoop, makeLoopInput, sliceFirstHit, normalize, peakDb } from "../lib/audio.js";
import { audioToAudio } from "../lib/stability.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, ".tmp", "test-audio");
await mkdir(tmp, { recursive: true });
const p = (n) => path.join(tmp, n);

const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } };
const fmt = (n) => n.toFixed(3) + " s";

// 1. Fake "hit": 0.2 s of silence, then a 0.3 s noise burst with decay, then 0.5 s silence (like a mic recording).
await ffmpeg([
  "-f", "lavfi", "-i", "anoisesrc=d=1.0:c=pink:r=44100:a=0.8",
  "-af", "volume=enable='lt(t,0.2)':volume=0,afade=t=out:st=0.2:d=0.3,volume=enable='gt(t,0.5)':volume=0",
  "-ac", "1", "-c:a", "pcm_s16le", p("hit-src.wav"),
]);
await toWav(p("hit-src.wav"), p("hit.wav"));
console.log("hit.wav          ", fmt(await durationSeconds(p("hit.wav"))), "peak", (await peakDb(p("hit.wav"))).toFixed(1), "dB");

// 2. One-shot loop >= 6 s
await makeOneShotLoop(p("hit.wav"), p("oneshot-loop.wav"));
const d1 = await durationSeconds(p("oneshot-loop.wav"));
console.log("oneshot-loop.wav ", fmt(d1));
assert(d1 >= 6.0, "one-shot loop must be >= 6 s");

// 3. Loop input from the whole recording
await makeLoopInput(p("hit.wav"), p("loop-input.wav"));
const d2 = await durationSeconds(p("loop-input.wav"));
console.log("loop-input.wav   ", fmt(d2));
assert(d2 >= 6.0, "loop input must be >= 6 s");

// 4. Slice first hit back out of the loop (stands in for generated audio)
await sliceFirstHit(p("oneshot-loop.wav"), p("sliced.wav"));
const d3 = await durationSeconds(p("sliced.wav"));
console.log("sliced.wav       ", fmt(d3));
assert(d3 > 0.5 && d3 <= 1.05, "slice should be ~1 s");

// 5. Normalize
await normalize(p("sliced.wav"), p("sliced-norm.wav"));
console.log("sliced-norm.wav  peak", (await peakDb(p("sliced-norm.wav"))).toFixed(1), "dB");

// 6. Silence must be rejected
await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", "-c:a", "pcm_s16le", p("silence.wav")]);
let rejected = false;
try { await makeOneShotLoop(p("silence.wav"), p("silence-loop.wav")); } catch (e) { rejected = /No sound detected/.test(e.message); }
assert(rejected, "silent recording must throw 'No sound detected in recording'");
console.log("silence.wav       rejected OK");

// 7. Optional live call
const key = process.env.STABILITY_API_KEY || "";
if (process.argv.includes("--live") && key && !key.includes("paste-your-key")) {
  const { buffer, seed } = await audioToAudio({ wavPath: p("oneshot-loop.wav"), prompt: "punchy acoustic snare drum one-shot, dry, tight", strength: 0.7, duration: 6 });
  await writeFile(p("generated.wav"), buffer);
  console.log("generated.wav    ", fmt(await durationSeconds(p("generated.wav"))), "seed", seed);
} else {
  console.log("live Stability call skipped (no --live flag or no real STABILITY_API_KEY)");
}
console.log("ALL PASS");
