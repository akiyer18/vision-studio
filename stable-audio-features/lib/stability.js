// Stability AI Stable Audio client (Node 18 global fetch/FormData/Blob, no deps).
import { readFile } from "node:fs/promises";

const BASE = "https://api.stability.ai/v2beta/audio";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Longest clip each model will render, in seconds. */
export const MAX_SEC = { "stable-audio-2.5": 190, "stable-audio-3": 380 };
const POLL_DEADLINE_MS = 10 * 60 * 1000, POLL_REQUEST_MS = 30000, POLL_MIN_MS = 2000, POLL_MAX_MS = 10000;
const SUBMIT_REQUEST_MS = 120000, SUBMIT_RETRY_AFTER_MS = 3000;
const RETRYABLE = new Set([429, 502, 503, 504]);

function apiKey() {
  const key = process.env.STABILITY_API_KEY;
  if (!key || key.includes("paste-your-key")) throw new Error("STABILITY_API_KEY is not set in .env");
  return key;
}

function headers() {
  return { authorization: `Bearer ${apiKey()}`, accept: "audio/*" };
}

async function fail(res) {
  throw new Error(`Stability ${res.status}: ${await res.text()}`);
}

async function toResult(res) {
  const buffer = Buffer.from(await res.arrayBuffer());
  const seed = Number(res.headers.get("seed")) || 0;
  return { buffer, seed };
}

/** Validate/normalize generation parameters; throws a clear error on out-of-range values. */
export function validateParams({ model = "stable-audio-2.5", duration, steps, cfg_scale, strength, seed } = {}) {
  if (!(model in MAX_SEC)) throw new Error(`Stability: unknown model "${model}" (use ${Object.keys(MAX_SEC).join(" or ")})`);
  const out = { model };
  if (duration !== undefined && duration !== null && duration !== "") {
    const d = Number(duration);
    if (!Number.isFinite(d) || d <= 0) throw new Error(`Stability: duration must be a positive number of seconds (got ${duration})`);
    if (d > MAX_SEC[model]) throw new Error(`Stability: duration ${d}s exceeds the ${MAX_SEC[model]}s limit of ${model}`);
    out.duration = d;
  }
  if (steps !== undefined && steps !== null && steps !== "") {
    const s = Number(steps);
    if (!Number.isInteger(s) || s < 4 || s > 8) throw new Error(`Stability: steps must be an integer 4-8 (got ${steps})`);
    out.steps = s;
  }
  if (cfg_scale !== undefined && cfg_scale !== null && cfg_scale !== "") {
    const c = Number(cfg_scale);
    if (!Number.isFinite(c) || c < 1 || c > 25) throw new Error(`Stability: cfg_scale must be 1-25 (got ${cfg_scale})`);
    out.cfg_scale = c;
  }
  if (strength !== undefined && strength !== null && strength !== "") {
    const st = Number(strength);
    if (!Number.isFinite(st) || st < 0 || st > 1) throw new Error(`Stability: strength must be 0-1 (got ${strength})`);
    out.strength = st;
  }
  if (seed !== undefined && seed !== null && seed !== "") {
    const sd = Number(seed);
    if (!Number.isInteger(sd) || sd < 0 || sd > 4294967295) throw new Error(`Stability: seed must be an unsigned 32-bit integer (got ${seed})`);
    out.seed = sd;
  }
  return out;
}

/** Stable Audio 3 is async: 202 -> {id}, then poll /results/{id}. Deadline 10 min, 30 s per request, backoff 2 s -> 10 s; 429/5xx on a poll are tolerated. */
async function pollResult(id) {
  const t0 = Date.now();
  let wait = POLL_MIN_MS, softErrors = 0;
  while (Date.now() - t0 < POLL_DEADLINE_MS) {
    let res;
    try { res = await fetch(`${BASE}/results/${id}`, { headers: headers(), signal: AbortSignal.timeout(POLL_REQUEST_MS) }); }
    catch (e) { if (++softErrors > 6) throw new Error(`Stability: polling failed repeatedly (${e.message})`); await sleep(wait); wait = Math.min(POLL_MAX_MS, wait * 1.5); continue; }
    if (res.status === 200) return toResult(res);
    if (res.status === 202 || res.status === 429 || res.status >= 500) {
      if (res.status !== 202 && ++softErrors > 6) await fail(res);
      await res.arrayBuffer().catch(() => {});
      await sleep(wait); wait = Math.min(POLL_MAX_MS, wait * 1.5);
      continue;
    }
    await fail(res);
  }
  throw new Error("Stability: timed out waiting for generation result (10 min)");
}

function buildForm(fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== "") form.append(k, String(v));
  }
  return form;
}

/** POST with a 120 s timeout; one retry after 3 s on 429/502/503/504. `makeForm` rebuilds the body (a FormData cannot be re-sent). */
async function submit(path, makeForm) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: headers(), body: await makeForm(), signal: AbortSignal.timeout(SUBMIT_REQUEST_MS) });
    if (res.status === 200) return toResult(res);
    if (res.status === 202) return pollResult((await res.json()).id);
    if (RETRYABLE.has(res.status) && attempt === 0) { await res.arrayBuffer().catch(() => {}); await sleep(SUBMIT_RETRY_AFTER_MS); continue; }
    await fail(res);
  }
}

/**
 * Transform a wav (6-190 s) guided by a prompt. strength 0 = identical to input, 1 = ignore input.
 * -> { buffer: Buffer (wav bytes), seed }
 */
export async function audioToAudio({ wavPath, prompt, strength = 0.7, duration = 6, model = "stable-audio-2.5", seed = 0, steps, cfg_scale } = {}) {
  if (!wavPath || !prompt) throw new Error("audioToAudio needs wavPath and prompt");
  const p = validateParams({ model, duration, strength, seed, steps, cfg_scale });
  const isV3 = model === "stable-audio-3";
  const audio = await readFile(wavPath);
  const makeForm = () => {
    const form = buildForm({ prompt, output_format: "wav", duration: p.duration, strength: p.strength, seed: p.seed, steps: p.steps, cfg_scale: p.cfg_scale, model: isV3 ? undefined : model });
    form.append("audio", new Blob([audio], { type: "audio/wav" }), "input.wav");
    return form;
  };
  return submit(isV3 ? "/stable-audio/audio-to-audio" : "/stable-audio-2/audio-to-audio", makeForm);
}

/** Generate audio from text only. -> { buffer, seed } */
export async function textToAudio({ prompt, duration = 6, model = "stable-audio-2.5", seed = 0, steps, cfg_scale } = {}) {
  if (!prompt) throw new Error("textToAudio needs prompt");
  const p = validateParams({ model, duration, seed, steps, cfg_scale });
  const isV3 = model === "stable-audio-3";
  const makeForm = () => buildForm({ prompt, output_format: "wav", duration: p.duration, seed: p.seed, steps: p.steps, cfg_scale: p.cfg_scale, model: isV3 ? undefined : model });
  return submit(isV3 ? "/stable-audio/text-to-audio" : "/stable-audio-2/text-to-audio", makeForm);
}
