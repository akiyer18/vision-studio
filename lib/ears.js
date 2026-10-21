// "Ears" for the agent: ask NVIDIA Music Flamingo (hosted Hugging Face Space, ZeroGPU) about an audio file.
// Uses the Gradio queue protocol so we get real error messages. Needs HF_TOKEN in .env (ZeroGPU rejects anonymous API calls).
import fs from "node:fs/promises";
import path from "node:path";

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
  const cfg = await (await fetch(`${SPACE}/config`, { headers: authHeaders() })).json();
  const dep = cfg.dependencies.find((d) => d.api_name === "infer");
  if (!dep) throw new Error("ears: Space has no 'infer' endpoint");
  fnIndexCache = { id: dep.id, trigger: dep.targets?.[0]?.[0] ?? null };
  return fnIndexCache;
}
async function uploadFile(filePath) {
  const form = new FormData();
  form.append("files", new Blob([await fs.readFile(filePath)], { type: "audio/wav" }), path.basename(filePath));
  const res = await fetch(`${SPACE}/gradio_api/upload`, { method: "POST", headers: authHeaders(), body: form });
  if (!res.ok) throw new Error(`ears upload ${res.status}: ${await res.text()}`);
  const [serverPath] = await res.json();
  return { path: serverPath, orig_name: path.basename(filePath), meta: { _type: "gradio.FileData" }, mime_type: "audio/wav", size: (await fs.stat(filePath)).size };
}

// ---------- provider 2: Google Gemini (native audio in, no GPU quota; free tier at aistudio.google.com) ----------
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY);
async function listenGemini(filePath, question) {
  const t0 = Date.now();
  const data = (await fs.readFile(filePath)).toString("base64");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data } }, { text: question }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error(`gemini: empty answer (${j.candidates?.[0]?.finishReason || "no candidates"})`);
  return { text, ms: Date.now() - t0, provider: "gemini" };
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
  const order = (process.env.EARS_PROVIDER || "auto") === "gemini" ? ["gemini", "flamingo"] : ["flamingo", "gemini"];
  const errors = [];
  for (const p of order) {
    if (p === "flamingo" && !earsAvailable()) { errors.push(`flamingo: ${earsStatus()}`); continue; }
    if (p === "gemini" && !geminiAvailable()) { errors.push("gemini: no GEMINI_API_KEY"); continue; }
    try { return p === "gemini" ? await listenGemini(filePath, question) : { ...(await listenFlamingo(filePath, question, opts)), provider: "flamingo" }; }
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
  const join = await fetch(`${SPACE}/gradio_api/queue/join`, {
    method: "POST", headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ data: [file, "", question], fn_index: fn.id, trigger_id: fn.trigger, session_hash, event_data: null }),
  });
  if (!join.ok) throw new Error(`ears join ${join.status}: ${await join.text()}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SPACE}/gradio_api/queue/data?session_hash=${session_hash}`, { headers: authHeaders(), signal: ctrl.signal });
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
export async function judge(filePath, intent) {
  const q = `A music producer asked for: "${intent}". Listen to this one-shot sample. In 2 short lines: (1) what it actually sounds like (instrument, timbre, envelope, any pitch); (2) how well it matches the request and what to change in the text prompt if it doesn't. End with "MATCH: n/10".`;
  const r = await listen(filePath, q);
  const m = r.text.match(/MATCH:\s*(\d+)\s*\/\s*10/i);
  return { ...r, match: m ? Number(m[1]) : null };
}
