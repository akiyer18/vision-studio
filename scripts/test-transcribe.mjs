// Offline: parseMidi round-trips files written by lib/midi.js exactly; midiToNotes clip logic. No network.
import assert from "node:assert/strict";
import { buildMidi, patternToMidi } from "../lib/midi.js";
import { parseMidi, midiToNotes, transcribeAvailable } from "../lib/transcribe.js";

// 1) format 0, several pitches/velocities/channels, overlapping notes, tempo 93
const notes = [
  { pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100, channel: 0 },
  { pitch: 64, startBeats: 0, durationBeats: 0.5, velocity: 77, channel: 0 },
  { pitch: 67, startBeats: 0.5, durationBeats: 0.25, velocity: 45, channel: 0 },
  { pitch: 60, startBeats: 1, durationBeats: 0.125, velocity: 127, channel: 0 },   // same pitch again right after
  { pitch: 36, startBeats: 2.5, durationBeats: 0.75, velocity: 110, channel: 9 },
  { pitch: 84, startBeats: 7.75, durationBeats: 0.25, velocity: 1, channel: 1 },
];
const buf = buildMidi({ bpm: 93, ppq: 96, notes });
const p = parseMidi(buf);
assert.equal(p.ppq, 96); assert.equal(p.format, 0); assert.equal(p.tracks.length, 1);
assert.ok(Math.abs(p.tempoBpm - 93) < 0.01, `tempo ${p.tempoBpm}`);
const got = p.tracks[0].notes.map((n) => ({ pitch: n.pitch, startBeats: n.startTick / 96, durationBeats: n.durationTick / 96, velocity: n.velocity, channel: n.channel }))
  .sort((a, b) => a.startBeats - b.startBeats || a.pitch - b.pitch);
const want = [...notes].sort((a, b) => a.startBeats - b.startBeats || a.pitch - b.pitch);
assert.deepEqual(got, want, "exact round-trip of all notes");

// 2) a 2-bar swung pattern through patternToMidi (gm + single)
const pattern = { name: "t", bpm: 124, bars: 2, stepsPerBar: 16, swing: 0.3, lanes: [
  { instrument: "kick", steps: [{ step: 0, velocity: 120 }, { step: 8, velocity: 110 }, { step: 16, velocity: 120 }, { step: 24, velocity: 110 }] },
  { instrument: "hat_closed", steps: Array.from({ length: 32 }, (_, i) => ({ step: i, velocity: i % 2 ? 70 : 100 })) },
]};
for (const mapping of ["gm", "single"]) {
  const q = parseMidi(patternToMidi(pattern, { mapping }));
  const n = q.tracks[0].notes;
  assert.equal(n.length, 36, `${mapping}: 36 notes`);
  assert.ok(Math.abs(q.tempoBpm - 124) < 0.01);
  const kicks = n.filter((x) => x.pitch === (mapping === "gm" ? 36 : 60) && x.velocity >= 110);
  assert.equal(kicks.length, 4, `${mapping}: 4 kicks`);
  assert.deepEqual(kicks.map((k) => k.startTick / 96), [0, 2, 4, 6], `${mapping}: kick beats`);
  // odd 16ths are swung late by 0.3 * 0.5 * 0.25 beats = 0.0375 beats = 3.6 ticks -> 4 ticks
  const hatStep1 = n.find((x) => x.velocity === 70 && x.startTick > 0 && x.startTick < 30);
  assert.equal(hatStep1.startTick, 24 + 4, "swing applied to odd step");
  assert.ok(n.every((x) => x.channel === (mapping === "gm" ? 9 : 0)), `${mapping}: channel`);
}

// 3) midiToNotes: tonal material preferred over channel-10 drums, bars derived, long clips trimmed, >64 notes capped
const tonal = midiToNotes(p);
assert.ok(tonal.notes.every((n) => n.pitch !== 36), "drums dropped when tonal notes exist");
assert.equal(tonal.bars, 2, `bars from end beat 8 -> 2 (${tonal.bars})`);
const drumsOnly = midiToNotes(parseMidi(patternToMidi(pattern, { mapping: "gm" })));
assert.equal(drumsOnly.notes.length, 36, "drums kept when nothing else");
const long = buildMidi({ bpm: 120, notes: Array.from({ length: 200 }, (_, i) => ({ pitch: 48 + (i % 24), startBeats: i * 0.25, durationBeats: 0.25, velocity: 60 + (i % 60), channel: 0 })) });
const capped = midiToNotes(parseMidi(long));
assert.ok(capped.notes.length <= 64 && capped.notes.every((n) => n.startBeats < 32), "capped to 64 notes within 8 bars");
assert.equal(capped.bars, 8);
// offset material shifted to bar start
const late = midiToNotes(parseMidi(buildMidi({ bpm: 120, notes: [{ pitch: 60, startBeats: 9, durationBeats: 1, velocity: 90, channel: 0 }] })));
assert.equal(late.notes[0].startBeats, 1, "shifted to the containing bar"); assert.equal(late.bars, 1);

// 4) running status + note-on velocity 0 as note-off (hand-built bytes)
const rs = Buffer.from([0x4d,0x54,0x68,0x64, 0,0,0,6, 0,1, 0,1, 0,96, 0x4d,0x54,0x72,0x6b, 0,0,0,0x11,
  0x00,0xff,0x03,0x02,0x68,0x69,      // track name "hi"
  0x00,0x90,0x3c,0x50,               // C4 on
  0x60,0x3c,0x00,                    // running status: C4 velocity 0 = off after 96 ticks
  0x00,0xff,0x2f,0x00]);
const r = parseMidi(rs);
assert.equal(r.format, 1); assert.equal(r.tracks[0].name, "hi");
assert.deepEqual(r.tracks[0].notes, [{ pitch: 60, startTick: 0, durationTick: 96, velocity: 80, channel: 0 }]);
assert.equal(r.tempoBpm, 120, "default tempo when none");
assert.equal(typeof transcribeAvailable(), "boolean");
assert.throws(() => parseMidi(Buffer.from("RIFF....")), /MThd/);
console.log(`parseMidi round-trip: ${got.length} notes exact · 2-bar pattern gm+single ok · midiToNotes caps/bars ok · running status ok`);
console.log("ALL PASS");
