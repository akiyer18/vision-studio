// Offline tests for lib/melody.js and lib/rhythm.js. Inputs are synthesized (raw f32 -> wav via ffmpeg); no mic needed.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { humToNotes, describeToMelody, notesToMidi, SR } from "../lib/melody.js";
import { beatboxToPattern } from "../lib/rhythm.js";
import { PatternSchema } from "../lib/pattern.js";
import { patternToMidi } from "../lib/midi.js";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(here, "..", ".tmp");
await fs.mkdir(TMP, { recursive: true });
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failures++; };

async function writeWav(name, samples) {
  const raw = path.join(TMP, `${name}.f32`), wav = path.join(TMP, `${name}.wav`);
  await fs.writeFile(raw, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", raw, "-c:a", "pcm_s16le", wav]);
  return wav;
}
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

// ---------- 1. melody: C4 E4 G4 C5, 0.5 s each (1 beat at 120 bpm) ----------
{
  const pitches = [60, 64, 67, 72], dur = 0.5;
  const x = new Float32Array(Math.round(SR * dur * pitches.length));
  pitches.forEach((m, i) => {
    const f = midiHz(m), n0 = Math.round(i * dur * SR), n = Math.round(dur * SR), fade = 80;
    for (let k = 0; k < n; k++) {
      const env = Math.min(1, k / fade, (n - k) / fade);
      x[n0 + k] = 0.5 * env * Math.sin((2 * Math.PI * f * k) / SR);
    }
  });
  const wav = await writeWav("melody-test", x);
  const { notes, bars, bpm } = await humToNotes(wav, { bpm: 120 });
  console.log("melody notes:", JSON.stringify(notes));
  check(notes.length === 4, `humToNotes returns 4 notes (got ${notes.length})`);
  check(notes.every((n, i) => n.pitch === pitches[i]), "pitches are C4 E4 G4 C5 exactly");
  check(notes.every((n, i) => n.startBeats === i && n.durationBeats === 1), "each note starts on beat i and lasts 1 beat");
  check(bars === 1 && bpm === 120, `bars=1 bpm=120 (got ${bars}/${bpm})`);
  const midi = notesToMidi(notes, { bpm });
  check(midi.subarray(0, 4).toString() === "MThd", "melody MIDI starts with MThd");
  await fs.writeFile(path.join(TMP, "melody-test.mid"), midi);
}

// ---------- 2. beatbox: 4 bars @120, kick on 1&3, snare on 2&4, hats on off-8ths ----------
{
  const bpm = 120, bars = 4, step = 60 / bpm / 4;
  const lead = 0.3; // leading silence, like a real recording
  const total = Math.round((lead + bars * 16 * step) * SR) + SR / 2;
  const x = new Float32Array(total);
  const add = (t, gen) => { const n0 = Math.round((lead + t) * SR); for (let k = 0; k < gen.length && n0 + k < total; k++) x[n0 + k] += gen[k]; };
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const kick = () => { const n = Math.round(0.15 * SR), g = new Float32Array(n); for (let k = 0; k < n; k++) g[k] = 0.8 * Math.exp(-k / (0.04 * SR)) * Math.sin((2 * Math.PI * 70 * k) / SR); return g; };
  const lp2 = (fc) => { const a = Math.exp((-2 * Math.PI * fc) / SR); let y1 = 0, y2 = 0; return (v) => { y1 = (1 - a) * v + a * y1; y2 = (1 - a) * y1 + a * y2; return y2; }; };
  const snare = () => { const n = Math.round(0.12 * SR), g = new Float32Array(n), f = lp2(1000); for (let k = 0; k < n; k++) g[k] = 0.9 * Math.exp(-k / (0.03 * SR)) * f(rnd()); return g; };
  const hat = () => { const n = Math.round(0.04 * SR), g = new Float32Array(n), f = lp2(4000); for (let k = 0; k < n; k++) { const v = rnd(); g[k] = 0.4 * Math.exp(-k / (0.01 * SR)) * (v - f(v)); } return g; };
  const expected = [];
  for (let b = 0; b < bars; b++) {
    for (const s of [0, 8]) { add((b * 16 + s) * step, kick()); expected.push({ step: b * 16 + s, instrument: "kick" }); }
    for (const s of [4, 12]) { add((b * 16 + s) * step, snare()); expected.push({ step: b * 16 + s, instrument: "snare" }); }
    for (const s of [2, 6, 10, 14]) { add((b * 16 + s) * step, hat()); expected.push({ step: b * 16 + s, instrument: "hat_closed" }); }
  }
  const wav = await writeWav("beatbox-test", x);
  const { pattern, onsets, bpm: est } = await beatboxToPattern(wav, { bpm, bars });
  console.log("onsets:", onsets.map((o) => `${o.step}:${o.instrument}(${o.centroid}Hz)`).join(" "));
  const got = new Map(onsets.map((o) => [o.step, o.instrument]));
  const correct = expected.filter((e) => got.get(e.step) === e.instrument).length;
  const acc = correct / expected.length;
  check(onsets.length >= expected.length * 0.9 && onsets.length <= expected.length * 1.1, `onset count ~${expected.length} (got ${onsets.length})`);
  check(acc >= 0.8, `classification + quantization accuracy ${(acc * 100).toFixed(0)}% >= 80%`);
  check(PatternSchema.safeParse(pattern).success, "pattern is PatternSchema-valid");
  check(pattern.bars === 4 && pattern.bpm === 120, `pattern bars=4 bpm=120 (got ${pattern.bars}/${pattern.bpm})`);
  const { bpm: guessed } = await beatboxToPattern(wav, {});
  check(Math.abs(guessed - 120) <= 3, `bpm estimate ~120 without hint (got ${guessed})`);
  const midi = patternToMidi(pattern, { mapping: "gm" });
  check(midi.subarray(0, 4).toString() === "MThd", "beatbox MIDI starts with MThd");
  await fs.writeFile(path.join(TMP, "beatbox-test.mid"), midi);
}

// ---------- 3. describeToMelody rules ----------
delete process.env.ANTHROPIC_API_KEY;
for (const description of ["arp in C minor", "bassline in F# major", "stabs", "lead melody in A minor, 4 bars, octave up"]) {
  const m = await describeToMelody({ description, bpm: 120 });
  const inRange = m.notes.every((n) => n.pitch >= 36 && n.pitch <= 96 && n.durationBeats > 0 && n.startBeats >= 0 && n.startBeats < m.bars * 4);
  const midi = notesToMidi(m.notes, { bpm: 120 });
  check(m.source === "rules" && m.notes.length > 0 && inRange && midi.subarray(0, 4).toString() === "MThd",
    `"${description}" -> ${m.key}, ${m.bars} bars, ${m.notes.length} notes, MIDI ok`);
  await fs.writeFile(path.join(TMP, `melody-${description.replace(/[^a-z0-9]+/gi, "-")}.mid`), midi);
}
{
  const bass = await describeToMelody({ description: "bassline in F# major", bpm: 120 });
  check(bass.key === "F# major" && bass.notes.every((n) => n.pitch >= 36 && n.pitch <= 55), "bassline sits in octave 2-3 in F# major");
  const arp = await describeToMelody({ description: "arp in C minor", bpm: 120 });
  check(arp.notes.length === 16 && arp.notes[0].pitch === 60 && arp.notes[1].pitch === 63, "C minor arp: 8ths, starts C4 then Eb4");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
