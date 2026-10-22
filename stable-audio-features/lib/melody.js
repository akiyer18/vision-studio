// Hum -> notes (pitch tracking) and text -> melody (Claude or rules). No deps beyond ffmpeg + the SDK.
import { execFile } from "node:child_process";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildMidi } from "./midi.js";

export const SR = 16000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Decode any audio file to mono float32 at 16 kHz via ffmpeg. */
export function decodeMono16k(path) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-i", path, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-loglevel", "error", "-"],
      { encoding: "buffer", maxBuffer: 1 << 30 },
      (err, stdout) => {
        if (err) return reject(new Error(`ffmpeg decode failed: ${err.message}`));
        const buf = Buffer.from(stdout);
        resolve(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4))));
      },
    );
  });
}

// ---------- pitch tracking (YIN difference function, CMND threshold 0.15) ----------

const HOP = 256, W = 1024; // W = YIN integration window; a frame needs W + tauMax samples
const TAU_MAX = Math.ceil(16000 / 60);
const FRAME = W + TAU_MAX; // 1291 samples (~81 ms); keeps analysis running up to the very end of the file
const F_MIN = 60, F_MAX = 1000;
const RMS_GATE = 0.01;

function frameRms(x, start, len) {
  let s = 0;
  for (let i = start; i < start + len; i++) s += x[i] * x[i];
  return Math.sqrt(s / len);
}

function yinPitch(x, start) {
  const tauMin = Math.floor(SR / F_MAX), tauMax = Math.ceil(SR / F_MIN);
  const d = new Float64Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const diff = x[start + j] - x[start + j + tau]; s += diff * diff; }
    d[tau] = s;
  }
  // cumulative mean normalized difference
  const cmnd = new Float64Array(tauMax + 1);
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    cmnd[tau] = tau < tauMin ? 1 : (d[tau] * tau) / (run || 1e-12);
  }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < 0.15) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau; break;
    }
  }
  if (best < 0) {
    let m = 1e9;
    for (let tau = tauMin; tau <= tauMax; tau++) if (cmnd[tau] < m) { m = cmnd[tau]; best = tau; }
    if (m > 0.5) return null;
  }
  // parabolic interpolation
  let t = best;
  if (best > tauMin && best < tauMax) {
    const a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-12) t = best + 0.5 * (a - c) / denom;
  }
  return SR / t;
}

const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

function medianFilter(track, win = 5) {
  const half = win >> 1, out = track.slice();
  for (let i = 0; i < track.length; i++) {
    const vals = [];
    for (let j = i - half; j <= i + half; j++) if (j >= 0 && j < track.length && track[j] != null) vals.push(track[j]);
    if (track[i] == null && vals.length < win - 1) { out[i] = null; continue; }
    if (!vals.length) { out[i] = null; continue; }
    vals.sort((a, b) => a - b);
    out[i] = vals[vals.length >> 1];
  }
  return out;
}

/** Frame-wise pitch track: [{ t (s), midi|null, rms }] */
export function pitchTrack(x) {
  const frames = [];
  for (let s = 0; s + FRAME <= x.length; s += HOP) {
    const rms = frameRms(x, s, W);
    const t = (s + W / 2) / SR;
    if (rms < RMS_GATE) { frames.push({ t, midi: null, rms }); continue; }
    const f = yinPitch(x, s);
    frames.push({ t, midi: f ? Math.round(hzToMidi(f)) : null, rms });
  }
  const smoothed = medianFilter(frames.map((f) => f.midi), 7); // window 7 wipes the 2-3 frame glitches YIN makes at note boundaries
  return frames.map((f, i) => ({ ...f, midi: smoothed[i] }));
}

/**
 * humToNotes(wavPath, { bpm, stepsPerBar=16, minSteps=1 })
 * -> { notes:[{ pitch, startBeats, durationBeats, velocity }], bars, bpm }
 */
export async function humToNotes(wavPath, { bpm = 120, stepsPerBar = 16, minSteps = 1 } = {}) {
  const x = await decodeMono16k(wavPath);
  const track = pitchTrack(x);
  const stepBeats = 4 / stepsPerBar;
  const toBeats = (t) => (t * bpm) / 60;

  // group consecutive same-pitch frames into raw segments
  const segs = [];
  for (const f of track) {
    const last = segs[segs.length - 1];
    if (f.midi == null) { if (last && !last.closed) last.closed = true; continue; }
    if (last && !last.closed && last.midi === f.midi) { last.tEnd = f.t; last.rms.push(f.rms); }
    else segs.push({ midi: f.midi, tStart: f.t, tEnd: f.t, rms: [f.rms], closed: false });
  }
  // transition glitches last 2-3 frames; a real note is at least ~40% of a grid step (and never under 4 frames = 64 ms)
  const minFrames = Math.max(4, Math.round(((0.4 * stepBeats * 60) / bpm) * (SR / HOP)));
  const notes = [];
  for (const s of segs) {
    if (s.rms.length < minFrames) continue;
    const tStart = s.tStart - HOP / SR / 2, tEnd = s.tEnd + HOP / SR / 2;
    let start = Math.round(toBeats(tStart) / stepBeats) * stepBeats;
    let end = Math.round(toBeats(tEnd) / stepBeats) * stepBeats;
    if (end - start < minSteps * stepBeats) end = start + minSteps * stepBeats;
    const meanRms = s.rms.reduce((a, b) => a + b, 0) / s.rms.length;
    const velocity = Math.round(clamp(60 + 60 * Math.min(1, meanRms / 0.3), 60, 120));
    const pitch = clamp(s.midi, 36, 96);
    const prev = notes[notes.length - 1];
    if (prev && prev.pitch === pitch && Math.abs(prev.startBeats + prev.durationBeats - start) < 1e-9) {
      prev.durationBeats = end - prev.startBeats; continue;
    }
    if (prev && start < prev.startBeats + prev.durationBeats) prev.durationBeats = Math.max(stepBeats, start - prev.startBeats);
    notes.push({ pitch, startBeats: start, durationBeats: end - start, velocity });
  }
  const totalBeats = notes.reduce((m, n) => Math.max(m, n.startBeats + n.durationBeats), 0);
  return { notes, bars: Math.max(1, Math.ceil(totalBeats / 4)), bpm };
}

// ---------- text -> melody ----------

export const NoteSchema = z.object({
  pitch: z.number().int().min(36).max(96),
  startBeats: z.number().min(0),
  durationBeats: z.number().gt(0),
  velocity: z.number().int().min(1).max(127),
});
export const MelodySchema = z.object({
  name: z.string(),
  key: z.string(),
  bars: z.number().int().min(1).max(8),
  notes: z.array(NoteSchema),
});

const NOTE_NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

/** parseKey("F# major") -> { root: 6, mode: 'major', name: 'F# major' } ; default C minor */
export function parseKey(text = "") {
  const m = /\b([A-G])\s?(#|b|♯|♭)?\s*(major|minor|maj|min|m)?\b/.exec(text);
  if (!m) return { root: 0, mode: "minor", name: "C minor" };
  let root = NOTE_NAMES[m[1]];
  if (m[2] === "#" || m[2] === "♯") root += 1;
  if (m[2] === "b" || m[2] === "♭") root -= 1;
  root = ((root % 12) + 12) % 12;
  const mode = /^(maj|major)$/.test(m[3] || "") ? "major" : "minor";
  const acc = m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2] || "";
  return { root, mode, name: `${m[1]}${acc} ${mode}` };
}

function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Rule-based melody generator. */
export function rulesToMelody({ description = "", bpm, bars = 2, key } = {}) {
  const text = description.toLowerCase();
  const k = parseKey(key || description);
  const scale = SCALES[k.mode];
  const barsMatch = /(\d+)\s*bars?/.exec(text);
  bars = clamp(Math.round(Number(barsMatch?.[1]) || bars || 2), 1, 8);
  const prog = k.mode === "minor" ? [0, 5, 2, 6] : [0, 4, 5, 3]; // i-VI-III-VII / I-V-vi-IV (scale degrees)
  const degToMidi = (deg, base) => base + k.root + scale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
  let shift = /octave up/.test(text) ? 12 : /octave down/.test(text) ? -12 : 0;
  const notes = [];
  const push = (pitch, start, dur, vel) => notes.push({ pitch: clamp(pitch + shift, 36, 96), startBeats: start, durationBeats: dur, velocity: clamp(Math.round(vel), 1, 127) });
  const style = /arp/.test(text) ? "arp" : /bass/.test(text) ? "bass" : /stab|chord/.test(text) ? "stabs" : "lead";
  const name = `${style} in ${k.name}`;

  if (style === "arp") {
    const step = /16th|fast/.test(text) ? 0.25 : 0.5;
    for (let b = 0; b < bars; b++) {
      const deg = prog[b % prog.length];
      const tones = [degToMidi(deg, 60), degToMidi(deg + 2, 60), degToMidi(deg + 4, 60), degToMidi(deg, 72), degToMidi(deg + 4, 60), degToMidi(deg + 2, 60)];
      for (let t = 0; t < 4; t += step) {
        const i = Math.round(t / step);
        push(tones[i % tones.length], b * 4 + t, step, (t % 1 === 0 ? 110 : 90));
      }
    }
  } else if (style === "bass") {
    for (let b = 0; b < bars; b++) {
      const deg = prog[b % prog.length];
      for (let t = 0; t < 4; t += 0.5) {
        const off = t % 1 !== 0;
        const octaveJump = /octave/.test(text) && off ? 12 : 0;
        push(degToMidi(deg, 36) + octaveJump, b * 4 + t, 0.5, off ? 85 : 112);
      }
    }
  } else if (style === "stabs") {
    for (let b = 0; b < bars; b++) {
      const deg = prog[b % prog.length];
      for (const t of [0, 2.5]) {
        for (const d of [0, 2, 4]) push(degToMidi(deg + d, 60), b * 4 + t, 0.5, t === 0 ? 112 : 96);
      }
    }
  } else {
    const rnd = lcg(bars * 7919 + k.root * 131 + description.length);
    let deg = 7; // start on the tonic one octave up (C5 region feels like a lead)
    let t = 0;
    const total = bars * 4;
    while (t < total) {
      const dur = rnd() < 0.7 ? 0.5 : 1;
      const dir = rnd() < 0.5 ? -1 : 1;
      const jump = rnd() < 0.8 ? 1 : 2;
      deg = clamp(deg + dir * jump, 0, 14);
      if (t % 4 === 0 && rnd() < 0.5) deg = 7 + prog[(t / 4) % prog.length]; // land on chord root at bar starts sometimes
      push(degToMidi(deg, 60 - 12), t, Math.min(dur, total - t), t % 1 === 0 ? 105 : 88);
      t += dur;
    }
  }
  return { name, key: k.name, bars, notes };
}

const MELODY_SYSTEM = `You write short melodic MIDI parts for electronic music producers. Output notes in beats (quarter notes), 4/4, where bar n starts at beat 4n. Pitches are MIDI numbers (60 = C4). Stay in the requested key and within 36-96. Styles: arp = chord tones cycling in 8ths or 16ths; bassline = roots and fifths in octave 2 (36-48), 8ths, octave jumps on offbeats; stabs/chords = 3-4 note chords on syncopated hits; lead = singable stepwise melody with a few leaps, mostly 8ths and quarters, resolving to chord tones. Use velocity 80-120 with accents on downbeats. Respect any bars, key, or bpm the user names.`;

async function claudeToMelody({ description, bpm, bars, key }) {
  const client = new Anthropic();
  const hints = [key ? `Key: ${key}.` : "", bpm ? `BPM: ${bpm}.` : "", bars ? `Bars: ${bars}.` : ""].filter(Boolean).join(" ");
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: MELODY_SYSTEM,
    messages: [{ role: "user", content: `${description}\n${hints}`.trim() }],
    output_config: { format: zodOutputFormat(MelodySchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude returned no melody");
  const m = response.parsed_output;
  const maxBeat = m.bars * 4;
  m.notes = m.notes.filter((n) => n.startBeats < maxBeat).map((n) => ({ ...n, durationBeats: Math.min(n.durationBeats, maxBeat - n.startBeats) }));
  return MelodySchema.parse(m);
}

/** describeToMelody({ description, bpm, bars=2, key }) -> { notes, bars, key, name, source:'claude'|'rules' } */
export async function describeToMelody({ description = "", bpm, bars = 2, key } = {}) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const m = await claudeToMelody({ description, bpm, bars, key });
      return { ...m, source: "claude" };
    } catch (err) {
      console.warn("[melody] Claude failed, using rules:", err?.message || err);
    }
  }
  return { ...rulesToMelody({ description, bpm, bars, key }), source: "rules" };
}

/** notesToMidi(notes, { bpm, ppq=96, channel=0 }) -> Buffer */
export function notesToMidi(notes, { bpm = 120, ppq = 96, channel = 0 } = {}) {
  return buildMidi({ bpm, ppq, notes: notes.map((n) => ({ ...n, channel })) });
}
