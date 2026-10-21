// Audio -> MIDI notes via the MuScriptor Space on Hugging Face (polyphonic music transcription, Gradio queue API).
// Same protocol as lib/ears.js. Needs HF_TOKEN in .env. Also exports a dependency-free Standard MIDI File parser.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const fetchT = (url, opts = {}, ms = 60000) => fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(ms) });
import os from "node:os";

const SPACE = process.env.TRANSCRIBE_SPACE_URL || "https://hugging-apps-muscriptor-music-transcription.hf.space";
const DEFAULT_TIMEOUT_MS = Number(process.env.TRANSCRIBE_TIMEOUT_MS || 240000);
const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".tmp");
let fnIndexCache = null;

export const transcribeAvailable = () => Boolean(process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN);
function authHeaders() {
  const tok = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;
  return tok ? { authorization: `Bearer ${tok}` } : {};
}
async function fnIndex() {
  if (fnIndexCache != null) return fnIndexCache;
  const cfg = await (await fetchT(`${SPACE}/config`, { headers: authHeaders() })).json();
  const dep = cfg.dependencies.find((d) => d.api_name === "transcribe");
  if (!dep) throw new Error("transcribe: Space has no 'transcribe' endpoint");
  fnIndexCache = { id: dep.id, trigger: dep.targets?.[0]?.[0] ?? null };
  return fnIndexCache;
}
async function uploadFile(filePath) {
  const form = new FormData();
  form.append("files", new Blob([await fs.readFile(filePath)], { type: "audio/wav" }), path.basename(filePath));
  const res = await fetchT(`${SPACE}/gradio_api/upload`, { method: "POST", headers: authHeaders(), body: form });
  if (!res.ok) throw new Error(`transcribe upload ${res.status}: ${await res.text()}`);
  const [serverPath] = await res.json();
  return { path: serverPath, orig_name: path.basename(filePath), meta: { _type: "gradio.FileData" }, mime_type: "audio/wav", size: (await fs.stat(filePath)).size };
}

// ---------------- Standard MIDI File parser (format 0 and 1) ----------------
function readVlq(buf, pos) {
  let n = 0, b;
  do { b = buf[pos++]; n = (n << 7) | (b & 0x7f); } while (b & 0x80);
  return [n >>> 0, pos];
}
/** parseMidi(buffer) -> { ppq, tempoBpm, tracks:[{ name, notes:[{ pitch, startTick, durationTick, velocity, channel }] }] } */
export function parseMidi(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.toString("latin1", 0, 4) !== "MThd") throw new Error("not a MIDI file (no MThd)");
  const headerLen = buf.readUInt32BE(4);
  const format = buf.readUInt16BE(8);
  const nTracks = buf.readUInt16BE(10);
  const division = buf.readUInt16BE(12);
  if (division & 0x8000) throw new Error("SMPTE time division not supported");
  const ppq = division || 96;
  let pos = 8 + headerLen;
  let tempoBpm = null;
  const tracks = [];
  for (let t = 0; t < nTracks && pos + 8 <= buf.length; t++) {
    if (buf.toString("latin1", pos, pos + 4) !== "MTrk") throw new Error(`track ${t}: expected MTrk at ${pos}`);
    const len = buf.readUInt32BE(pos + 4);
    const end = pos + 8 + len;
    pos += 8;
    let tick = 0, status = 0, name = "";
    const notes = [], open = new Map(); // key ch:pitch -> stack of {startTick, velocity}
    while (pos < end) {
      let delta; [delta, pos] = readVlq(buf, pos); tick += delta;
      let b = buf[pos];
      if (b === 0xff) { // meta
        const type = buf[pos + 1]; let mlen; [mlen, pos] = readVlq(buf, pos + 2);
        const data = buf.subarray(pos, pos + mlen); pos += mlen;
        if (type === 0x51 && mlen === 3 && tempoBpm == null) tempoBpm = 60_000_000 / ((data[0] << 16) | (data[1] << 8) | data[2]);
        else if (type === 0x03 && !name) name = data.toString("utf8");
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { let slen; [slen, pos] = readVlq(buf, pos + 1); pos += slen; continue; } // sysex
      if (b & 0x80) { status = b; pos++; } // else running status
      const hi = status & 0xf0, ch = status & 0x0f;
      const d1 = buf[pos], d2 = hi === 0xc0 || hi === 0xd0 ? undefined : buf[pos + 1];
      pos += hi === 0xc0 || hi === 0xd0 ? 1 : 2;
      const key = `${ch}:${d1}`;
      if (hi === 0x90 && d2 > 0) {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push({ startTick: tick, velocity: d2 });
      } else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
        const stack = open.get(key);
        if (stack && stack.length) { const on = stack.shift(); notes.push({ pitch: d1, startTick: on.startTick, durationTick: Math.max(1, tick - on.startTick), velocity: on.velocity, channel: ch }); }
      }
    }
    for (const [key, stack] of open) for (const on of stack) notes.push({ pitch: Number(key.split(":")[1]), startTick: on.startTick, durationTick: ppq, velocity: on.velocity, channel: Number(key.split(":")[0]) });
    notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    tracks.push({ name, notes });
    pos = end;
  }
  return { ppq, tempoBpm: tempoBpm || 120, format, tracks };
}

/** Convert a parsed MIDI file into clip-ready notes (beats), max 8 bars, max 64 notes. */
export function midiToNotes(parsed, { maxBars = 8, maxNotes = 64 } = {}) {
  const { ppq } = parsed;
  let notes = [];
  for (const t of parsed.tracks) for (const n of t.notes) {
    if (n.channel === 9) continue; // skip GM drums when transcribing tonal material; they'd be noise in Simpler
    notes.push({ pitch: n.pitch, startBeats: n.startTick / ppq, durationBeats: n.durationTick / ppq, velocity: Math.max(1, Math.min(127, n.velocity)) });
  }
  if (!notes.length) for (const t of parsed.tracks) for (const n of t.notes) notes.push({ pitch: n.pitch, startBeats: n.startTick / ppq, durationBeats: n.durationTick / ppq, velocity: Math.max(1, Math.min(127, n.velocity)) });
  // shift so the first note starts at the first bar boundary at or before it
  if (notes.length) { const first = Math.min(...notes.map((n) => n.startBeats)); const shift = Math.floor(first / 4) * 4; notes = notes.map((n) => ({ ...n, startBeats: n.startBeats - shift })); }
  const limitBeats = maxBars * 4;
  notes = notes.filter((n) => n.startBeats < limitBeats).map((n) => ({ ...n, durationBeats: Math.max(0.0625, Math.min(n.durationBeats, limitBeats - n.startBeats)) }));
  if (notes.length > maxNotes) notes = notes.sort((a, b) => b.velocity * b.durationBeats - a.velocity * a.durationBeats).slice(0, maxNotes);
  notes.sort((a, b) => a.startBeats - b.startBeats || a.pitch - b.pitch);
  notes = notes.map((n) => ({ pitch: n.pitch, startBeats: +n.startBeats.toFixed(4), durationBeats: +n.durationBeats.toFixed(4), velocity: n.velocity }));
  const endBeats = notes.reduce((m, n) => Math.max(m, n.startBeats + n.durationBeats), 0);
  const bars = Math.max(1, Math.min(maxBars, Math.ceil(endBeats / 4 || 1)));
  return { notes, bars };
}

/** transcribe(filePath, { instruments=[], temperature=0.1 }) -> { notes, bars, bpm, tracks:[{name,noteCount}], summary, midiPath, ms } */
export async function transcribe(filePath, { instruments = [], temperature = 0.1, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!transcribeAvailable()) throw new Error("transcribe: set HF_TOKEN in .env (free Hugging Face token) so the MuScriptor Space accepts our calls");
  const t0 = Date.now();
  const [file, fn] = await Promise.all([uploadFile(filePath), fnIndex()]);
  const session_hash = Math.random().toString(36).slice(2, 12);
  const join = await fetchT(`${SPACE}/gradio_api/queue/join`, {
    method: "POST", headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ data: [file, instruments, false, temperature], fn_index: fn.id, trigger_id: fn.trigger, session_hash, event_data: null }),
  });
  if (!join.ok) throw new Error(`transcribe join ${join.status}: ${await join.text()}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let output;
  try {
    const res = await fetchT(`${SPACE}/gradio_api/queue/data?session_hash=${session_hash}`, { headers: authHeaders(), signal: ctrl.signal });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    outer: while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.msg === "process_completed") {
          if (ev.output?.error) throw new Error(`transcribe: ${ev.output.error}`);
          output = ev.output?.data; break outer;
        }
        if (ev.msg === "unexpected_error") throw new Error(`transcribe: ${ev.message || "unexpected error"}`);
      }
    }
  } finally { clearTimeout(timer); }
  if (!output) throw new Error("transcribe: stream ended without a result");
  const [midiFile, summary] = output;
  const fileUrl = midiFile?.url || (midiFile?.path ? `${SPACE}/gradio_api/file=${midiFile.path}` : null);
  if (!fileUrl) throw new Error(`transcribe: no MIDI file in result (${String(summary || "").slice(0, 120)})`);
  const dl = await fetchT(fileUrl, { headers: authHeaders() });
  if (!dl.ok) throw new Error(`transcribe download ${dl.status}`);
  const midiBuf = Buffer.from(await dl.arrayBuffer());
  await fs.mkdir(TMP, { recursive: true });
  const midiPath = path.join(TMP, `transcribed-${Date.now()}.mid`);
  await fs.writeFile(midiPath, midiBuf);
  const parsed = parseMidi(midiBuf);
  const { notes, bars } = midiToNotes(parsed);
  return { notes, bars, bpm: Math.round(parsed.tempoBpm), tracks: parsed.tracks.map((t) => ({ name: t.name || "(untitled)", noteCount: t.notes.length })), summary: String(summary || "").trim(), midiPath, ms: Date.now() - t0 };
}
