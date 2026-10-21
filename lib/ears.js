// "Ears" for the agent: ask NVIDIA Music Flamingo (hosted Hugging Face Space, ZeroGPU) or Google Gemini about an audio file.
// Uses the Gradio queue protocol so we get real error messages. Needs HF_TOKEN in .env (ZeroGPU rejects anonymous API calls).
// Evidence-first protocol (critiqueMix / scoreGenre): a local gate (peak + onsets) rejects near-silent clips before any model
// call; Step A "hear" sends the audio WITHOUT the target text; Step B "markers" is a text-only call that judges the Step-A
// evidence against the target. A marker may only be "present" when it cites a heard event.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { decodeMono16k, SR as EVIDENCE_SR } from "./melody.js";
import { detectOnsets } from "./rhythm.js";
import { ffmpeg } from "./audio.js";
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

// ---------- local evidence (no model): peak level + onset count ----------
const NEAR_SILENT_DBFS = -30, MIN_ONSETS = 2;
/** Cheap local facts about a clip: { peakDbfs, onsets, durationSec }. peakDbfs is -120 for digital silence (JSON-safe). */
export async function audioEvidence(filePath) {
  const x = await decodeMono16k(filePath);
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  const peakDbfs = peak > 0 ? Math.max(-120, Math.round(20 * Math.log10(peak) * 10) / 10) : -120;
  const onsets = x.length ? detectOnsets(x).length : 0;
  return { peakDbfs, onsets, durationSec: Math.round((x.length / EVIDENCE_SR) * 100) / 100 };
}
const isNearSilent = (ev) => !ev || !Number.isFinite(ev.peakDbfs) || ev.peakDbfs < NEAR_SILENT_DBFS || ev.onsets < MIN_ONSETS;
async function evidenceOrNull(filePath) {
  try { return await audioEvidence(filePath); } catch (e) { return { peakDbfs: null, onsets: null, durationSec: null, error: e.message.slice(0, 160) }; }
}
/** true = reject before any model call. A decode failure (peakDbfs null) lets the model try rather than faking silence. */
const gateClosed = (ev) => Boolean(ev) && ev.peakDbfs != null && isNearSilent(ev);

// ---------- provider 2: Google Gemini (native audio in, no GPU quota; free tier at aistudio.google.com) ----------
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY);
const GEMINI_FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-lite-latest").split(",").map((x) => x.trim()).filter(Boolean);
const JUDGE_MODEL_LIST = () => (process.env.GEMINI_JUDGE_MODELS || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3);   // judge calls: at most 3 models
const isLite = (model) => /lite/i.test(String(model || ""));
const MAX_INLINE_B64 = 19 * 1024 * 1024;
const JSON_Q = /ONLY (a )?JSON/i;
const fatal = (msg) => { const e = new Error(msg); e.fatal = true; return e; };
const rejectsThinkingConfig = new Set();   // models that 400 on thinkingConfig (lite models): go straight to the plain request next time
const quotaBlocked = new Map();            // model -> timestamp until which its daily quota is known to be exhausted
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

/** Downsample to 16 kHz mono s16 wav (what the model hears anyway) so the inline payload stays small; returns base64. */
async function prepareGeminiAudio(filePath) {
  const tmp = path.join(os.tmpdir(), `ears-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  try {
    await ffmpeg(["-i", filePath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp]);
    const data = (await fs.readFile(tmp)).toString("base64");
    if (data.length > MAX_INLINE_B64) throw fatal(`gemini: audio payload ${(data.length / 1048576).toFixed(1)} MB exceeds the 19 MB inline limit (trim the clip)`);
    return data;
  } finally { await fs.unlink(tmp).catch(() => {}); }
}
const audioPart = (data) => ({ inlineData: { mimeType: "audio/wav", data } });

/** One Gemini request. parts = Gemini content parts (audio and/or text). thinkMode: "on" (budget 2048) | "off" (budget 0) | "none" (no thinkingConfig). */
async function geminiRequest(model, parts, { temperature = 0.4, thinkMode = "off", json = false } = {}) {
  const t0 = Date.now();
  if (thinkMode === "off" && rejectsThinkingConfig.has(model)) thinkMode = "none";
  const thinking = thinkMode === "on";
  const generationConfig = { temperature, maxOutputTokens: thinking ? 8192 : 2048 };
  if (thinkMode === "on") generationConfig.thinkingConfig = { thinkingBudget: 2048 };
  else if (thinkMode === "off") generationConfig.thinkingConfig = { thinkingBudget: 0 };   // 3.x/2.5 models spend output tokens on hidden thinking otherwise
  if (json) generationConfig.responseMimeType = "application/json";
  const res = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
  }, thinking ? 180000 : 90000);
  if (res.status === 400) {
    const body = await res.text();
    if (/too large|size|exceed|audio|mime/i.test(body)) throw fatal(`gemini(${model}) 400: ${body.slice(0, 300)}`);   // payload problem: never retry
    // model rejects thinkingConfig: retry plain, once. Lite models say only "Request contains an invalid argument." for thinkingBudget: 0.
    if (thinkMode !== "none" && (/thinking/i.test(body) || /invalid argument/i.test(body))) { rejectsThinkingConfig.add(model); return geminiRequest(model, parts, { temperature, thinkMode: "none", json }); }
    throw new Error(`gemini(${model}) 400: ${body.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`gemini(${model}) ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error(`gemini(${model}): empty answer (${j.candidates?.[0]?.finishReason || "no candidates"})`);
  return { text, ms: Date.now() - t0, provider: `gemini:${model}`, model, lite: isLite(model) };
}

/** Model cascade with per-model retry on transient errors. Returns { text, ms, provider, model, lite, fellBackFrom }. */
async function geminiCascade(parts, question, { temperature = 0.4, think = false, models = null, judge = false } = {}) {
  const base = judge ? JUDGE_MODEL_LIST() : [GEMINI_MODEL, ...GEMINI_FALLBACKS.filter((m) => m !== GEMINI_MODEL)];
  let list = Array.isArray(models) && models.length ? [...models, ...base.filter((m) => !models.includes(m))] : base;
  if (judge) list = list.slice(0, 3);
  const json = JSON_Q.test(question);
  const errors = [];
  const now = Date.now();
  const usable = list.filter((m) => !(quotaBlocked.get(m) > now));
  for (const m of list) if (!usable.includes(m)) errors.push(`${m}: skipped (daily quota exhausted until ${new Date(quotaBlocked.get(m)).toLocaleTimeString()})`);
  if (usable.length) list = usable;   // all blocked: try anyway, the cooldown is only a guess
  for (const model of list) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const r = await geminiRequest(model, parts, { temperature, thinkMode: think ? "on" : "off", json }); return { ...r, fellBackFrom: errors }; }
      catch (e) {
        lastErr = e;
        if (e.fatal) { errors.push(`${model}: ${e.message.slice(0, 160)}`); throw fatal(`gemini: ${errors.join(" | ")}`); }   // payload problem: no model will accept it
        if (/prepayment|credits|API key|PERMISSION_DENIED|401|403/i.test(e.message)) { errors.push(`${model}: ${e.message.slice(0, 160)}`); throw new Error(`gemini: ${errors.join(" | ")}`); }   // account-level: stop
        const quotaDaily = /quota/i.test(e.message) && /billing|plan|per.?day|daily/i.test(e.message);   // daily cap on this model: a retry cannot help
        if (quotaDaily) quotaBlocked.set(model, Date.now() + QUOTA_COOLDOWN_MS);
        const transient = !quotaDaily && /\b(503|429|500)\b|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|aborted|timeout/i.test(e.message);
        if (!transient) break;                       // 400/404/daily quota: try the next model instead of hammering this one
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    errors.push(`${model}: ${(lastErr?.message || "").replace(/\s+/g, " ").slice(0, 140)}`);
  }
  throw new Error(`gemini: all models failed -> ${errors.join(" | ")}`);
}
async function listenGemini(filePath, question, temperature = 0.4, think = false, preferred = null, judge = false) {
  const data = await prepareGeminiAudio(filePath);
  return geminiCascade([audioPart(data), { text: question }], question, { temperature, think, models: preferred, judge });
}
/** Text-only Gemini call (no audio): used for the evidence -> markers judgement. With judge=true the capped judge list is tried
 *  first; if every judge model is out of quota the cheap text step falls back to the lite cascade (result is flagged lite). */
async function textGemini(question, { temperature = 0.1, think = false, models = null, judge = true } = {}) {
  if (!geminiAvailable()) throw new Error("gemini: no GEMINI_API_KEY");
  const parts = [{ text: question }];
  if (!judge) return geminiCascade(parts, question, { temperature, think, models, judge: false });
  try { return await geminiCascade(parts, question, { temperature, think, models, judge: true }); }
  catch (e) {
    if (e.fatal || /prepayment|credits|API key|PERMISSION_DENIED|401|403/i.test(e.message)) throw e;
    const lite = GEMINI_FALLBACKS.filter(isLite);
    if (!lite.length) throw e;
    const r = await geminiCascade(parts, question, { temperature, think, models: lite, judge: false });
    return { ...r, fellBackFrom: [`judge models: ${e.message.slice(0, 200)}`, ...(r.fellBackFrom || [])] };
  }
}

/** Which ears are usable right now. */
export function earsProviders() {
  const out = [];
  if (earsAvailable()) out.push("flamingo");
  if (geminiAvailable()) out.push("gemini");
  return out;
}

/** Ask a question about an audio file. Gemini first for structured JSON questions (or EARS_PROVIDER=gemini), Flamingo first for free text.
 *  Returns { text, ms, provider, model, lite, fellBackFrom }. opts: { temperature, think, models, judge } */
export async function listen(filePath, question = "Describe this sound: instrument/type, timbre, envelope, tempo or pitch if any, production style, mood. Be concrete and brief.", opts = {}) {
  const temperature = opts.temperature ?? 0.4;
  const think = Boolean(opts.think);
  const models = Array.isArray(opts.models) && opts.models.length ? opts.models : null;
  const geminiFirst = (process.env.EARS_PROVIDER || "auto") === "gemini" || JSON_Q.test(question);
  const order = geminiFirst ? ["gemini", "flamingo"] : ["flamingo", "gemini"];
  const errors = [];
  for (const p of order) {
    if (p === "flamingo" && !earsAvailable()) { errors.push(`flamingo: ${earsStatus()}`); continue; }
    if (p === "gemini" && !geminiAvailable()) { errors.push("gemini: no GEMINI_API_KEY"); continue; }
    try {
      if (p === "gemini") return await listenGemini(filePath, question, temperature, think, models, Boolean(opts.judge));
      return { ...(await listenFlamingo(filePath, question, opts)), provider: "flamingo", model: "music-flamingo", lite: false, fellBackFrom: errors.slice() };
    } catch (e) { errors.push(e.message); }
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
/** Index of the bracket closing the one at `start`, honoring strings/escapes; -1 when the text is truncated. */
function balancedEnd(t, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
const repairJson = (s) => s.replace(/\bNaN\b/g, "null").replace(/,\s*([}\]])/g, "$1");
/** Pull the first JSON object or array out of a model answer (code fences, prose around it, trailing commas, NaN tolerated). */
export function extractJson(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const starts = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) throw new Error("ears: no JSON object in answer");
  const a = Math.min(...starts);
  let end = balancedEnd(t, a);
  if (end < 0) end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));   // truncated answer: best effort
  if (end < a) throw new Error("ears: no JSON object in answer");
  const slice = t.slice(a, end + 1);
  try { return JSON.parse(slice); }
  catch (e1) {
    try { return JSON.parse(repairJson(slice)); }
    catch { throw new Error(`ears: unparseable JSON (${e1.message.slice(0, 80)})`); }
  }
}
export async function productionDna(filePath) {
  const q = `You are a senior music producer's ears. Listen to this reference and return ONLY a JSON object (no markdown) with:
{"tempoGuessBpm": number|null, "keyGuess": string|null, "genre": string, "era": "<decade/scene, e.g. 'early-2000s West Coast'>", "drums": {"kick": "<8-14 words a sound designer would type into a text-to-audio model>", "snare": "...", "hats": "...", "perc": "..."}, "percussionLayers": ["<each extra percussion element you hear: snaps, claps, shakers, tambourine, rimshot, congas, vinyl crackle ...>"], "bassType": "<what kind of bass: 808 glide / sub sine / Moog-style synth / picked electric / Reese / none, plus register and how it moves against the kick>", "groove": {"swing": "straight|light|medium|heavy", "feel": "<pushed/laid back/on the grid, ghost notes, fills: 1 sentence>"}, "lowEnd": "<1 sentence: sub vs kick relationship>", "space": "<1 sentence: reverb/room/delay character>", "vocals": "<1 sentence or null>", "hookDevice": "<what carries the hook: vocal chop, lead synth, string stab, piano riff, whistle, talkbox ... and where it sits in the bar>", "eraMarkers": ["<3 concrete sonic markers that date this to its era: specific drum machine sound, sample treatment, synth type, mix habit>"], "arrangement": "<1 sentence: sections, drops, how often things change>", "expensive": ["<3 concrete things that make it sound produced/expensive>"], "avoid": ["<2 things that would cheapen it>"]}
Be concrete and technical, no praise.`;
  const r = await listen(filePath, q, { temperature: 0.2 });
  return { ...extractJson(r.text), provider: r.provider, ms: r.ms, lite: r.lite };
}

/** Production-first critique shape; every field present so callers never crash. */
export function normalizeCritique(obj) {
  const o = obj && typeof obj === "object" ? obj : {};
  const str = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null).map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : []);
  const sa = o.styleAccuracy && typeof o.styleAccuracy === "object" ? o.styleAccuracy : {};
  const bass = o.bass && typeof o.bass === "object" ? o.bass : {};
  const verdict = ["on target", "close", "off", "uncertain"].includes(String(sa.verdict || "").toLowerCase()) ? String(sa.verdict).toLowerCase() : null;
  return {
    styleRead: str(o.styleRead),
    styleAccuracy: { target: str(sa.target), verdict, why: str(sa.why) },
    drums: str(o.drums),
    bass: { present: typeof bass.present === "boolean" ? bass.present : null, type: str(bass.type), suggestion: str(bass.suggestion) },
    harmonyMelody: str(o.harmonyMelody),
    soundDesign: str(o.soundDesign),
    groove: str(o.groove),
    arrangement: str(o.arrangement),
    moves: arr(o.moves).slice(0, 5),
    mixNotes: str(o.mixNotes),
    ...(o.mixDetail && typeof o.mixDetail === "object" ? { mixDetail: o.mixDetail } : {}),
    ...(o.vsReference ? { vsReference: o.vsReference } : {}),
    ...(o.provider ? { provider: o.provider } : {}),
    ...(o.ms != null ? { ms: o.ms } : {}),
  };
}

export const CRITIQUE_PROMPT = ({ genreTarget, mixDetail, hints } = {}) => `You are a record producer listening to a rough bounce of a beat (no final mixing yet).${hints ? " Context from the DAW: " + String(hints).slice(0, 500) : ""}
Describe ONLY what is audible in this clip. Never describe the target style or the context instead of the audio: if the clip is mostly silent, very short, or does not match the target, say exactly that in styleRead, set the verdict to "off", and return an empty moves list rather than inventing instruments you did not hear. Speak as a producer about SOUNDS, PATTERNS and STYLE, not as a mix engineer: what the drums are made of and how they move, what kind of bass it has or needs, the instruments and chord language, the hook, the ear candy (snaps, shakers, vinyl, risers, chops), the groove and the arrangement. Do not talk about loudness, LUFS, dB, EQ balance or compression${mixDetail ? " except inside the mixDetail field" : " at all; mixNotes stays empty unless something is clearly broken (a layer inaudible, a sound distorting)"}.
${genreTarget ? `The producer is aiming for this style; judge style accuracy against it:\n<<<\n${String(genreTarget).slice(0, 1400)}\n>>>` : "No target style was given: judge style accuracy against what the beat itself seems to aim for."}
Return ONLY a JSON object (no markdown, no text before or after):
{"styleRead": "<what genre/era it actually sounds like and why, 1-2 sentences>",
 "styleAccuracy": {"target": "<the target style, or your best read of the intended one>", "verdict": "on target|close|off", "why": "<sound and pattern reasons, concrete>"},
 "drums": "<kick/snare/hat character and pattern feel; name what is generic or dated-correctly>",
 "bass": {"present": true|false, "type": "<what it is: 808 glide, sub sine, synth bass, electric, none>", "suggestion": "<what TYPE of bass this style wants, its register, and how it should move against the kick>"},
 "harmonyMelody": "<instrument choices, chord language, whether a hook exists and what carries it>",
 "soundDesign": "<layering, texture, ear candy that is missing or working: snaps, claps, shakers, vinyl, risers, chops, ad-libs>",
 "groove": "<swing, pocket, variation, fills, what feels stiff>",
 "arrangement": "<repetition, sections, energy curve, what is missing>",
 "moves": ["<3-5 concrete PRODUCTION moves; each names the element, the sound, the pattern or the device, e.g. 'add a layered snap on 2 and 4 under the snare, dry and bright'>"],
 "mixNotes": "<one line max, only if something is clearly broken, else empty string>"${mixDetail ? `,\n "mixDetail": {"lowEnd": "<sub/kick/bass relationship>", "topEnd": "<hats/air/harshness>", "dynamics": "<punch, compression>", "space": "<dry/wet, depth>"}` : ""}}`;

// ---------- evidence-first protocol: Step A (hear, no target) + Step B (text-only judgement) ----------
export const HEAR_PROMPT = ({ hints } = {}) => `You are a producer's ears. Listen to this clip and transcribe ONLY what is audible; do not guess a genre from context${hints ? " (DAW context, for orientation only: " + String(hints).slice(0, 300) + ")" : ""}.
Return ONLY JSON (no markdown):
{"durationSec": <number>, "silentOrEmpty": <true if nothing musical is audible>, "tempoGuessBpm": <number|null>,
 "events": [{"t": <seconds, 1 decimal>, "sound": "<kick|snare|clap|hat|perc|bass|chord|lead|vocal|fx|noise|other>", "desc": "<5-10 words: timbre, envelope, pattern role>"}],
 "drumKit": "<what the drums are made of: machine/sample character, era, 1 sentence or 'none'>",
 "bass": "<type, register, movement against the kick, or 'none'>",
 "harmony": "<instruments, chord language, hook, or 'none'>",
 "swing": "straight|light|medium|heavy|unclear",
 "confidence": <0-1 how sure you are about the events list>}
List at most 24 events (one per distinct sound onset or pattern change); never invent sounds you did not hear.`;

export const MARKERS_PROMPT = ({ evidence, genreTarget, markers = [], mixDetail = false, scope = "full" } = {}) => `You are a record producer judging a beat from an EVIDENCE TRANSCRIPT written by a listener (you cannot hear the audio yourself). Reason ONLY from the transcript; never assume a sound is there because the target style would have it.
EVIDENCE (JSON): ${JSON.stringify(evidence).slice(0, 6000)}
${genreTarget ? `TARGET STYLE:\n<<<\n${String(genreTarget).slice(0, 1400)}\n>>>` : "No target style was given: judge against what the beat itself seems to aim for and name that style."}
${markers.length ? "Concrete markers to check one by one: " + markers.slice(0, 12).join(" | ") : "Derive 6-10 concrete markers of the target style (specific drum sounds, bass type, groove, palette, era tells, arrangement)."}${scope === "drums" ? "\nThis is a DRUM LOOP only (no bass, no chords by design): judge drums, groove, palette and era; set dimensions.bass and dimensions.arrangement to null; do not list bass/chord markers as missing." : ""}
Rules: a marker may be "present" ONLY if you cite the t of an event in the transcript that shows it; otherwise it is "absent" (the transcript clearly shows something else) or "unclear". Dimensions 0-10 follow from the markers (mostly present -> 8+, half -> 5-6, few -> <=3); if the transcript is thin or hallucinationRisk is true, prefer "uncertain". Speak as a producer about sounds, patterns and style; no loudness/dB/EQ talk${mixDetail ? " except inside mixDetail" : ""}.
Return ONLY JSON (no markdown):
{"markers": [{"m": "<marker>", "state": "present|absent|unclear", "evidence": <event t or null>}],
 "dimensions": {"drums": n|null, "groove": n|null, "bass": n|null, "palette": n|null, "arrangement": n|null, "era": n|null},
 "verdict": "on target|close|off|uncertain",
 "styleRead": "<what style/era the evidence actually points to and why, 1-2 sentences>",
 "styleAccuracy": {"target": "<the target style>", "verdict": "on target|close|off|uncertain", "why": "<concrete, citing events>"},
 "drums": "<kick/snare/hat character and pattern feel from the evidence>",
 "bass": {"present": true|false, "type": "<from the evidence or 'none'>", "suggestion": "<what TYPE of bass the style wants and how it should move against the kick>"},
 "harmonyMelody": "<from the evidence; what the hook is or that there is none>",
 "soundDesign": "<layering/ear candy present or missing>",
 "groove": "<swing, pocket, variation from the evidence>",
 "arrangement": "<repetition, sections, energy curve>",
 "moves": ["<3-5 concrete PRODUCTION moves naming element, sound, pattern or device>"],
 "mixNotes": "<one line only if something is clearly broken, else empty string>",
 "fixPrompt": "<one revised text-to-audio prompt body (<= 30 words) toward the target>"${mixDetail ? `,\n "mixDetail": {"lowEnd": "...", "topEnd": "...", "dynamics": "...", "space": "..."}` : ""}}`;

/** Step A: hear the clip (audio in, no target text). Returns the model JSON + local cross-check fields. */
async function hear(filePath, evidence, { hints } = {}) {
  const r = await listen(filePath, HEAR_PROMPT({ hints }), { temperature: 0.1 });
  const j = extractJson(r.text);
  const events = Array.isArray(j.events) ? j.events.slice(0, 24) : [];
  const localOnsets = evidence?.onsets ?? null;
  const hallucinationRisk = localOnsets != null && events.length > 2 * Math.max(1, localOnsets);
  return { ...j, events, localOnsets, localPeakDbfs: evidence?.peakDbfs ?? null, localDurationSec: evidence?.durationSec ?? null, hallucinationRisk, provider: r.provider, model: r.model, lite: Boolean(r.lite), ms: r.ms, fellBackFrom: r.fellBackFrom || [] };
}
/** Enforce the evidence rule: "present" needs a cited event t (or at least non-empty evidence). */
function cleanMarkers(raw, events = []) {
  const ts = new Set((events || []).map((e) => Number(e?.t)).filter(Number.isFinite).map((t) => t.toFixed(1)));
  return (Array.isArray(raw) ? raw : []).filter((m) => m && (m.m || m.marker)).slice(0, 16).map((m) => {
    const ev = m.evidence ?? m.t ?? null;
    const cited = ev != null && ev !== "" && (typeof ev !== "number" || !ts.size || ts.has(Number(ev).toFixed(1)));
    let state = ["present", "absent", "unclear"].includes(String(m.state || "").toLowerCase()) ? String(m.state).toLowerCase() : "unclear";
    if (state === "present" && !cited) state = "unclear";
    return { m: String(m.m || m.marker), state, evidence: ev };
  });
}
const scoreNoteFor = (lite) => (lite ? "LITE JUDGE: treat as a hint" : undefined);
const judgeInfo = (r) => ({ model: r?.model || null, provider: r?.provider || null, lite: Boolean(r?.lite), fellBackFrom: r?.fellBackFrom || [] });

/** Production critique. Same shape as before (normalizeCritique) plus { evidence, markers, dimensions, fixPrompt, lite, judge, scoreNote, nearSilent? }. */
export async function critiqueMix(renderPath, refPath, { genreTarget, mixDetail = false, hints } = {}) {
  const evidence = await evidenceOrNull(renderPath);
  if (gateClosed(evidence)) {
    const why = `Near-silent or empty clip (peak ${evidence.peakDbfs} dBFS, ${evidence.onsets} onsets in ${evidence.durationSec}s): nothing to critique. Check the capture routing and levels.`;
    const out = normalizeCritique({ styleRead: why, styleAccuracy: { target: genreTarget ? String(genreTarget).split(":")[0].slice(0, 80) : null, verdict: "off", why: "no audible material" }, moves: [], mixNotes: "clip is near-silent", provider: "local", ms: 0 });
    return { ...out, evidence, markers: [], lite: false, judge: null, nearSilent: true };
  }
  const stepA = await hear(renderPath, evidence, { hints });
  if (stepA.silentOrEmpty === true && !(stepA.events || []).length) {
    const out = normalizeCritique({ styleRead: "The listener heard nothing musical in this clip.", styleAccuracy: { target: null, verdict: "off", why: "no audible material" }, moves: [], mixNotes: "", provider: stepA.provider, ms: stepA.ms });
    return { ...out, evidence: stepA, markers: [], lite: stepA.lite, judge: judgeInfo(stepA), scoreNote: scoreNoteFor(stepA.lite), nearSilent: true };
  }
  const stepB = await textGemini(MARKERS_PROMPT({ evidence: stepA, genreTarget, mixDetail }), { temperature: 0.1 });
  const parsed = extractJson(stepB.text);
  const markers = cleanMarkers(parsed.markers, stepA.events);
  if (!parsed.styleAccuracy || typeof parsed.styleAccuracy !== "object") parsed.styleAccuracy = { target: genreTarget ? String(genreTarget).split(":")[0].slice(0, 80) : null, verdict: parsed.verdict, why: null };
  if (!parsed.styleAccuracy.verdict && parsed.verdict) parsed.styleAccuracy.verdict = parsed.verdict;
  if (stepA.hallucinationRisk) parsed.styleAccuracy.verdict = "uncertain";
  const lite = Boolean(stepA.lite || stepB.lite);
  const out = normalizeCritique({ ...parsed, provider: `${stepA.provider}+${stepB.provider}`, ms: (stepA.ms || 0) + (stepB.ms || 0) });
  if (refPath) {
    const ours = { styleRead: out.styleRead, drums: out.drums, bass: out.bass, harmonyMelody: out.harmonyMelody, soundDesign: out.soundDesign, groove: out.groove };
    const q2 = `You are a record producer. Earlier you described OUR beat as: ${JSON.stringify(ours)}. Now you are hearing the REFERENCE track the producer wants to get closer to. Return ONLY JSON: {"referenceRead": "<1 sentence: what the reference does with drums, bass, hook, texture>", "closer": ["<3 concrete sound or pattern moves that would bring our beat toward the reference: which element, what sound, what pattern>"], "keep": ["<2 things in our beat already aligned with the reference>"]}. Production language only, no loudness or dB talk.`;
    try { const r2 = await listen(refPath, q2, { temperature: 0.2 }); out.vsReference = extractJson(r2.text); } catch (e) { out.vsReference = { error: e.message }; }
  }
  return { ...out, evidence: stepA, markers, dimensions: parsed.dimensions || null, fixPrompt: parsed.fixPrompt || null, lite, judge: { ...judgeInfo(stepB), hearModel: stepA.model }, scoreNote: scoreNoteFor(lite) };
}
export async function labelPiece(filePath) {
  const q = `This is a short audio slice (< 1 s). Return ONLY JSON: {"type": "vowel|consonant|breath|noise|drum|tone|other", "pitched": true|false, "pitchNote": "<e.g. A3 or null>", "character": "<5 words>", "usableAs": "<chop-melody|perc-hit|texture|transient-layer|discard>"}`;
  const r = await listen(filePath, q, { temperature: 0.1 });
  return { ...extractJson(r.text), provider: r.provider, lite: r.lite };
}

/** Listen to a generated sound, compare with the intent, and propose a revised Stable Audio prompt. */
export async function proposePrompt(filePath, { intent, currentPrompt, kind = "drum" }) {
  const q = `You are a sound designer who writes prompts for a text-to-audio model (Stable Audio). The producer wants: "${intent}". The current prompt was: "${currentPrompt}". Listen to the result.
Return ONLY JSON: {"heard": "<what it actually sounds like, 1 line>", "gap": "<what is missing or wrong vs the intent, 1 line>", "match": <0-10 integer>, "newPrompt": "<revised descriptive prompt, max 30 words, order: genre/style, source/instrument and how it sounds, envelope/decay, production (room, mic, processing); describe, never instruct; for a ${kind === "tone" ? "sustained single note" : "single hit"}>", "useAudioToAudio": <true if the current sound is close and should be used as the seed, false if it should be regenerated from text>, "strength": <0.3-0.8 when useAudioToAudio>}`;
  const r = await listen(filePath, q, { temperature: 0.2 });
  return { ...extractJson(r.text), provider: r.provider, ms: r.ms, lite: r.lite };
}

const DIM_KEYS = ["drums", "groove", "bass", "palette", "arrangement", "era"];
const uniq = (arr) => [...new Set((arr || []).filter((x) => x != null && x !== "").map(String))];
/** Strict genre-authenticity rubric (0-10 per dimension, calibrated), evidence-first: one hear call, then two text-only rubric samples.
 *  opts: { genreTarget, markers, scope: "full"|"drums", samples: 1|2 (rubric samples, default 2) }.
 *  Returns { overall, dimensions, scope, samples, spread, markersPresent, markersMissing, markers, verdict, why, fixPrompt, provider, ms, lite, judge, abstained, evidence, scoreNote }. */
export async function scoreGenre(filePath, { genreTarget = "", markers = [], scope = "full", samples: wantSamples = 2 } = {}) {
  const evidence = await evidenceOrNull(filePath);
  const empty = (why, extra = {}) => ({ overall: 0, dimensions: Object.fromEntries(DIM_KEYS.map((k) => [k, scope === "drums" && (k === "bass" || k === "arrangement") ? null : 0])), scope, samples: 0, spread: null, markersPresent: [], markersMissing: uniq(markers), markers: [], verdict: "off", why, fixPrompt: null, provider: "local", ms: 0, lite: false, judge: null, abstained: true, evidence, nearSilent: true, ...extra });
  if (gateClosed(evidence)) return empty(`Near-silent or empty clip (peak ${evidence.peakDbfs} dBFS, ${evidence.onsets} onsets in ${evidence.durationSec}s): not judged.`);
  const stepA = await hear(filePath, evidence);
  if (stepA.silentOrEmpty === true && !(stepA.events || []).length) return empty("The listener heard nothing musical in this clip.", { evidence: stepA, provider: stepA.provider, ms: stepA.ms, lite: stepA.lite, judge: judgeInfo(stepA) });
  const rubric = `${MARKERS_PROMPT({ evidence: stepA, genreTarget, markers, scope })}
Calibration (be harsh): 9-10 = could sit on a classic record of the genre, every marker present with evidence; 7-8 = clearly the genre, one or two markers off; 5-6 = generic, "AI loop" feel, right tempo but wrong sounds or flat groove; 3-4 = wrong era or wrong sound palette; 0-2 = different genre. Most generated loops are 4-6. Do not give 8+ unless each marker cites an event. Also include "overall": n and "why": "<2 sentences naming the specific sounds/patterns that decide it>" in the JSON.`;
  // the judge varies run to run: take two text-only samples over the same evidence (second one warmer) and measure the spread
  const samples = [], errors = [];
  const temps = [0.1, 0.4].slice(0, Math.max(1, Math.min(2, Number(wantSamples) || 2)));
  for (const temperature of temps) {
    try { const r = await textGemini(rubric, { temperature, judge: true }); samples.push({ j: extractJson(r.text), provider: r.provider, model: r.model, lite: Boolean(r.lite), ms: r.ms, fellBackFrom: r.fellBackFrom || [] }); }
    catch (e) { errors.push(e.message.slice(0, 160)); if (!samples.length && temperature === temps[temps.length - 1]) throw e; }
  }
  if (!samples.length) throw new Error("scoreGenre: no sample");
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const dims = {};
  for (const k of DIM_KEYS) { const v = samples.map((s) => s.j.dimensions?.[k]).filter((x) => x != null).map(Number).filter(Number.isFinite); dims[k] = v.length ? Math.round(mean(v)) : null; }
  if (scope === "drums") { dims.bass = null; dims.arrangement = null; }
  const spread = samples.length < 2 ? null : Math.max(0, ...DIM_KEYS.map((k) => { const v = samples.map((s) => s.j.dimensions?.[k]).filter((x) => x != null).map(Number).filter(Number.isFinite); return v.length > 1 ? Math.max(...v) - Math.min(...v) : 0; }));
  const vals = DIM_KEYS.filter((k) => dims[k] != null).map((k) => Number(dims[k])).filter(Number.isFinite);   // zeros count, nulls skipped
  const modelOverall = samples.map((s) => Number(s.j.overall)).filter(Number.isFinite);
  const overall = vals.length ? Math.round(mean(vals)) : (modelOverall.length ? Math.round(mean(modelOverall)) : null);
  const allMarkers = samples.flatMap((s) => cleanMarkers(s.j.markers, stepA.events));
  const markersPresent = uniq([...allMarkers.filter((m) => m.state === "present").map((m) => m.m), ...samples.flatMap((s) => s.j.markersPresent || [])]);
  const markersMissing = uniq([...allMarkers.filter((m) => m.state === "absent").map((m) => m.m), ...samples.flatMap((s) => s.j.markersMissing || [])]).filter((m) => !markersPresent.includes(m));
  const lite = samples.some((s) => s.lite) || Boolean(stepA.lite);
  const modelSaysUncertain = samples.every((s) => /uncertain/i.test(String(s.j.verdict || "")));
  const uncertain = overall == null || (spread != null && spread >= 3) || (lite && spread != null && spread >= 2) || Boolean(stepA.hallucinationRisk) || modelSaysUncertain;
  const verdict = uncertain ? "uncertain" : overall >= 8 ? "on target" : overall >= 6 ? "close" : "off";
  const why = samples.map((s) => s.j.why || s.j.styleAccuracy?.why).filter(Boolean).join(" / ").slice(0, 400) + (stepA.hallucinationRisk ? ` [hallucination risk: ${stepA.events.length} heard events vs ${stepA.localOnsets} local onsets]` : "");
  const fixPrompt = samples.map((s) => s.j.fixPrompt).find(Boolean) || null;
  return {
    overall, dimensions: dims, scope, samples: samples.length, spread, markersPresent, markersMissing, markers: allMarkers.slice(0, 16), verdict, why, fixPrompt,
    provider: [stepA.provider, ...samples.map((s) => s.provider)].join("+"), ms: (stepA.ms || 0) + samples.reduce((a, s) => a + (s.ms || 0), 0),
    lite, judge: { model: samples[0].model, provider: samples[0].provider, lite, hearModel: stepA.model, fellBackFrom: uniq([...(stepA.fellBackFrom || []), ...samples.flatMap((s) => s.fellBackFrom), ...errors]) },
    abstained: uncertain, evidence: stepA, scoreNote: scoreNoteFor(lite),
  };
}

/** Pairwise authenticity: Gemini hears A then B (and B then A); the winner counts only when both orders agree.
 *  Returns { winner:'A'|'B'|null, confidence 0-1, why, aFlaws, bFlaws, provider, lite, ab, ba, scoreNote }. */
export async function compareAuthenticity(pathA, pathB, { genreTarget = "", scope = "drums" } = {}) {
  if (!geminiAvailable()) throw new Error("compareAuthenticity needs GEMINI_API_KEY");
  const [a, b] = await Promise.all([prepareGeminiAudio(pathA), prepareGeminiAudio(pathB)]);
  const q = `You will hear two clips, A then B. Which one is MORE authentic ${genreTarget ? "to this style: <<< " + String(genreTarget).slice(0, 1200) + " >>>" : "to its intended genre"}?${scope === "drums" ? " Both are drum loops: judge drum sounds, groove, swing, era, production character only." : ""} Return ONLY JSON: {"winner": "A"|"B", "confidence": 0.5-1.0, "why": "<2 sentences naming the sounds/patterns that decide it>", "aFlaws": "<1 line>", "bFlaws": "<1 line>"}`;
  const run = async (first, second) => {
    const r = await geminiCascade([{ text: "Clip A:" }, audioPart(first), { text: "Clip B:" }, audioPart(second), { text: q }], q, { temperature: 0.1, judge: true });
    const out = extractJson(r.text);
    return { winner: out.winner === "B" ? "B" : "A", confidence: Math.min(1, Math.max(0.5, Number(out.confidence) || 0.5)), why: out.why || "", aFlaws: out.aFlaws || "", bFlaws: out.bFlaws || "", provider: r.provider, model: r.model, lite: Boolean(r.lite), fellBackFrom: r.fellBackFrom || [] };
  };
  const ab = await run(a, b);
  const baRaw = await run(b, a);
  const ba = { ...baRaw, winner: baRaw.winner === "A" ? "B" : "A", aFlaws: baRaw.bFlaws, bFlaws: baRaw.aFlaws };   // mapped back to the caller's A/B
  const lite = ab.lite || ba.lite;
  const provider = ab.provider === ba.provider ? ab.provider : `${ab.provider}+${ba.provider}`;
  if (ab.winner !== ba.winner) return { winner: null, confidence: 0.5, why: "order-dependent", aFlaws: ab.aFlaws, bFlaws: ab.bFlaws, provider, lite, ab, ba, scoreNote: scoreNoteFor(lite) };
  return { winner: ab.winner, confidence: Math.min(ab.confidence, ba.confidence), why: ab.why, aFlaws: ab.aFlaws, bFlaws: ab.bFlaws, provider, lite, ab, ba, scoreNote: scoreNoteFor(lite) };
}
