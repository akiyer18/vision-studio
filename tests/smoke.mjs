// Offline smoke tests: no Live, no Stability, no Gemini. `node tests/smoke.mjs`
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
let fails = 0, passes = 0;
const ok = (cond, msg, extra = "") => { if (cond) { passes++; } else { fails++; console.log("FAIL", msg, extra); } };
const T = ".tmp/tests"; await fs.mkdir(T, { recursive: true });

// ---- pattern rules
const { rulesToPattern } = await import("../lib/pattern.js");
for (const [desc, want] of [
  ["four on the floor kick, clap on 2 and 4, offbeat open hats", { kick: [0, 4, 8, 12], snare_or_clap: [4, 12] }],
  ["boom bap: kick on 1 and the and of 2, snare on 2 and 4, swing", { snare_or_clap: [4, 12] }],
  ["half time trap, snare on 3, rolling hats", { snare_or_clap: [8] }],
]) {
  const p = rulesToPattern({ description: desc, bpm: 120, bars: 1 });
  const lanes = Object.fromEntries((p.lanes || p.tracks || []).map((l) => [l.instrument || l.name, (l.steps || l.hits || []).map((s) => (typeof s === "number" ? s : s.step))]));
  const kick = lanes.kick || [], sn = [...(lanes.snare || []), ...(lanes.clap || [])];
  if (want.kick) ok(want.kick.every((s) => kick.includes(s)), `pattern kick for "${desc}"`, JSON.stringify(kick));
  if (want.snare_or_clap) ok(want.snare_or_clap.every((s) => sn.includes(s)), `pattern backbeat for "${desc}"`, JSON.stringify(sn));
}

// ---- melody rules + MIDI bytes
const { rulesToMelody, parseKey, notesToMidi } = await import("../lib/melody.js");
ok(parseKey("a dark arp in F minor").root != null, "parseKey F minor", JSON.stringify(parseKey("a dark arp in F minor")));
const mel = rulesToMelody({ description: "hypnotic saw arp in F minor", bpm: 128, bars: 2 });
ok(mel.notes?.length >= 8, "rulesToMelody produces notes", String(mel.notes?.length));
ok(mel.notes.every((n) => n.pitch >= 24 && n.pitch <= 108), "melody pitches in range");
const midi = notesToMidi(mel.notes, { bpm: 128 });
ok(Buffer.isBuffer(midi) && midi.subarray(0, 4).toString() === "MThd", "notesToMidi emits MThd header");
const { patternToMidi } = await import("../lib/midi.js");
const pm = patternToMidi(rulesToPattern({ description: "four on the floor", bpm: 120, bars: 1 }));
ok(Buffer.isBuffer(pm) && pm.subarray(0, 4).toString() === "MThd", "patternToMidi emits MThd header");

// ---- genre matching false positives
const k = await import("../lib/knowledge.js");
const shouldMatch = { "make me a deep house groove": "deep-house", "2000s hip hop like Timbaland": "hiphop-2000s", "industrial techno at 138": "industrial", "ebm bassline": "industrial", "lo-fi beat 85 bpm": "lofi-hiphop", "uk garage shuffle": "uk-garage" };
for (const [t, slug] of Object.entries(shouldMatch)) ok(k.matchGenre(t) === slug, `matchGenre "${t}"`, String(k.matchGenre(t)));
const shouldNot = ["make the house party vibe louder", "use a factory preset", "a metallic snare please", "pop the kick out a bit", "there is a trap door sound", "drill into the bass more", "the pad is too soft", "keep the guitar as the lead", "make it groovy not rushed", "more ambient reverb on the snare"];
for (const t of shouldNot) ok(k.matchGenre(t) == null, `matchGenre false positive "${t}"`, String(k.matchGenre(t)));
// short everyday-word aliases ("deep", "rumble", "perc", "garage", "drag", "drone", "trap") need a genre context
const shortNeg = ["deep bass please", "give me a rumble on the kick", "add some perc hits", "garage door sample", "can you drag the hats a bit", "the drone is too loud", "trap door sound"];
for (const t of shortNeg) ok(k.matchGenre(t) == null, `matchGenre short-alias false positive "${t}"`, String(k.matchGenre(t)));
const shortPos = { "a deep house groove": "deep-house", "trap beat 140": "trap", "make it drill": "drill", "garage shuffle at 132": "uk-garage" };
for (const [t, slug] of Object.entries(shortPos)) ok(k.matchGenre(t) === slug, `matchGenre short-alias "${t}"`, String(k.matchGenre(t)));
{ const lp = k.getLoopPrompts("deep-house"); ok(lp && "track" in lp && typeof lp.production === "string" && typeof lp.era === "string", "getLoopPrompts exposes track/production/era", JSON.stringify({ track: lp?.track, production: lp?.production?.slice(0, 40), era: lp?.era?.slice(0, 40) })); ok(lp && !/\{bpm\}/.test(lp.withBpm(122).loops.join(" ")), "withBpm fills every {bpm}"); }

// ---- Stable Audio prompt composition
const { composePrompt, stripTrackType } = await import("../lib/prompts.js");
{
  const p1 = composePrompt({ kind: "drums", bpm: 122, title: "Deep House", body: "deep house drum loop at {bpm} BPM, warm 909 kick, no melody", production: "Warm, round low end, subtle saturation." });
  ok(p1.startsWith("TrackType: Instrument, Genre: Deep House,") && p1.includes("122 BPM") && (p1.match(/\bBPM\b/g) || []).length === 1 && (p1.match(/no melody/g) || []).length === 1 && /no vocals/.test(p1) && /no bass/.test(p1) && /saturation/.test(p1), "composePrompt drums", p1);
  const p2 = composePrompt({ kind: "texture", bpm: 90, body: "TrackType: Instrument, Genre: Lo-fi, warm detuned chord pad, {bpm} BPM, dusty tape", production: "Lo-fi, warm" });
  ok(p2 === "TrackType: Instrument, warm detuned chord pad, 90 BPM, dusty tape, no drums, no vocals", "composePrompt texture strips pasted tags and skips production when the body has a production word", p2);
  const p3 = composePrompt({ kind: "oneshot", body: "warm deep house kick drum, 400 ms decay, dry one-shot" });
  ok(p3.startsWith("TrackType: SFX,") && /single hit/.test(p3) && /no reverb tail/.test(p3) && /no music/.test(p3) && (p3.match(/\bdry\b/g) || []).length === 1 && !/BPM/.test(p3), "composePrompt oneshot", p3);
  const p4 = composePrompt({ kind: "track", bpm: 140, title: "Trap", body: "trap beat with sliding 808s", era: "Atlanta 2012-2018" });
  ok(p4 === "TrackType: Music, Genre: Trap, trap beat with sliding 808s, 140 BPM, Atlanta 2012-2018, cohesive full mix", "composePrompt track", p4);
  ok(stripTrackType("TrackType: SFX, Genre: Techno, rumble kick") === "rumble kick" && stripTrackType("plain body") === "plain body", "stripTrackType");
}

// ---- ears helpers (offline)
const ears = await import("../lib/ears.js");
ok(JSON.stringify(ears.extractJson("```json\n{\"a\": [1,2,], \"b\": NaN, \"s\": \"x } y\"}\n```")) === '{"a":[1,2],"b":null,"s":"x } y"}', "extractJson repairs trailing commas/NaN and honors strings");
ok(Array.isArray(ears.extractJson("here: [1, {\"q\": \"]\"}] done")), "extractJson accepts arrays");
for (const g of k.listGenres()) { const v = k.validateBlueprint(g.slug); ok(v.ok, `blueprint ${g.slug} valid`, JSON.stringify(v)); const lp = k.getLoopPrompts(g.slug); ok(lp && lp.loops.length >= 1, `blueprint ${g.slug} has loop prompts`); }

// ---- analysis on synthetic audio: dual-mono vs widened
const { analyzeAudio } = await import("../lib/analyze.js");
const mono = path.join(T, "mono.wav"), st = path.join(T, "stereo.wav"), silent = path.join(T, "silent.wav");
await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=2", "-f", "lavfi", "-i", "anoisesrc=color=pink:duration=2:amplitude=0.1", "-filter_complex", "[0][1]amix=inputs=2[m];[m]aformat=channel_layouts=stereo", "-ar", "44100", mono]);
await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=color=pink:duration=2:amplitude=0.2:seed=1", "-f", "lavfi", "-i", "anoisesrc=color=pink:duration=2:amplitude=0.2:seed=2", "-filter_complex", "[0][1]join=inputs=2:channel_layout=stereo", "-ar", "44100", st]);
await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "2", silent]);
const am = await analyzeAudio(mono), as = await analyzeAudio(st);
ok(am.stereo && am.stereo.width < 0.05, "dual-mono reads as mono", JSON.stringify(am.stereo));
ok(as.stereo && as.stereo.width > 0.5, "decorrelated noise reads as wide", JSON.stringify(as.stereo));
ok(am.durationSeconds > 1.9 && am.durationSeconds < 2.1, "duration measured", String(am.durationSeconds));
let silentOk = true; try { const z = await analyzeAudio(silent); silentOk = Number.isFinite(z.durationSeconds); } catch (e) { silentOk = /silent|no sound/i.test(e.message); }
ok(silentOk, "analyzeAudio handles silence without crashing");
// local evidence gate used by critiqueMix/scoreGenre (no model call)
{ const sil = await ears.audioEvidence(path.join(T, "silent.wav")); ok(sil.peakDbfs <= -30 && sil.onsets === 0, "audioEvidence on silence", JSON.stringify(sil)); }
{ const tone = await ears.audioEvidence(path.join(T, "mono.wav")); ok(tone.peakDbfs > -30 && tone.durationSec > 1.9, "audioEvidence on a tone", JSON.stringify(tone)); }

// ---- widener via pytools (if venv present)
const py = await import("../lib/pytools.js");
if (py.pyAvailable()) {
  const out = path.join(T, "widened.wav");
  await py.processAudio(mono, [{ type: "widen", amount: 0.6 }], out);
  const aw = await analyzeAudio(out);
  ok(aw.stereo.width > 0.15, "widen makes dual-mono stereo", JSON.stringify(aw.stereo));
} else console.log("skip: python toolbelt not installed");

// ---- render preview
const { renderPreview } = await import("../lib/render.js");
try {
  const r = await renderPreview({ bpm: 120, bars: 1, layers: [{ name: "Kick", samplePath: mono, steps: [{ step: 0, velocity: 120 }, { step: 8, velocity: 120 }] }], outPath: path.join(T, "render.wav") });
  ok(Boolean(r && (r.path || r.outPath)), "renderPreview returns a path");
} catch (e) { ok(false, "renderPreview", e.message.slice(0, 160)); }

// ---- tweak rules
const { rulesTweak } = await import("../lib/tweak.js");
const tw = rulesTweak({ text: "half time, more swing, kick punchier", state: { bpm: 120, swing: 0.1 } });
ok(tw && typeof tw === "object", "rulesTweak returns an object", JSON.stringify(tw).slice(0, 200));

// ---- history repair (extracted from server.js)
const src = await fs.readFile("server.js", "utf8");
const repairHistory = new Function(src.match(/function repairHistory[\s\S]*?\n}\n/)[0] + "; return repairHistory;")();
const h = [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }, { type: "tool_use", id: "t2", name: "y", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] }, { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "z", input: {} }] }];
const rh = repairHistory(h);
ok(rh[2].content.length === 2 && rh[2].content.some((b) => b.tool_use_id === "t2"), "repairHistory fills a partial result message");
ok(rh.at(-1).role === "user" && rh.at(-1).content[0].tool_use_id === "t3", "repairHistory appends results for a dangling tail");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
