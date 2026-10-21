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
  listen: async (p, q) => { calls.push(["listen", p, q]); return { text: "a dry, clicky kick with a short sub tail; dark and driving" }; },
  judge: async (p, intent) => { calls.push(["judge", p, intent]); return { text: "tight and clicky but the sub tail is too short", match: 6 }; },
  transcribe: async (p, o) => { calls.push(["transcribe", p, o]); return { notes: Array.from({ length: 12 }, (_, i) => ({ pitch: 60 + (i % 5), startBeats: i * 0.5, durationBeats: 0.5, velocity: 90 })), bars: 2, bpm: 118, tracks: [{ name: "piano", noteCount: 12 }], summary: "12 notes, piano", midiPath: "/tmp/t.mid", ms: 1234 }; },
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

const tools = makeTools(ctx, { beat: "/tmp/fake.wav", refs: [{ name: "loop.wav", path: "/tmp/ref1.wav" }, { name: "kick.wav", path: "/tmp/ref2.wav" }] });
const expected = ["set_tempo", "list_tracks", "analyze_recording", "write_drum_pattern", "write_melody", "synthesize_sound", "build_drum_layer", "build_melody_layer", "update_layer", "replace_sound", "remove_layer", "listen", "transcribe_audio", "judge_sound", "show_live", "play", "stop"];
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
  listen: { path: "/tmp/fake.wav", question: "what kind of kick is this?" },
  transcribe_audio: { which: "ref#1", instruments: ["acoustic_piano"] },
  judge_sound: { path: "/out/x.wav", intent: "tight clicky techno kick with a short sub tail" },
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

// ears: shapes, and failure paths
const li = JSON.parse(await tools.find((t) => t.name === "listen").run({ path: "/tmp/fake.wav" }));
assert.match(li.heard, /clicky kick/);
const ju = JSON.parse(await tools.find((t) => t.name === "judge_sound").run(sample.judge_sound));
assert.equal(ju.match, 6); assert.match(ju.critique, /sub tail/);
ctx.judge = async () => ({ text: "could not rate", match: null });
assert.equal(JSON.parse(await tools.find((t) => t.name === "judge_sound").run(sample.judge_sound)).match, null, "null match preserved");
ctx.listen = async () => { throw new Error("Music Flamingo timed out after 40 s"); };
const lf = JSON.parse(await tools.find((t) => t.name === "listen").run({ path: "/tmp/fake.wav" }));
assert.equal(lf.ok, false); assert.match(lf.error, /timed out/); assert.equal(events.at(-1).ok, false);
assert.ok(PRODUCER_SYSTEM.includes("judge_sound") && PRODUCER_SYSTEM.includes("at most 3"), "system prompt covers ears + cap");
// transcribe_audio: ok path (ref), summary truncation keeps full count, bad ref -> ok:false, schema bounds
const tr = tools.find((t) => t.name === "transcribe_audio");
const trOk = JSON.parse(await tr.run(tr.parse({ which: "ref#1", instruments: ["acoustic_piano"] })));
assert.equal(trOk.ok, true); assert.equal(trOk.noteCount, 12); assert.equal(trOk.bars, 2); assert.equal(trOk.bpm, 118);
assert.ok(trOk.notes.length <= 7 && String(trOk.notes.at(-1)).includes("more"), "notes truncated in summary");
assert.deepEqual(calls.filter((c) => c[0] === "transcribe").at(-1).slice(1), ["/tmp/ref1.wav", { instruments: ["acoustic_piano"] }], "ref path + instruments forwarded");
const trBad = JSON.parse(await tr.run(tr.parse({ which: "ref#9" })));
assert.equal(trBad.ok, false); assert.match(trBad.error, /no ref#9/);
const trHum = JSON.parse(await tr.run(tr.parse({ which: "hum" })));
assert.equal(trHum.ok, false); assert.match(trHum.error, /no hum recording/);
assert.throws(() => tr.parse({ which: "loop.wav" }), "which must be beat|hum|ref#N");
assert.throws(() => tr.parse({ which: "ref#1", instruments: ["a","b","c","d","e","f","g"] }), "max 6 instrument hints");
assert.ok(PRODUCER_SYSTEM.includes("transcribe_audio"), "system prompt mentions transcribe_audio");
// lengthSeconds bound: 16 ok (long pad), 25 rejected
const ss = tools.find((t) => t.name === "synthesize_sound");
assert.equal(ss.parse({ role: "pad", prompt: "evolving pad, single sustained note, no drums", lengthSeconds: 16 }).lengthSeconds, 16);
assert.throws(() => ss.parse({ role: "pad", prompt: "pad", lengthSeconds: 25 }), "lengthSeconds 25 rejected");
await ss.run(ss.parse({ role: "pad", prompt: "evolving pad, single sustained note, no drums", lengthSeconds: 12 }));
assert.equal(calls.filter((c) => c[0] === "synth").at(-1)[1].oneshotSeconds, 12, "lengthSeconds forwarded");

// reference files
const ar = tools.find((t) => t.name === "analyze_recording");
const rb = JSON.parse(await ar.run(ar.parse({ which: "ref#1", as: "beat" })));
assert.equal(rb.ok, true); assert.equal(calls.filter((c) => c[0] === "beatboxToPattern").at(-1)[1], "/tmp/ref1.wav", "ref analyzed as beat");
const rh = JSON.parse(await ar.run(ar.parse({ which: "ref#2", as: "hum", bpm: 100 })));
assert.equal(rh.ok, true); assert.equal(calls.filter((c) => c[0] === "humToNotes").at(-1)[1], "/tmp/ref2.wav", "ref analyzed as hum");
const rd = JSON.parse(await ar.run(ar.parse({ which: "ref#1" })));   // default as beat
assert.equal(rd.ok, true); assert.ok("firstOnsetSeconds" in rd, "ref default analyzed as beat");
const rbad = JSON.parse(await ar.run(ar.parse({ which: "ref#9", as: "beat" })));
assert.equal(rbad.ok, false); assert.match(rbad.error, /no ref#9 .*2 reference files/);
assert.throws(() => ar.parse({ which: "loop.wav" }), "which must be beat|hum|ref#N");
const ss0 = tools.find((t) => t.name === "synthesize_sound");
const rs = JSON.parse(await ss0.run(ss0.parse({ role: "kick", prompt: "kick like the reference, dry one-shot", source: "ref#1", offsetSeconds: 0.5 })));
assert.equal(rs.ok, true);
const rsc = calls.filter((c) => c[0] === "synth").at(-1)[1];
assert.equal(rsc.audioPath, "/tmp/ref1.wav"); assert.equal(rsc.offsetSeconds, 0.5); assert.equal(rsc.strength, 0.6, "ref strength default 0.6");
assert.equal(JSON.parse(await ss0.run(ss0.parse({ role: "kick", prompt: "x kick, dry one-shot", source: "ref#9" }))).ok, false, "bad ref in synth -> ok:false");
const h = (await runProducer({ history: [], userText: "make it like this", recordings: { refs: [{ name: "loop.wav", path: "/tmp/ref1.wav" }] }, ctx, client: { beta: { messages: { toolRunner(params) { return { params, pushMessages() {}, async *[Symbol.asyncIterator]() { yield { role: "assistant", stop_reason: "end_turn", content: [] }; } }; } } } } })).history;
assert.match(h[0].content, /ref#1 "loop.wav" \(path: \/tmp\/ref1.wav\)/); assert.match(h[0].content, /analyzed, imitated/);
assert.ok(PRODUCER_SYSTEM.includes("REFERENCE FILES") && PRODUCER_SYSTEM.includes("ref#N"));

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
