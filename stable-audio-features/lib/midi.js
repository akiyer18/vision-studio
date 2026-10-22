// Hand-written Standard MIDI File writer (format 0). No dependencies.
import { GM_DRUM_NOTES } from "./pattern.js";

const PPQ_DEFAULT = 96;

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n) {
  return [(n >>> 8) & 0xff, n & 0xff];
}

/**
 * buildMidi({ bpm, ppq=96, notes:[{ pitch, startBeats, durationBeats, velocity, channel? }] }) -> Buffer
 * Beats are quarter notes. channel defaults to 9 (GM drums, "channel 10").
 */
export function buildMidi({ bpm = 120, ppq = PPQ_DEFAULT, notes = [] }) {
  const events = [];
  for (const n of notes) {
    const ch = (n.channel ?? 9) & 0x0f;
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity ?? 100)));
    const on = Math.max(0, Math.round(n.startBeats * ppq));
    const off = on + Math.max(1, Math.round(n.durationBeats * ppq));
    events.push({ tick: on, order: 1, bytes: [0x90 | ch, pitch, vel] });
    events.push({ tick: off, order: 0, bytes: [0x80 | ch, pitch, 0] });
  }
  // note-offs (order 0) before note-ons (order 1) at the same tick
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track = [];
  const usPerBeat = Math.round(60_000_000 / bpm);
  track.push(0, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff);
  track.push(0, 0xff, 0x58, 0x04, 4, 2, 24, 8); // 4/4

  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  track.push(0, 0xff, 0x2f, 0x00); // end of track

  const header = [...u32(6), ...u16(0), ...u16(1), ...u16(ppq)];
  return Buffer.from([
    0x4d, 0x54, 0x68, 0x64, ...header, // MThd
    0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track, // MTrk
  ]);
}

/**
 * patternToMidi(pattern, { mapping='gm'|'single', singleNote=60 }) -> Buffer
 * 'gm': instruments -> GM_DRUM_NOTES on channel 10 (Drum Rack pads).
 * 'single': every hit on singleNote, channel 1 (one sample in Simpler, C3=60).
 * Step = 1/16 note, note length = 1/32, swing delays odd 16ths by swing*0.5*(16th).
 */
export function patternToMidi(pattern, { mapping = "gm", singleNote = 60 } = {}) {
  const stepBeats = 4 / (pattern.stepsPerBar || 16);
  const swing = Math.max(0, Math.min(1, pattern.swing ?? 0));
  const maxStep = (pattern.bars || 1) * (pattern.stepsPerBar || 16) - 1;
  const notes = [];
  for (const lane of pattern.lanes || []) {
    const pitch = mapping === "single" ? singleNote : GM_DRUM_NOTES[lane.instrument] ?? 38;
    const channel = mapping === "single" ? 0 : 9;
    for (const hit of lane.steps || []) {
      const step = Math.max(0, Math.min(maxStep, Math.round(hit.step)));
      const shift = step % 2 === 1 ? swing * 0.5 * stepBeats : 0;
      notes.push({
        pitch,
        channel,
        startBeats: step * stepBeats + shift,
        durationBeats: stepBeats / 2,
        velocity: hit.velocity,
      });
    }
  }
  return buildMidi({ bpm: pattern.bpm, notes });
}
