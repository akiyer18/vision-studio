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
const GEMINI_FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-lite-latest").split(",").map((x) => x.trim()).filter(Boolean);
async function listenGemini(filePath, question, temperature = 0.4, think = false, preferred = null) {
  const data = (await fs.readFile(filePath)).toString("base64");
  const models = preferred ? [...preferred, ...[GEMINI_MODEL, ...GEMINI_FALLBACKS].filter((m) => !preferred.includes(m))] : [GEMINI_MODEL, ...GEMINI_FALLBACKS.filter((m) => m !== GEMINI_MODEL)];
  const errors = [];
  for (const model of models) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await geminiOnce(model, data, question, temperature, !think); }
      catch (e) {
        lastErr = e;
        if (/prepayment|credits|API key|PERMISSION_DENIED|401|403/i.test(e.message)) { errors.push(`${model}: ${e.message.slice(0, 160)}`); throw new Error(`gemini: ${errors.join(" | ")}`); }   // account-level: stop
        const transient = /\b(503|429|500)\b|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(e.message);
        if (!transient) break;                       // 400/404 etc: try the next model instead of hammering this one
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    errors.push(`${model}: ${(lastErr?.message || "").replace(/\s+/g, " ").slice(0, 140)}`);
  }
  throw new Error(`gemini: all models failed -> ${errors.join(" | ")}`);
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
  if (res.status === 400 && noThinking) return geminiOnce(model, data, question, temperature, false);   // some models reject thinkingConfig: retry plain
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
  const think = Boolean(opts.think);
  const models = Array.isArray(opts.models) && opts.models.length ? opts.models : null;
  const order = (process.env.EARS_PROVIDER || "auto") === "gemini" ? ["gemini", "flamingo"] : ["flamingo", "gemini"];
  const errors = [];
  for (const p of order) {
    if (p === "flamingo" && !earsAvailable()) { errors.push(`flamingo: ${earsStatus()}`); continue; }
    if (p === "gemini" && !geminiAvailable()) { errors.push("gemini: no GEMINI_API_KEY"); continue; }
    try { return p === "gemini" ? await listenGemini(filePath, question, temperature, think, models) : { ...(await listenFlamingo(filePath, question, opts)), provider: "flamingo" }; }
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
{"tempoGuessBpm": number|null, "keyGuess": string|null, "genre": string, "era": "<decade/scene, e.g. 'early-2000s West Coast'>", "drums": {"kick": "<8-14 words a sound designer would type into a text-to-audio model>", "snare": "...", "hats": "...", "perc": "..."}, "percussionLayers": ["<each extra percussion element you hear: snaps, claps, shakers, tambourine, rimshot, congas, vinyl crackle ...>"], "bassType": "<what kind of bass: 808 glide / sub sine / Moog-style synth / picked electric / Reese / none, plus register and how it moves against the kick>", "groove": {"swing": "straight|light|medium|heavy", "feel": "<pushed/laid back/on the grid, ghost notes, fills: 1 sentence>"}, "lowEnd": "<1 sentence: sub vs kick relationship>", "space": "<1 sentence: reverb/room/delay character>", "vocals": "<1 sentence or null>", "hookDevice": "<what carries the hook: vocal chop, lead synth, string stab, piano riff, whistle, talkbox ... and where it sits in the bar>", "eraMarkers": ["<3 concrete sonic markers that date this to its era: specific drum machine sound, sample treatment, synth type, mix habit>"], "arrangement": "<1 sentence: sections, drops, how often things change>", "expensive": ["<3 concrete things that make it sound produced/expensive>"], "avoid": ["<2 things that would cheapen it>"]}
Be concrete and technical, no praise.`;
  const r = await listen(filePath, q, { temperature: 0.2 });
  return { ...extractJson(r.text), provider: r.provider, ms: r.ms };
}

/** Production-first critique shape; every field present so callers never crash. */
export function normalizeCritique(obj) {
  const o = obj && typeof obj === "object" ? obj : {};
  const str = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null).map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : []);
  const sa = o.styleAccuracy && typeof o.styleAccuracy === "object" ? o.styleAccuracy : {};
  const bass = o.bass && typeof o.bass === "object" ? o.bass : {};
  const verdict = ["on target", "close", "off"].includes(String(sa.verdict || "").toLowerCase()) ? String(sa.verdict).toLowerCase() : null;
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

export async function critiqueMix(renderPath, refPath, { genreTarget, mixDetail = false, hints } = {}) {
  const r = await listen(renderPath, CRITIQUE_PROMPT({ genreTarget, mixDetail, hints }), { temperature: 0.2 });
  const parsed = extractJson(r.text);
  const out = normalizeCritique({ ...parsed, provider: r.provider, ms: r.ms });
  if (refPath) {
    const ours = { styleRead: out.styleRead, drums: out.drums, bass: out.bass, harmonyMelody: out.harmonyMelody, soundDesign: out.soundDesign, groove: out.groove };
    const q2 = `You are a record producer. Earlier you described OUR beat as: ${JSON.stringify(ours)}. Now you are hearing the REFERENCE track the producer wants to get closer to. Return ONLY JSON: {"referenceRead": "<1 sentence: what the reference does with drums, bass, hook, texture>", "closer": ["<3 concrete sound or pattern moves that would bring our beat toward the reference: which element, what sound, what pattern>"], "keep": ["<2 things in our beat already aligned with the reference>"]}. Production language only, no loudness or dB talk.`;
    try { const r2 = await listen(refPath, q2, { temperature: 0.2 }); out.vsReference = extractJson(r2.text); } catch (e) { out.vsReference = { error: e.message }; }
  }
  return out;
}
export async function labelPiece(filePath) {
  const q = `This is a short audio slice (< 1 s). Return ONLY JSON: {"type": "vowel|consonant|breath|noise|drum|tone|other", "pitched": true|false, "pitchNote": "<e.g. A3 or null>", "character": "<5 words>", "usableAs": "<chop-melody|perc-hit|texture|transient-layer|discard>"}`;
  const r = await listen(filePath, q, { temperature: 0.1 });
  return { ...extractJson(r.text), provider: r.provider };
}

/** Listen to a generated sound, compare with the intent, and propose a revised Stable Audio prompt. */
export async function proposePrompt(filePath, { intent, currentPrompt, kind = "drum" }) {
  const q = `You are a sound designer who writes prompts for a text-to-audio model (Stable Audio). The producer wants: "${intent}". The current prompt was: "${currentPrompt}". Listen to the result.
Return ONLY JSON: {"heard": "<what it actually sounds like, 1 line>", "gap": "<what is missing or wrong vs the intent, 1 line>", "match": <0-10 integer>, "newPrompt": "<revised descriptive prompt, max 30 words, order: genre/style, source/instrument and how it sounds, envelope/decay, production (room, mic, processing); describe, never instruct; for a ${kind === "tone" ? "sustained single note" : "single hit"}>", "useAudioToAudio": <true if the current sound is close and should be used as the seed, false if it should be regenerated from text>, "strength": <0.3-0.8 when useAudioToAudio>}`;
  const r = await listen(filePath, q, { temperature: 0.2 });
  return { ...extractJson(r.text), provider: r.provider, ms: r.ms };
}

/** Strict genre-authenticity rubric (0-10 per dimension, calibrated). Returns { overall, dimensions, markersPresent, markersMissing, verdict, why, provider, ms }. */
export async function scoreGenre(filePath, { genreTarget = "", markers = [], scope = "full" } = {}) {
  const scopeNote = scope === "drums" ? "\nIMPORTANT: this is a DRUM LOOP only (no bass, no chords by design). Judge drums, groove, palette and era; set bass and arrangement to null and leave them out of the overall; do not list bass/chord markers as missing." : "";
  const q = `You are a strict A&R / producer judging whether this audio is AUTHENTIC ${genreTarget ? "to this style:\n<<< " + String(genreTarget).slice(0, 1400) + " >>>" : "to the style it seems to aim for"}.${scopeNote}
${markers.length ? "Check these concrete markers one by one: " + markers.slice(0, 12).join(" | ") : ""}
Calibration (be harsh): 9-10 = could sit on a classic record of the genre, every marker present; 7-8 = clearly the genre, one or two markers off; 5-6 = generic, "AI loop" feel, right tempo but wrong sounds or flat groove; 3-4 = wrong era or wrong sound palette; 0-2 = different genre. Most generated loops are 4-6. Do not give 8+ unless you can name why each marker is present.
Return ONLY JSON: {"dimensions": {"drums": n, "groove": n, "bass": n, "palette": n, "arrangement": n, "era": n}, "overall": n, "markersPresent": ["..."], "markersMissing": ["..."], "verdict": "on target|close|off", "why": "<2 sentences naming the specific sounds/patterns that decide it>", "fixPrompt": "<one revised text-to-audio prompt body (<= 30 words) that would move it toward the target>"}`;
  // the judge varies a lot run to run on the lite models: keep Gemini's reasoning on and take two samples
  const samples = [];
  const JUDGE_MODELS = (process.env.GEMINI_JUDGE_MODELS || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest").split(",").map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < 2; i++) { try { const r = await listen(filePath, q, { temperature: 0.1, think: true, models: JUDGE_MODELS }); samples.push({ j: extractJson(r.text), provider: r.provider, ms: r.ms }); } catch (e) { if (!samples.length && i === 1) throw e; } }
  if (!samples.length) throw new Error("scoreGenre: no sample");
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const dimKeys = ["drums", "groove", "bass", "palette", "arrangement", "era"];
  const merged = {}; for (const k of dimKeys) { const v = samples.map((s) => Number(s.j.dimensions?.[k])).filter(Number.isFinite); merged[k] = v.length ? Math.round(mean(v)) : null; }
  const spread = Math.max(0, ...dimKeys.map((k) => { const v = samples.map((s) => Number(s.j.dimensions?.[k])).filter(Number.isFinite); return v.length > 1 ? Math.max(...v) - Math.min(...v) : 0; }));
  const j = { ...samples[0].j, dimensions: merged, markersPresent: samples[0].j.markersPresent, markersMissing: samples[0].j.markersMissing, why: samples.map((s) => s.j.why).filter(Boolean).join(" / ").slice(0, 400) };
  const r = { provider: samples.map((s) => s.provider).join("+"), ms: samples.reduce((a, s) => a + (s.ms || 0), 0) };
  const dims = j.dimensions || {};
  if (scope === "drums") { dims.bass = null; dims.arrangement = null; }
  const vals = Object.values(dims).map(Number).filter((v) => Number.isFinite(v) && v !== 0 || v === 0 && false);
  const overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : (Number.isFinite(Number(j.overall)) ? Number(j.overall) : null);   // overall = mean of applicable dimensions
  const verdict = overall == null ? (j.verdict || null) : overall >= 7 ? "on target" : overall >= 5 ? "close" : "off";
  return { overall, dimensions: dims, scope, samples: samples.length, spread, markersPresent: j.markersPresent || [], markersMissing: j.markersMissing || [], verdict, why: j.why || "", fixPrompt: j.fixPrompt || null, provider: r.provider, ms: r.ms };
}

/** Pairwise authenticity: Gemini hears A then B in one request and picks the more genre-true one. Returns { winner:'A'|'B', confidence 0-1, why }. */
export async function compareAuthenticity(pathA, pathB, { genreTarget = "", scope = "drums" } = {}) {
  if (!geminiAvailable()) throw new Error("compareAuthenticity needs GEMINI_API_KEY");
  const [a, b] = await Promise.all([fs.readFile(pathA), fs.readFile(pathB)]);
  const q = `You will hear two clips, A then B. Which one is MORE authentic ${genreTarget ? "to this style: <<< " + String(genreTarget).slice(0, 1200) + " >>>" : "to its intended genre"}?${scope === "drums" ? " Both are drum loops: judge drum sounds, groove, swing, era, production character only." : ""} Return ONLY JSON: {"winner": "A"|"B", "confidence": 0.5-1.0, "why": "<2 sentences naming the sounds/patterns that decide it>", "aFlaws": "<1 line>", "bFlaws": "<1 line>"}`;
  const JUDGE_MODELS = (process.env.GEMINI_JUDGE_MODELS || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite").split(",").map((x) => x.trim()).filter(Boolean);
  let lastErr;
  for (const model of JUDGE_MODELS) {
    try {
      const res = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Clip A:" }, { inlineData: { mimeType: "audio/wav", data: a.toString("base64") } }, { text: "Clip B:" }, { inlineData: { mimeType: "audio/wav", data: b.toString("base64") } }, { text: q }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 2048 } }),
      }, 90000);
      if (!res.ok) { const body = await res.text(); lastErr = new Error(`gemini(${model}) ${res.status}: ${body.slice(0, 160)}`); if (/prepayment|credits|API key|PERMISSION/i.test(body)) throw lastErr; continue; }
      const j = await res.json();
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
      const out = extractJson(text);
      return { winner: out.winner === "B" ? "B" : "A", confidence: Number(out.confidence) || 0.5, why: out.why || "", aFlaws: out.aFlaws || "", bFlaws: out.bFlaws || "", provider: `gemini:${model}` };
    } catch (e) { lastErr = e; if (/prepayment|credits|API key|PERMISSION/i.test(e.message)) throw e; }
  }
  throw lastErr || new Error("compareAuthenticity failed");
}
