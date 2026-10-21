// Rules-only tests for lib/tweak.js (no ANTHROPIC_API_KEY needed).
delete process.env.ANTHROPIC_API_KEY;
import assert from "node:assert/strict";
import { rulesToPattern } from "../lib/pattern.js";
import { applyTweak, TweakSchema } from "../lib/tweak.js";

const base = () => ({
  bpm: 124,
  pattern: rulesToPattern({ description: "four on the floor, snare on 2 and 4, offbeat hats", bpm: 124, bars: 1 }),
  melody: { notes: [
    { pitch: 60, startBeats: 0, durationBeats: 0.5, velocity: 100 },
    { pitch: 63, startBeats: 0.5, durationBeats: 0.5, velocity: 90 },
    { pitch: 67, startBeats: 1, durationBeats: 0.5, velocity: 95 },
    { pitch: 72, startBeats: 1.5, durationBeats: 0.5, velocity: 100 },
  ], bars: 1, key: "C minor" },
  plan: { synth: { prompt: "fat supersaw synth, single sustained note, bright" } },
});
const lane = (p, i) => p.lanes.find((l) => l.instrument === i);
let n = 0;
async function t(text, check) {
  const { changes, source } = await applyTweak({ text, state: base() });
  TweakSchema.parse(changes);
  assert.equal(source, "rules");
  check(changes);
  n++; console.log(`ok  "${text}" -> ${changes.summary}`);
}

await t("128 bpm", (c) => { assert.equal(c.bpm, 128); assert.equal(c.pattern, null); });
await t("faster", (c) => assert.equal(c.bpm, 132));
await t("slower please", (c) => assert.equal(c.bpm, 116));
await t("double time", (c) => assert.equal(c.bpm, 248));
await t("double the hats", (c) => { assert.equal(lane(c.pattern, "hat_closed").steps.length, 16); assert.equal(c.bpm, null); });
await t("8th hats", (c) => assert.equal(lane(c.pattern, "hat_closed").steps.length, 8));
await t("remove the hats", (c) => assert.ok(!c.pattern.lanes.some((l) => l.instrument.startsWith("hat"))));
await t("half time", (c) => { const s = lane(c.pattern, "snare"); assert.deepEqual(s.steps.map((h) => h.step), [8]); assert.ok(!lane(c.pattern, "clap")); });
await t("more swing", (c) => assert.ok(Math.abs(c.pattern.swing - 0.15) < 1e-9));
await t("straight", (c) => assert.equal(c.pattern.swing, 0));
await t("add a clap on 2 and 4", (c) => assert.deepEqual(lane(c.pattern, "clap").steps.map((h) => h.step), [4, 12]));
await t("remove the clap", (c) => assert.ok(!lane(c.pattern, "clap")));
await t("ghost notes", (c) => { const s = lane(c.pattern, "snare").steps; assert.ok(s.some((h) => h.step === 7 && h.velocity < 50)); assert.ok(s.some((h) => h.step === 4)); });
await t("busier kick", (c) => assert.ok(lane(c.pattern, "kick").steps.some((h) => h.step === 10)));
await t("very busy kick", (c) => { const k = lane(c.pattern, "kick").steps.map((h) => h.step); assert.ok(k.includes(10) && k.includes(7)); });
await t("sparser", (c) => assert.deepEqual(lane(c.pattern, "kick").steps.map((h) => h.step), [0, 8]));
await t("transpose the melody up an octave", (c) => { assert.deepEqual(c.melody.notes.map((x) => x.pitch), [72, 75, 79, 84]); assert.equal(c.pattern, null); });
await t("octave down", (c) => assert.deepEqual(c.melody.notes.map((x) => x.pitch), [48, 51, 55, 60]));
await t("transpose the melody down 5 semitones", (c) => assert.deepEqual(c.melody.notes.map((x) => x.pitch), [55, 58, 62, 67]));
await t("simpler melody", (c) => assert.equal(c.melody.notes.length, 2));
await t("longer notes", (c) => assert.ok(c.melody.notes.every((x) => x.durationBeats === 1)));
await t("change the kick to a boomy 808", (c) => { assert.equal(c.drums.length, 1); assert.equal(c.drums[0].role, "kick"); assert.match(c.drums[0].prompt, /boomy 808/); assert.equal(c.pattern, null); });
await t("make the snare crunchy and lo-fi", (c) => { assert.equal(c.drums[0].role, "snare"); assert.match(c.drums[0].prompt, /crunchy/); });
await t("make the saw brighter", (c) => { assert.match(c.synth.prompt, /brighter/); assert.match(c.synth.prompt, /supersaw/); assert.equal(c.drums, null); });
await t("faster with 16th hats and more swing", (c) => { assert.equal(c.bpm, 132); assert.equal(lane(c.pattern, "hat_closed").steps.length, 16); assert.ok(c.pattern.swing > 0); assert.equal(c.pattern.bpm, 132); });
await t("hello there", (c) => { assert.match(c.summary, /No change understood/); for (const k of ["bpm", "pattern", "melody", "drums", "synth"]) assert.equal(c[k], null); });

// 2-bar pattern: lanes must tile over both bars
{
  const state = base(); state.pattern = rulesToPattern({ description: "house", bpm: 124, bars: 2 });
  const { changes } = await applyTweak({ text: "double the hats", state });
  assert.equal(lane(changes.pattern, "hat_closed").steps.length, 32);
  assert.ok(lane(changes.pattern, "hat_closed").steps.every((h) => h.step < 32));
  n++; console.log('ok  2-bar "double the hats" -> 32 hat steps');
}
console.log(`\n${n} tweak tests passed`);
