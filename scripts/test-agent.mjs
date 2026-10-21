// Offline test of lib/agent.js: fake ctx, every tool runs, schemas reject bad input. No API calls.
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { makeTools, runProducer, PRODUCER_SYSTEM, MODEL } from "../lib/agent.js";

assert.ok(Anthropic && betaZodTool, "SDK helpers import");
assert.equal(MODEL, "claude-opus-5-5");
assert.ok(PRODUCER_SYSTEM.includes("dry one-shot") && PRODUCER_SYSTEM.includes("ok:true"), "system prompt has prompt rules + ok rule");

const calls = [], events = []; let refCounter = 2;
const ctx = {
  emit: (e) => events.push(e),
  synth: async (o) => { calls.push(["synth", o]); return { path: "/out/x.wav", name: "x.wav", url: "/out/x.wav", durationSeconds: 1, peakDb: -1 }; },
  writePattern: async (o) => { calls.push(["writePattern", o]); return { pattern: { name: "p", bpm: o.bpm, bars: o.bars, stepsPerBar: 16, swing: 0, lanes: [{ instrument: "kick", steps: [{ step: 0, velocity: 120 }] }] }, source: "rules" }; },
  writeMelody: async (o) => { calls.push(["writeMelody", o]); return { key: o.key, bars: o.bars, notes: [{ pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100 }], source: "rules" }; },
  beatboxToPattern: async (p, o) => { calls.push(["beatboxToPattern", p, o]); return { pattern: { name: "bb", bpm: 120, bars: 1, stepsPerBar: 16, swing: 0, lanes: [] }, onsets: [{ time: 0.31, instrument: "kick" }, { time: 0.8, instrument: "snare" }, { time: 1.3, instrument: "kick" }], bpm: 120 }; },
  humToNotes: async (p, o) => { calls.push(["humToNotes", p, o]); return { notes: [{ pitch: 62, startBeats: 0, durationBeats: 0.5, velocity: 90 }], bars: 1, bpm: o.bpm }; },
  slice: async (p, o) => { calls.push(["slice", p, o]); return { path: `/out/${o.name}.wav`, name: `${o.name}.wav`, url: `/out/${o.name}.wav`, durationSeconds: o.lengthSeconds }; },
  chop: async (p, o) => { calls.push(["chop", p, o]); return { pieces: [{ index: 0, startSeconds: 0.1, lengthSeconds: 0.3, loudnessDb: -6, kind: "tonal", samplePath: "/out/piece-0.wav" }, { index: 1, startSeconds: 0.9, lengthSeconds: 0.25, loudnessDb: -8, kind: "snare", samplePath: "/out/piece-1.wav" }], bpm: 120 }; },
  analyze: async (p) => { calls.push(["analyze", p]); return { durationSeconds: 1.02, sampleRate: 44100, loudness: { integratedLufs: -14.2, loudnessRange: 2, peakDbfs: -1.0, rmsDbfs: -18.3, crestFactorDb: 17.3 }, envelope: { attackMs: 3.1, decayMs: 140, sustainRatio: 0.2 }, spectrum: { centroidHz: 612, rolloff85Hz: 2400, flatness: 0.2, bands: { sub: { db: -3, share: 0.31 }, low: { db: -6, share: 0.4 }, lowMid: { db: -12, share: 0.15 }, mid: { db: -20, share: 0.08 }, high: { db: -28, share: 0.04 }, air: { db: -40, share: 0.02 } } }, pitch: null, rhythm: null, stereo: null, ratings: { loudness: { level: "medium", value: -14.2, unit: "LUFS" }, punch: { level: "high", value: 17.3, unit: "dB crest" }, subWeight: { level: "medium", value: 0.31, unit: "share" }, brightness: { level: "low", value: 612, unit: "Hz" } }, summary: "1.0 s one-shot, centroid 612 Hz, crest 17 dB, decay 140 ms." }; },
  compare: async (a, b) => { calls.push(["compare", a, b]); return { deltas: { punch: -2.1, subWeight: 0.12, brightness: 300 }, text: "reference has 6 dB more sub-band energy; produced kick decays 120 ms faster" }; },
  render: async (o) => { calls.push(["render", o]); return { path: "/out/preview.wav", url: "/out/preview.wav", durationSeconds: 3.8, profile: { durationSeconds: 1.02, sampleRate: 44100, loudness: { integratedLufs: -14.2, loudnessRange: 2, peakDbfs: -1.0, rmsDbfs: -18.3, crestFactorDb: 17.3 }, envelope: { attackMs: 3.1, decayMs: 140, sustainRatio: 0.2 }, spectrum: { centroidHz: 612, rolloff85Hz: 2400, flatness: 0.2, bands: { sub: { db: -3, share: 0.31 }, low: { db: -6, share: 0.4 }, lowMid: { db: -12, share: 0.15 }, mid: { db: -20, share: 0.08 }, high: { db: -28, share: 0.04 }, air: { db: -40, share: 0.02 } } }, pitch: null, rhythm: null, stereo: null, ratings: { loudness: { level: "medium", value: -14.2, unit: "LUFS" }, punch: { level: "high", value: 17.3, unit: "dB crest" }, subWeight: { level: "medium", value: 0.31, unit: "share" }, brightness: { level: "low", value: 612, unit: "Hz" } }, summary: "1.0 s one-shot, centroid 612 Hz, crest 17 dB, decay 140 ms." } }; },
  layerSamples: async (o) => { calls.push(["layerSamples", o]); return { path: `/out/${o.name}.wav`, url: `/out/${o.name}.wav`, durationSeconds: 0.9 }; },
  tuneSample: async (o) => { calls.push(["tuneSample", o]); return { path: `/out/${o.name}.wav`, url: `/out/${o.name}.wav`, detectedMidi: 36, appliedSemitones: o.semitones ?? 5 }; },
  shapeSample: async (o) => { calls.push(["shapeSample", o]); return { path: `/out/${o.name}.wav`, url: `/out/${o.name}.wav`, durationSeconds: (o.lengthMs || 500) / 1000 }; },
  reviewMix: async () => { calls.push(["reviewMix"]); return { path: "/out/preview.wav", whole: { loudness: { integratedLufs: -11.2, peakDbfs: -0.9, rmsDbfs: -14, crestFactorDb: 9.1 }, ratings: { loudness: { level: "high", value: -11.2, unit: "LUFS" }, punch: { level: "low", value: 9.1, unit: "dB crest" } }, summary: "whole mix crest 9 dB" }, perLayer: { Kick: { ratings: { subWeight: { level: "high", value: 0.4, unit: "share" } } }, Bass: { ratings: { subWeight: { level: "high", value: 0.38, unit: "share" } } }, Hats: { ratings: { loudness: { level: "high", value: -9, unit: "LUFS" } } } }, issues: [{ severity: "high", text: "Kick and Bass both high sub share (0.40 / 0.38): masking below 80 Hz", fix: "add_effect Bass EQ Eight highpass 60 Hz" }, { severity: "medium", text: "Hats 4 dB above Snare", fix: "set_mixer Hats volume 0.6" }] }; },
  stems: async (p) => { calls.push(["stems", p]); return { stems: { drums: "/out/stems/drums.wav", bass: "/out/stems/bass.wav", other: "/out/stems/other.wav", vocals: "/out/stems/vocals.wav" } }; },
  addRef: async (name, path) => { calls.push(["addRef", name, path]); refCounter += 1; return { index: refCounter, name }; },
  analyzeMusic: async (p) => { calls.push(["analyzeMusic", p]); return { tempo: 93.2, beats: Array(60).fill(0), downbeats: Array(15).fill(0), key: { tonic: "F", mode: "minor", confidence: 0.81 }, onsets: Array(120).fill(0), groove: { swing: 0.22, microtiming: Array.from({ length: 16 }, (_, i) => (i % 2 ? 11.3 : -1.2)), velocityProfile: Array.from({ length: 16 }, (_, i) => (i % 4 ? 0.7 : 1)) }, sections: [{ start: 0, end: 15.5 }, { start: 15.5, end: 31 }], duration: 31 }; },
  setGroove: async (g) => { calls.push(["setGroove", g]); },
  transcribeLocal: async (p, o) => { calls.push(["transcribeLocal", p, o]); return { notes: [{ pitch: 53, startBeats: 0, durationBeats: 1, velocity: 100 }], bars: 1, bpm: 93 }; },
  processAudio: async (p, chain, name) => { calls.push(["processAudio", p, chain, name]); return { path: `/out/${name}.wav`, url: `/out/${name}.wav`, peakDbfs: -1.02 }; },
  masterAudio: async (lufs) => { calls.push(["masterAudio", lufs]); return { path: "/out/master.wav", url: "/out/master.wav", lufs: lufs + 0.1, peakDbfs: -1 }; },
  generateLoop: async (o) => { calls.push(["generateLoop", o]); return { loop: { path: "/out/loop.wav", url: "/out/loop.wav" }, kit: o.kind === "drums" ? [{ kind: "kick", path: "/out/k.wav", time: 0.012 }, { kind: "snare", path: "/out/s.wav", time: 0.655 }, { kind: "hat_closed", path: "/out/h.wav", time: 0.33 }] : [] }; },
  restyleMix: async (o) => { calls.push(["restyleMix", o]); return { path: "/out/restyle.wav", url: "/out/restyle.wav", durationSeconds: 7.7 }; },
  productionDna: async (p) => { calls.push(["productionDna", p]); return { drums: { kick: "round dusty kick, soft attack", snare: "cracked layered snare", hats: "crisp swung hats" }, groove: "lazy, behind the beat", space: "short plate on snare", tempo: 93, key: "F minor", arrangement: "8-bar loops, drop at bar 17", expensive: ["kick and bass share a sub lane", "hats panned wide", "vocal chops tuned"] }; },
  critiqueMix: async (ref) => { calls.push(["critiqueMix", ref]); return { groove: "straight vs reference swing 0.22", lowEnd: "kick/bass masking 60-90 Hz", topFixes: [{ what: "bass highpass", how: "add_effect Bass EQ Eight highpass 60 Hz" }] }; },
  labelPieces: async (paths) => { calls.push(["labelPieces", paths]); return paths.map((p, i) => ({ path: p, label: i % 2 ? "consonant" : "vowel", pitchedness: i % 2 ? 0.2 : 0.9, usableAs: i % 2 ? "perc" : "chop" })); },
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
    setSend: async (i) => { calls.push(["setSend", i]); return { sends: [{ index: 0, name: "A-Reverb", level: i.send === "A" ? i.level : 0 }, { index: 1, name: "B-Delay", level: i.send === "B" ? i.level : 0 }] }; },
    browse: async (i) => { calls.push(["browse", i]); return { root: i.root, items: [{ name: "Bass-Sub Operator", is_folder: false, path: ["Sounds", "Bass"] }, { name: "Bass", is_folder: true, path: ["Sounds"] }] }; },
    mixBalance: async (i) => { calls.push(["mixBalance", i]); return { applied: [{ track: "Kick", volume: 0.85, pan: 0 }, { track: "Hats", volume: 0.62, pan: 0.18 }], overrides: i.overrides?.length || 0 }; },
    setTrackColor: async (i) => { calls.push(["setTrackColor", i]); return { color: i.colorIndex }; },
    captureMidi: async () => { calls.push(["captureMidi"]); return { captured: true, track: "Keys" }; },
    show: async () => ({ view: "Session" }),
    play: async () => ({ playing: true }),
    stop: async () => ({ playing: false }),
  },
};

const tools = makeTools(ctx, { beat: "/tmp/fake.wav", refs: [{ name: "loop.wav", path: "/tmp/ref1.wav" }, { name: "kick.wav", path: "/tmp/ref2.wav" }] });
const expected = ["set_tempo", "list_tracks", "analyze_recording", "write_drum_pattern", "write_melody", "synthesize_sound", "build_drum_layer", "build_melody_layer", "update_layer", "replace_sound", "remove_layer", "listen", "transcribe_audio", "judge_sound", "slice_sample", "chop_sample", "load_device", "add_effect", "set_param", "list_devices", "set_mixer", "create_scene", "fire_scene", "record_arrangement", "analyze_audio", "compare_audio", "render_preview", "set_track_color", "capture_midi", "layer_samples", "tune_sample", "shape_sample", "set_send", "browse_library", "mix_balance", "review_mix", "separate_stems", "analyze_music", "process_audio", "master_preview", "generate_loop", "restyle_mix", "production_dna", "critique_mix", "label_pieces", "show_live", "play", "stop"];
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
  load_device: { track: "Drums", device: "909 Core Kit.adg" },
  add_effect: { track: "Kick", device: "Saturator", params: [{ name: "Drive", value: 18 }, { name: "Dry/Wet", value: 100 }] },
  set_param: { track: "Kick", device: "Saturator", param: "Drive", value: 12 },
  list_devices: { track: "Kick" },
  set_mixer: { track: "Bass", volume: 0.75, pan: -0.1 },
  create_scene: { name: "Drop", index: 1 },
  fire_scene: { index: 1 },
  record_arrangement: { bars: 16 },
  analyze_audio: { which: "ref#1" },
  compare_audio: { a: "ref#1", b: "/out/x.wav" },
  render_preview: { bars: 2 },
  set_track_color: { track: "Kick", colorIndex: 2 },
  capture_midi: {},
  layer_samples: { layers: [{ path: "/out/sub.wav", lowpassHz: 120 }, { path: "/out/click.wav", gainDb: -3, highpassHz: 150 }], name: "kick-layered" },
  tune_sample: { path: "/out/sub.wav", targetNote: "F1", name: "sub-F1" },
  shape_sample: { path: "/out/snare.wav", lengthMs: 350, fadeOutMs: 80, name: "snare-350" },
  set_send: { track: "Snare", send: "A", level: 0.25 },
  browse_library: { root: "sounds", query: "Bass" },
  mix_balance: { overrides: [{ track: "Hats", volume: 0.6 }] },
  review_mix: {},
  separate_stems: { which: "ref#1" },
  analyze_music: { which: "ref#1" },
  process_audio: { which: "/out/vox.wav", chain: [{ type: "highpass", hz: 150 }, { type: "compressor", threshold_db: -18, ratio: 4, attack_ms: 5, release_ms: 80 }], name: "vox-proc" },
  master_preview: { lufs: -12 },
  generate_loop: { prompt: "dusty boom bap drum loop, round kick, cracked snare", bpm: 93, bars: 2, kind: "drums" },
  restyle_mix: { prompt: "warm tape-saturated boom bap", strength: 0.45 },
  production_dna: { which: "ref#1" },
  critique_mix: { reference: "ref#1" },
  label_pieces: { paths: ["/out/p0.wav", "/out/p1.wav"] },
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
const savedLocal = ctx.transcribeLocal; ctx.transcribeLocal = undefined;   // this block tests the MuScriptor path
const trOk = JSON.parse(await tr.run(tr.parse({ which: "ref#1", instruments: ["acoustic_piano"] })));
assert.equal(trOk.engine, "muscriptor");
assert.equal(trOk.ok, true); assert.equal(trOk.noteCount, 12); assert.equal(trOk.bars, 2); assert.equal(trOk.bpm, 118);
assert.equal(trOk.notes.split(" ").length, 12, "all 12 notes present as compact strings"); assert.match(trOk.notes, /^\d+@[\d.]+:[\d.]+/); assert.equal(trOk.format, "pitch@startBeats:durationBeats[vVelocity]");
assert.deepEqual(calls.filter((c) => c[0] === "transcribe").at(-1).slice(1), ["/tmp/ref1.wav", { instruments: ["acoustic_piano"] }], "ref path + instruments forwarded");
const trBad = JSON.parse(await tr.run(tr.parse({ which: "ref#9" })));
assert.equal(trBad.ok, false); assert.match(trBad.error, /no ref#9/);
const trHum = JSON.parse(await tr.run(tr.parse({ which: "hum" })));
assert.equal(trHum.ok, false); assert.match(trHum.error, /no hum recording/);
assert.throws(() => tr.parse({ which: "loop.wav" }), "which must be beat|hum|ref#N");
ctx.transcribeLocal = savedLocal;
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
assert.equal(rbad.ok, false); assert.match(rbad.error, /no ref#9 .*\d+ reference files/);
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

// v5: analysis, compare, render, color, capture
const an1 = JSON.parse(await T("analyze_audio").run({ which: "ref#1" }));
assert.equal(calls.filter((c) => c[0] === "analyze").at(-1)[1], "/tmp/ref1.wav");
assert.equal(an1.ratings.punch, "high (17.3 dB crest)"); assert.equal(an1.loudness.crestFactorDb, 17.3); assert.equal(an1.spectrum.bandShares.sub, 0.3); assert.equal(an1.envelope.decayMs, 140); assert.match(an1.summary, /crest 17 dB/);
assert.equal(an1.pitch, null); assert.ok(!("sampleRate" in an1) && !("rolloff85Hz" in (an1.spectrum || {})), "profile compacted");
const an2 = JSON.parse(await T("analyze_audio").run({ which: "/out/x.wav" }));
assert.equal(calls.filter((c) => c[0] === "analyze").at(-1)[1], "/out/x.wav", "absolute path accepted");
assert.equal(JSON.parse(await T("analyze_audio").run({ which: "ref#9" })).ok, false, "bad ref -> ok:false");
assert.throws(() => T("analyze_audio").parse({ which: "" }), "empty which rejected");
ctx.analyze = async () => { throw new Error("ffmpeg ebur128 failed"); };
assert.equal(JSON.parse(await T("analyze_audio").run({ which: "ref#1" })).ok, false, "analyze failure -> ok:false");
const cmp = JSON.parse(await T("compare_audio").run(sample.compare_audio));
assert.deepEqual(calls.filter((c) => c[0] === "compare").at(-1).slice(1), ["/tmp/ref1.wav", "/out/x.wav"]);
assert.equal(cmp.deltas.subWeight, 0.12); assert.match(cmp.text, /6 dB more sub-band/);
assert.equal(JSON.parse(await T("compare_audio").run({ a: "hum", b: "ref#1" })).ok, false, "compare with missing hum -> ok:false");
const rp = JSON.parse(await T("render_preview").run({ bars: 2 }));
assert.equal(calls.filter((c) => c[0] === "render").at(-1)[1].bars, 2);
assert.equal(rp.path, "/out/preview.wav"); assert.equal(rp.noLiveEffects, true); assert.equal(rp.profile.ratings.punch, "high (17.3 dB crest)"); assert.equal(rp.durationSeconds, 3.8);
assert.throws(() => T("render_preview").parse({ bars: 17 }), "bars 17 rejected");
ctx.render = async () => { throw new Error("nothing built yet"); };
assert.equal(JSON.parse(await T("render_preview").run({})).ok, false, "render failure -> ok:false");
const col = JSON.parse(await T("set_track_color").run(sample.set_track_color)); assert.equal(col.color, 2);
assert.throws(() => T("set_track_color").parse({ track: "Kick", colorIndex: 70 }), "colorIndex 70 rejected");
assert.throws(() => T("set_track_color").parse({ track: "Kick", colorIndex: 2.5 }), "non-integer color rejected");
ctx.live.setTrackColor = async () => { throw new Error("unknown cmd: u'set_track_color'"); };
assert.equal(JSON.parse(await T("set_track_color").run(sample.set_track_color)).ok, false, "color failure passes through as ok:false");
const cap = JSON.parse(await T("capture_midi").run({})); assert.equal(cap.captured, true); assert.equal(cap.track, "Keys");
ctx.live.captureMidi = async () => { throw new Error("no MIDI played recently"); };
assert.equal(JSON.parse(await T("capture_midi").run({})).ok, false);
for (const k of ["DENSITY", "[density: minimal]", "[density: rich]", "FEEDBACK", "never with judgments", "render_preview", "compare_audio", "ARRANGEMENT", "loop length x 2", "COLOR", "set_track_color"]) assert.ok(PRODUCER_SYSTEM.includes(k), `system prompt has ${k}`);

// v6: sound design, sends, browsing, balance, review
const ls = JSON.parse(await T("layer_samples").run(sample.layer_samples));
assert.equal(ls.samplePath, "/out/kick-layered.wav"); assert.equal(ls.layers, 2);
assert.equal(calls.filter((c) => c[0] === "layerSamples").at(-1)[1].layers[1].highpassHz, 150);
assert.throws(() => T("layer_samples").parse({ layers: [{ path: "/out/a.wav" }], name: "x" }), "1 layer rejected");
assert.throws(() => T("layer_samples").parse({ layers: Array(5).fill({ path: "/out/a.wav" }), name: "x" }), "5 layers rejected");
assert.throws(() => T("layer_samples").parse({ ...sample.layer_samples, layers: [{ path: "/out/a.wav", gainDb: 20 }, { path: "/out/b.wav" }] }), "gainDb 20 rejected");
ctx.layerSamples = async () => { throw new Error("ffmpeg amix failed"); };
assert.equal(JSON.parse(await T("layer_samples").run(sample.layer_samples)).ok, false);
const tu = JSON.parse(await T("tune_sample").run(sample.tune_sample));
assert.equal(tu.samplePath, "/out/sub-F1.wav"); assert.equal(tu.detectedMidi, 36); assert.equal(tu.appliedSemitones, 5);
assert.equal(JSON.parse(await T("tune_sample").run({ path: "/out/sub.wav", semitones: -2, name: "s" })).appliedSemitones, -2);
assert.throws(() => T("tune_sample").parse({ path: "/out/sub.wav", targetNote: "H2", name: "x" }), "bad note rejected");
assert.throws(() => T("tune_sample").parse({ path: "/out/sub.wav", semitones: 30, name: "x" }), "30 st rejected");
assert.equal(JSON.parse(await T("tune_sample").run({ path: "/out/sub.wav", name: "x" })).ok, false, "neither semitones nor targetNote -> ok:false");
ctx.tuneSample = async () => { throw new Error("no pitch detected"); };
assert.equal(JSON.parse(await T("tune_sample").run(sample.tune_sample)).ok, false);
const sh = JSON.parse(await T("shape_sample").run(sample.shape_sample));
assert.equal(sh.samplePath, "/out/snare-350.wav"); assert.equal(sh.durationSeconds, 0.35);
assert.equal(JSON.parse(await T("shape_sample").run({ path: "/out/a.wav", name: "x" })).ok, false, "no ops -> ok:false");
assert.throws(() => T("shape_sample").parse({ path: "/out/a.wav", lengthMs: 5, name: "x" }), "lengthMs 5 rejected");
ctx.shapeSample = async () => { throw new Error("ffmpeg failed"); };
assert.equal(JSON.parse(await T("shape_sample").run(sample.shape_sample)).ok, false);
const sd = JSON.parse(await T("set_send").run(sample.set_send));
assert.equal(sd.sends[0].level, 0.25); assert.equal(sd.send, "A");
assert.throws(() => T("set_send").parse({ track: "Snare", send: "C", level: 0.2 }), "send C rejected");
assert.throws(() => T("set_send").parse({ track: "Snare", send: "A", level: 1.5 }), "level 1.5 rejected");
ctx.live.setSend = async () => { throw new Error("unknown cmd: u'set_send'"); };
assert.equal(JSON.parse(await T("set_send").run(sample.set_send)).ok, false);
const br = JSON.parse(await T("browse_library").run(sample.browse_library));
assert.equal(br.count, 2); assert.equal(br.items[0].name, "Bass-Sub Operator"); assert.equal(br.items[0].path, "Sounds/Bass"); assert.equal(br.items[1].folder, true);
assert.throws(() => T("browse_library").parse({ root: "plugins" }), "bad root rejected");
assert.throws(() => T("browse_library").parse({ root: "sounds", depth: 9 }), "depth 9 rejected");
ctx.live.browse = async () => { throw new Error("browser root not available"); };
assert.equal(JSON.parse(await T("browse_library").run(sample.browse_library)).ok, false);
const mb = JSON.parse(await T("mix_balance").run(sample.mix_balance));
assert.equal(mb.template, "drums-default"); assert.equal(mb.applied.length, 2); assert.equal(mb.overrides, 1);
assert.throws(() => T("mix_balance").parse({ template: "loud" }), "bad template rejected");
assert.throws(() => T("mix_balance").parse({ overrides: [{ track: "Hats", volume: 2 }] }), "override volume 2 rejected");
ctx.live.mixBalance = async () => { throw new Error("no tracks built"); };
assert.equal(JSON.parse(await T("mix_balance").run({})).ok, false);
const rv = JSON.parse(await T("review_mix").run({}));
assert.equal(rv.issueCount, 2); assert.equal(rv.high, 1); assert.match(rv.issues[0].fix, /highpass 60 Hz/); assert.equal(rv.perLayer.Kick.subWeight, "high (0.4 share)"); assert.equal(rv.whole.ratings.punch, "low (9.1 dB crest)"); assert.match(rv.whole.summary, /crest 9 dB/);
ctx.reviewMix = async () => { throw new Error("nothing built yet"); };
assert.equal(JSON.parse(await T("review_mix").run({})).ok, false);
// humanize bound + passthrough
assert.throws(() => T("build_drum_layer").parse({ ...sample.build_drum_layer, humanize: 2 }), "humanize 2 rejected");
await T("build_drum_layer").run(T("build_drum_layer").parse({ ...sample.build_drum_layer, humanize: 0.4 }));
assert.equal(calls.filter((c) => c[0] === "buildLane").at(-1)[1].humanize, 0.4, "humanize forwarded");
// reused:true surfaces from loadDevice
ctx.live.loadDevice = async (i) => ({ device: { index: 1, name: i.device, class_name: i.device }, reused: true, params: [{ index: 1, name: "Drive", value: 6, min: -36, max: 36, quantized: false, display: "6 dB" }] });
ctx.live.setParam = async (i) => ({ param: { name: i.param, value: i.value, min: -36, max: 36, display: `${i.value}` } });
const fxr2 = JSON.parse(await T("add_effect").run({ track: "Kick", device: "Saturator", params: [{ name: "Drive", value: 9 }] }));
assert.equal(fxr2.reused, true); assert.equal(fxr2.set[0].value, 9);
// compact notes: 64 cap, format
const many = Array.from({ length: 70 }, (_, i) => ({ pitch: 60 + (i % 12), startBeats: i * 0.25, durationBeats: 0.25, velocity: i % 2 ? 100 : 80 }));
ctx.humToNotes = async () => ({ notes: many, bars: 5, bpm: 120 });
const hn = JSON.parse(await T("analyze_recording").run({ which: "beat", as: "hum" })); // 'beat' which -> mode beat; use hum path instead:
const hn2 = JSON.parse(await makeTools(ctx, { hum: "/tmp/hum.wav" }).find((t) => t.name === "analyze_recording").run({ which: "hum" }));
assert.equal(hn2.noteCount, 70); assert.equal(hn2.truncated, 6); assert.equal(hn2.notes.split(" ").length, 64); assert.match(hn2.notes, /^60@0:0.25v80 61@0.25:0.25 /);
ctx.transcribe = async () => ({ notes: many.slice(0, 10), bars: 1, bpm: 120, tracks: ["acoustic_piano"], summary: "piano" });
const savedLocal2 = ctx.transcribeLocal; ctx.transcribeLocal = undefined;
const tr2 = JSON.parse(await T("transcribe_audio").run({ which: "ref#1" }));
ctx.transcribeLocal = savedLocal2;
assert.equal(tr2.noteCount, 10); assert.equal(tr2.notes.split(" ").length, 10); assert.ok(!("truncated" in tr2));
for (const k of ["PRODUCTION PLAYBOOK", "never copy bar 1", "layer_samples", "tune_sample", "shape_sample", "set_send", "browse_library", "mix_balance", "review_mix", "humanize", "QUALITY GATE", "reused:true", "Review:", "[density: minimal]", "i-VI-III-VII"]) assert.ok(PRODUCER_SYSTEM.includes(k), `system prompt has ${k}`);
assert.ok(!PRODUCER_SYSTEM.includes("EFFECTS AND MIX (add_effect") && !PRODUCER_SYSTEM.includes("VOCAL CHOPS AND SAMPLE PIECES"), "old sections replaced");

// load_device: match/requested/actual name surfaced; failure passthrough
ctx.live.loadDevice = async (i) => ({ requested: i.device, match: i.device === "ping pong" ? "alias" : "exact", device: { index: 0, name: i.device === "ping pong" ? "Delay" : i.device, class_name: "X" }, params: [{ index: 0, name: "Device On", value: 1, min: 0, max: 1, display: "On" }] });
const ldv = JSON.parse(await T("load_device").run(sample.load_device));
assert.equal(ldv.device, "909 Core Kit.adg"); assert.equal(ldv.match, "exact"); assert.equal(ldv.requested, "909 Core Kit.adg"); assert.equal(ldv.params[0].name, "Device On");
const ldp = JSON.parse(await T("load_device").run({ track: "Perc", device: "ping pong" }));
assert.equal(ldp.device, "Delay"); assert.equal(ldp.match, "alias"); assert.equal(ldp.requested, "ping pong");
assert.throws(() => T("load_device").parse({ track: "Perc", device: "x" }), "1-char device rejected");
ctx.live.loadDevice = async () => { throw new Error("device 'Echo' not found; audio effects available: Auto Filter, Delay, Reverb, Saturator ..."); };
const ldf = JSON.parse(await T("load_device").run({ track: "Perc", device: "Echo" }));
assert.equal(ldf.ok, false); assert.match(ldf.error, /available: Auto Filter, Delay/);
const fxf = JSON.parse(await T("add_effect").run({ track: "Perc", device: "Echo", params: [{ name: "Dry/Wet", value: 0.2 }] }));
assert.equal(fxf.ok, false, "add_effect with a missing device -> ok:false");
ctx.live.loadDevice = async (i) => ({ requested: i.device, match: "ci", device: { index: 2, name: "Reverb", class_name: "Reverb" }, params: [{ index: 1, name: "Dry/Wet", value: 0.3, min: 0, max: 1, display: "30 %" }] });
ctx.live.setParam = async (i) => ({ param: { name: i.param, value: i.value, min: 0, max: 1, display: `${i.value}` } });
const fxm = JSON.parse(await T("add_effect").run({ track: "Snare", device: "reverb", params: [{ name: "Dry/Wet", value: 0.2 }] }));
assert.equal(fxm.match, "ci"); assert.equal(fxm.device, "Reverb"); assert.equal(fxm.requested, "reverb");
for (const k of ["LIVE 10 STANDARD ON THIS MACHINE", "NO Ping Pong Delay", "KIT PATH", "909 Core Kit.adg", "kick 36, snare 38, clap 39", "Arpeggiator", "Dynamic Tube", "bitcrusher", '"exact"|"alias"|"ci"|"fuzzy"', "return tracks"]) assert.ok(PRODUCER_SYSTEM.includes(k), `system prompt has ${k}`);
assert.ok(!PRODUCER_SYSTEM.includes("Ping Pong Delay / Echo at"), "no nonexistent device recipe left");

// v7: stems, music analysis, processing, mastering, loops, restyle, Gemini ears
const addRefBefore = calls.filter((c) => c[0] === "addRef").length;
const st = JSON.parse(await T("separate_stems").run({ which: "ref#1" }));
assert.equal(st.stems.length, 4); assert.equal(st.stems[0].stem, "drums"); assert.match(st.stems[0].name, /^drums of loop$/); assert.match(st.stems[0].ref, /^ref#\d+$/);
assert.equal(calls.filter((c) => c[0] === "addRef").length - addRefBefore, 4, "one addRef per stem");
const vocalsRef = st.stems.find((x) => x.stem === "vocals").ref;
// the new ref is addressable by later tools in the same turn
ctx.analyze = async (p) => { calls.push(["analyze", p]); return { durationSeconds: 31, loudness: { integratedLufs: -16 }, ratings: { loudness: { level: "medium", value: -16, unit: "LUFS" } }, summary: "vocal stem" }; };
const an3 = JSON.parse(await T("analyze_audio").run({ which: vocalsRef }));
assert.equal(an3.ok, true); assert.equal(calls.filter((c) => c[0] === "analyze").at(-1)[1], "/out/stems/vocals.wav", "stem ref resolves");
assert.equal(JSON.parse(await T("separate_stems").run({ which: "ref#99" })).ok, false);
ctx.stems = async () => { throw new Error("demucs not installed / run tools/py/setup.sh"); };
const stf = JSON.parse(await T("separate_stems").run({ which: "ref#1" })); assert.equal(stf.ok, false); assert.match(stf.error, /run tools\/py\/setup.sh/, "install message passes through");
const am = JSON.parse(await T("analyze_music").run(sample.analyze_music));
assert.equal(am.tempo, 93.2); assert.equal(am.beats, 60); assert.equal(am.downbeats, 15); assert.equal(am.onsets, 120); assert.equal(am.key, "F minor (conf 0.8)"); assert.equal(am.groove.swing, 0.2); assert.equal(am.groove.microtimingMs.length, 16); assert.equal(am.groove.velocityProfile[0], 1); assert.deepEqual(am.sections, ["0-15.5s", "15.5-31s"]); assert.equal(am.grooveStored, true);
assert.equal(calls.filter((c) => c[0] === "setGroove").length, 1);
ctx.analyzeMusic = async () => { throw new Error("librosa not installed / run tools/py/setup.sh"); };
assert.equal(JSON.parse(await T("analyze_music").run(sample.analyze_music)).ok, false);
const pa = JSON.parse(await T("process_audio").run(sample.process_audio));
assert.equal(pa.samplePath, "/out/vox-proc.wav"); assert.equal(pa.peakDbfs, -1); assert.deepEqual(pa.chain, ["highpass", "compressor"]);
assert.deepEqual(calls.filter((c) => c[0] === "processAudio").at(-1).slice(1, 2), ["/out/vox.wav"]);
assert.throws(() => T("process_audio").parse({ ...sample.process_audio, chain: [] }), "empty chain rejected");
assert.throws(() => T("process_audio").parse({ ...sample.process_audio, chain: [{ type: "flanger" }] }), "unknown type rejected");
assert.throws(() => T("process_audio").parse({ ...sample.process_audio, chain: Array(9).fill({ type: "gain", db: -1 }) }), "9 effects rejected");
ctx.processAudio = async () => { throw new Error("pedalboard not installed / run tools/py/setup.sh"); };
assert.equal(JSON.parse(await T("process_audio").run(sample.process_audio)).ok, false);
const mp = JSON.parse(await T("master_preview").run({})); assert.equal(mp.target, -12); assert.equal(mp.lufs, -11.9); assert.equal(mp.path, "/out/master.wav");
assert.throws(() => T("master_preview").parse({ lufs: -3 }), "lufs -3 rejected");
ctx.masterAudio = async () => { throw new Error("no render yet"); };
assert.equal(JSON.parse(await T("master_preview").run({ lufs: -14 })).ok, false);
const gl = JSON.parse(await T("generate_loop").run(sample.generate_loop));
assert.equal(gl.loop.path, "/out/loop.wav"); assert.equal(gl.kitCount, 3); assert.equal(gl.kit[1].kind, "snare"); assert.equal(gl.kit[1].samplePath, "/out/s.wav"); assert.equal(gl.kit[1].time, 0.7);
assert.equal(JSON.parse(await T("generate_loop").run({ ...sample.generate_loop, kind: "texture" })).kitCount, 0);
assert.throws(() => T("generate_loop").parse({ ...sample.generate_loop, bars: 9 }), "bars 9 rejected");
assert.throws(() => T("generate_loop").parse({ ...sample.generate_loop, kind: "vocals" }), "bad kind rejected");
ctx.generateLoop = async () => { throw new Error("Stability 429"); };
assert.equal(JSON.parse(await T("generate_loop").run(sample.generate_loop)).ok, false);
const rsm = JSON.parse(await T("restyle_mix").run(sample.restyle_mix)); assert.equal(rsm.samplePath, "/out/restyle.wav"); assert.equal(rsm.durationSeconds, 7.7);
assert.throws(() => T("restyle_mix").parse({ prompt: "x tape", strength: 0.9 }), "strength 0.9 rejected");
assert.throws(() => T("restyle_mix").parse({ prompt: "x tape", strength: 0.1 }), "strength 0.1 rejected");
ctx.restyleMix = async () => { throw new Error("nothing built yet"); };
assert.equal(JSON.parse(await T("restyle_mix").run(sample.restyle_mix)).ok, false);
const dna = JSON.parse(await T("production_dna").run(sample.production_dna));
assert.equal(dna.dna.drums.kick, "round dusty kick, soft attack"); assert.equal(dna.dna.key, "F minor"); assert.equal(dna.dna.expensive.length, 3);
assert.equal(calls.filter((c) => c[0] === "productionDna").at(-1)[1], "/tmp/ref1.wav");
assert.equal(JSON.parse(await T("production_dna").run({ which: "ref#99" })).ok, false);
ctx.productionDna = async () => { throw new Error("GEMINI_API_KEY not set"); };
assert.equal(JSON.parse(await T("production_dna").run(sample.production_dna)).ok, false);
const cq = JSON.parse(await T("critique_mix").run(sample.critique_mix));
assert.equal(calls.filter((c) => c[0] === "critiqueMix").at(-1)[1], "/tmp/ref1.wav"); assert.match(cq.critique.topFixes[0].how, /highpass 60 Hz/);
await T("critique_mix").run({}); assert.equal(calls.filter((c) => c[0] === "critiqueMix").at(-1)[1], undefined, "no reference -> undefined");
ctx.critiqueMix = async () => { throw new Error("nothing built yet"); };
assert.equal(JSON.parse(await T("critique_mix").run({})).ok, false);
const lb = JSON.parse(await T("label_pieces").run(sample.label_pieces)); assert.equal(lb.count, 2); assert.equal(lb.labels[0].label, "vowel"); assert.equal(lb.labels[1].usableAs, "perc");
assert.throws(() => T("label_pieces").parse({ paths: Array(13).fill("/out/p.wav") }), "13 paths rejected");
assert.throws(() => T("label_pieces").parse({ paths: [] }), "0 paths rejected");
ctx.labelPieces = async () => { throw new Error("GEMINI_API_KEY not set"); };
assert.equal(JSON.parse(await T("label_pieces").run(sample.label_pieces)).ok, false);
// transcribe: local first, MuScriptor fallback
const trl = JSON.parse(await T("transcribe_audio").run({ which: "ref#1" }));
assert.equal(trl.engine, "basic-pitch (local)"); assert.equal(trl.noteCount, 1); assert.equal(calls.filter((c) => c[0] === "transcribeLocal").length >= 1, true);
ctx.transcribeLocal = async () => { throw new Error("basic-pitch not installed / run tools/py/setup.sh"); };
ctx.transcribe = async () => ({ notes: [{ pitch: 60, startBeats: 0, durationBeats: 0.5, velocity: 100 }, { pitch: 64, startBeats: 0.5, durationBeats: 0.5, velocity: 100 }], bars: 1, bpm: 120, tracks: ["piano"], summary: "piano" });
const trm = JSON.parse(await T("transcribe_audio").run({ which: "ref#1" }));
assert.equal(trm.engine, "muscriptor"); assert.equal(trm.noteCount, 2); assert.match(trm.localFallbackReason, /not installed/);
// useGroove passthrough
await T("build_drum_layer").run(T("build_drum_layer").parse({ ...sample.build_drum_layer, useGroove: true }));
assert.equal(calls.filter((c) => c[0] === "buildLane").at(-1)[1].useGroove, true);
await T("update_layer").run(T("update_layer").parse({ ...sample.update_layer, useGroove: true }));
assert.equal(calls.filter((c) => c[0] === "updateLayer").at(-1)[1].useGroove, true);
for (const k of ["TOOL ROLES", "SAMPLING WORKFLOW", "separate_stems", "analyze_music", "production_dna", "critique_mix", "label_pieces", "generate_loop", "restyle_mix", "process_audio", "master_preview", "useGroove:true", "run tools/py/setup.sh", "never guess what audio sounds like"]) assert.ok(PRODUCER_SYSTEM.includes(k), `system prompt has ${k}`);

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
