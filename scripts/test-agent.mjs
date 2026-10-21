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
  slice: async (p, o) => { calls.push(["slice", p, o]); return { path: `/out/${o.name}.wav`, name: `${o.name}.wav`, url: `/out/${o.name}.wav`, durationSeconds: o.lengthSeconds }; },
  chop: async (p, o) => { calls.push(["chop", p, o]); return { pieces: [{ index: 0, startSeconds: 0.1, lengthSeconds: 0.3, loudnessDb: -6, kind: "tonal", samplePath: "/out/piece-0.wav" }, { index: 1, startSeconds: 0.9, lengthSeconds: 0.25, loudnessDb: -8, kind: "snare", samplePath: "/out/piece-1.wav" }], bpm: 120 }; },
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
    loadDevice: async (i) => { calls.push(["loadDevice", i]); return { device: { index: 1, name: i.device, class_name: i.device.replace(/ /g, "") }, params: i.device === "Reverb"
      ? [{ index: 0, name: "Device On", value: 1, min: 0, max: 1, quantized: true, display: "On" }, { index: 1, name: "Decay Time", value: 1200, min: 200, max: 60000, quantized: false, display: "1.20 s" }, { index: 2, name: "Dry/Wet", value: 0.3, min: 0, max: 1, quantized: false, display: "30 %" }]
      : [{ index: 0, name: "Device On", value: 1, min: 0, max: 1, quantized: true, display: "On" }, { index: 1, name: "Drive", value: 0, min: -36, max: 36, quantized: false, display: "0.0 dB" }, { index: 2, name: "Dry/Wet", value: 1, min: 0, max: 1, quantized: false, display: "100 %" }] }; },
    setParam: async (i) => { calls.push(["setParam", i]); return { param: { name: i.param, value: i.value, min: -36, max: 36, display: `${i.value}` } }; },
    listDevices: async (t) => { calls.push(["listDevices", t]); return [{ index: 0, name: "Simpler", params: [{ name: "Volume", value: -12 }] }]; },
    setMixer: async (i) => { calls.push(["setMixer", i]); return { volume: i.volume ?? 0.85 }; },
    createScene: async (i) => { calls.push(["createScene", i]); return { index: i.index ?? 1, name: i.name }; },
    fireScene: async (i) => { calls.push(["fireScene", i]); return { fired: true }; },
    recordArrangement: async (i) => { calls.push(["recordArrangement", i]); return { recordedBars: i.bars, stopped: true }; },
    show: async () => ({ view: "Session" }),
    play: async () => ({ playing: true }),
    stop: async () => ({ playing: false }),
  },
};

const tools = makeTools(ctx, { beat: "/tmp/fake.wav", refs: [{ name: "loop.wav", path: "/tmp/ref1.wav" }, { name: "kick.wav", path: "/tmp/ref2.wav" }] });
const expected = ["set_tempo", "list_tracks", "analyze_recording", "write_drum_pattern", "write_melody", "synthesize_sound", "build_drum_layer", "build_melody_layer", "update_layer", "replace_sound", "remove_layer", "listen", "transcribe_audio", "judge_sound", "slice_sample", "chop_sample", "add_effect", "set_param", "list_devices", "set_mixer", "create_scene", "fire_scene", "record_arrangement", "show_live", "play", "stop"];
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
  slice_sample: { which: "ref#1", startSeconds: 1.2, lengthSeconds: 0.4, name: "vox-ah" },
  chop_sample: { which: "ref#1", maxPieces: 8 },
  add_effect: { track: "Kick", device: "Saturator", params: [{ name: "Drive", value: 18 }, { name: "Dry/Wet", value: 100 }] },
  set_param: { track: "Kick", device: "Saturator", param: "Drive", value: 12 },
  list_devices: { track: "Kick" },
  set_mixer: { track: "Bass", volume: 0.75, pan: -0.1 },
  create_scene: { name: "Drop", index: 1 },
  fire_scene: { index: 1 },
  record_arrangement: { bars: 16 },
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
assert.match(h[0].content, /ref#1 "loop.wav" \(from an earlier turn; path: \/tmp\/ref1.wav\)/); assert.match(h[0].content, /earlier files are still usable/);
assert.ok(PRODUCER_SYSTEM.includes("REFERENCE FILES") && PRODUCER_SYSTEM.includes("ref#N"));

// v4 tools: shapes, bounds, failure paths
const T = (n) => tools.find((t) => t.name === n);
const sl = JSON.parse(await T("slice_sample").run(sample.slice_sample));
assert.equal(sl.samplePath, "/out/vox-ah.wav"); assert.equal(calls.filter((c) => c[0] === "slice").at(-1)[1], "/tmp/ref1.wav");
assert.throws(() => T("slice_sample").parse({ ...sample.slice_sample, lengthSeconds: 5 }), "slice length 5 rejected");
assert.throws(() => T("slice_sample").parse({ ...sample.slice_sample, lengthSeconds: 0.01 }), "slice length 0.01 rejected");
assert.equal(JSON.parse(await T("slice_sample").run({ ...sample.slice_sample, which: "ref#9" })).ok, false, "slice bad ref");
const ch = JSON.parse(await T("chop_sample").run(sample.chop_sample));
assert.equal(ch.pieceCount, 2); assert.equal(ch.pieces[1].kind, "snare"); assert.equal(ch.bpm, 120);
assert.equal(JSON.parse(await T("chop_sample").run({ which: "hum" })).ok, false, "chop with no hum attached -> ok:false");
const fx = JSON.parse(await T("add_effect").run(sample.add_effect));
assert.equal(fx.device, "Saturator"); assert.equal(fx.deviceIndex, 1); assert.equal(fx.set.length, 2); assert.ok(fx.set.every((p) => p.ok));
assert.equal(fx.set[0].value, 18, "Drive 18 within -36..36 untouched");
assert.equal(fx.set[1].value, 1, "Dry/Wet 100 clamped to max 1"); assert.match(fx.set[1].note, /clamped/);
assert.equal(fx.deviceParams.length, 3); assert.deepEqual(Object.keys(fx.deviceParams[1]).sort(), ["display", "max", "min", "name"]);
assert.deepEqual(calls.filter((c) => c[0] === "setParam").slice(-2).map((c) => c[1].param), ["Drive", "Dry/Wet"]);
// case-insensitive match + seconds -> ms conversion
const fxr = JSON.parse(await T("add_effect").run({ track: "Pad", device: "Reverb", params: [{ name: "decay time", value: 1.5 }, { name: "Dry/Wet", value: 0.25 }] }));
assert.equal(fxr.set[0].name, "Decay Time"); assert.equal(fxr.set[0].value, 1500); assert.match(fxr.set[0].note, /s -> ms/);
assert.equal(fxr.set[1].value, 0.25);
ctx.live.setParam = async (i) => { if (i.param === "Nope") throw new Error("unknown parameter 'Nope' on Reverb; available: Device On, Decay Time, Dry/Wet"); return { param: { name: i.param, value: i.value, min: 0, max: 1, display: `${i.value}` } }; };
const fx2 = JSON.parse(await T("add_effect").run({ track: "Kick", device: "Reverb", params: [{ name: "Nope", value: 1 }, { name: "Dry/Wet", value: 0.2 }] }));
assert.equal(fx2.ok, true); assert.equal(fx2.set[0].ok, false); assert.match(fx2.set[0].error, /available: Device On, Decay Time/, "Live's error passes through verbatim"); assert.equal(fx2.set[1].ok, true, "one bad param does not fail the effect");
ctx.live.loadDevice = async () => { throw new Error("device 'Foo' not found in Live browser"); };
assert.equal(JSON.parse(await T("add_effect").run({ track: "Kick", device: "Foo" })).ok, false, "missing device -> ok:false");
assert.throws(() => T("add_effect").parse({ track: "Kick", device: "Reverb", params: Array(13).fill({ name: "x", value: 1 }) }), "max 12 params");
const sp = JSON.parse(await T("set_param").run(sample.set_param)); assert.equal(sp.param.value, 12); assert.equal(sp.param.display, "12"); assert.equal(sp.param.min, 0);
const ld = JSON.parse(await T("list_devices").run({ track: "Kick" })); assert.equal(ld.devices[0].name, "Simpler");
const mx = JSON.parse(await T("set_mixer").run(sample.set_mixer)); assert.equal(mx.volume, 0.75);
assert.throws(() => T("set_mixer").parse({ track: "Bass", volume: 1.5 }), "volume 1.5 rejected");
assert.throws(() => T("set_mixer").parse({ track: "Bass", pan: 2 }), "pan 2 rejected");
assert.equal(JSON.parse(await T("set_mixer").run({ track: "Bass" })).ok, false, "mixer with nothing to set -> ok:false");
assert.throws(() => T("build_drum_layer").parse({ ...sample.build_drum_layer, slot: 8 }), "slot 8 rejected");
assert.equal(T("build_drum_layer").parse({ ...sample.build_drum_layer, slot: 1 }).slot, 1);
await T("build_melody_layer").run(T("build_melody_layer").parse({ ...sample.build_melody_layer, slot: 1 }));
assert.equal(calls.filter((c) => c[0] === "buildMelody").at(-1)[1].slot, 1, "slot forwarded to buildMelody");
await T("update_layer").run(T("update_layer").parse({ ...sample.update_layer, slot: 1 }));
assert.equal(calls.filter((c) => c[0] === "updateLayer").at(-1)[1].slot, 1, "slot forwarded to updateLayer");
const sc = JSON.parse(await T("create_scene").run(sample.create_scene)); assert.equal(sc.name, "Drop"); assert.equal(sc.index, 1);
assert.equal(JSON.parse(await T("fire_scene").run({ index: 1 })).fired, true);
assert.throws(() => T("fire_scene").parse({ index: 9 }), "scene 9 rejected");
const ra = JSON.parse(await T("record_arrangement").run({ bars: 16 })); assert.equal(ra.recordedBars, 16);
assert.throws(() => T("record_arrangement").parse({ bars: 0 }), "0 bars rejected");
ctx.live.recordArrangement = async () => { throw new Error("transport not running"); };
assert.equal(JSON.parse(await T("record_arrangement").run({ bars: 4 })).ok, false);
assert.ok(PRODUCER_SYSTEM.includes("Saturator") && PRODUCER_SYSTEM.includes("Vox Chop") && PRODUCER_SYSTEM.includes("slot 1") && PRODUCER_SYSTEM.includes("record_arrangement") && PRODUCER_SYSTEM.includes("0.85 ~ 0 dB"), "system prompt covers v4 recipes");

// persistent attachments: note lists all, marks new vs earlier
const fc = { beta: { messages: { toolRunner(params) { return { params, pushMessages() {}, async *[Symbol.asyncIterator]() { yield { role: "assistant", stop_reason: "end_turn", content: [] }; } }; } } } };
const h2 = (await runProducer({ history: [], userText: "use that loop again", recordings: { beat: "/tmp/beat.wav", refs: [{ name: "loop.wav", path: "/tmp/ref1.wav" }, { name: "vox.wav", path: "/tmp/ref2.wav" }], attachedThisTurn: ["ref#2"] }, ctx, client: fc })).history;
assert.match(h2[0].content, /'beat' = BEATBOX recording \(from an earlier turn; path: \/tmp\/beat.wav\)/);
assert.match(h2[0].content, /ref#1 "loop.wav" \(from an earlier turn; path: \/tmp\/ref1.wav\)/);
assert.match(h2[0].content, /ref#2 "vox.wav" \(NEW this turn; path: \/tmp\/ref2.wav\)/);
assert.match(h2[0].content, /Attached this turn: ref#2/);
const h3 = (await runProducer({ history: [], userText: "faster", recordings: { refs: [{ name: "loop.wav", path: "/tmp/ref1.wav" }], attachedThisTurn: [] }, ctx, client: fc })).history;
assert.match(h3[0].content, /Nothing new was attached/);
const h4 = (await runProducer({ history: [], userText: "hi", recordings: {}, ctx, client: fc })).history;
assert.equal(h4[0].content, "hi", "no attachments -> plain text");

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
assert.equal(r.history.length, 2); assert.equal(r.history[0].role, "user"); assert.match(r.history[0].content, /BEATBOX recording \(from an earlier turn/);
assert.equal(r.stopReason, "end_turn");
console.log(`tools: ${tools.length} · events: ${events.length} · calls: ${calls.length}`);
console.log("ALL PASS");
