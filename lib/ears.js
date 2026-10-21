// "Ears" for the agent: ask NVIDIA Music Flamingo (hosted Hugging Face Space, ZeroGPU) about an audio file.
// Uses the Gradio queue protocol so we get real error messages. Needs HF_TOKEN in .env (ZeroGPU rejects anonymous API calls).
import fs from "node:fs/promises";
import path from "node:path";
const fetchT = (url, opts = {}, ms = 60000) => fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(ms) });

const SPACE = process.env.EARS_SPACE_URL || "https://nvidia-music-flamingo.hf.space";
const DEFAULT_TIMEOUT_MS = Number(process.env.EARS_TIMEOUT_MS || 150000);
let fnIndexCache = null;

let quotaBlockedUntil = 0;   // when ZeroGPU says we're out of quota, fail fast for a while instead of burning a turn
export const earsAvailable = () => Boolean(process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN) && Date.now() > quotaBlockedUntil;
export const earsStatus = () => !(process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN) ? 'no HF_TOKEN' : Date.now() <= quotaBlockedUntil ? `ZeroGPU quota exhausted, retry after ${new Date(quotaBlockedUntil).toLocaleTimeString()}` : 'ok';
function authHeaders() {
  const tok = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;
  return tok ? { authorization: `Bearer ${tok}` } : {};
}
async function fnIndex() {
  if (fnIndexCache != null) return fnIndexCache;
  const cfg = await (await fetchT(`${SPACE}/config`, { headers: authHeaders() })).json();
  const dep = cfg.dependencies.find((d) => d.api_name === "infer");
  if (!dep) throw new Error("ears: Space has no 'infer' endpoint");
  fnIndexCache = { id: dep.id, trigger: dep.targets?.[0]?.[0] ?? null };
  return fnIndexCache;
}
async function uploadFile(filePath) {
  const form = new FormData();
  form.append("files", new Blob([await fs.readFile(filePath)], { type: "audio/wav" }), path.basename(filePath));
  const res = await fetchT(`${SPACE}/gradio_api/upload`, { method: "POST", headers: authHeaders(), body: form });
  if (!res.ok) throw new Error(`ears upload ${res.status}: ${await res.text()}`);
  const [serverPath] = await res.json();
  return { path: serverPath, orig_name: path.basename(filePath), meta: { _type: "gradio.FileData" }, mime_type: "audio/wav", size: (await fs.stat(filePath)).size };
}

// ---------- provider 2: Google Gemini (native audio in, no GPU quota; free tier at aistudio.google.com) ----------
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY);
const GEMINI_FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest").split(",").map((x) => x.trim()).filter(Boolean);
async function listenGemini(filePath, question, temperature = 0.4) {
  const data = (await fs.readFile(filePath)).toString("base64");
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACKS.filter((m) => m !== GEMINI_MODEL)];
  let lastErr;
  for (const [i, model] of models.entries()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await geminiOnce(model, data, question, temperature); }
      catch (e) {
        lastErr = e;
        const transient = /\b(503|429|500)\b|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(e.message) && !/prepayment|credits/i.test(e.message);
        if (!transient) break;                       // real error (bad key, billing, bad request): don't hammer
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!/\b(503|429|500|404)\b|overloaded|UNAVAILABLE|no longer available/i.test(lastErr?.message || "")) break;   // only hop models for availability problems
  }
  throw lastErr;
}
async function geminiOnce(model, data, question, temperature = 0.4, noThinking = true) {
  const t0 = Date.now();
  const generationConfig = { temperature, maxOutputTokens: 2048 };
  if (noThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };   // 3.x/2.5 models spend output tokens on hidden thinking otherwise
  const res = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data } }, { text: question }] }],
      generationConfig,
    }),
  });
  if (res.status === 400 && noThinking) {
    const body = await res.text();
    if (/thinking/i.test(body)) return geminiOnce(model, data, question, temperature, false);   // model doesn't take thinkingConfig
    throw new Error(`gemini(${model}) 400: ${body.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`gemini(${model}) ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error(`gemini(${model}): empty answer (${j.candidates?.[0]?.finishReason || "no candidates"})`);
  return { text, ms: Date.now() - t0, provider: `gemini:${model}` };
}

/** Which ears are usable right now. */
export function earsProviders() {
  const out = [];
  if (earsAvailable()) out.push("flamingo");
  if (geminiAvailable()) out.push("gemini");
  return out;
}

/** Ask a question about an audio file. Tries Music Flamingo (if quota) then Gemini. Returns { text, ms, provider }. */
export async function listen(filePath, question = "Describe this sound: instrument/type, timbre, envelope, tempo or pitch if any, production style, mood. Be concrete and brief.", opts = {}) {
  const temperature = opts.temperature ?? 0.4;
  const order = (process.env.EARS_PROVIDER || "auto") === "gemini" ? ["gemini", "flamingo"] : ["flamingo", "gemini"];
  const errors = [];
  for (const p of order) {
    if (p === "flamingo" && !earsAvailable()) { errors.push(`flamingo: ${earsStatus()}`); continue; }
    if (p === "gemini" && !geminiAvailable()) { errors.push("gemini: no GEMINI_API_KEY"); continue; }
    try { return p === "gemini" ? await listenGemini(filePath, question, temperature) : { ...(await listenFlamingo(filePath, question, opts)), provider: "flamingo" }; }
    catch (e) { errors.push(e.message); }
  }
  throw new Error(`ears unavailable (${errors.join(" | ")}). Do not retry this turn; work from the pitch/onset analysis instead.`);
}

/** Music Flamingo via the HF Space. Returns { text, ms }. */
async function listenFlamingo(filePath, question = "Describe this sound: instrument/type, timbre, envelope, tempo or pitch if any, production style, mood. Be concrete and brief.", { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!earsAvailable()) throw new Error(`ears unavailable: ${earsStatus()}. Do not retry this turn; work from the pitch/onset analysis instead.`);
  const t0 = Date.now();
  const [file, fn] = await Promise.all([uploadFile(filePath), fnIndex()]);
  const session_hash = Math.random().toString(36).slice(2, 12);
  const join = await fetchT(`${SPACE}/gradio_api/queue/join`, {
    method: "POST", headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ data: [file, "", question], fn_index: fn.id, trigger_id: fn.trigger, session_hash, event_data: null }),
  });
  if (!join.ok) throw new Error(`ears join ${join.status}: ${await join.text()}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchT(`${SPACE}/gradio_api/queue/data?session_hash=${session_hash}`, { headers: authHeaders(), signal: ctrl.signal });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.msg === "process_completed") {
          if (ev.output?.error) {
            if (/quota/i.test(ev.output.error)) { const m = String(ev.output.error).match(/Try again in (\d+):(\d+):(\d+)/); const secs = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0; quotaBlockedUntil = Date.now() + Math.max(secs, 15 * 60) * 1000; }
            throw new Error(`ears: ${ev.output.error.split(". Subscribe")[0]}. Do not retry this turn.`);
          }
          const text = String(ev.output?.data?.[0] ?? "").replace(/^✅[^\n]*\n+/, "").trim();
          if (/^❌/.test(text)) throw new Error(`ears: ${text}`);
          return { text, ms: Date.now() - t0 };
        }
        if (ev.msg === "unexpected_error") throw new Error(`ears: ${ev.message || "unexpected error"}`);
      }
    }
    throw new Error("ears: stream ended without a result");
  } finally { clearTimeout(timer); }
}

/** Compare a generated sound with what was asked for. Returns { text, match (1-10|null), ms }. */
export function parseMatch(text) {
  const t = String(text || "").replace(/[*_`#]/g, "");
  let m = t.match(/match[^0-9]{0,12}(\d{1,2})\s*(?:\/|out of|of)\s*10/i);
  if (!m) { const all = [...t.matchAll(/(\d{1,2})\s*(?:\/|out of|of)\s*10\b/gi)]; m = all.length ? all[all.length - 1] : null; }
  if (!m) { const w = t.match(/match[^0-9]{0,12}(\d{1,2})\b/i); m = w; }
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
}
export async function judge(filePath, intent) {
  const q = `A music producer asked for: "${intent}". Listen to this one-shot sample.\nAnswer in exactly 3 plain-text lines, no markdown:\nLine 1: what it actually sounds like (instrument, timbre, envelope, any pitch).\nLine 2: how well it matches the request and what to change in the text prompt if it doesn't.\nLine 3: MATCH: n/10   (digits only, e.g. "MATCH: 7/10")`;
  const r = await listen(filePath, q, { temperature: 0.1 });
  return { ...r, match: parseMatch(r.text) };
}


// ---------- structured ears (Gemini is the one that actually hears; Claude reasons on the result) ----------
function extractJson(text) {
  const t = String(text || "").replace(/```json|```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("ears: no JSON object in answer");
  return JSON.parse(t.slice(a, b + 1));
}
export async function productionDna(filePath) {
  const q = `You are a senior music producer's ears. Listen to this reference and return ONLY a JSON object (no markdown) with: 
{"tempoGuessBpm": number|null, "keyGuess": string|null, "genre": string, "drums": {"kick": "<8-14 words a sound designer would type into a text-to-audio model>", "snare": "...", "hats": "...", "perc": "..."}, "groove": {"swing": "straight|light|medium|heavy", "feel": "<pushed/laid back/on the grid, ghost notes, fills: 1 sentence>"}, "lowEnd": "<1 sentence: sub vs kick relationship>", "space": "<1 sentence: reverb/room/delay character>", "vocals": "<1 sentence or null>", "arrangement": "<1 sentence: sections, drops, how often things change>", "expensive": ["<3 concrete things that make it sound produced/expensive>"], "avoid": ["<2 things that would cheapen it>"]}
Be concrete and technical, no praise.`;
  const r = await listen(filePath, q, { temperature: 0.2 });
  return { ...extractJson(r.text), provider: r.provider, ms: r.ms };
}
export async function critiqueMix(renderPath, refPath) {
  const q = `You are a mix engineer. This is a rough preview bounce of a beat (no final effects). Return ONLY a JSON object (no markdown):
{"groove": "<timing/feel: 1-2 sentences>", "drums": "<kick/snare/hat character and balance>", "lowEnd": "<sub/kick/bass relationship, masking>", "topEnd": "<hats/air/harshness>", "space": "<dry/wet, depth>", "dynamics": "<punch, compression, crest>", "arrangement": "<repetition, variation, what is missing>", "topFixes": [{"what": "<issue>", "how": "<concrete action a producer would take, name device/parameter or technique>"}] (3-5 items), "readiness": "sketch|demo|release-candidate"}
Technical language only, no good/bad words.`;
  const r = await listen(renderPath, q, { temperature: 0.2 });
  const out = { ...extractJson(r.text), provider: r.provider, ms: r.ms };
  if (refPath) {
    const q2 = `Compare the FIRST description (our beat) to this REFERENCE track you are hearing now. Our beat: ${JSON.stringify({ groove: out.groove, drums: out.drums, lowEnd: out.lowEnd, topEnd: out.topEnd, space: out.space })}. Return ONLY JSON: {"closer": ["<3 concrete changes that would move our beat toward the reference>"], "keep": ["<2 things already aligned>"]}`;
    try { const r2 = await listen(refPath, q2, { temperature: 0.2 }); out.vsReference = extractJson(r2.text); } catch (e) { out.vsReference = { error: e.message }; }
  }
  return out;
}
export async function labelPiece(filePath) {
  const q = `This is a short audio slice (< 1 s). Return ONLY JSON: {"type": "vowel|consonant|breath|noise|drum|tone|other", "pitched": true|false, "pitchNote": "<e.g. A3 or null>", "character": "<5 words>", "usableAs": "<chop-melody|perc-hit|texture|transient-layer|discard>"}`;
  const r = await listen(filePath, q, { temperature: 0.1 });
  return { ...extractJson(r.text), provider: r.provider };
}
