// Stability AI Stable Audio client (Node 18 global fetch/FormData/Blob, no deps).
import { readFile } from "node:fs/promises";

const BASE = "https://api.stability.ai/v2beta/audio";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Stable Audio 3 is async: 202 -> {id}, then poll /results/{id}. */
async function pollResult(id) {
  for (let i = 0; i < 150; i++) {
    const res = await fetch(`${BASE}/results/${id}`, { headers: headers() });
    if (res.status === 200) return toResult(res);
    if (res.status !== 202) await fail(res);
    await sleep(2000);
  }
  throw new Error("Stability: timed out waiting for generation result");
}

function buildForm(fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== "") form.append(k, String(v));
  }
  return form;
}

async function submit(path, form) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: headers(), body: form });
  if (res.status === 200) return toResult(res);
  if (res.status === 202) return pollResult((await res.json()).id);
  await fail(res);
}

/**
 * Transform a wav (6-190 s) guided by a prompt. strength 0 = identical to input, 1 = ignore input.
 * -> { buffer: Buffer (wav bytes), seed }
 */
export async function audioToAudio({ wavPath, prompt, strength = 0.7, duration = 6, model = "stable-audio-2.5", seed = 0, steps } = {}) {
  if (!wavPath || !prompt) throw new Error("audioToAudio needs wavPath and prompt");
  const isV3 = model === "stable-audio-3";
  const form = buildForm({
    prompt, output_format: "wav", duration, strength, seed, steps,
    model: isV3 ? undefined : model,
  });
  form.append("audio", new Blob([await readFile(wavPath)], { type: "audio/wav" }), "input.wav");
  return submit(isV3 ? "/stable-audio/audio-to-audio" : "/stable-audio-2/audio-to-audio", form);
}

/** Generate audio from text only. -> { buffer, seed } */
export async function textToAudio({ prompt, duration = 6, model = "stable-audio-2.5", seed = 0, steps } = {}) {
  if (!prompt) throw new Error("textToAudio needs prompt");
  const isV3 = model === "stable-audio-3";
  const form = buildForm({ prompt, output_format: "wav", duration, seed, steps, model: isV3 ? undefined : model });
  return submit(isV3 ? "/stable-audio/text-to-audio" : "/stable-audio-2/text-to-audio", form);
}
