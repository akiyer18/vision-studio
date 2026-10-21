// Offline-safe test of lib/capture.js: (1) Live's pid (may be silent), (2) a tone played by afplay must be captured above -40 dBFS.
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureAvailable, findLivePid, captureLive } from "../lib/capture.js";

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(here, "..", ".tmp"); await fs.mkdir(tmp, { recursive: true });
const log = (...a) => console.log(...a);

if (!(await captureAvailable())) { log("SKIP: audiotee not built (bash tools/capture/build.sh)"); process.exit(0); }

// (1) Live, as-is
const livePid = await findLivePid();
if (livePid) {
  try {
    const r = await captureLive({ seconds: 3, outPath: path.join(tmp, "cap-live.wav"), allowSystemFallback: false, startTimeoutMs: 6000 });
    log(`live: pid ${r.pid} scope ${r.scope} bytes ${r.bytes} peak ${r.peakDbfs} dBFS silent=${r.silent}${r.hint ? " | " + r.hint : ""}`);
  } catch (e) { log(`live: ${e.message.slice(0, 160)} (expected when Live is idle: a silent process never starts the tap)`); }
} else log("live: not running, skipped");

// (2) a process that definitely plays
const tone = path.join(tmp, "cap-tone.wav");
await execFileP("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ac", "2", "-ar", "44100", tone]);
const player = spawn("afplay", [tone], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));
try {
  const r = await captureLive({ seconds: 2, pid: player.pid, outPath: path.join(tmp, "cap-tone-tap.wav"), allowSystemFallback: false });
  log(`afplay tap: scope ${r.scope} bytes ${r.bytes} peak ${r.peakDbfs} dBFS format ${r.format}`);
  if (!(r.peakDbfs > -40)) throw new Error(`expected peak > -40 dBFS, got ${r.peakDbfs}`);
  log("ALL PASS");
} catch (e) {
  if (/System Audio Recording|permission/i.test(e.message)) { log(`SKIP: ${e.message}`); process.exit(0); }
  console.error("FAIL:", e.message); process.exitCode = 1;
} finally { try { player.kill(); } catch {} }
