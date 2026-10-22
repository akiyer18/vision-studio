// Gemini fallback for the producer agent. Same contract as runProducer in lib/agent.js: the same tools (makeTools), the same
// system prompt, the same ctx.emit events, and the same Anthropic-format history in and out, so a chat can move between
// Claude and Gemini turn by turn. REST generateContent over fetch; keys come from lib/ears.js (GEMINI_API_KEY + GEMINI_API_KEYS).
import { makeTools, PRODUCER_SYSTEM, levelFromText } from "./agent.js";
import { geminiKeys } from "./ears.js";

export const GEMINI_PRODUCER_MODEL = () => process.env.GEMINI_PRODUCER_MODEL || "gemini-3.8-flash";
export const GEMINI_PRODUCER_FALLBACKS = () => String(process.env.GEMINI_PRODUCER_FALLBACKS || "gemini-3.5-flash-lite,gemini-2.5-flash").split(",").map((s) => s.trim()).filter(Boolean);
const isLite = (m) => /lite/i.test(String(m || ""));
const API = "https://generativelanguage.googleapis.com/v1beta/models";

let _fetchImpl = null;   // test hook: replaces fetch so the loop/rotation can run offline
export function _setFetchImpl(fn) { _fetchImpl = typeof fn === "function" ? fn : null; }
const doFetch = (...a) => (_fetchImpl || fetch)(...a);

// ---------- 1. tool schemas -> Gemini function declarations ----------
const DROP = new Set(["$schema", "additionalProperties", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "multipleOf", "default", "$defs", "definitions", "title", "examples", "format"]);
/** Gemini's Schema subset: type/description/enum/nullable/properties/required/items/minItems/maxItems. $ref resolved, anyOf flattened, const -> enum. */
export function toGeminiSchema(schema, defs = null) {
  if (!schema || typeof schema !== "object") return { type: "string" };
  defs ??= schema.$defs || schema.definitions || {};
  const walk = (s) => {
    if (!s || typeof s !== "object") return { type: "string" };
    if (s.$ref) { const key = String(s.$ref).replace(/^#\/(\$defs|definitions)\//, ""); const { $ref, ...rest } = s; return { ...walk(defs[key] || {}), ...(rest.description ? { description: rest.description } : {}) }; }
    let nullable = false;
    const branches = s.anyOf || s.oneOf || s.allOf;
    if (Array.isArray(branches)) {
      const nonNull = branches.filter((b) => !(b && b.type === "null"));
      nullable = nonNull.length < branches.length;
      const base = nonNull.length === 1 ? walk(nonNull[0]) : nonNull.length ? mergeBranches(nonNull.map(walk)) : { type: "string" };
      return { ...base, ...(s.description ? { description: s.description } : {}), ...(nullable ? { nullable: true } : {}) };
    }
    const out = {};
    if (Array.isArray(s.type)) { nullable = s.type.includes("null"); out.type = s.type.find((t) => t !== "null") || "string"; }
    else if (s.type) out.type = s.type;
    if ("const" in s) { out.type = out.type || typeof s.const; out.enum = [String(s.const)]; }
    if (Array.isArray(s.enum)) { out.enum = s.enum.map(String); out.type = "string"; }
    if (s.description) out.description = s.description;
    if (nullable) out.nullable = true;
    if (out.type === "object" || s.properties) {
      out.type = "object";
      out.properties = Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, walk(v)]));
      if (Array.isArray(s.required) && s.required.length) out.required = s.required.filter((k) => k in out.properties);
      if (!Object.keys(out.properties).length) { delete out.properties; delete out.required; }
    }
    if (out.type === "array" || s.items) { out.type = "array"; out.items = walk(Array.isArray(s.items) ? s.items[0] : s.items || {}); if (s.minItems != null) out.minItems = String(s.minItems); if (s.maxItems != null) out.maxItems = String(s.maxItems); }
    if (!out.type) out.type = "string";
    return out;
  };
  const mergeBranches = (bs) => {   // e.g. string | number: Gemini has no union, so keep the first typed branch and mention the rest
    const first = bs[0];
    const others = bs.slice(1).map((b) => b.type).filter(Boolean);
    return { ...first, ...(others.length ? { description: `${first.description || ""} (also accepts ${others.join("/")})`.trim() } : {}) };
  };
  const top = walk(schema);
  if (top.type !== "object") return { type: "object", properties: {} };
  return top;
}
const BAD_KEYS = new Set([...DROP, "$ref", "anyOf", "oneOf", "allOf", "const"]);
/** Keys Gemini rejects that are still present anywhere in a converted schema (for tests). */
export function unsupportedKeys(schema, path = "", acc = []) {
  if (!schema || typeof schema !== "object") return acc;
  for (const [k, v] of Object.entries(schema)) {
    if (BAD_KEYS.has(k)) acc.push(`${path}/${k}`);
    if (k === "properties" && v && typeof v === "object") Object.entries(v).forEach(([pk, pv]) => unsupportedKeys(pv, `${path}/${pk}`, acc));
    else if (k === "items") unsupportedKeys(v, `${path}/items`, acc);
  }
  return acc;
}
export function functionDeclarations(tools) {
  return tools.map((t) => ({ name: t.name, description: String(t.description || "").slice(0, 4000), parameters: toGeminiSchema(t.input_schema || t.inputSchema) }));
}

// ---------- 2. history: Anthropic blocks <-> Gemini contents ----------
const signatures = new Map();   // tool_use id -> Gemini thoughtSignature (Gemini 3 wants it echoed with the call; Claude's history format cannot carry it)
let gemCounter = 0;
const nextId = () => `gem_${Date.now().toString(36)}_${++gemCounter}`;
const asText = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text : b?.text || "")).join("\n") : c == null ? "" : JSON.stringify(c));
const parseResult = (content) => { const s = asText(content); try { return JSON.parse(s); } catch { return { text: s }; } };

/** Anthropic messages -> Gemini contents. Thinking blocks are dropped; tool_result parts carry the tool name looked up from the matching tool_use. */
export function toGeminiContents(messages) {
  const names = new Map();
  const out = [];
  const push = (role, parts) => {
    if (!parts.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts); else out.push({ role, parts });
  };
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
    const parts = [];
    for (const b of blocks) {
      if (!b || b.type === "thinking" || b.type === "redacted_thinking") continue;
      if (b.type === "text") { if (String(b.text || "").trim()) parts.push({ text: b.text }); }
      else if (b.type === "tool_use") { names.set(b.id, b.name); const p = { functionCall: { name: b.name, args: b.input && typeof b.input === "object" ? b.input : {} } }; const sig = signatures.get(b.id); if (sig) p.thoughtSignature = sig; parts.push(p); }
      else if (b.type === "tool_result") { const name = names.get(b.tool_use_id) || "tool"; const r = parseResult(b.content); parts.push({ functionResponse: { name, response: r && typeof r === "object" && !Array.isArray(r) ? { ...r, ...(b.is_error ? { ok: false } : {}) } : { result: r } } }); }
    }
    push(role, parts);
  }
  return out;
}
/** One Gemini model reply (parts) -> Anthropic assistant content blocks; returns { blocks, calls:[{id,name,args,part}] }. */
export function fromGeminiParts(parts) {
  const blocks = [], calls = [];
  for (const p of parts || []) {
    if (p.thought) continue;   // thought summaries are not content
    if (typeof p.text === "string" && p.text.trim()) blocks.push({ type: "text", text: p.text });
    if (p.functionCall) { const id = nextId(); if (p.thoughtSignature) signatures.set(id, p.thoughtSignature); blocks.push({ type: "tool_use", id, name: p.functionCall.name, input: p.functionCall.args || {} }); calls.push({ id, name: p.functionCall.name, args: p.functionCall.args || {}, part: p }); }
  }
  return { blocks, calls };
}

// ---------- 3. the model call with key / model rotation ----------
class GemError extends Error { constructor(msg, { status, kind, model, key } = {}) { super(msg); this.status = status; this.kind = kind; this.model = model; this.key = key; } }
const classify = (status, body) => {
  const msg = String(body?.error?.message || body?.message || "");
  if (status === 401 || status === 403 || /API key not valid|PERMISSION_DENIED|credits|prepayment/i.test(msg)) return "account";
  if (status === 429) return /per.?day|daily|PerDay/i.test(msg + JSON.stringify(body?.error?.details || "")) ? "quota" : "rate";
  if (status === 404) return "model";
  if (status === 503 || status === 500 || /UNAVAILABLE|overloaded|high demand/i.test(msg)) return "transient";
  if (status === 400) return /thinking/i.test(msg) ? "thinking" : "bad_request";
  return "other";
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blocked = new Map();   // `${key}:${model}` -> until (daily quota)
const badKeys = new Set();
const rejectsThinking = new Set();

async function callOnce({ model, key, body, timeoutMs = 120000 }) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await doFetch(`${API}/${model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    if (!r.ok) throw new GemError(`${r.status} ${json?.error?.message || text.slice(0, 200)}`, { status: r.status, kind: classify(r.status, json), model });
    return json;
  } finally { clearTimeout(t); }
}
/** Try keys on the model (starting with the last good one), then the fallback models. Returns { json, model, keyIndex }. */
export async function generate({ models, body, log = () => {} }) {
  const keys = geminiKeys();
  if (!keys.length) throw new GemError("no GEMINI_API_KEY in .env", { kind: "config" });
  const errors = [];
  for (const model of models) {
    const b = { ...body, ...(isLite(model) && !rejectsThinking.has(model) ? { generationConfig: { ...body.generationConfig, thinkingConfig: { thinkingBudget: 0 } } } : {}) };
    for (let ki = 0; ki < keys.length; ki++) {
      const idx = (generate.active + ki) % keys.length;
      if (badKeys.has(idx)) continue;
      if ((blocked.get(`${idx}:${model}`) || 0) > Date.now()) { errors.push(`${model} key ${idx + 1}: daily quota (blocked)`); continue; }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const json = await callOnce({ model, key: keys[idx], body: b });
          generate.active = idx;
          return { json, model, keyIndex: idx };
        } catch (e) {
          const kind = e.kind || "other";
          errors.push(`${model} key ${idx + 1}: ${String(e.message).slice(0, 140)}`);
          log(`[gemini-producer] ${model} key ${idx + 1} ${kind}: ${String(e.message).slice(0, 120)}`);
          if (kind === "transient" && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
          if ((kind === "thinking" || kind === "bad_request") && b.generationConfig?.thinkingConfig) { rejectsThinking.add(model); delete b.generationConfig.thinkingConfig; continue; }   // lite models 400 ("invalid argument") on thinkingConfig: retry plain
          if (kind === "account") badKeys.add(idx);
          if (kind === "quota") blocked.set(`${idx}:${model}`, Date.now() + 6 * 3600 * 1000);
          if (kind === "bad_request") throw e;   // our request is wrong: no key or model will fix it
          break;   // next key (rate / quota / account / transient exhausted); model 404 also tries other keys cheaply then moves on
        }
      }
      if (errors.length && /404/.test(errors[errors.length - 1])) break;   // model missing: next model
    }
  }
  throw new GemError(`Gemini producer: every key/model failed: ${errors.slice(-4).join(" | ")}`, { kind: "exhausted" });
}
generate.active = 0;
export function _resetGemini() { blocked.clear(); badKeys.clear(); rejectsThinking.clear(); generate.active = 0; signatures.clear(); }

// ---------- 4. the turn ----------
function userTurn(userText, recordings = {}) {   // mirrors lib/agent.js userTurn (not exported there)
  const now = new Set(recordings.attachedThisTurn || []);
  const refs = Array.isArray(recordings.refs) ? recordings.refs : [];
  const exists = (k) => (k === "beat" && recordings.beat) || (k === "hum" && recordings.hum) || Boolean(refs[Number((/^ref#(\d+)$/.exec(k) || [])[1]) - 1]);
  const fresh = [], earlier = [];
  if (recordings.beat) (now.has("beat") ? fresh : earlier).push(now.has("beat") ? `'beat' = BEATBOX recording (path: ${recordings.beat})` : "beat (beatbox)");
  if (recordings.hum) (now.has("hum") ? fresh : earlier).push(now.has("hum") ? `'hum' = HUMMED MELODY recording (path: ${recordings.hum})` : "hum (hummed melody)");
  refs.forEach((r, i) => (now.has(`ref#${i + 1}`) ? fresh : earlier).push(now.has(`ref#${i + 1}`) ? `ref#${i + 1} "${r.name}" (path: ${r.path})` : `ref#${i + 1} ${r.name}`));
  if (!fresh.length && !earlier.length) return { role: "user", content: userText || "(empty message)" };
  void exists;
  const parts = [];
  if (fresh.length) parts.push(`Attached this turn: ${fresh.join("; ")}. The user may want it analyzed, imitated, or used as the groove/melody source: listen first if the text is vague, then analyze_recording / synthesize_sound / chop_sample as the playbook says.`);
  if (earlier.length) parts.push(`earlier: ${earlier.join(", ")} (name one to use it).`);
  return { role: "user", content: `${userText || "(no text, just the attachment)"}\n\n[${parts.join(" ")}]` };
}

const SYSTEM_SUFFIX = "\n\nYou are running on Gemini for this turn. Call tools one or a few at a time and keep each tool input small (at most 64 notes per call). When you are done, answer in the reply format with 2-3 quoted next moves.";

/**
 * Run one producer turn on Gemini. Same contract as runProducer: { text, history, stopReason, error? };
 * history in and out is Anthropic-format (text / tool_use / tool_result blocks).
 */
export async function runProducerGemini({ history = [], userText = "", recordings = {}, ctx, maxIterations = 18, model, log = (m) => console.warn(m) }) {
  const tools = makeTools(ctx, recordings, { level: levelFromText(userText) });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const decls = functionDeclarations(tools);
  const models = [...new Set([model || GEMINI_PRODUCER_MODEL(), ...GEMINI_PRODUCER_FALLBACKS()])];
  const messages = [...history, userTurn(userText, recordings)];
  const base = { systemInstruction: { parts: [{ text: PRODUCER_SYSTEM + SYSTEM_SUFFIX }] }, tools: [{ functionDeclarations: decls }], generationConfig: { maxOutputTokens: 8192, temperature: 0.7 } };
  const texts = [];
  let usedModel = null, stopReason = null;
  const emitText = (t) => { if (t) { texts.length = 0; texts.push(t); ctx.emit({ type: "text", text: t }); } };
  try {
    for (let iter = 0; iter < maxIterations; iter++) {
      const { json, model: m, keyIndex } = await generate({ models, body: { ...base, contents: toGeminiContents(messages) }, log });
      if (!usedModel) { usedModel = m; ctx.emit({ type: "tool_done", name: "producer", ok: true, summary: `producer: Gemini ${m} (key ${keyIndex + 1})` }); }
      const cand = json?.candidates?.[0];
      const finish = cand?.finishReason || null;
      if (json?.promptFeedback?.blockReason || finish === "SAFETY" || finish === "PROHIBITED_CONTENT") {
        ctx.emit({ type: "error", error: `Gemini declined (${json?.promptFeedback?.blockReason || finish})` });
        emitText("I can't do that part. Tell me what to build instead."); stopReason = "refusal"; break;
      }
      const { blocks, calls } = fromGeminiParts(cand?.content?.parts || []);
      const t = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (t) emitText(t);
      if (!blocks.length) { blocks.push({ type: "text", text: finish === "MAX_TOKENS" ? "(cut off)" : "(no reply)" }); }
      messages.push({ role: "assistant", content: blocks });
      if (!calls.length) { stopReason = finish === "MAX_TOKENS" ? "max_tokens" : "end_turn"; break; }
      if (finish === "MAX_TOKENS") ctx.emit({ type: "tool_done", name: "budget", ok: false, summary: "reply cut off at max_tokens; asking Gemini to continue in smaller tool calls" });
      const results = [];
      for (const c of calls) {   // sequential: Live commands are serialized anyway, and the tool wrapper emits tool/tool_done itself
        const tool = byName.get(c.name);
        if (!tool) { ctx.emit({ type: "tool_done", name: c.name, ok: false, summary: `unknown tool ${c.name}`, error: "unknown tool" }); results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify({ ok: false, error: `unknown tool ${c.name}` }), is_error: true }); continue; }
        let input = c.args;
        try { input = tool.parse ? tool.parse(c.args) : c.args; }
        catch (e) { const msg = `invalid input for ${c.name}: ${String(e?.message || e).slice(0, 300)}`; ctx.emit({ type: "tool_done", name: c.name, ok: false, summary: msg.slice(0, 120), error: msg }); results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify({ ok: false, error: msg }), is_error: true }); continue; }
        const out = await tool.run(input);   // never throws: makeTool wraps errors into {ok:false}
        const isErr = typeof out === "string" && /^\{"ok":false/.test(out);
        results.push({ type: "tool_result", tool_use_id: c.id, content: typeof out === "string" ? out : JSON.stringify(out), ...(isErr ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      stopReason = "tool_use";
    }
  } catch (e) {
    ctx.emit({ type: "error", error: e?.message || String(e) });
    return { text: texts.join("\n") || "", history: messages, stopReason: "error", error: e?.message || String(e), producer: "gemini" };
  }
  let text = texts.join("\n");
  if (stopReason === "tool_use") {   // budget: wrap up text-only, as the Claude runner does
    ctx.emit({ type: "tool_done", name: "budget", ok: false, summary: `tool budget reached (${maxIterations} rounds); wrapping up` });
    messages.push({ role: "user", content: [{ type: "text", text: "Stop here. In the reply format, say what IS in Live now, what you did not get to, and give 2-3 quoted next moves. No new tool calls." }] });
    try {
      const { json } = await generate({ models, body: { ...base, tools: undefined, contents: toGeminiContents(messages) }, log });
      const { blocks } = fromGeminiParts(json?.candidates?.[0]?.content?.parts || []);
      const t = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (t) { text = t; ctx.emit({ type: "text", text: t }); messages.push({ role: "assistant", content: [{ type: "text", text: t }] }); }
    } catch (e) { ctx.emit({ type: "tool_done", name: "budget", ok: false, summary: `wrap-up failed: ${String(e.message).slice(0, 100)}` }); }
  }
  return { text, history: messages, stopReason, producer: "gemini", model: usedModel };
}
