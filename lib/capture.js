// Hear what Ableton Live actually outputs: a Core Audio process tap (AudioTee, MIT) piped into ffmpeg -> wav.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const AUDIOTEE_BIN = process.env.AUDIOTEE_BIN || path.join(here, "..", "tools", "capture", "audiotee", ".build", "release", "audiotee");
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const NOT_BUILT = "audio capture tool missing: run `bash tools/capture/build.sh` (builds AudioTee, MIT) and retry";
const PERMISSION = "macOS blocked system audio capture: System Settings > Privacy & Security > Screen & System Audio Recording > enable the app that runs this server (Terminal / VS Code / Claude), then retry";

export async function captureAvailable() { try { await fs.access(AUDIOTEE_BIN); return true; } catch { return false; } }

export async function findLivePid() {
  try { const { stdout } = await execFileP("pgrep", ["-f", "MacOS/Live$"]); const pid = Number(String(stdout).trim().split("\n")[0]); return Number.isFinite(pid) && pid > 0 ? pid : null; }
  catch { return null; }
}

async function peakDbfs(file) {
  try {
    const { stderr } = await execFileP(FFMPEG, ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
    const m = String(stderr).match(/max_volume:\s*(-?[\d.]+)\s*dB/);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/** One tap session. Resolves when ffmpeg has written the wav. */
function tapOnce({ pid, seconds, outPath, startTimeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const args = ["--stereo", "--sample-rate", "44100", "--chunk-duration", "0.2"];
    if (pid) args.push("--include-processes", String(pid));
    const tee = spawn(AUDIOTEE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let ff = null, bytes = 0, started = false, meta = null, errText = "", settled = false, startTimer = null, stopTimer = null;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(startTimer); clearTimeout(stopTimer); fn(v); };
    const startFfmpeg = () => {
      const fmt = meta?.encoding === "pcm_f32le" || meta?.is_float ? "f32le" : "s16le";
      const ar = String(meta?.sample_rate || 44100), ac = String(meta?.channels_per_frame || 2);
      ff = spawn(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", fmt, "-ar", ar, "-ac", ac, "-i", "pipe:0", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outPath], { stdio: ["pipe", "ignore", "pipe"] });
      ff.stderr.on("data", (d) => { errText += d; });
      ff.on("close", (code) => finish(code === 0 || bytes > 0 ? resolve : reject, code === 0 || bytes > 0 ? { bytes, meta, started } : new Error(`ffmpeg exited ${code}: ${errText.slice(-300)}`)));
      ff.on("error", (e) => finish(reject, e));
      tee.stdout.pipe(ff.stdin);
    };
    tee.stdout.on("data", (d) => { bytes += d.length; });
    let buf = "";
    tee.stderr.on("data", (d) => {
      buf += d; errText += d;
      let i; while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        try {
          const m = JSON.parse(line);
          if (m.message_type === "metadata") meta = m.data;
          if (m.message_type === "stream_start") { started = true; clearTimeout(startTimer); if (!ff) startFfmpeg(); stopTimer = setTimeout(() => tee.kill("SIGTERM"), Math.round(seconds * 1000) + 300); }
          if (m.message_type === "error") errText += ` ${JSON.stringify(m.data)}`;
        } catch {}
      }
    });
    tee.on("error", (e) => finish(reject, e.code === "ENOENT" ? new Error(NOT_BUILT) : e));
    tee.on("close", (code) => {
      if (!ff) {   // never streamed
        const txt = errText.toLowerCase();
        if (/tcc|not permitted|permission|denied/.test(txt)) return finish(reject, new Error(PERMISSION));
        return finish(reject, Object.assign(new Error(pid ? `no audio stream from process ${pid} (is it producing sound? a process that is silent never starts the tap)` : "no audio stream from the system tap"), { noStream: true, code }));
      }
      try { ff.stdin.end(); } catch {}
    });
    startTimer = setTimeout(() => { if (!started) { try { tee.kill("SIGTERM"); } catch {} } }, startTimeoutMs);
  });
}

/**
 * Record what Live outputs for `seconds`. Tries the per-process tap first; if that process never streams
 * (idle, or the tap device won't start), falls back to the system-wide tap when allowSystemFallback.
 */
export async function captureLive({ seconds = 8, pid, outPath, allowSystemFallback = true, startTimeoutMs = 10000 } = {}) {
  if (!(await captureAvailable())) throw new Error(NOT_BUILT);
  const livePid = pid ?? (await findLivePid());
  if (!livePid) throw new Error("Ableton Live is not running (no process matching MacOS/Live)");
  outPath = outPath || path.join(here, "..", ".tmp", `live-capture-${Date.now()}.wav`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  let scope = "process", result, lastErr;
  try { result = await tapOnce({ pid: livePid, seconds, outPath, startTimeoutMs }); }
  catch (e) {
    lastErr = e;
    if (!(e.noStream && allowSystemFallback)) throw e;
    scope = "system";
    result = await tapOnce({ pid: null, seconds, outPath, startTimeoutMs });
  }
  const peak = await peakDbfs(outPath);
  const silent = result.bytes === 0 || peak == null || peak < -60;
  return {
    path: outPath, seconds, pid: livePid, scope, bytes: result.bytes, format: result.meta?.encoding || "pcm_s16le", peakDbfs: peak, silent,
    ...(silent ? { hint: "capture is silent: start Live's transport (play / fire a scene) before capturing, and check Live's audio output device is the system default" } : {}),
    ...(scope === "system" ? { note: `per-process tap of Live gave no stream (${lastErr?.message?.slice(0, 80)}); captured the system output instead (includes anything else playing)` } : {}),
  };
}
