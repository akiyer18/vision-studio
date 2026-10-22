// Offline checks for the Gemini producer fallback (schema conversion, history round trip, tool loop, key rotation).
// Run: node tests/test-agent-gemini.mjs            (offline)
//      LIVE=1 node tests/test-agent-gemini.mjs     (adds one real call on GEMINI_PRODUCER_MODEL || gemini-3.5-flash-lite)
import "dotenv/config";
import { makeTools } from "../lib/agent.js";
import { toGeminiSchema, unsupportedKeys, functionDeclarations, toGeminiContents, fromGeminiParts, runProducerGemini, _setFetchImpl, _resetGemini } from "../lib/agent-gemini.js";

const REAL_KEYS = { k: process.env.GEMINI_API_KEY, ks: process.env.GEMINI_API_KEYS };
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("FAIL:", msg); } };

// ---- 1. schemas: every tool converts and carries no unsupported keyword
const fakeCtx = { emit() {}, live: {} };
const tools = makeTools(fakeCtx, {}, {});
ok(tools.length >= 70, `tools: ${tools.length}`);
const decls = functionDeclarations(tools);
let badTotal = 0;
for (const d of decls) {
  const bad = unsupportedKeys(d.parameters, d.name);
  if (bad.length) { badTotal += bad.length; console.log("unsupported in", d.name, bad.slice(0, 5)); }
  ok(d.parameters.type === "object", `${d.name}: object params`);
}
ok(badTotal === 0, `unsupported keywords left: ${badTotal}`);
const st = decls.find((d) => d.name === "set_tempo").parameters;
ok(st.properties.bpm.type === "number" && !("minimum" in st.properties.bpm), "set_tempo bpm: number, no minimum");
ok(st.required.includes("bpm") && !st.required.includes("confirmed"), "set_tempo required = bpm only");
const sp = decls.find((d) => d.name === "set_position").parameters;
ok(sp.properties.bar.type === "integer", "set_position bar stays integer");
const nullable = toGeminiSchema({ type: "object", properties: { d: { anyOf: [{ type: "string", pattern: "^r" }, { type: "null" }] }, r: { $ref: "#/$defs/__s" } }, $defs: { __s: { type: "number", minimum: 1, description: "ref'd" } } });
ok(nullable.properties.d.nullable === true && nullable.properties.d.type === "string" && !nullable.properties.d.pattern, "anyOf+null -> nullable string without pattern");
ok(nullable.properties.r.type === "number" && nullable.properties.r.description === "ref'd" && !("minimum" in nullable.properties.r), "$ref resolved, minimum dropped");
ok(toGeminiSchema({ type: "object", properties: { c: { const: "x" } } }).properties.c.enum[0] === "x", "const -> enum");

// ---- 2. history round trip
const hist = [
  { role: "user", content: "hi" },
  { role: "assistant", content: [{ type: "thinking", thinking: "...", signature: "s" }, { type: "text", text: "ok" }, { type: "tool_use", id: "toolu_1", name: "list_tracks", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"ok":true,"tracks":[]}' }] },
  { role: "assistant", content: [{ type: "text", text: "done" }] },
];
const contents = toGeminiContents(hist);
ok(contents.length === 4 && contents[0].role === "user" && contents[1].role === "model", `contents roles: ${contents.map((c) => c.role).join(",")}`);
ok(!JSON.stringify(contents).includes("thinking"), "thinking dropped");
ok(contents[1].parts.some((p) => p.functionCall?.name === "list_tracks") && contents[2].parts[0].functionResponse?.name === "list_tracks", "tool_use/tool_result -> functionCall/functionResponse by name");
ok(contents[2].parts[0].functionResponse.response.ok === true, "functionResponse carries parsed JSON");
const back = fromGeminiParts([{ text: "building" }, { functionCall: { name: "set_tempo", args: { bpm: 120 } }, thoughtSignature: "sig1" }]);
ok(back.blocks.length === 2 && back.blocks[1].type === "tool_use" && /^gem_/.test(back.blocks[1].id) && back.calls[0].name === "set_tempo", "Gemini parts -> Anthropic blocks");
const again = toGeminiContents([{ role: "assistant", content: back.blocks }, { role: "user", content: [{ type: "tool_result", tool_use_id: back.blocks[1].id, content: '{"ok":true}' }] }]);
ok(again[0].parts.find((p) => p.functionCall)?.thoughtSignature === "sig1", "thought signature restored from the side map");
ok(again[1].parts[0].functionResponse.name === "set_tempo", "round trip keeps the pairing");

// ---- 3. tool loop with fake model responses (2 calls then a reply)
const events = [];
const ctx = { emit: (e) => events.push(e), live: { listTracks: async () => [{ name: "Drums", index: 0 }], setTempo: async ({ bpm }) => ({ bpm, warped: [], unwarpedLeft: [] }) } };
process.env.GEMINI_API_KEY = "k1"; process.env.GEMINI_API_KEYS = "k2";
_resetGemini();
const replies = [
  { candidates: [{ content: { parts: [{ text: "Checking the set." }, { functionCall: { name: "list_tracks", args: {} }, thoughtSignature: "x" }] }, finishReason: "STOP" }] },
  { candidates: [{ content: { parts: [{ functionCall: { name: "set_tempo", args: { bpm: 124, confirmed: true } } }] }, finishReason: "STOP" }] },
  { candidates: [{ content: { parts: [{ text: "Tempo set to 124. \"add a snare\" / \"play it\"" }] }, finishReason: "STOP" }] },
];
const seen = [];
_setFetchImpl(async (url, init) => { const body = JSON.parse(init.body); seen.push({ url, body }); const r = replies.shift(); return { ok: true, status: 200, text: async () => JSON.stringify(r) }; });
const out = await runProducerGemini({ history: [], userText: "set the tempo to 124", ctx, model: "gemini-test" });
ok(out.text.startsWith("Tempo set to 124"), `final text: ${out.text.slice(0, 40)}`);
ok(out.stopReason === "end_turn" && out.producer === "gemini", `stopReason ${out.stopReason}`);
ok(seen.length === 3 && seen[0].url.includes("gemini-test") && seen[0].url.includes("key=k1"), "3 model calls on key 1");
ok(seen[0].body.systemInstruction.parts[0].text.length > 1000 && seen[0].body.tools[0].functionDeclarations.length === tools.length, "system prompt + all tools sent");
ok(seen[1].body.contents.some((c) => c.role === "model" && c.parts.some((p) => p.functionCall?.name === "list_tracks" && p.thoughtSignature === "x")), "2nd call echoes the functionCall with its thought signature");
ok(seen[1].body.contents.some((c) => c.parts.some((p) => p.functionResponse?.name === "list_tracks" && p.functionResponse.response.ok === true)), "2nd call carries the functionResponse");
ok(events.filter((e) => e.type === "tool").map((e) => e.name).join(",") === "list_tracks,set_tempo", "tool events in order");
ok(events.filter((e) => e.type === "tool_done" && e.ok).length === 3 && events.some((e) => e.type === "tool_done" && e.name === "producer"), "tool_done events incl. producer notice");
ok(events.filter((e) => e.type === "text").length === 2, "text events for the intent line and the reply");
const h = out.history;
ok(h[0].role === "user" && h[1].role === "assistant" && h[1].content.some((b) => b.type === "tool_use") && h[2].content[0].type === "tool_result" && h[h.length - 1].content[0].text.startsWith("Tempo"), "returned history is Anthropic-format and paired");

// ---- 4. key rotation on a daily 429, model fallback on 404, bad key on 403
_resetGemini();
const calls = [];
_setFetchImpl(async (url) => {
  calls.push(url.replace(/.*models\//, "").replace(/\?key=/, " "));
  if (url.includes("key=k1") && url.includes("gemini-a")) return { ok: false, status: 429, text: async () => JSON.stringify({ error: { message: "quota exceeded", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }) };
  if (url.includes("gemini-a")) return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi from k2" }] }, finishReason: "STOP" }] }) };
  return { ok: false, status: 404, text: async () => "{}" };
});
const r2 = await runProducerGemini({ history: [], userText: "hello", ctx: { emit() {}, live: {} }, model: "gemini-a" });
ok(r2.text === "hi from k2" && calls[0] === "gemini-a:generateContent k1" && calls[1] === "gemini-a:generateContent k2", `rotation: ${calls.join(" -> ")}`);
calls.length = 0;
const r3 = await runProducerGemini({ history: [], userText: "hello again", ctx: { emit() {}, live: {} }, model: "gemini-a" });
ok(r3.text === "hi from k2" && calls.length === 1 && calls[0].endsWith("k2"), `blocked key skipped next turn: ${calls.join(" -> ")}`);
_resetGemini(); calls.length = 0;
process.env.GEMINI_PRODUCER_FALLBACKS = "gemini-b";
_setFetchImpl(async (url) => {
  calls.push(url.replace(/.*models\//, "").replace(/\?key=/, " "));
  if (url.includes("gemini-a")) return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: "not found" } }) };
  if (url.includes("key=k1")) return { ok: false, status: 403, text: async () => JSON.stringify({ error: { message: "API key not valid", status: "PERMISSION_DENIED" } }) };
  return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "from b/k2" }] }, finishReason: "STOP" }] }) };
});
const r4 = await runProducerGemini({ history: [], userText: "x", ctx: { emit() {}, live: {} }, model: "gemini-a" });
ok(r4.text === "from b/k2" && calls.includes("gemini-b:generateContent k2"), `404 -> fallback model, 403 -> next key: ${calls.join(" -> ")}`);
_resetGemini(); calls.length = 0;
_setFetchImpl(async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: { message: "high demand", status: "UNAVAILABLE" } }) }));
const r5 = await runProducerGemini({ history: [], userText: "x", ctx: { emit: () => {}, live: {} }, model: "gemini-a" });
ok(r5.stopReason === "error" && /every key\/model failed/.test(r5.error) && calls.length === 0, `all 503 -> error result (${r5.error?.slice(0, 60)})`);
_setFetchImpl(null); _resetGemini();
delete process.env.GEMINI_PRODUCER_FALLBACKS;

console.log(`\n${pass} passed, ${fail} failed`);

// ---- 5. optional real run (one short turn on a cheap model, fake Live)
if (process.env.LIVE === "1") {
  const model = process.env.GEMINI_PRODUCER_MODEL || "gemini-3.5-flash-lite";
  const ev = [];
  const liveCtx = { emit: (e) => ev.push(e), live: { listTracks: async () => ({ ok: true, tracks: [{ name: "Drums", index: 0, is_midi: true }, { name: "Vox", index: 1, is_midi: false }] }), describeSet: async () => ({ tempo: 124, tracks: [{ name: "Drums", is_midi: true, devices: ["Drum Rack"] }, { name: "Vox", is_midi: false }], scenes: 1 }) } };
  process.env.GEMINI_API_KEY = REAL_KEYS.k; process.env.GEMINI_API_KEYS = REAL_KEYS.ks || "";
  const t0 = Date.now();
  const r = await runProducerGemini({ history: [], userText: "what is in my set?", ctx: liveCtx, model, maxIterations: 4 });
  console.log(`\nLIVE run on ${r.model || model} in ${Date.now() - t0} ms: stop=${r.stopReason} error=${r.error || "none"}`);
  console.log("tools called:", ev.filter((e) => e.type === "tool").map((e) => e.name).join(", ") || "(none)");
  console.log("producer notice:", ev.find((e) => e.name === "producer")?.summary);
  console.log("reply:", String(r.text).slice(0, 400));
}
process.exit(fail ? 1 : 0);
