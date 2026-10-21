// Node wrapper around tools/py/adetools.py (open-source audio toolbelt: demucs, basic-pitch, librosa, pedalboard).
// Every call spawns the venv python; stdout is one JSON object; stderr is kept for error messages.
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PY_DIR = path.join(here, "..", "tools", "py");
export const PY_BIN = path.join(PY_DIR, ".venv", "bin", "python");
const CLI = path.join(PY_DIR, "adetools.py");
const DEFAULT_TIMEOUT_MS = Number(process.env.PYTOOLS_TIMEOUT_MS || 10 * 60 * 1000);

export function pyAvailable() {
  return fs.existsSync(PY_BIN) && fs.existsSync(CLI);
}
const SETUP_HINT = "python toolbelt not installed: run `bash tools/py/setup.sh` (creates tools/py/.venv with demucs, basic-pitch, librosa, pedalboard)";

export function runPy(args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!pyAvailable()) return Promise.reject(new Error(SETUP_HINT));
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(PY_BIN, ["-I", CLI, ...args.map(String)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`pytools ${args[0]} timed out after ${timeoutMs} ms\n${err.slice(-800)}`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`pytools spawn failed: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      let json = null;
      try { json = JSON.parse(line); } catch {}
      if (json && json.ok === false) return reject(new Error(`pytools ${args[0]}: ${json.error}${json.known ? ` (known: ${json.known.join(", ")})` : ""}`));
      if (code !== 0 || !json) return reject(new Error(`pytools ${args[0]} exited ${code}${json ? "" : " without JSON"}\n${err.slice(-1200)}`));
      resolve({ ...json, ms: Date.now() - t0 });
    });
  });
}

/** Separate a mix into stems with demucs. Returns { stems: {drums,bass,other,vocals}, model, seconds }. */
export async function stems(file, { outDir, model = "htdemucs", twoStems, segment = 7 } = {}) {
  const dir = outDir || path.join(path.dirname(file), `${path.basename(file, path.extname(file))}-stems`);
  await fsp.mkdir(dir, { recursive: true });
  const args = ["stems", "--in", file, "--out", dir, "--model", model, "--segment", segment];
  if (twoStems) args.push("--two-stems", twoStems);
  return runPy(args);
}

/** Tempo, beats, downbeats, key, onsets, groove template (microtiming/velocity per 16th), sections. */
export const analyzeMusic = (file) => runPy(["analyze", "--in", file], { timeoutMs: 3 * 60 * 1000 });

/** Polyphonic audio -> MIDI notes with basic-pitch (local, no quota). */
export const transcribeLocal = (file, { onset = 0.5, frame = 0.3, minNoteMs = 60, outMidi } = {}) =>
  runPy(["transcribe", "--in", file, "--onset", onset, "--frame", frame, "--min-note-ms", minNoteMs, ...(outMidi ? ["--out", outMidi] : [])], { timeoutMs: 5 * 60 * 1000 });

/** Apply a pedalboard chain (array of {type,...}) and write outPath. */
export const processAudio = (file, chain, outPath) => runPy(["process", "--in", file, "--out", outPath, "--chain", JSON.stringify(chain)], { timeoutMs: 3 * 60 * 1000 });

/** Bus compression + gain to target LUFS + limiter. */
export const masterAudio = (file, outPath, lufs = -12) => runPy(["master", "--in", file, "--out", outPath, "--lufs", lufs], { timeoutMs: 3 * 60 * 1000 });

export const pyVersions = () => runPy(["versions"], { timeoutMs: 60 * 1000 });
