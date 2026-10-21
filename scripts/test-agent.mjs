// Offline test of lib/agent.js: fake ctx, every tool runs, schemas reject bad input. No API calls.
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { makeTools, runProducer, PRODUCER_SYSTEM, MODEL } from "../lib/agent.js";

assert.ok(Anthropic && betaZodTool, "SDK helpers import");
assert.equal(MODEL, "claude-opus-5-5");
assert.ok(PRODUCER_SYSTEM.includes("dry one-shot") && PRODUCER_SYSTEM.includes("ok:true"), "system prompt has prompt rules + ok rule");

const calls = [], events = [];
const ctx = {
  emit: (e) => events.push(e),
  synth: async (o) => { calls.push(["synth", o]); return { path: "/out/x.wav", name: "x.wav", url: "/out/x.wav", durationSeconds: 1, peakDb: -1 }; },
  writePattern: async (o) => { calls.push(["writePattern", o]); return { pattern: { name: "p", bpm: o.bpm, bars: o.bars, stepsPerBar: 16, swing: 0, lanes: [{ instrument: "kick", steps: [{ step: 0, velocity: 120 }] }] }, source: "rules" }; },
  writeMelody: async (o) => { calls.push(["writeMelody", o]); return { key: o.key, bars: o.bars, notes: [{ pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100 }], source: "rules" }; },
  beatboxToPattern: async (p, o) => { calls.push(["beatboxToPattern", p, o]); return { pattern: { name: "bb", bpm: 120, bars: 1, stepsPerBar: 16, swing: 0, lanes: [] }, onsets: [{ time: 0.31, instrument: "kick" }, { time: 0.8, instrument: "snare" }, { time: 1.3, instrument: "kick" }], bpm: 120 }; },
  humToNotes: async (p, o) => { calls.push(["humToNotes", p, o]); return { notes: [{ pitch: 62, startBeats: 0, durationBeats: 0.5, velocity: 90 }], bars: 1, bpm: o.bpm }; },
  live: {
    setTempo: async (bpm) => { calls.push(["setTempo", bpm]); return { tempo: bpm }; },
    listTracks: async () => [{ index: 0, name: "Kick", is_midi: true, selected: true }],
    buildLane: async (i) => { calls.push(["buildLane", i]); return { track: { index: 1, name: i.name }, notes: i.steps.length, loadedSample: true }; },
    buildMelody: async (i) => { calls.push(["buildMelody", i]); return { track: { index: 2, name: i.name }, notes: i.notes.length, loadedSample: true }; },
    updateLayer: async (i) => { calls.push(["updateLayer", i]); return { track: { index: 1, name: i.name }, notes: (i.steps || i.notes).length }; },
    loadSample: async (i) => { calls.push(["loadSample", i]); return { index: 1, name: i.name }; },
    deleteTrack: async (n) => { calls.push(["deleteTrack", n]); return { deleted: true }; },
    show: async () => ({ view: "Session" }),
    play: async () => ({ playing: true }),
    stop: async () => ({ playing: false }),
  },
};

const tools = makeTools(ctx, { beat: "/tmp/fake.wav" });
const expected = ["set_tempo", "list_tracks", "analyze_recording", "write_drum_pattern", "write_melody", "synthesize_sound", "build_drum_layer", "build_melody_layer", "update_layer", "replace_sound", "remove_layer", "show_live", "play", "stop"];
assert.deepEqual(tools.map((t) => t.name), expected, "tool names");
for (const t of tools) {
  assert.ok(t.description && t.description.length > 20, `${t.name} description`);
  assert.equal(t.input_schema.type, "object", `${t.name} schema object`);
  assert.equal(typeof t.run, "function"); assert.equal(typeof t.parse, "function");
}

const sample = {
  set_tempo: { bpm: 126 },
  list_tracks: {},
  analyze_recording: { which: "beat" },
  write_drum_pattern: { description: "four on the floor", bpm: 126, bars: 1 },
  write_melody: { description: "arp", key: "C minor", bpm: 126, bars: 2 },
  synthesize_sound: { role: "kick", prompt: "tight techno kick, dry one-shot", source: "beatbox", offsetSeconds: 0.31 },
  build_drum_layer: { name: "Kick", instrument: "kick", samplePath: "/out/x.wav", steps: [{ step: 0, velocity: 120 }, { step: 4, velocity: 110 }], bars: 1 },
  build_melody_layer: { name: "Saw", samplePath: "/out/x.wav", notes: [{ pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100 }], bars: 2 },
  update_layer: { name: "Kick", steps: [{ step: 0, velocity: 120 }], bars: 1 },
  replace_sound: { name: "Kick", samplePath: "/out/y.wav", role: "kick" },
  remove_layer: { name: "Rim" },
  show_live: {}, play: {}, stop: {},
};
for (const t of tools) {
  const input = t.parse(sample[t.name]);               // zod validation (what the runner does)
  const before = events.length;
  const out = await t.run(input);
  assert.equal(typeof out, "string", `${t.name} returns a string`);
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true, `${t.name} ok: ${out}`);
  const mine = events.slice(before);
  assert.equal(mine[0]?.type, "tool"); assert.equal(mine.at(-1)?.type, "tool_done"); assert.equal(mine.at(-1).ok, true);
}
// specific shapes
const an = JSON.parse(await tools.find((t) => t.name === "analyze_recording").run({ which: "beat" }));
assert.deepEqual(an.firstOnsetSeconds, { kick: 0.31, snare: 0.8 }, "first onsets per instrument");
const sy = calls.find((c) => c[0] === "synth")[1];
assert.equal(sy.kind, "drum"); assert.equal(sy.audioPath, "/tmp/fake.wav"); assert.equal(sy.offsetSeconds, 0.31); assert.equal(sy.oneshotSeconds, 1.0);
// tonal default length
await tools.find((t) => t.name === "synthesize_sound").run({ role: "pad", prompt: "warm pad, single sustained note, no drums", source: "text" });
assert.equal(calls.filter((c) => c[0] === "synth").at(-1)[1].oneshotSeconds, 2.5);

// failures become ok:false strings, never throws
ctx.live.setTempo = async () => { throw new Error("Live not reachable"); };
const bad = JSON.parse(await tools[0].run({ bpm: 100 }));
assert.equal(bad.ok, false); assert.match(bad.error, /not reachable/);
assert.equal(events.at(-1).type, "tool_done"); assert.equal(events.at(-1).ok, false);
// missing recording
const miss = JSON.parse(await makeTools(ctx, {})[2].run({ which: "hum" }));
assert.equal(miss.ok, false); assert.match(miss.error, /no hum recording/);

// schema rejections
const bdl = tools.find((t) => t.name === "build_drum_layer");
assert.throws(() => bdl.parse({ ...sample.build_drum_layer, steps: [{ step: 0, velocity: 200 }] }), /velocity|200|<=127|Too big/i, "velocity 200 rejected");
assert.throws(() => tools.find((t) => t.name === "synthesize_sound").parse({ role: "guitar", prompt: "x" }), "unknown role rejected");
assert.throws(() => tools.find((t) => t.name === "set_tempo").parse({ bpm: 10 }), "bpm 10 rejected");

// runProducer: fake client whose toolRunner yields one message and exposes params.messages like the SDK
const fakeClient = { beta: { messages: { toolRunner(params) {
  const msg = { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Kick and Snare are in Live at 126." }] };
  const runner = { params, pushMessages() {}, async *[Symbol.asyncIterator]() { params.messages.push({ role: "assistant", content: msg.content }); yield msg; } };
  return runner;
} } } };
const r = await runProducer({ history: [], userText: "make a techno beat", recordings: { beat: "/tmp/fake.wav" }, ctx, client: fakeClient });
assert.equal(r.text, "Kick and Snare are in Live at 126.");
assert.equal(r.history.length, 2); assert.equal(r.history[0].role, "user"); assert.match(r.history[0].content, /BEATBOX/);
assert.equal(r.stopReason, "end_turn");
console.log(`tools: ${tools.length} · events: ${events.length} · calls: ${calls.length}`);
console.log("ALL PASS");
