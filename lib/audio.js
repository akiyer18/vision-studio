// ffmpeg helpers. All functions are async and take/return absolute paths.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SR = 44100;
const BASE = ["-y", "-hide_banner", "-loglevel", "error"];

export async function ffmpeg(args) {
  await run("ffmpeg", [...BASE, ...args]);
}

/** Any browser recording (webm/opus, mp4/aac, wav) -> 44.1k mono 16-bit wav. */
export async function toWav(inputPath, outputPath, { channels = 1 } = {}) {
  await ffmpeg(["-i", inputPath, "-vn", "-ac", String(channels), "-ar", String(SR), "-c:a", "pcm_s16le", outputPath]);
  return outputPath;
}

export async function durationSeconds(path) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path,
  ]);
  const d = parseFloat(stdout);
  if (!Number.isFinite(d)) throw new Error(`ffprobe: no duration for ${path}`);
  return d;
}

/** Peak level in dBFS (via ffmpeg volumedetect). */
export async function peakDb(path) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"]);
  const m = stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return m ? parseFloat(m[1]) : -Infinity;
}

async function assertHasSound(path) {
  const peak = await peakDb(path);
  if (peak < -45) throw new Error("No sound detected in recording");
}

const trimLeadingSilence = (thresholdDb, minSilence = 0.01) =>
  `silenceremove=start_periods=1:start_threshold=${thresholdDb}dB:start_silence=${minSilence}`;

/**
 * Trim leading silence, keep the first hit (hitSeconds), fade it, then tile it on a
 * gridSeconds grid until the file is totalSeconds long (Stability needs >= 6 s input).
 */
export async function makeOneShotLoop(inWav, outWav, { hitSeconds = 0.45, gridSeconds = 0.5, totalSeconds = 6.5 } = {}) {
  await assertHasSound(inWav);
  const loops = Math.ceil(totalSeconds / gridSeconds); // extra repetitions (aloop plays size once, then `loop` more times)
  const fade = Math.min(0.1, hitSeconds / 3);
  const chain = [
    trimLeadingSilence(-40),
    `atrim=0:${hitSeconds}`,
    `afade=t=out:st=${(hitSeconds - fade).toFixed(3)}:d=${fade}`,
    `apad=whole_dur=${gridSeconds}`,
    `aloop=loop=${loops}:size=${Math.round(gridSeconds * SR)}`,
    `atrim=0:${totalSeconds}`,
    "asetpts=N/SR/TB",
  ].join(",");
  await ffmpeg(["-i", inWav, "-af", chain, "-ac", "2", "-ar", String(SR), "-c:a", "pcm_s16le", outWav]);
  const d = await durationSeconds(outWav);
  if (d < 6.0) throw new Error(`One-shot loop too short (${d.toFixed(2)} s)`);
  return outWav;
}

/** Loop the whole recording (whole repetitions) until it is >= minSeconds. */
export async function makeLoopInput(inWav, outWav, { minSeconds = 6.5 } = {}) {
  await assertHasSound(inWav);
  const d = await durationSeconds(inWav);
  const reps = Math.max(1, Math.ceil(minSeconds / d));
  const chain = [
    `aloop=loop=${reps - 1}:size=${Math.ceil(d * SR) + SR}`,
    "asetpts=N/SR/TB",
  ].join(",");
  await ffmpeg(["-i", inWav, "-af", chain, "-ac", "2", "-ar", String(SR), "-c:a", "pcm_s16le", outWav]);
  const out = await durationSeconds(outWav);
  if (out < 6.0) throw new Error(`Loop input too short (${out.toFixed(2)} s)`);
  return outWav;
}

/** Cut the first transient of generated audio into a one-shot with a fade-out. */
export async function sliceFirstHit(inWav, outWav, { seconds = 1.0 } = {}) {
  const fade = Math.min(0.3, seconds / 3);
  const chain = [
    trimLeadingSilence(-30, 0.005),
    `atrim=0:${seconds}`,
    `afade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}`,
    "asetpts=N/SR/TB",
  ].join(",");
  await ffmpeg(["-i", inWav, "-af", chain, "-ac", "2", "-ar", String(SR), "-c:a", "pcm_s16le", outWav]);
  return outWav;
}

/** Peak-normalize to -1 dBFS (two pass: volumedetect, then volume gain). */
export async function normalize(inWav, outWav, targetDb = -1) {
  const peak = await peakDb(inWav);
  const gain = Number.isFinite(peak) ? targetDb - peak : 0;
  await ffmpeg(["-i", inWav, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "pcm_s16le", outWav]);
  return outWav;
}
