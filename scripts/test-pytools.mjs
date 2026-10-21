// Offline tests for the Python toolbelt via lib/pytools.js. Inputs are synthesized with ffmpeg.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pyAvailable, pyVersions, stems, analyzeMusic, transcribeLocal, processAudio, masterAudio } from "../lib/pytools.js";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(here, "..", ".tmp", "pytools-test");
await fs.mkdir(TMP, { recursive: true });
const ff = (args) => run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };

if (!pyAvailable()) { console.error("venv missing: run bash tools/py/setup.sh"); process.exit(1); }
const v = await pyVersions();
console.log("python", v.python, Object.entries(v.versions).map(([k, x]) => `${k}=${x}`).join(" "));

// 1) a 10 s "song": kick-ish clicks on the beat at 120 BPM + two sustained tones (A2 110 Hz, E4 330 Hz)
const song = path.join(TMP, "song.wav");
await ff(["-f", "lavfi", "-i", "sine=frequency=110:duration=10", "-f", "lavfi", "-i", "sine=frequency=330:duration=10",
  "-f", "lavfi", "-i", "anoisesrc=color=white:duration=10:amplitude=0.6",
  "-filter_complex", "[2:a]lowpass=f=150,volume=12dB,aeval=val(0)*(lt(mod(t\\,0.5)\\,0.03)):c=same[clk];[0:a]volume=0.25[a];[1:a]volume=0.15[b];[a][b][clk]amix=inputs=3:normalize=0,aformat=channel_layouts=stereo[out]",
  "-map", "[out]", "-ar", "44100", song]);

// analyze
const an = await analyzeMusic(song);
console.log(`analyze: tempo ${an.tempo} beats ${an.beats.length} key ${an.key?.tonic} ${an.key?.mode} (conf ${an.key?.confidence}) onsets ${an.onsets.length} swing ${an.groove.swing} sections ${an.sections.length} (${an.ms} ms)`);
assert(an.ok && an.duration > 9.5, "analyze duration");
assert(an.tempo > 100 && an.tempo < 140 || (an.tempo > 50 && an.tempo < 70) || (an.tempo > 220 && an.tempo < 260), `tempo near 120 (or half/double), got ${an.tempo}`);
assert(an.onsets.length >= 12, `>= 12 onsets, got ${an.onsets.length}`);
assert(Array.isArray(an.groove.microtiming) && an.groove.microtiming.length === 16, "microtiming 16");
assert(an.groove.velocityProfile.length === 16, "velocityProfile 16");
assert(an.key && ["A", "E"].includes(an.key.tonic), `key tonic A or E, got ${an.key?.tonic}`);

// transcribe: 4 tones C4 E4 G4 C5, 0.5 s each
const mel = path.join(TMP, "melody.wav");
await ff(["-f", "lavfi", "-i", "sine=frequency=261.63:duration=0.5", "-f", "lavfi", "-i", "sine=frequency=329.63:duration=0.5", "-f", "lavfi", "-i", "sine=frequency=392:duration=0.5", "-f", "lavfi", "-i", "sine=frequency=523.25:duration=0.5",
  "-filter_complex", "[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1,volume=0.5,aformat=channel_layouts=mono[out]", "-map", "[out]", "-ar", "22050", mel]);
const tr = await transcribeLocal(mel);
const pitches = tr.notes.map((n) => n.pitch);
console.log(`transcribe: ${tr.noteCount} notes ${pitches.join(",")} midi=${tr.midiPath ? "yes" : "no"} (${tr.ms} ms, ${tr.backend})`);
assert(tr.ok && tr.noteCount >= 4, "transcribe >= 4 notes");
for (const p of [60, 64, 67, 72]) assert(pitches.some((q) => Math.abs(q - p) <= 1), `pitch ${p} found`);

// process: noise burst -> highpass + compressor + limiter + gain
const burst = path.join(TMP, "burst.wav");
await ff(["-f", "lavfi", "-i", "anoisesrc=color=pink:duration=0.6:amplitude=0.9", "-af", "afade=t=out:st=0.1:d=0.5,aformat=channel_layouts=stereo", "-ar", "44100", burst]);
const procOut = path.join(TMP, "burst-processed.wav");
const pr = await processAudio(burst, [{ type: "highpass", hz: 300 }, { type: "compressor", threshold_db: -18, ratio: 4 }, { type: "gain", db: -6 }, { type: "limiter", threshold_db: -3 }], procOut);
console.log(`process: in ${pr.inPeakDbfs} dBFS -> out ${pr.peakDbfs} dBFS, ${pr.steps} steps (${pr.ms} ms)`);
assert(pr.ok && pr.peakDbfs <= -2.9, `limited peak <= -3 dBFS, got ${pr.peakDbfs}`);
let bad = null; try { await processAudio(burst, [{ type: "nope" }], procOut); } catch (e) { bad = e.message; }
assert(bad && /unknown chain step/.test(bad), "unknown step rejected");

// master
const mOut = path.join(TMP, "song-master.wav");
const ms = await masterAudio(song, mOut, -14);
console.log(`master: ${ms.lufsIn} -> ${ms.lufs} LUFS (target ${ms.targetLufs}), gain ${ms.gainDb} dB, peak ${ms.peakDbfs} (${ms.ms} ms)`);
assert(ms.ok && ms.peakDbfs <= -0.9, "master peak <= -1 dBFS");
assert(ms.lufs == null || Math.abs(ms.lufs - (-14)) < 2.5, `lufs near -14, got ${ms.lufs}`);

// stems (demucs CPU, 10 s, segment 7)
const st = await stems(song, { outDir: path.join(TMP, "stems"), segment: 7 });
console.log(`stems: ${Object.keys(st.stems).join(",")} in ${st.seconds}s (${st.model})`);
assert(st.ok && st.stems.drums && st.stems.vocals, "4 stems");
for (const p of Object.values(st.stems)) { const s = await fs.stat(p); assert(s.size > 100000, `stem ${path.basename(p)} has audio`); }

console.log("ALL PASS");
