// Offline tests for lib/analyze.js and lib/render.js. Inputs are synthesized with ffmpeg; no network.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeAudio, compareProfiles, RATING_THRESHOLDS } from "../lib/analyze.js";
import { renderPreview } from "../lib/render.js";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", ".tmp", "analyze-test");
await fs.mkdir(dir, { recursive: true });
const ff = (args) => run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
const out = (n) => path.join(dir, n);
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failures++; };
const FORBIDDEN = /\b(good|bad|nice|weak|better|worse|great|poor)\b/i;

// 1) 60 Hz sine burst (1 s, fade in/out) -> sub heavy, dark, pitched ~MIDI 31
await ff(["-f", "lavfi", "-i", "sine=frequency=60:duration=1", "-af", "afade=t=in:d=0.01,afade=t=out:st=0.9:d=0.1,volume=0.8", "-ac", "2", "-ar", "44100", out("sine60.wav")]);
const sine = await analyzeAudio(out("sine60.wav"));
check(sine.ratings.subWeight.level === "high", `sine: subWeight high (share ${sine.spectrum.bands.sub.share})`);
check(sine.ratings.brightness.level === "low", `sine: brightness low (centroid ${sine.spectrum.centroidHz} Hz)`);
check(sine.pitch && Math.abs(sine.pitch.midi - 31) < 0.6, `sine: pitch midi ≈ 31 (got ${sine.pitch?.midi}, ${sine.pitch?.note})`);
check(sine.ratings.tonalness.level === "high", `sine: tonalness high (${sine.pitch?.confidence})`);
check(sine.ratings.punch.level === "low", `sine: crest low (${sine.loudness.crestFactorDb} dB)`);
check(!FORBIDDEN.test(sine.summary), `sine: summary neutral -> ${sine.summary}`);

// 2) white noise 0.5 s -> noisy, not tonal, flat spectrum
await ff(["-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.5:duration=0.5:seed=7", "-ac", "2", "-ar", "44100", out("noise.wav")]);
const noise = await analyzeAudio(out("noise.wav"));
check(noise.ratings.noisiness.level === "high", `noise: noisiness high (flatness ${noise.spectrum.flatness})`);
check(noise.spectrum.flatness > 0.3, `noise: flatness > 0.3`);
check(noise.ratings.tonalness.level === "low", `noise: tonalness low (${noise.pitch?.confidence})`);
check(noise.stereo === null, `noise: identical channels -> stereo null`);

// 3) click + fast decay (1.2 s) -> instant attack, decay in the hundreds of ms, high crest
await ff(["-f", "lavfi", "-i", "aevalsrc=exp(-t*12)*sin(2*PI*200*t):s=44100:d=1.2", "-ac", "2", out("click.wav")]);
const click = await analyzeAudio(out("click.wav"));
check(click.envelope.attackMs < 15, `click: attack < 15 ms (${click.envelope.attackMs})`);
check(click.envelope.decayMs > 50 && click.envelope.decayMs < 1000, `click: decay sane (${click.envelope.decayMs} ms, expected ~190)`);
check(click.ratings.punch.level === "high", `click: crest high (${click.loudness.crestFactorDb} dB)`);

// 4) stereo with different L/R noise -> wide; mono file -> stereo null
await ff(["-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.4:duration=0.5:seed=1", "-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.4:duration=0.5:seed=2", "-filter_complex", "[0:a][1:a]join=inputs=2:channel_layout=stereo[a]", "-map", "[a]", "-ar", "44100", out("wide.wav")]);
const wide = await analyzeAudio(out("wide.wav"));
check(wide.stereo && wide.stereo.width > 0.3, `wide: stereo width > 0.3 (${wide.stereo?.width}, corr ${wide.stereo?.correlation})`);
await ff(["-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.4:duration=0.5:seed=3", "-ac", "1", "-ar", "44100", out("mono.wav")]);
const mono = await analyzeAudio(out("mono.wav"));
check(mono.stereo === null && mono.channels === 1, `mono: stereo null, channels 1`);

// 5) renderPreview: kick on 0,4,8,12 + hat on every 2nd step, 1 bar at 120 -> 2.0 s, peak <= -1 dBFS, ~8-12 onsets
await ff(["-f", "lavfi", "-i", "sine=frequency=55:duration=0.3", "-af", "afade=t=out:st=0.05:d=0.25,volume=0.9", "-ac", "2", "-ar", "44100", out("kick.wav")]);
await ff(["-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.6:duration=0.06:seed=4", "-af", "highpass=f=6000,afade=t=out:st=0.01:d=0.05", "-ac", "2", "-ar", "44100", out("hat.wav")]);
const rendered = await renderPreview({
  bpm: 120, outPath: out("preview.wav"),
  layers: [
    { name: "Kick", samplePath: out("kick.wav"), steps: [0, 4, 8, 12].map((step) => ({ step, velocity: 120 })) },
    { name: "Hat", samplePath: out("hat.wav"), steps: Array.from({ length: 8 }, (_, i) => ({ step: i * 2, velocity: i % 2 ? 70 : 100 })) },
  ],
});
check(Math.abs(rendered.durationSeconds - 2.0) < 0.05, `render: duration 2.0 s (${rendered.durationSeconds})`);
const prev = await analyzeAudio(out("preview.wav"));
check(prev.loudness.peakDbfs <= -0.99, `render: peak <= -1 dBFS (${prev.loudness.peakDbfs})`);
check(prev.rhythm && prev.rhythm.onsetCount >= 8 && prev.rhythm.onsetCount <= 12, `render: onsets 8-12 (${prev.rhythm?.onsetCount}, bpm ${prev.rhythm?.bpmEstimate})`);
// pitched notes path: 3 notes of the kick sample at different pitches
const melodic = await renderPreview({ bpm: 120, bars: 1, outPath: out("melodic.wav"), layers: [{ name: "Bass", samplePath: out("kick.wav"), notes: [{ pitch: 48, startBeats: 0, durationBeats: 1, velocity: 100 }, { pitch: 60, startBeats: 1, durationBeats: 1, velocity: 100 }, { pitch: 72, startBeats: 2, durationBeats: 1, velocity: 100 }] }] });
check(melodic.durationSeconds === 2 && (await fs.stat(out("melodic.wav"))).size > 44, `render: pitched notes rendered`);

// 6) compareProfiles: numeric deltas for every rating, neutral text
const cmp = compareProfiles(sine, click, { nameA: "reference", nameB: "produced kick" });
check(Object.keys(cmp.deltas).length === Object.keys(RATING_THRESHOLDS).length && cmp.deltas.subWeight.delta !== null, `compare: deltas for all ${Object.keys(cmp.deltas).length} ratings`);
check(cmp.text.split(". ").length >= 2 && !FORBIDDEN.test(cmp.text), `compare: neutral text -> ${cmp.text}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
