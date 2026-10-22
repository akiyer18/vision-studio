import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toWav, makeOneShotLoop, makeLoopInput, sliceFirstHit, normalize } from './lib/audio.js';
import { audioToAudio, textToAudio } from './lib/stability.js';
import { describeToPattern } from './lib/pattern.js';
import { patternToMidi } from './lib/midi.js';
import { GM_DRUM_NOTES } from './lib/pattern.js';
import { ffmpeg } from './lib/audio.js';
import { hitsPrompt, extractHits, HIT_ROLES } from './lib/hits.js';
import { composePrompt } from './lib/prompts.js';
import * as synthLocal from './lib/synthlocal.js';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFileCb);

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.ADE_OUT_DIR || path.join(os.homedir(), 'Music/Ableton/User Library/ADE Hack');
const TMP = path.join(here, '.tmp');
const PORT = Number(process.env.PORT || 3000);
await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(TMP, { recursive: true });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(here, 'public')));
app.use('/out', express.static(OUT_DIR));
const upload = multer({ dest: TMP, limits: { fileSize: 50 * 1024 * 1024 } });

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound';
const hasKey = (v) => Boolean(v && !/paste-your-key/i.test(v));
function insideDir(dir, p) {
  const r = path.relative(dir, path.resolve(String(p || '')));
  return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r);
}
const insideOut = (p) => insideDir(OUT_DIR, p);
const insideTmp = (p) => insideDir(TMP, p);
const audioPathOk = (p) => insideOut(p) || insideTmp(p);
/** First preset name from a live-presets.md cell: "Wobble Bass (speed garage warp), Sub Bass" -> "Wobble Bass" (parentheticals break Live's exact/alias match). */
const presetName = (cell) => String(cell || '').split(/[,|/]/)[0].replace(/\s*\(.*?\)\s*/g, '').trim();

async function publish(buffer, name, ext, kind) {
  const file = `${slug(name)}-${Date.now()}${ext}`;
  const full = path.join(OUT_DIR, file);
  await fs.writeFile(full, buffer);
  return { name: file, url: `/out/${encodeURIComponent(file)}`, path: full, kind };
}

// Prompt grammar from the Stable Audio guide: tags first, then genre -> instrument/rhythm -> mood/production -> performance detail.
function buildPrompt(prompt, mode, kind) {
  const p = String(prompt || '').trim().replace(/^(TrackType|Genre|Format):[^,]+,\s*/i, '');
  if (kind === 'raw') return p;
  if (kind === 'tone') return `TrackType: Instrument, ${p || 'analog synth'}, a single sustained note, clean, no drums, no percussion`;
  if (mode === 'loop') return `TrackType: Instrument, ${p || 'drum loop'}, drum loop, tight and dry, no melody`;
  return `TrackType: SFX, ${p || 'drum hit'}, a single hit, clean transient, natural decay, close-miked, dry, no melody`;
}
const LOOP_MODEL = process.env.STABILITY_LOOP_MODEL || 'stable-audio-3';   // async but longer/better for loops, textures, restyles

const scriptState = { running: null, at: 0 };   // the ADEHack version Live is actually running (health handshake), cached 30 s
function versionAtLeast(have, want) {
  const a = String(have || '0').split('.').map((x) => parseInt(x, 10) || 0), b = String(want).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d > 0; }
  return true;
}
async function liveVersion() {
  let installed = null, running = null, reachable = false;
  try { installed = (await fs.readFile(path.join(here, 'ableton', 'VERSION'), 'utf8')).trim(); } catch {}
  try {
    const { sendToLive } = await import('./ableton/client.js');
    await Promise.race([liveQueue.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);   // let pending Live commands drain (max 3 s) so a busy Live does not read as 'old script'
    const r = await sendToLive({ cmd: 'version' }, { timeoutMs: 4000 });
    reachable = true;
    running = r?.ok ? String(r.version) : 'pre-5';   // older scripts answer "unknown cmd"
    scriptState.running = running; scriptState.at = Date.now();
  } catch { reachable = false; }
  return { reachable, running, installed, restartNeeded: Boolean(reachable && installed && running !== installed) };
}
/** True when the script Live runs supports `want` (e.g. '5.8'); refreshes the handshake when the cache is older than 30 s. */
async function scriptAtLeast(want) {
  if (!scriptState.running || Date.now() - scriptState.at > 30000) { try { await liveVersion(); } catch {} }
  return Boolean(scriptState.running && scriptState.running !== 'pre-5' && versionAtLeast(scriptState.running, want));
}
app.get('/api/health', async (_req, res) => {
  res.json({
    live: await liveVersion(),
    stabilityKey: hasKey(process.env.STABILITY_API_KEY),
    anthropicKey: hasKey(process.env.ANTHROPIC_API_KEY),
    ears: Boolean(process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || process.env.GEMINI_API_KEY),
    earsStatus: (await import('./lib/ears.js')).earsStatus(),
    earsProviders: (await import('./lib/ears.js')).earsProviders(),
    gemini: (await import('./lib/ears.js')).geminiStatus(),
    geminiStatus: (await import('./lib/ears.js')).geminiStatusText(),
    outDir: OUT_DIR,
  });
});

const TONAL = new Set(['synth', 'saw', 'bass', 'pad', 'lead', 'pluck', 'keys', 'melody', 'rhodes', 'piano', 'chords', 'tone']);
// The whole sound pipeline as a function: (recording?) -> Stability -> one-shot + full file in the Ableton folder.
const roleOfName = (n) => { const h = String(n || '').toLowerCase(); if (/open ?hat|ohat|hat_open/.test(h)) return 'hat_open'; if (/hat|hh|hihat/.test(h)) return 'hat_closed'; for (const r of HIT_ROLES) if (h.includes(r.replace('_', ' ')) || h.includes(r)) return r; if (/snap/.test(h)) return 'snap'; return null; };
async function synthesize({ prompt = '', mode = 'oneshot', kind, name = 'sound', role, audioPath, offsetSeconds, strength = 0.7, model = 'stable-audio-2.5', oneshotSeconds, alternates = 3 }) {
  if (!hasKey(process.env.STABILITY_API_KEY)) throw new Error('STABILITY_API_KEY is not set in .env');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  if (!audioPath) mode = 'text';
  if (!kind) kind = TONAL.has(String(name).toLowerCase()) ? 'tone' : undefined;
  const files = [];
  let result;
  const wantSec = Number.isFinite(Number(oneshotSeconds)) && Number(oneshotSeconds) > 0 ? clamp(Number(oneshotSeconds), 0.2, 20) : (kind === 'tone' ? 2.5 : 1.0);
  const genSec = Math.max(6, Math.ceil(wantSec + 1));
  const hitRole = kind === 'tone' || kind === 'raw' ? null : (HIT_ROLES.includes(role) ? role : roleOfName(role) || roleOfName(name) || roleOfName(prompt));
  if (mode === 'text' && hitRole) {
    // Drums: Stable Audio cannot do "a single kick" (it returns a sub drone) but it is excellent at a SEQUENCE of hits.
    // Generate 10 s of separate hits, keep the ones that sound like the role, cut each with its natural tail, pick the best.
    const genreTitle = lastBuild.genreTarget ? String(lastBuild.genreTarget).split(':')[0].replace(/\s*\(.*\)\s*$/, '') : '';
    // the seed decides whether the model honours "separate hits": two phrasings in parallel, pool every usable hit, one retry
    const want = clamp(Number(alternates) || 3, 1, 4);
    const round = async (variants) => Promise.all(variants.map(async (v) => {
      const full = hitsPrompt({ role: hitRole, character: prompt, genreTitle, variant: v });
      const r = await textToAudio({ prompt: full, duration: 10, model: 'stable-audio-2.5' });
      const gen = path.join(TMP, `${id}-hits-${v}.wav`); await fs.writeFile(gen, r.buffer);
      const ex = await extractHits(gen, { role: hitRole, max: want, outDir: TMP, name: `${id}-${hitRole}-${v}` });
      return { full, r, gen, ex };
    }));
    let rounds = await round([0, 1]);
    let pool = rounds.flatMap((x) => x.ex.hits.map((h) => ({ ...h, from: x })));
    if (pool.length < 2) { rounds = rounds.concat(await round([2])); pool = rounds.flatMap((x) => x.ex.hits.map((h) => ({ ...h, from: x }))); }
    pool.sort((a, b) => b.score - a.score);
    if (pool.length) {
      const chosen = pool.slice(0, want);
      for (const [i, h] of chosen.entries()) files.push({ ...(await publish(await fs.readFile(h.path), i ? `${name}-${String.fromCharCode(65 + i)}` : name, '.wav', i ? 'alt' : 'oneshot')), label: String.fromCharCode(65 + i), length: h.length, centroidHz: h.centroidHz, subShare: h.subShare, score: h.score });
      const best = chosen[0].from;
      files.push(await publish(best.r.buffer, `${name}-hits`, '.wav', 'loop'));
      return { files, seed: best.r.seed, mode, role: hitRole, prompt: best.full, hits: { generations: rounds.length, total: rounds.reduce((n, x) => n + x.ex.total, 0), matching: rounds.reduce((n, x) => n + x.ex.matching, 0) }, alternates: files.filter((f) => f.kind === 'alt') };
    }
    // nothing usable came back: fall through to the single-hit path on a fresh generation
    result = await textToAudio({ prompt: buildPrompt(prompt, 'oneshot', kind), duration: genSec, model });
  } else if (mode === 'text') {
    result = await textToAudio({ prompt: buildPrompt(prompt, 'oneshot', kind), duration: genSec, model });
  } else {
    const raw = path.join(TMP, `${id}-raw.wav`);
    const input = path.join(TMP, `${id}-input.wav`);
    await toWav(audioPath, raw);
    const offset = Number(offsetSeconds);
    if (Number.isFinite(offset) && offset > 0) {
      const cut = path.join(TMP, `${id}-cut.wav`);
      await ffmpeg(['-ss', String(Math.max(0, offset - 0.015)), '-i', raw, '-t', '1.2', cut]);
      await fs.rename(cut, raw);
    }
    if (mode === 'loop') await makeLoopInput(raw, input);
    else await makeOneShotLoop(raw, input);
    files.push(await publish(await fs.readFile(raw), `${name}-hum`, '.wav', 'raw'));
    result = await audioToAudio({ wavPath: input, prompt: buildPrompt(prompt, mode, kind), strength: Number.isFinite(Number(strength)) && Number(strength) > 0 ? clamp(Number(strength), 0.01, 1) : 0.7, duration: genSec, model });
  }
  const gen = path.join(TMP, `${id}-gen.wav`);
  await fs.writeFile(gen, result.buffer);
  if (mode !== 'loop') {
    const one = path.join(TMP, `${id}-oneshot.wav`);
    const norm = path.join(TMP, `${id}-oneshot-norm.wav`);
    await sliceFirstHit(gen, one, { seconds: wantSec });
    await normalize(one, norm, kind === 'tone' ? -1 : -3);
    files.unshift(await publish(await fs.readFile(norm), name, '.wav', 'oneshot'));
  }
  files.push(await publish(result.buffer, `${name}-full`, '.wav', 'loop'));
  return { files, seed: result.seed, mode };
}

app.post('/api/synth', upload.single('audio'), async (req, res) => {
  try {
    const { prompt = '', name = 'sound', kind, mode = 'oneshot', model, strength, oneshotSeconds, offsetSeconds } = req.body;
    const out = await synthesize({ prompt, name, kind, mode, model: model || 'stable-audio-2.5', strength: parseFloat(strength), oneshotSeconds, offsetSeconds, audioPath: req.file?.path });
    res.json(out);
  } catch (e) {
    console.error('[synth]', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (req.file) fs.unlink(req.file.path).catch(() => {});
  }
});

app.post('/api/pattern', async (req, res) => {
  try {
    const { description = '', name, mapping = 'gm' } = req.body || {};
    const bpm = req.body?.bpm ? clamp(Number(req.body.bpm), 40, 300) : undefined;
    const bars = clamp(Number(req.body?.bars), 1, 8) || 1;
    const { pattern, source } = await describeToPattern({ description, bpm, bars });
    const buffer = patternToMidi(pattern, { mapping: mapping === 'single' ? 'single' : 'gm', singleNote: 60 });
    const midi = await publish(buffer, name || pattern.name || 'pattern', '.mid', 'midi');
    res.json({ pattern, source, midi });
  } catch (e) {
    console.error('[pattern]', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reveal', (req, res) => {
  const p = path.resolve(String(req.body?.path || ''));
  if (!insideOut(p)) return res.status(400).json({ error: 'path outside output dir' });
  execFile('open', ['-R', p], (err) => (err ? res.status(500).json({ error: err.message }) : res.json({ ok: true })));
});

// Live 10's browser index only scans a Place once (when it is added), so freshly written files are invisible to
// browser.load_item. We therefore keep fixed "slot" files (ADE Kick.wav, ADE Saw.wav, ...) that get indexed once and
// overwrite them with the latest sound before each load. Simpler reads the file from disk, so it gets the new audio.
// Slot pool: Live keeps a loaded sample in memory, so a filename must not be reused while a track may still hold it.
// Each role has numbered slots (ADE Kick 1..6, ADE Synth 1..8); we rotate through them (counter persisted in .tmp).
const ROLE_OF = { kick: 'Kick', snare: 'Snare', clap: 'Clap', hat_closed: 'Hat', hat: 'Hat', hat_open: 'OpenHat', rim: 'Rim', perc: 'Perc', tom_low: 'Tom', tom_high: 'Tom', tom: 'Tom', ride: 'Perc', crash: 'Perc', drum: 'Snare', shaker: 'Perc', snap: 'Clap', cowbell: 'Perc', conga: 'Perc', vox: 'Synth', fx: 'Synth', texture: 'Synth',
  synth: 'Synth', saw: 'Synth', bass: 'Synth', pad: 'Synth', pluck: 'Synth', lead: 'Synth', keys: 'Synth', melody: 'Synth', rhodes: 'Synth', piano: 'Synth' };
// Slot files per role ("ADE Kick 1..N.wav" in the ADE Hack Place). Live indexes a Place once, so more slots need: create the
// extra numbered files (scripts/ or `touch`), then Places > remove + re-add "ADE Hack" (or restart Live) so they get indexed.
const SLOT_POOL = clamp(parseInt(process.env.SLOT_POOL, 10) || 8, 2, 32);
const POOL_SIZE = { Kick: SLOT_POOL, Snare: SLOT_POOL, Clap: SLOT_POOL, Hat: SLOT_POOL, OpenHat: SLOT_POOL, Rim: SLOT_POOL, Perc: SLOT_POOL, Tom: SLOT_POOL, Synth: Math.max(SLOT_POOL, 8) };
const COUNTER_FILE = path.join(TMP, 'slot-counter.json');
const LIVE_DB = path.join(os.homedir(), 'Library/Application Support/Ableton/Live Database/Live-files-36.db');
let indexedSlots = null, indexedAt = 0;
async function indexedSlotNames() {
  if (indexedSlots && Date.now() - indexedAt < 5000) return indexedSlots;
  try {
    const { stdout } = await execFileP('sqlite3', [LIVE_DB, "select name from files where name like 'ADE %.wav'"]);
    const set = new Set(stdout.split('\n').filter(Boolean));
    indexedSlots = set.size ? set : null;   // empty = unknown, don't block on it
  } catch { indexedSlots = null; }
  indexedAt = Date.now();
  return indexedSlots;
}
function roleFor(hint = '', fallback = 'Snare') {
  const h = String(hint).toLowerCase();
  if (ROLE_OF[h]) return ROLE_OF[h];
  const key = Object.keys(ROLE_OF).find((k) => h.includes(k));
  return key ? ROLE_OF[key] : fallback;
}
// the set's tempo is the truth: refresh lastBuild.bpm from Live (cached 2 s) before anything converts beats <-> seconds
let tempoCache = { at: 0 };
async function syncTempo() {
  if (Date.now() - tempoCache.at < 2000) return lastBuild.bpm || 120;
  try { const r = await (await liveClient())({ cmd: 'ping' }); if (r?.tempo) { lastBuild.bpm = Math.round(Number(r.tempo)); tempoCache.at = Date.now(); } } catch {}
  return lastBuild.bpm || 120;
}
let slotLock = Promise.resolve();
const reservedSlots = new Map();   // slot file -> reserved at (ms); released by rememberSound or after 2 min
async function nextSlot(role) {
  const run = slotLock.then(() => nextSlotUnlocked(role));
  slotLock = run.catch(() => {});
  return run;
}
async function nextSlotUnlocked(role) {
  let counters = {};
  try { counters = JSON.parse(await fs.readFile(COUNTER_FILE, 'utf8')); } catch {}
  const indexed = await indexedSlotNames();
  const n = POOL_SIZE[role] || 6;
  // never hand out a slot that a track in the current set is still playing (Live caches by filename)
  for (const [k, at] of reservedSlots) if (Date.now() - at > 120000) reservedSlots.delete(k);
  for (const [k, at] of Object.entries(lastBuild.retiredSlots || {})) if (Date.now() - at > 24 * 3600e3) delete lastBuild.retiredSlots[k];
  const inUse = new Set([...Object.values(lastBuild.samples || {}).map((s) => path.basename(s.slotPath || '')), ...reservedSlots.keys(), ...Object.keys(lastBuild.retiredSlots || {})]);
  let pick = null;
  for (let i = 0; i < n; i++) {
    const k = ((counters[role] || 0) + i) % n + 1;
    const name = `ADE ${role} ${k}.wav`;
    if ((!indexed || indexed.has(name)) && !inUse.has(name)) { pick = { name, k }; break; }
  }
  if (!pick && (!indexed || [...Array(n)].some((_, i) => indexed.has(`ADE ${role} ${i + 1}.wav`)))) {
    // pool exhausted: recycle the slot that is NOT loaded in any track of this set, oldest retirement first (retired = loaded in a
    // previous set; Live may still hold the old audio under that filename, so this is the last resort before refusing)
    const loaded = new Set([...Object.values(lastBuild.samples || {}).map((s) => path.basename(s.slotPath || '')), ...reservedSlots.keys()]);
    const retired = Object.entries(lastBuild.retiredSlots || {}).filter(([k]) => k.startsWith(`ADE ${role} `) && !loaded.has(k) && (!indexed || indexed.has(k))).sort((a, b) => a[1] - b[1]);
    if (retired.length) {
      const [name] = retired[0]; delete lastBuild.retiredSlots[name];
      const k = parseInt(name.match(/(\d+)\.wav$/)?.[1], 10) || 1;
      console.warn(`[slot] ${role} pool exhausted, recycling ${name} (not loaded in this set)`);
      pick = { name, k, recycled: true };
    } else throw new Error(`all ${n} ${role} sound slots are loaded by tracks in this set; remove_layer an unused AI ${role} track or replace_sound on one instead of generating a new one (SLOT_POOL env raises the cap after indexing more files)`);
  }
  if (!pick) {   // pool not indexed yet (user must re-add the Place once); fall back to the old single role slot
    const legacy = `ADE ${role === 'OpenHat' ? 'Hat Open' : role}.wav`;
    console.warn(`[slot] pool for ${role} not indexed by Live, falling back to ${legacy}`);
    return legacy;
  }
  counters[role] = pick.k;
  reservedSlots.set(pick.name, Date.now());
  await fs.writeFile(COUNTER_FILE, JSON.stringify(counters));
  return pick.name;
}
async function toSlot(srcPath, hint = '', fallback = 'Snare', opts = {}) {
  if (!audioPathOk(srcPath)) throw new Error('path outside project audio (output dir or .tmp)');
  const role = roleFor(hint, fallback);
  const name = await nextSlot(role);
  const dest = path.join(OUT_DIR, name);
  let src = srcPath;
  const WIDEN = { Hat: 0.4, OpenHat: 0.5, Perc: 0.45, Clap: 0.35, Rim: 0.3 };   // dual-mono one-shots get stereo width by default; Kick/Snare/Synth stay centred
  if (WIDEN[role] && !opts.noWiden) {
    try {
      const { analyzeAudio } = await import('./lib/analyze.js'); const py = await import('./lib/pytools.js');
      const w = (await analyzeAudio(srcPath))?.stereo?.width ?? 1;
      if (w < 0.08 && py.pyAvailable()) { const out = path.join(TMP, `wide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`); await py.processAudio(srcPath, [{ type: 'widen', amount: WIDEN[role] }], out); src = out; }
    } catch (e) { console.warn('[slot] default widen skipped:', e.message.slice(0, 100)); }
  }
  if (dest !== src) await fs.copyFile(src, dest);
  await fs.rm(dest + '.asd', { force: true }).catch(() => {});   // a stale analysis file from the previous occupant would mislead Live's warping
  return dest;
}
export const slotNameFor = (srcPath, hint, fallback) => roleFor(hint, fallback);

// what the last build put where, so tweaks can replace clips/samples in place
const lastBuild = { bpm: null, tracks: {} };   // tracks: { kick: {index,name}, ..., synth: {...}, drums: {...} }
const LANE_LABEL = { kick: 'Kick', snare: 'Snare', clap: 'Clap', hat_closed: 'Hats', hat_open: 'Open Hats', rim: 'Rim', perc: 'Perc', tom_low: 'Tom', tom_high: 'Tom Hi', ride: 'Ride', crash: 'Crash', shaker: 'Shaker', snap: 'Snap', cowbell: 'Cowbell', conga: 'Conga', vox: 'Vox', fx: 'FX', texture: 'Texture' };

async function sendWithRetry(send, cmd, tries = 2, delayMs = 700) {
  let reply;
  for (let i = 0; i < tries; i++) {
    reply = await send(cmd);
    if (reply?.ok || !/not found/i.test(reply?.error || '')) return reply;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return reply;
}

function patternToLiveNotes(pattern, mapping = 'gm') {
  const stepBeats = 0.25, swing = (pattern.swing || 0) * 0.5 * stepBeats;
  const notes = [];
  for (const lane of pattern.lanes) {
    const pitch = mapping === 'single' ? 60 : (GM_DRUM_NOTES[lane.instrument] ?? 60);
    for (const s of lane.steps) notes.push({ pitch, start: s.step * stepBeats + (s.step % 2 ? swing : 0), duration: 0.125, velocity: clamp(Number(s.velocity) || 100, 1, 127) });
  }
  return notes;
}

const melodyToLiveNotes = (notes) => notes.map((n) => ({ pitch: n.pitch, start: n.startBeats, duration: n.durationBeats, velocity: n.velocity }));
const melodyBars = (notes, bars) => bars || Math.max(1, Math.ceil(Math.max(0, ...notes.map((n) => n.startBeats + n.durationBeats)) / 4));

// ---- Send straight into Ableton via the ADEHack remote script (ableton/client.js, TCP 9004) ----
// Live's remote script handles one command at a time on a 100 ms tick; parallel tool calls would flood it, so serialize.
let liveQueue = Promise.resolve();
async function liveClient() {
  let sendToLive;
  try { ({ sendToLive } = await import('./ableton/client.js')); }
  catch { throw new Error('ableton/client.js missing - run ableton/install.sh'); }
  return (cmd) => {
    const run = liveQueue.then(async () => {
      try { return await sendToLive(cmd, { timeoutMs: /load_sample|load_to_pad|load_device|describe_set|browse/.test(cmd.cmd) ? 20000 : 12000 }); }
      catch (e) { throw new Error(`${e.message} Fix: fully quit and relaunch Live 10, then Preferences > Link/MIDI > Control Surface = "ADEHack".`); }
    });
    liveQueue = run.catch(() => {});
    return run;
  };
}

app.post('/api/live/sample', async (req, res) => {
  try {
    const p = await toSlot(String(req.body?.path || ''), req.body?.instrument || req.body?.role || '', 'Snare');
    const send = await liveClient();
    let track = req.body?.track;
    if (track == null && req.body?.instrument) {
      if (!lastBuild.tracks[req.body.instrument]) throw new Error(`no track for ${req.body.instrument} in the current build`);
      track = lastBuild.tracks[req.body.instrument].name;
    }
    const reply = await sendWithRetry(send, { cmd: 'load_sample', path: p, ...(track != null ? { track } : {}) });
    if (!reply?.ok) throw new Error(reply?.error || 'Live rejected load_sample');
    res.json(reply);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/live/pattern', async (req, res) => {
  try {
    const { pattern, mapping = 'gm', slot = 0, fire = true } = req.body || {};
    if (!pattern?.lanes) throw new Error('pattern missing');
    const notes = patternToLiveNotes(pattern, mapping);
    const send = await liveClient();
    const tempo = await send({ cmd: 'set_tempo', bpm: pattern.bpm });
    const clip = await send({ cmd: 'create_clip', track: req.body.track ?? 'selected', slot: Number(slot) || 0, length: pattern.bars * 4, notes, fire: Boolean(fire), name: 'Drums' });
    if (!clip?.ok) throw new Error(clip?.error || 'Live rejected create_clip');
    res.json({ ok: true, tempo, clip, noteCount: notes.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/plan', async (req, res) => {
  try {
    const { makePlan } = await import('./lib/plan.js');
    const { text = '', hasBeatbox = false, hasHum = false } = req.body || {};
    res.json(await makePlan({ text: String(text), hasBeatbox: Boolean(hasBeatbox), hasHum: Boolean(hasHum) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- v2: melody, rhythm, multi-track build ----
app.post('/api/melody', upload.single('audio'), async (req, res) => {
  const id = Date.now();
  try {
    const { humToNotes, describeToMelody, notesToMidi } = await import('./lib/melody.js');
    const bpm = req.body.bpm ? clamp(Number(req.body.bpm), 40, 300) : 120;
    const bars = req.body.bars ? clamp(Number(req.body.bars), 1, 8) : undefined;
    const name = req.body.name || 'melody';
    let out;
    if (req.file) {
      const raw = path.join(TMP, `${id}-mel.wav`);
      await toWav(req.file.path, raw, { channels: 2 });   // user material stays stereo; analysis decodes mono itself
      const r = await humToNotes(raw, { bpm });
      if (!r.notes.length) throw new Error('No pitched notes detected. Hum louder and closer to the mic, hold each note a little longer.');
      out = { notes: r.notes, bars: r.bars || melodyBars(r.notes), bpm: r.bpm || bpm, source: 'hum' };
    } else {
      const r = await describeToMelody({ description: req.body.description || '', bpm, bars: bars || 2, key: req.body.key || undefined });
      out = { notes: r.notes, bars: bars || 2, bpm, source: r.source, key: r.key };
    }
    const midi = await publish(notesToMidi(out.notes, { bpm: out.bpm }), name, '.mid', 'midi');
    res.json({ ...out, midi });
  } catch (e) {
    console.error('[melody]', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (req.file) fs.unlink(req.file.path).catch(() => {});
  }
});

app.post('/api/rhythm', upload.single('audio'), async (req, res) => {
  const id = Date.now();
  try {
    const { beatboxToPattern } = await import('./lib/rhythm.js');
    if (!req.file) throw new Error('Record a beatbox first');
    const raw = path.join(TMP, `${id}-beat.wav`);
    await toWav(req.file.path, raw);
    const bpm = req.body.bpm ? clamp(Number(req.body.bpm), 40, 300) : undefined;
    const bars = req.body.bars ? clamp(Number(req.body.bars), 1, 8) : undefined;
    const { pattern, onsets } = await beatboxToPattern(raw, { bpm, bars });
    const mapping = req.body.mapping === 'single' ? 'single' : 'gm';
    const midi = await publish(patternToMidi(pattern, { mapping, singleNote: 60 }), req.body.name || 'beatbox-pattern', '.mid', 'midi');
    res.json({ pattern, onsets, midi, source: 'beatbox' });
  } catch (e) {
    console.error('[rhythm]', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (req.file) fs.unlink(req.file.path).catch(() => {});
  }
});

app.post('/api/live/melody', async (req, res) => {
  try {
    let { notes, bpm, bars, track, slot = 0, fire = true, name = 'Melody' } = req.body || {};
    if (!notes?.length) throw new Error('no notes');
    if (track == null) track = lastBuild.tracks.synth ? lastBuild.tracks.synth.index : 'selected';
    if (lastBuild.tracks.synth) lastBuild.melody = { notes, bars };
    const send = await liveClient();
    if (bpm) await send({ cmd: 'set_tempo', bpm });
    const clip = await send({ cmd: 'create_clip', track, slot: Number(slot) || 0, length: melodyBars(notes, bars) * 4, notes: melodyToLiveNotes(notes), fire: Boolean(fire), name });
    if (!clip?.ok) throw new Error(clip?.error || 'Live rejected create_clip');
    res.json({ ok: true, clip, noteCount: notes.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/live/build', async (req, res) => {
  const steps = [];
  try {
    const { bpm, drums, synth } = req.body || {};
    const send = await liveClient();
    const step = async (label, cmd, retry = false) => {
      const r = retry ? await sendWithRetry(send, cmd) : await send(cmd);
      steps.push({ label, ok: Boolean(r?.ok), ...(r?.error ? { error: r.error } : {}) });
      if (!r?.ok) throw new Error(`${label}: ${r?.error || 'failed'}`);
      return r;
    };
    if (bpm) await step('tempo', { cmd: 'set_tempo', bpm });
    const nb = { bpm: bpm || lastBuild.bpm, tracks: {}, pattern: drums?.pattern || null, melody: synth?.notes ? { notes: synth.notes, bars: synth.bars } : null };
    const softStep = async (label, cmd, retry) => { try { return await step(label, cmd, retry); } catch (e) { console.warn('[build]', e.message); return null; } };
    if (drums?.pattern?.lanes && Array.isArray(drums.lanes) && drums.lanes.length) {
      // one track per drum lane, each with its own synthesized sound
      for (const lane of drums.pattern.lanes) {
        if (!lane.steps?.length) continue;
        const label = LANE_LABEL[lane.instrument] || lane.instrument;
        const sample = drums.lanes.find((l) => l.instrument === lane.instrument)?.samplePath;
        const t = await step(`create ${label} track`, { cmd: 'create_midi_track', name: label, index: -1 });
        nb.tracks[lane.instrument] = { index: t.index, name: label };
        if (sample) await softStep(`load ${label} sound`, { cmd: 'load_sample', path: await toSlot(sample, lane.instrument, 'Snare'), track: t.name ?? t.index }, true);
        await step(`${label} clip`, { cmd: 'create_clip', track: t.name ?? t.index, slot: 0, length: drums.pattern.bars * 4, notes: patternToLiveNotes({ ...drums.pattern, lanes: [lane] }, 'single'), fire: true, name: label, show: false });
      }
    } else if (drums?.pattern?.lanes) {
      const t = await step('create Drums track', { cmd: 'create_midi_track', name: 'Drums', index: -1 });
      nb.tracks.drums = { index: t.index, name: 'Drums' };
      if (drums.samplePath) await softStep('load drum sample', { cmd: 'load_sample', path: await toSlot(drums.samplePath, drums.role || '', 'Snare'), track: t.name ?? t.index }, true);
      await step('drums clip', { cmd: 'create_clip', track: t.name ?? t.index, slot: 0, length: drums.pattern.bars * 4, notes: patternToLiveNotes(drums.pattern, drums.mapping || 'single'), fire: true, name: 'Drums', show: false });
    }
    if (synth?.notes?.length) {
      const synthName = (synth.role || 'Saw').replace(/^./, (c) => c.toUpperCase());
      const t = await step(`create ${synthName} track`, { cmd: 'create_midi_track', name: synthName, index: -1 });
      nb.tracks.synth = { index: t.index, name: synthName };
      if (synth.samplePath) await softStep(`load ${synthName} sound`, { cmd: 'load_sample', path: await toSlot(synth.samplePath, synth.role || 'synth', 'Synth'), track: t.name ?? t.index }, true);
      await step(`${synthName} clip`, { cmd: 'create_clip', track: t.name ?? t.index, slot: 0, length: melodyBars(synth.notes, synth.bars) * 4, notes: melodyToLiveNotes(synth.notes), fire: true, name: synthName });
    }
    Object.assign(lastBuild, nb);
    await send({ cmd: 'show_view', view: 'Session' });
    await send({ cmd: 'show_view', view: 'Detail/Clip' });
    res.json({ ok: true, steps, tracks: lastBuild.tracks });
  } catch (e) { res.status(500).json({ error: e.message, steps }); }
});

// ---- live tweaking: replace clips / samples / tempo in place while Live plays ----
// lastBuild + per-track mute/solo from Live (cheap describe_set, 2.5 s budget) so the session panel is exact after a reload
app.get('/api/live/state', async (_req, res) => {
  let liveTracks = null;
  try {
    const { sendToLive } = await import('./ableton/client.js');
    const set = await sendToLive({ cmd: 'describe_set' }, { timeoutMs: 2500 });
    if (set?.ok) liveTracks = (set.tracks || []).map((t) => ({ index: t.index, name: t.name, muted: Boolean(t.mute ?? t.muted ?? t.mixer?.mute), solo: Boolean(t.solo ?? t.mixer?.solo), is_midi: Boolean(t.is_midi) }));
  } catch {}
  res.json({ ...lastBuild, ...(liveTracks ? { liveTracks } : {}) });
});
// drop a generated/processed wav into Live as a warped audio clip (UI cards and tests; the agent uses add_loop_layer)
app.post('/api/live/loop-clip', async (req, res) => {
  try { const { path: p, track = 'AI Loop', slot = 0, warpMode = 'complex_pro', overwrite = true } = req.body || {}; if (!p || !audioPathOk(p)) throw new Error('path missing or outside project audio'); res.json({ ok: true, ...(await makeCtx(() => {}).live.loadAudioClip({ track, slot, samplePath: p, warpMode, overwrite })) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ---- existing project: read the open set, listen to what is playing, propose production moves ----
app.post('/api/project/scan', async (req, res) => {
  const scanBody = async () => {
  try {
    const bars = clamp(Number(req.body?.bars) || 8, 2, 16);
    const send = await liveClient();
    const set = await send({ cmd: 'describe_set' });
    if (!set?.ok) throw new Error(set?.error || 'describe_set failed');
    const tracks = (set.tracks || []).map((t) => ({ index: t.index, name: t.name, kind: t.is_midi ? 'midi' : 'audio', devices: (t.devices || []).map((d) => d.name || d.class_name).filter(Boolean).slice(0, 4), clips: Array.isArray(t.clips) ? t.clips.filter((c) => c && (c.name != null || c.has_clip)).length : (t.clip_count ?? undefined), muted: t.mute ?? t.muted ?? undefined, arrangementClips: t.arrangement_clips ?? undefined }));
    const setNames = new Set((set.tracks || []).map((t) => t.name));
    const ours = Object.values(lastBuild.tracks || {}).map((t) => t.name);
    if (ours.length && !ours.some((n) => setNames.has(n))) {   // none of our tracks exist: a different set is open, forget the old build (the conversation stays)
      lastBuild.tracks = {}; lastBuild.samples = {}; lastBuild.groove = null; lastBuild.melody = null; lastBuild.lastCapture = null; lastBuild.genreTarget = null;
      await saveChat().catch(() => {});
    }
    lastBuild.bpm = Math.round(Number(set.tempo) || 0) || lastBuild.bpm;
    let genreTarget = null;   // never judge a new project against a style left over from another one; the user picks it per scan
    if (req.body?.genre) { try { const k = await import('./lib/knowledge.js'); const slug = k.matchGenre(String(req.body.genre)); const bp = slug && k.getBlueprint(slug); if (bp?.summary) { genreTarget = `${bp.title}: ${bp.summary}`; lastBuild.genreTarget = genreTarget; } } catch {} }
    const ctx = makeCtx(() => {});
    let capture = null, critique = null, captureError = null;
    try { capture = await ctx.captureLive({ bars }); } catch (e) { captureError = e.message; }
    let arrangement = null; try { arrangement = await send({ cmd: 'arrangement_info' }); } catch {}
    if (capture && !capture.silent) { try { critique = await ctx.critiqueCapture(capture.path, null, { genreTarget, hints: `The Live set is at ${Math.round(Number(set.tempo))} BPM and its tracks are named: ${tracks.map((t) => t.name).join(', ')}.` }); } catch (e) { critique = { error: e.message }; } }
    const project = { scannedAt: Date.now(), tempo: Number(set.tempo), signature: set.signature, loop: set.loop, position: set.current_song_time, arrangementBars: arrangement?.bars ?? null, selectedTrack: set.selected_track?.name, scenes: (set.scenes || []).length, tracks, capture: capture ? { url: capture.url, path: capture.path, seconds: capture.seconds, silent: capture.silent, profile: capture.profile } : null, captureError, critique, genreTarget, toldAgent: false };
    lastBuild.project = project;
    res.json({ ok: true, project });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  };
  const run = chatQueue.then(scanBody); chatQueue = run.catch(() => {}); await run;   // never scan (and stop the transport) while a producer turn is building
});

app.post('/api/live/show', async (_req, res) => {
  try { const send = await liveClient(); const r = await send({ cmd: 'show_view', view: 'Session' }); await send({ cmd: 'show_view', view: 'Detail/Clip' }); res.json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/live/tempo', async (req, res) => {
  try { const send = await liveClient(); const r = await send({ cmd: 'set_tempo', bpm: Number(req.body?.bpm) }); lastBuild.bpm = Number(req.body?.bpm); res.json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// re-push the (edited) drum pattern into the tracks of the last build; lanes without a track get one
app.post('/api/live/update', async (req, res) => {
  const done = [];
  try {
    const { pattern, instruments } = req.body || {};
    if (!pattern?.lanes) throw new Error('pattern missing');
    const send = await liveClient();
    lastBuild.pattern = pattern;
    const hadTracks = Object.keys(lastBuild.tracks);
    if (lastBuild.tracks.drums && !Object.keys(lastBuild.tracks).some((k) => LANE_LABEL[k])) {
      const r = await send({ cmd: 'create_clip', track: lastBuild.tracks.drums.name, slot: 0, length: pattern.bars * 4, notes: patternToLiveNotes(pattern, 'single'), fire: true, name: 'Drums', show: false });
      if (!r?.ok) throw new Error(r?.error); done.push('drums');
    } else {
      // lanes removed from the pattern: empty their clips so the old hits stop
      for (const [inst, t] of Object.entries(lastBuild.tracks)) {
        if (!LANE_LABEL[inst] || pattern.lanes.some((l) => l.instrument === inst && l.steps.length)) continue;
        if (instruments && !instruments.includes(inst)) continue;
        const r = await send({ cmd: 'create_clip', track: t.name, slot: 0, length: pattern.bars * 4, notes: [], fire: false, name: t.name, show: false });
        if (r?.ok) done.push(inst + ' (silenced)');
      }
      for (const lane of pattern.lanes) {
        if (instruments && !instruments.includes(lane.instrument)) continue;
        if (!lane.steps.length) continue;
        let t = lastBuild.tracks[lane.instrument];
        if (!t) {
          const label = LANE_LABEL[lane.instrument] || lane.instrument;
          const c = await send({ cmd: 'create_midi_track', name: label, index: -1 });
          if (!c?.ok) throw new Error(c?.error);
          t = lastBuild.tracks[lane.instrument] = { index: c.index, name: label };
        }
        const r = await send({ cmd: 'create_clip', track: t.name, slot: 0, length: pattern.bars * 4, notes: patternToLiveNotes({ ...pattern, lanes: [lane] }, 'single'), fire: true, name: t.name, show: false });
        if (!r?.ok) throw new Error(`${t.name}: ${r?.error}`); done.push(lane.instrument);
      }
    }
    res.json({ ok: true, updated: done, hadTracks });
  } catch (e) { res.status(500).json({ error: e.message, updated: done }); }
});
app.post('/api/tweak', async (req, res) => {
  try {
    const { applyTweak } = await import('./lib/tweak.js');
    const { text = '', state = {} } = req.body || {};
    res.json(await applyTweak({ text: String(text), state }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= v3: the producer agent (Claude with tools) =================
const STATE_FILE = path.join(TMP, 'chat-state.json');
const chat = { history: [], recordings: { refs: [] }, settings: { arrangementMode: true, arrangementBars: 8 } };   // attachments + settings persist (and across restarts)
try { const st = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); chat.history = st.history || []; chat.recordings = st.recordings || { refs: [] }; if (st.settings) chat.settings = { ...chat.settings, ...st.settings }; if (st.genreTarget) lastBuild.genreTarget = st.genreTarget; if (st.samples) lastBuild.samples = st.samples; if (st.tracks) lastBuild.tracks = st.tracks; if (st.bpm) lastBuild.bpm = st.bpm; if (st.clips) lastBuild.clips = st.clips; if (st.explanations) lastBuild.explanations = st.explanations; if (st.soundHistory) lastBuild.soundHistory = st.soundHistory; if (st.groove) lastBuild.groove = st.groove; if (st.lastRender) lastBuild.lastRender = st.lastRender; chat.promptHash = st.promptHash; } catch {}
lastBuild.samples ||= {};   // track name (lower) -> { samplePath, slotPath, role }
// Thinking blocks are bound to the system prompt + tool list that produced them; after we change either, replaying them is a 400.
import { createHash } from 'node:crypto';
async function promptHash() {
  const m = await import('./lib/agent.js');
  const names = m.makeTools ? m.makeTools({ emit() {}, live: {} }, {}).map((t) => t.name).sort().join(',') : '';
  return createHash('sha1').update(String(m.PRODUCER_SYSTEM || '') + '|' + names).digest('hex').slice(0, 12);
}
function stripThinking(history) {
  return history.map((msg) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;
    const content = msg.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    return { ...msg, content: content.length ? content : [{ type: 'text', text: '(earlier reasoning omitted)' }] };
  });
}
/** Claude rejects a tool_use without its tool_result in the next message (a turn cut off by max_iterations, a crash or a restart leaves exactly that). Fill the gaps with synthetic results so the thread survives. */
function repairHistory(h) {
  const out = []; let fixed = 0;
  for (let i = 0; i < h.length; i++) {
    const m = h[i]; out.push(m);
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const ids = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (!ids.length) continue;
    const nxt = h[i + 1];
    const got = new Set(nxt && Array.isArray(nxt.content) ? nxt.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id) : []);
    const missing = ids.filter((id) => !got.has(id));
    if (!missing.length) continue;
    const results = missing.map((id) => ({ type: 'tool_result', tool_use_id: id, content: 'interrupted: this tool call never ran (the turn was cut off). Redo it if it is still needed.', is_error: true }));
    if (nxt && nxt.role === 'user' && Array.isArray(nxt.content) && got.size) { h[i + 1] = { ...nxt, content: [...results, ...nxt.content] }; }
    else out.push({ role: 'user', content: results });
    fixed += missing.length;
  }
  if (fixed) console.warn(`[chat] repaired history: ${fixed} tool call(s) without results`);
  return out;
}
async function reconcileHistory() {
  chat.history = repairHistory(chat.history);
  const h = await promptHash();
  if (chat.promptHash !== h) { if (chat.history.length) console.log(`[chat] prompt/tools changed (${chat.promptHash} -> ${h}); dropping ${chat.history.length ? 'thinking blocks from' : ''} stored history`); chat.history = stripThinking(chat.history); chat.promptHash = h; await saveChat(); }
}
function safeHistory(h, max = 60) {   // cut only at a plain user text message so no tool_result is orphaned
  if (h.length <= max) return h;
  let i = h.length - max;
  while (i < h.length && !(h[i].role === 'user' && typeof h[i].content === 'string')) i++;
  return i < h.length ? h.slice(i) : [];
}
async function saveChat() { try { await fs.writeFile(STATE_FILE, JSON.stringify({ history: safeHistory(chat.history), recordings: chat.recordings, settings: chat.settings, genreTarget: lastBuild.genreTarget || null, explanations: lastBuild.explanations || {}, samples: lastBuild.samples, soundHistory: lastBuild.soundHistory, tracks: lastBuild.tracks, bpm: lastBuild.bpm, clips: lastBuild.clips, groove: lastBuild.groove || null, lastRender: lastBuild.lastRender || null, promptHash: chat.promptHash })); } catch (e) { console.warn('[state]', e.message); } }
lastBuild.soundHistory ||= {};   // track -> previous sounds (newest last), so a change is always undoable
function rememberSound(trackName, samplePath, slotPath, role) {
  reservedSlots.delete(path.basename(slotPath || ''));
  const key = String(trackName).toLowerCase();
  const prev = lastBuild.samples[key];
  if (prev?.samplePath && prev.samplePath !== samplePath) (lastBuild.soundHistory[key] ||= []).push(prev);
  if (lastBuild.soundHistory[key]?.length > 8) lastBuild.soundHistory[key].shift();
  lastBuild.samples[key] = { samplePath, slotPath, role, at: Date.now() };
}
lastBuild.clips ||= {};   // track name (lower) -> { steps|notes, bars, swing, slot }
function rememberClip(trackName, clip) { lastBuild.clips[String(trackName).toLowerCase()] = { ...clip, at: Date.now() }; }
function forgetTrack(trackName) {
  delete (lastBuild.clips || {})[String(trackName).toLowerCase()]; delete lastBuild.samples[String(trackName).toLowerCase()]; for (const k of Object.keys(lastBuild.tracks)) if (lastBuild.tracks[k]?.name?.toLowerCase() === String(trackName).toLowerCase()) delete lastBuild.tracks[k]; }
const uploads = new Map();   // id -> wav path (this process only)

app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) throw new Error('no audio');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const wav = path.join(TMP, `${id}-upload.wav`);
    await toWav(req.file.path, wav);
    const name = String(req.body?.name || req.file.originalname || 'audio').replace(/[^\w .()-]+/g, '_').slice(0, 80);
    uploads.set(id, { path: wav, name });
    await fs.writeFile(path.join(TMP, `${id}-upload.json`), JSON.stringify({ path: wav, name }));   // survives server restarts
    res.json({ id, name, seconds: await (await import('./lib/audio.js')).durationSeconds(wav) });
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { if (req.file) fs.unlink(req.file.path).catch(() => {}); }
});

async function getUpload(id) {
  id = String(id || '');
  if (!/^[\w-]+$/.test(id)) return null;
  if (uploads.has(id)) return uploads.get(id);
  try { const u = JSON.parse(await fs.readFile(path.join(TMP, `${id}-upload.json`), 'utf8')); await fs.access(u.path); uploads.set(id, u); return u; } catch { return null; }
}

// one-second C3 (MIDI 60) voices rendered once with ffmpeg, used only to stand in for Live presets in offline previews
async function genericVoice(kind = 'synth') {
  const f = path.join(TMP, `voice-${kind}.wav`);
  try { await fs.access(f); return f; } catch {}
  const expr = kind === 'bass'
    ? "0.5*sin(2*PI*261.63*t)*exp(-2*t)+0.25*sin(2*PI*523.25*t)*exp(-6*t)"          // soft sub-ish with a 2nd harmonic
    : "0.3*(2*(261.63*t-floor(261.63*t))-1)*exp(-1.5*t)";                               // decaying saw
  await ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=${expr}:s=44100:d=1.2`, '-af', 'lowpass=f=1800,afade=t=out:st=1.0:d=0.2', '-ac', '2', f]);
  return f;
}

async function trackByName(send, name) {
  const r = await send({ cmd: 'list_tracks' });
  if (!r?.ok) throw new Error(r?.error || 'list_tracks failed');
  const want = String(name).toLowerCase();
  return r.tracks.find((t) => t.name.toLowerCase() === want) || null;
}
async function ensureTrack(send, name) {
  const existing = await trackByName(send, name);
  if (existing) {
    const ours = Object.values(lastBuild.tracks).some((t) => String(t.name).toLowerCase() === String(existing.name).toLowerCase());
    if (existing.is_midi === false) return ensureTrack(send, /\bMIDI$/.test(name) ? `${name} 2` : `${name} MIDI`);   // an audio track cannot take our instrument or clips
    if (lastBuild.project && !ours && !/^AI /.test(name)) return ensureTrack(send, `AI ${name}`);   // the user's own track in a scanned set: build next to it, never on it
    return { index: existing.index, name: existing.name, created: false };
  }
  const c = await send({ cmd: 'create_midi_track', name, index: -1 });
  if (!c?.ok) throw new Error(c?.error || 'create_midi_track failed');
  return { index: c.index, name: c.name || name, created: true };
}
function stepsToNotes(steps, swing = 0, humanize = 0, bpm = lastBuild.bpm || 120, groove = null) {
  const h = clamp(Number(humanize) || 0, 0, 1);
  const beatMs = 60000 / bpm;
  const g = groove && Array.isArray(groove.microtiming) ? groove : null;
  return steps.map((s) => {
    const pos = s.step % 16;
    const grooveBeats = g ? (clamp(Number(g.microtiming[pos]) || 0, -40, 40)) / beatMs : 0;          // extracted microtiming (ms) per 16th position
    const grooveVel = g && Array.isArray(g.velocityProfile) && Number.isFinite(g.velocityProfile[pos]) ? 0.75 + 0.5 * clamp(g.velocityProfile[pos], 0, 1) : 1;   // 0.75..1.25
    const jitterBeats = h ? ((Math.random() * 2 - 1) * 12 * h) / beatMs : 0;     // up to ±12 ms at humanize 1
    let vel = Math.round((Number(s.velocity) || 100) * grooveVel);
    if (h) vel += Math.round((Math.random() * 2 - 1) * 15 * h);
    return { pitch: 60, start: Math.max(0, s.step * 0.25 + (s.step % 2 ? swing * 0.125 : 0) + grooveBeats + jitterBeats), duration: 0.125, velocity: clamp(vel, 1, 127) };
  });
}

function makeCtx(emit) {
  const okOrThrow = (r, what) => { if (!r?.ok) throw new Error(`${what}: ${r?.error || 'failed'}`); return r; };
  return {
    emit,
    async synth({ prompt, role = 'sound', kind, source, audioPath, offsetSeconds, lengthSeconds, oneshotSeconds, strength, variations = 1 }) {
      if (!kind) kind = TONAL.has(String(role).toLowerCase()) ? 'tone' : 'drum';
      const useAudio = Boolean(audioPath) && source !== 'text';
      const n = clamp(Number(variations) || 1, 1, 3);
      const one = async (label) => {
        const out = await synthesize({ prompt, role, alternates: n, name: n > 1 ? `${role}-${label}` : role, kind: kind === 'tone' ? 'tone' : undefined, mode: useAudio ? 'oneshot' : 'text', audioPath: useAudio ? audioPath : undefined, offsetSeconds, oneshotSeconds: oneshotSeconds || lengthSeconds, strength: strength ?? 0.7 });
        const f = out.files.find((x) => x.kind === 'oneshot') || out.files[0];
        const audio = await import('./lib/audio.js');
        const alts = (out.alternates || []).map((a) => ({ path: a.path, name: a.name, url: a.url, label: a.label, length: a.length, centroidHz: a.centroidHz, subShare: a.subShare }));
        return { path: f.path, name: f.name, url: f.url, durationSeconds: await audio.durationSeconds(f.path), peakDb: await audio.peakDb(f.path), seed: out.seed, label, promptUsed: out.prompt, hits: out.hits, alternates: alts, subShare: f.subShare, centroidHz: f.centroidHz, note: f.subShare != null && f.subShare < 0.25 && /kick/.test(String(role)) ? 'thin low end: layer a synth_local sub under it' : undefined };
      };
      const first = await one('A');
      if (first.alternates?.length) {   // a hit-sequence generation already holds different takes: variations for free
        const variants = [{ ...first, label: 'A' }, ...first.alternates.slice(0, n - 1).map((a) => ({ ...a, durationSeconds: a.length }))];
        if (n > 1) emit({ type: 'variations', group: `${role}-${Date.now()}`, role, items: variants.map((v) => ({ path: v.path, url: v.url, label: v.label })) });
        return { ...first, variants, note: `${variants.length} different hits from one generation (A = best match; B/C are round-robin alternates for ghost notes or layering)` };
      }
      if (n === 1) return first;
      const variants = [first, ...(await Promise.all(['B', 'C'].slice(0, n - 1).map(one)))];
      emit({ type: 'variations', group: `${role}-${Date.now()}`, role, items: variants.map((v) => ({ path: v.path, url: v.url, label: v.label, seed: v.seed })) });
      return { variants, ...variants[0], note: `${n} variations (A/B/C); first returned as default` };
    },
    async synthLocal({ kind = 'sub', name, startHz, endHz, decayMs, drive, highpassHz, gainDb } = {}) {
      const out = path.join(TMP, `local-${kind}-${Date.now()}.wav`);
      if (kind === '808') await synthLocal.synth808(out, { ...(startHz ? { startHz } : {}), ...(endHz ? { endHz } : {}), ...(decayMs ? { decayMs } : {}), ...(drive != null ? { drive } : {}) });
      else if (kind === 'snap') await synthLocal.synthSnap(out, { ...(decayMs ? { decayMs } : {}), ...(highpassHz ? { highpassHz } : {}), ...(gainDb != null ? { gainDb } : {}) });
      else await synthLocal.synthSub(out, { ...(startHz ? { startHz } : {}), ...(endHz ? { endHz } : {}), ...(decayMs ? { decayMs } : {}), ...(drive != null ? { drive } : {}), ...(gainDb != null ? { gainDb } : {}) });
      const f = await publish(await fs.readFile(out), name || `${kind}-local`, '.wav', 'oneshot');
      const audio = await import('./lib/audio.js');
      return { path: f.path, url: f.url, name: f.name, kind, durationSeconds: await audio.durationSeconds(f.path) };
    },
    writePattern: async (o) => describeToPattern(o),
    async slice(refPath, { startSeconds = 0, lengthSeconds = 0.35, name = 'chop', fadeMs = 5 } = {}) {
      if (!audioPathOk(refPath)) throw new Error('slice: path outside project audio');
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const cut = path.join(TMP, `${id}-slice.wav`), norm = path.join(TMP, `${id}-slice-norm.wav`);
      const len = clamp(Number(lengthSeconds), 0.05, 4), fade = Math.min(fadeMs / 1000, len / 4);
      await ffmpeg(['-ss', String(Math.max(0, Number(startSeconds) || 0)), '-i', refPath, '-t', String(len), '-af', `afade=t=in:st=0:d=${fade},afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade}`, '-ac', '2', '-ar', '44100', cut]);
      await normalize(cut, norm);
      const f = await publish(await fs.readFile(norm), name, '.wav', 'oneshot');
      return { path: f.path, name: f.name, url: f.url, durationSeconds: len };
    },
    // ---- v7: tool roles. Stability = sounds (loops/restyle), Gemini = ears (DNA/critique/labels), open-source python = analysis/processing ----
    addRef(name, p) { if (!chat.recordings.refs.some((r) => r.path === p)) chat.recordings.refs.push({ name, path: p }); const index = chat.recordings.refs.findIndex((r) => r.path === p) + 1; return { index, name: `ref#${index}`, label: name }; },
    setGroove(groove) { if (groove && Array.isArray(groove.microtiming)) { lastBuild.groove = { swing: groove.swing ?? null, microtiming: groove.microtiming.slice(0, 16), velocityProfile: (groove.velocityProfile || []).slice(0, 16), source: groove.source || 'analysis', at: Date.now() }; } return lastBuild.groove; },
    /** The freshest audio of what the set sounds like: a Live capture (< 10 min old) or an offline render of our layers. */
    async seedMix() {
      if (lastBuild.lastCapture && Date.now() - (lastBuild.lastCaptureAt || 0) < 10 * 60e3) return { path: lastBuild.lastCapture, source: 'live capture' };
      try { const r = await this.render({}); return { path: r.path, source: 'offline render of the AI layers' }; } catch { return null; }
    },
    async generateLoop({ prompt, bpm = lastBuild.bpm || 120, bars = 2, kind = 'drums', init = null, strength = 0.6 }) {
      const seconds = Math.max(6, Math.ceil(clamp(Number(bars), 1, 8) * 4 * 60 / clamp(Number(bpm), 40, 300)) + (kind === 'drums' ? 1 : 0));
      const body = String(prompt).trim().replace(/^(TrackType|Genre|Format):[^,]+,\s*/i, '');
      let lp = null; try { const k = await import('./lib/knowledge.js'); const slug = lastBuild.genreTarget ? k.matchGenre(String(lastBuild.genreTarget).split(':')[0]) : null; lp = slug && k.getLoopPrompts ? k.getLoopPrompts(slug) : null; } catch {}
      const genreTitle = lastBuild.genreTarget ? String(lastBuild.genreTarget).split(':')[0].replace(/\s*\(.*\)\s*$/, '') : undefined;
      const hasBpm = /\bBPM\b/i.test(body), hasProd = /dry|wet|room|tape|vinyl|saturat|reverb|lo-fi|clean|gritty|crunch/i.test(body);
      const composed = (() => { try { return composePrompt({ kind: kind === 'drums' || kind === 'tops' ? 'drums' : 'texture', title: genreTitle, bpm, body: kind === 'fx' ? `${body}, transition sound, wide stereo` : kind === 'tops' ? `${body}, hi-hats shakers and percussion only, no kick drum, no snare` : kind === 'drums' ? body : kind === 'bass' ? `${body}, bass line only, mono, centred` : `${body}, wide stereo`, production: lp?.production || undefined }); } catch { return null; } })();
      const full = composed ? composed : kind === 'drums' ? `TrackType: Instrument, ${body}${hasBpm ? '' : `, drum loop at ${Math.round(bpm)} BPM`}${hasProd ? '' : ', tight and dry'}${/no vocals/i.test(body) ? '' : ', no vocals'}${/no melody/i.test(body) ? '' : ', no melody'}`
        : kind === 'fx' ? `TrackType: SFX, ${body}, transition sound, wide stereo, no drums`
        : kind === 'bass' ? `TrackType: Instrument, ${body}${hasBpm ? '' : ` at ${Math.round(bpm)} BPM`}, bass line only, mono, no drums`
        : `TrackType: Instrument, ${body}${hasBpm ? '' : `, evolving texture layer at ${Math.round(bpm)} BPM`}, wide stereo, no drums`;
      // audio-to-audio: when a seed is given (the set's capture, our render, the kit loop, a user sample) the new loop inherits its
      // tempo, key and sonic world instead of being a text-only guess; strength = how far it may move away (0.3 subtle .. 0.85 new)
      let result, seeded = null;
      if (init) {
        let seedPath = init === 'mix' ? (await this.seedMix())?.path : init;
        if (seedPath && !audioPathOk(seedPath)) throw new Error('generateLoop: seed outside project audio');
        if (seedPath) {
          const seedWav = path.join(TMP, `seed-${Date.now()}.wav`);
          const want = clamp(Number(bars), 1, 8) * 4 * 60 / clamp(Number(bpm), 40, 300);
          await ffmpeg(['-i', seedPath, '-t', String(Math.max(6, Math.ceil(want))), '-ac', '2', '-ar', '44100', seedWav]);
          const st = clamp(Number(strength) || 0.6, 0.2, 0.9);
          try { result = await audioToAudio({ wavPath: seedWav, prompt: full, strength: st, duration: Math.min(seconds, 60), model: LOOP_MODEL }); }
          catch (e) { console.warn('[loop] audio-to-audio on', LOOP_MODEL, 'failed, trying 2.5:', e.message.slice(0, 80)); result = await audioToAudio({ wavPath: seedWav, prompt: full, strength: st, duration: Math.min(seconds, 60), model: 'stable-audio-2.5' }); }
          seeded = { from: init === 'mix' ? 'mix' : path.basename(seedPath), strength: st };
        }
      }
      if (!result) result = await textToAudio({ prompt: full, duration: Math.min(seconds, 60), model: LOOP_MODEL });
      // bar-exact: Stability renders whole seconds, Live warps the clip to bars*4 beats, so trim to the exact loop length
      const exact = clamp(Number(bars), 1, 8) * 4 * 60 / clamp(Number(bpm), 40, 300);
      const rawLoop = path.join(TMP, `loop-raw-${Date.now()}.wav`), trimmed = path.join(TMP, `loop-${Date.now()}.wav`);
      await fs.writeFile(rawLoop, result.buffer);
      let loopBuf = result.buffer;
      try { await ffmpeg(['-i', rawLoop, '-af', `atrim=0:${exact.toFixed(4)},afade=t=out:st=${Math.max(0, exact - 0.012).toFixed(3)}:d=0.012`, '-ac', '2', '-ar', '44100', trimmed]); loopBuf = await fs.readFile(trimmed); } catch (e) { console.warn('[loop] trim failed:', e.message); }
      const loop = await publish(loopBuf, `${kind}-loop`, '.wav', 'loop');
      const out = { loop: { path: loop.path, url: loop.url, name: loop.name, seconds: Number(exact.toFixed(3)), bars: clamp(Number(bars), 1, 8), bpm: Math.round(bpm), prompt: full, seeded }, kit: [] };
      if (kind === 'drums') {
        const { decodeMono16k } = await import('./lib/melody.js');
        const { detectOnsets, onsetFeatures, classifyOnset } = await import('./lib/rhythm.js');
        const x = await decodeMono16k(loop.path);
        const onsets = detectOnsets(x);
        const byKind = {};
        for (const o of onsets) { const f = onsetFeatures(x, o.sample); const k = classifyOnset(f); (byKind[k] ||= []).push({ ...o, rms: f.rms }); }
        const allTimes = onsets.map((o) => o.time).sort((a, b) => a - b);
        const gapAfter = (t) => { const nx = allTimes.find((x) => x > t + 0.03); return nx ? nx - t : 1; };
        for (const [k, list] of Object.entries(byKind)) {
          // prefer the hit with room after it (no neighbour bleeding into the tail), then the loudest
          const picks = list.sort((a, b) => (Math.min(gapAfter(b.time), 0.4) + b.rms) - (Math.min(gapAfter(a.time), 0.4) + a.rms)).slice(0, 2);
          for (const [i, best] of picks.entries()) {
            const want = k === 'kick' ? 0.6 : k === 'snare' ? 0.4 : 0.15;
            const len = Math.max(0.05, Math.min(want, gapAfter(best.time) - 0.006));
            const piece = await this.slice(loop.path, { startSeconds: Math.max(0, best.time - 0.005), lengthSeconds: len, fadeMs: Math.max(5, len * 150), name: `${kind}loop-${k}${i ? '-alt' : ''}` });
            out.kit.push({ kind: k, alt: i > 0, samplePath: piece.path, path: piece.path, url: piece.url, time: Number(best.time.toFixed(3)) });
          }
        }
        out.classesFound = Object.keys(byKind);
        if (!byKind.snare && !byKind.clap) out.note2 = 'no snare/clap-class hit detected in this loop; synthesize the clap/snare separately (same prompt words) so it matches';
        out.note = 'kit sliced from one loop: shared room/compression/character';
      }
      return out;
    },
    // ---- v9: hear and read the producer's own session ----
    /** Record what Live plays. fromBar (default 1) seeks the arrangement there first on ADEHack 5.8+; fromBar:null keeps the playhead. */
    async captureLive({ bars = 4, scene, fromBar = 1 } = {}) {
      const cap = await import('./lib/capture.js');
      if (!cap.captureAvailable()) throw new Error('Live audio capture not built: run `bash tools/capture/build.sh` (needs Xcode command line tools), then grant System Audio Recording to the terminal app in System Settings > Privacy & Security');
      const send = await liveClient();
      const bpm = Number((await send({ cmd: 'ping' }))?.tempo) || lastBuild.bpm || 120;   // the set's tempo is authoritative
      const seconds = Math.ceil(clamp(Number(bars) || 4, 1, 64) * 4 * 60 / bpm) + 1;
      const barSec = 4 * 60 / bpm;
      const total = seconds + Math.ceil(barSec) + 2;   // pre-roll: launch quantization can delay the start up to a bar
      let seekNote = null;
      if (scene == null && fromBar != null) {
        const known58 = await scriptAtLeast('5.8');
        const versionUnknown = !scriptState.running;   // handshake timed out: do not assume an old script, try the jump anyway
        if (known58 || versionUnknown) { const j = await send({ cmd: 'jump', bar: Math.max(1, Math.round(Number(fromBar))) }).catch((e) => ({ error: e.message })); seekNote = j?.ok ? `capture from bar ${Math.max(1, Math.round(Number(fromBar)))}` : `capture from playhead (jump failed: ${String(j?.error || '').slice(0, 60)})`; }
        else seekNote = 'capture from playhead (script < 5.8)';
      }
      if (scene != null) await send({ cmd: 'play_scene_for', index: Number(scene), seconds: total });
      else await send({ cmd: 'play_for', seconds: total, ...(seekNote?.startsWith('capture from bar') ? { from_bar: Math.max(1, Math.round(Number(fromBar))) } : {}) });
      for (let i = 0; i < 20; i++) { const st = await send({ cmd: 'ping' }); if (st?.is_playing !== false) break; await new Promise((r) => setTimeout(r, 150)); }
      const rawPath = path.join(TMP, `live-capture-raw-${Date.now()}.wav`);
      const r = await cap.captureLive({ seconds: total - 1, outPath: rawPath });
      const outPath = path.join(OUT_DIR, `live-capture-${Date.now()}.wav`);
      // drop the leading silence (before the first downbeat) and keep exactly N bars
      await ffmpeg(['-i', r.path, '-af', `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,atrim=0:${seconds - 1}`, '-ac', '2', '-ar', '44100', outPath]).catch(async () => fs.copyFile(r.path, outPath));
      const audio = await import('./lib/audio.js');
      const dur = await audio.durationSeconds(outPath).catch(() => 0);
      // sounding time: a -37 dBFS blip in 20 s of silence is not a performance; Gemini will happily invent a track from it
      let sounding = dur;
      try {
        const sd = await new Promise((resolve) => { execFileCb('ffmpeg', ['-hide_banner', '-nostdin', '-i', outPath, '-af', 'silencedetect=noise=-40dB:d=0.25', '-f', 'null', '-'], { maxBuffer: 4e6 }, (_e, _o, se) => resolve(String(se || ''))); });
        let quiet = 0, start = null;
        for (const m of sd.matchAll(/silence_(start|end): ([\d.]+)/g)) { if (m[1] === 'start') start = Number(m[2]); else if (start != null) { quiet += Number(m[2]) - start; start = null; } }
        if (start != null) quiet += Math.max(0, dur - start);
        sounding = Math.max(0, dur - quiet);
      } catch {}
      const silent = Boolean(r.silent) || dur < 0.5 || (r.peakDbfs != null && r.peakDbfs < -30) || sounding < Math.min(barSec, dur * 0.3);
      const out = { path: outPath, url: `/out/${encodeURIComponent(path.basename(outPath))}`, bars, bpm, seconds: Number(dur.toFixed(2)), soundingSeconds: Number(sounding.toFixed(2)), silent, peakDbfs: r.peakDbfs, note: silent ? `Live produced (almost) no sound: peak ${r.peakDbfs != null ? r.peakDbfs.toFixed(1) + ' dBFS' : 'none'}, ${sounding.toFixed(1)} s sounding of ${dur.toFixed(1)} s. Check: is the playhead on a section with clips, are the audio files online (no orange missing clips), is Back to Arrangement lit, is Live's output device the one it plays through?` : 'leading silence trimmed to the first downbeat' };
      if (seekNote) out.note = `${out.note}; ${seekNote}`;
      if (!silent) { try { out.profile = await (await import('./lib/analyze.js')).analyzeAudio(outPath); } catch (e) { out.profileError = e.message; } }
      lastBuild.lastCapture = outPath; lastBuild.lastCaptureAt = Date.now();
      return out;
    },
    /**
     * enhance_project v2. The whole-mix audio-to-audio result is a REFERENCE + SEED ("AI Enhance", muted after the audition), never
     * the final sound: a full mix regenerated at medium strength smears. Real layers come from PER-STEM audio-to-audio on short
     * windows (8-16 bars from bar 1): drums stem -> "AI Tops" loop (0.8), other stem -> "AI Texture" loop (0.6), bass stem ->
     * notes on a Live bass preset ("AI Bass"), clean generated kick/snare/hats on a Drum Rack with the stem's groove ("AI Kit").
     * Every new layer is scored against the original stem (order-swapped A/B, lite-judge labelled) and regenerated once on a clear loss.
     * Non-destructive: new tracks only, user faders untouched, nothing of theirs recorded over.
     */
    async enhanceProject({ intent = '', strength = 0.55, bars, deconstruct = true, genre } = {}) {
      const t0 = Date.now();
      const stage = (label, extra) => emit({ type: 'tool_done', name: 'enhance_project', ok: true, summary: `enhance: ${label}`, ...(extra ? { data: extra } : {}) });
      const send = await liveClient();
      const bpm = await syncTempo();
      let info = null; try { info = await send({ cmd: 'arrangement_info' }); } catch {}
      const totalBars = Number(bars) || Number(info?.bars) || 8;
      const useBars = clamp(totalBars, 4, 16);   // short windows: Stable Audio keeps structure better and Demucs/transcription stay quick
      const windowBars = Math.min(useBars, 8);   // the loop layers are 8 bars max (Live loops them)
      const peakOf = async (file) => { try { const se = await new Promise((resolve) => { execFileCb('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { maxBuffer: 4e6 }, (_e, _o, err) => resolve(String(err || ''))); }); const m = se.match(/max_volume:\s*(-?[\d.]+)\s*dB/); return m ? Number(m[1]) : null; } catch { return null; } };
      const sounding = (peak) => peak != null && peak > -40;
      stage(`recording ${useBars} bars of the whole set from bar 1 (${Math.round(useBars * 240 / bpm)} s)`);
      const cap = await this.captureLive({ bars: useBars, fromBar: 1 });
      if (cap.silent) throw new Error(`the capture was silent (${cap.note || 'nothing playing'}); make sure the set plays from bar 1 (Back to Arrangement lit, clips present)`);
      const genreTarget = lastBuild.genreTarget || '';
      // 1) Gemini: what is actually in the recording
      let dna = null; try { stage('Gemini listening to the recording'); dna = await (await import('./lib/ears.js')).productionDna(cap.path); } catch (e) { stage(`Gemini unavailable (${e.message.slice(0, 60)}), prompting from the set structure`); }
      // 2) Claude: one Stable Audio prompt from what was heard + the intent + the blueprint
      let bp = null; try { bp = await this.genreBlueprint(genre || intent || lastBuild.genreTarget || ''); } catch {}
      let promptText = null;
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default; const client = new Anthropic();
        const guide = await fs.readFile(path.join(here, 'docs', 'stable-audio-prompting.md'), 'utf8').catch(() => '');
        const r = await client.messages.create({ model: 'claude-opus-5-5', max_tokens: 400, output_config: { effort: 'low' },
          system: 'You write Stable Audio 3 audio-to-audio prompts for music producers. Output ONLY the prompt line, no quotes, max 60 words. Grammar: "TrackType: Music, Genre: <genre>, <what the music is and does: instruments, groove, mood, era, production>, <BPM> BPM". Describe, never instruct. Keep what the producer wants to keep by naming it.' + (guide ? `\n\nGuide excerpt:\n${guide.slice(0, 2500)}` : ''),
          messages: [{ role: 'user', content: `The producer's recording, as heard by an audio model: ${JSON.stringify(dna || {}).slice(0, 1500)}\nTempo: ${bpm} BPM.\nProducer's intent: ${intent}\n${bp ? `Style blueprint (${bp.title}): ${bp.summary.slice(0, 900)}` : ''}\nWrite the prompt.` }] });
        promptText = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0];
      } catch (e) { stage(`prompt writer unavailable (${e.message.slice(0, 60)})`); }
      if (!promptText) promptText = composePrompt({ kind: 'track', title: bp?.title, bpm, body: `${intent}, keeps the original melody and arrangement` });
      const body = promptText.replace(/^(TrackType|Genre|Format):[^,]+,\s*/gi, '').replace(/,?\s*\d+\s*BPM\s*$/i, '');
      // 3) Stable Audio 3 regenerates the recording audio-to-audio: the REFERENCE (what the whole thing could sound like)
      stage(`Stable Audio audio-to-audio reference (strength ${strength}): ${promptText.slice(0, 90)}`);
      const seconds = clamp(Math.ceil(cap.seconds || useBars * 240 / bpm), 6, 190);
      const st = clamp(Number(strength) || 0.55, 0.2, 0.9);
      let res; try { res = await audioToAudio({ wavPath: cap.path, prompt: promptText, strength: st, duration: seconds, model: LOOP_MODEL }); } catch (e) { stage(`Stable Audio 3 refused (${e.message.slice(0, 60)}), using 2.5`); res = await audioToAudio({ wavPath: cap.path, prompt: promptText, strength: st, duration: seconds, model: 'stable-audio-2.5' }); }
      const f = await publish(res.buffer, 'enhance', '.wav', 'loop');
      const ref = this.addRef(`enhanced version of the set (${intent.slice(0, 30)})`, f.path);
      stage('placing the enhanced reference in Live');
      const clip = await this.live.loadAudioClip({ track: 'AI Enhance', slot: 0, samplePath: f.path, warpMode: 'complex_pro', overwrite: true }).catch((e) => ({ error: e.message }));
      const out = { capture: { url: cap.url, seconds: cap.seconds, bars: useBars, from: cap.note }, heard: dna ? { style: dna.styleRead || dna.style || dna.genre, drums: dna.drums, bass: dna.bass, harmony: dna.harmonyMelody || dna.harmony, key: dna.key } : null, prompt: promptText, strength: st, enhanced: { url: f.url, path: f.path, ref: ref.name, clip: clip?.clip ? { track: 'AI Enhance', length: clip.clip.length } : clip, role: 'reference + seed, not the final sound' }, built: {}, scores: {}, ms: Date.now() - t0 };
      const created = ['AI Enhance'];
      // 4) real layers: per-stem audio-to-audio on the ORIGINAL capture (clean source), scored against the original stem
      if (deconstruct) {
        try {
          const py = await import('./lib/pytools.js');
          if (!py.pyAvailable()) throw new Error('python toolbelt not installed');
          stage('separating the recording into stems (Demucs)');
          const stR = await py.stems(cap.path, { outDir: path.join(TMP, `stems-${Date.now()}`) }); const stems = stR.stems || stR;
          out.stems = {}; const stemPeak = {};
          for (const [k, p] of Object.entries(stems)) if (p) { out.stems[k] = this.addRef(`${k} stem of the recording`, p).name; stemPeak[k] = await peakOf(p); }
          out.stemPeaks = stemPeak;
          let ears = null; try { ears = await import('./lib/ears.js'); if (!ears.geminiAvailable?.()) ears = null; } catch { ears = null; }
          // a candidate loop vs the original stem: A = original, B = ours. "B wins" = the new layer is more genre-true than what they had.
          const judge = async (origPath, candPath, scope) => { if (!ears) return { skipped: 'no Gemini key' }; try { return await ears.compareAuthenticity(origPath, candPath, { genreTarget, scope }); } catch (e) { return { error: e.message.slice(0, 120) }; } };
          const loopLayer = async ({ name, kind, stem, strength: lst, prompt, scope }) => {
            if (!stems[stem] || !sounding(stemPeak[stem])) return { skipped: `${stem} stem is (near) silent in the recording (peak ${stemPeak[stem] ?? 'n/a'} dBFS)` };
            stage(`${name}: audio-to-audio on the ${stem} stem (strength ${lst})`);
            const gen = () => this.generateLoop({ prompt, bpm, bars: windowBars, kind, init: stems[stem], strength: lst });
            let a = await gen();
            let score = await judge(stems[stem], a.loop.path, scope);
            let retried = null;
            if (score?.winner === 'A' && (score.confidence ?? 0) >= 0.7) {   // clear loss against the original: one more take, keep the better one
              stage(`${name}: judged weaker than the original (${String(score.why || '').slice(0, 60)}), one more take`);
              const b = await gen();
              const ab = await judge(a.loop.path, b.loop.path, scope);
              retried = { secondTake: b.loop.url, verdict: ab?.winner ? `take ${ab.winner === 'B' ? 2 : 1} kept (${ab.confidence})` : 'order-dependent, first take kept' };
              if (ab?.winner === 'B') { a = b; score = await judge(stems[stem], b.loop.path, scope); }
            }
            const warpMode = kind === 'tops' ? 'beats' : 'complex_pro';
            const r = await this.live.loadAudioClip({ track: name, slot: 0, samplePath: a.loop.path, warpMode, overwrite: true });
            rememberClip(name, { audio: true, bars: windowBars, slot: 0 });
            created.push(name);
            return { track: r.track || name, loop: a.loop.url, bars: windowBars, strength: lst, seededFrom: `${stem} stem`, score: score && !score.skipped ? { vsOriginal: score.winner === 'B' ? 'better' : score.winner === 'A' ? 'weaker' : 'even', confidence: score.confidence, why: score.why, lite: score.lite, provider: score.provider, scoreNote: score.scoreNote } : score, ...(retried ? { retried } : {}) };
          };
          const drumWords = String(dna?.drums || '').slice(0, 140);
          const harmonyWords = String(dna?.harmonyMelody || dna?.harmony || '').slice(0, 140);
          const bassWords = String(dna?.bass || '').slice(0, 100);
          // tops + texture generate in parallel (two Stability jobs), Live loads are serialized by the client queue
          const [tops, texture] = await Promise.all([
            loopLayer({ name: 'AI Tops', kind: 'tops', stem: 'drums', strength: 0.8, scope: 'drums', prompt: `${body}${drumWords ? ', ' + drumWords : ''}` }).catch((e) => ({ error: e.message.slice(0, 160) })),
            loopLayer({ name: 'AI Texture', kind: 'texture', stem: 'other', strength: 0.6, scope: 'full', prompt: `${body}${harmonyWords ? ', ' + harmonyWords : ''}` }).catch((e) => ({ error: e.message.slice(0, 160) })),
          ]);
          out.built.tops = tops; out.built.texture = texture;
          if (stems.drums && sounding(stemPeak.drums)) {
            // the GROOVE comes from their own drums; the SOUNDS come from the clean hit pipeline described by what Gemini heard
            stage('AI Kit: groove from the drum stem, clean sounds from the hit generator');
            const rhythm = await this.loopToPattern(stems.drums, { bpm, bars: Math.min(windowBars, 4) });
            this.setGroove(rhythm.groove);
            const lanes = (rhythm.pattern?.lanes || []).map((l) => l.instrument);
            const roles = ['kick', lanes.some((l) => /clap/.test(l)) && !lanes.some((l) => /snare/.test(l)) ? 'clap' : 'snare', lanes.some((l) => /hat_open/.test(l)) ? 'hat_open' : null, 'hat_closed'].filter(Boolean);
            const made = await Promise.all(roles.map(async (role) => { try { const r = await this.synth({ prompt: `${drumWords ? drumWords + ', ' : ''}${intent}`, role, variations: 1 }); return { kind: role, label: role, samplePath: r.path, path: r.path, url: r.url, subShare: r.subShare }; } catch { return null; } }));
            let kit = made.filter(Boolean);
            const kickHit = kit.find((k) => k.kind === 'kick');
            if (kickHit && kickHit.subShare != null && kickHit.subShare < 0.25) { try { const sub = await this.synthLocal({ kind: 'sub', name: 'enh-sub' }); const layered = await this.layerSamples({ layers: [{ path: kickHit.samplePath, gainDb: 0 }, { path: sub.path, gainDb: -3 }], name: 'enh-kick' }).catch(() => null); if (layered?.path) { kickHit.samplePath = layered.path; kickHit.path = layered.path; } } catch {} }
            if (!kit.length) { const kitR = await this.sliceKitFromAudio(stems.drums, { name: 'enh' }); kit = kitR.kit.filter((k) => !k.alt); }
            const have = new Set(kit.map((k) => k.kind));
            const pattern = { ...rhythm.pattern, lanes: (rhythm.pattern?.lanes || []).map((l) => ({ ...l, instrument: have.has(l.instrument) ? l.instrument : /snare|clap|rim/.test(l.instrument) ? (have.has('snare') ? 'snare' : 'clap') : /hat|ride|crash|perc|shaker/.test(l.instrument) ? (have.has(l.instrument) ? l.instrument : 'hat_closed') : 'kick' })) };
            if (kit.length && pattern.lanes.length) { out.built.kit = await this.live.buildKit({ name: 'AI Kit', kit, pattern, bars: pattern.bars, slot: 0, useGroove: true, humanize: 0.15, fire: false }).catch((e) => ({ error: e.message })); if (!out.built.kit?.error) { created.push('AI Kit'); try { await send({ cmd: 'set_mixer', track: 'AI Kit', mute: true }); } catch {} } }
            out.kitSounds = kit.map((k) => k.kind);
          } else out.built.kit = { skipped: 'no audible drums in the recording' };
          if (stems.bass && sounding(stemPeak.bass)) {
            // bass: audio-to-audio on the bass stem (0.5 keeps their line, moves the tone), transcribed onto a Live preset so it is editable
            stage('AI Bass: audio-to-audio on the bass stem, then notes onto a Live bass preset');
            let bassSrc = stems.bass, bassLoop = null;
            try { const g = await this.generateLoop({ prompt: `${body}${bassWords ? ', ' + bassWords : ''}, bass line only, no drums`, bpm, bars: windowBars, kind: 'bass', init: stems.bass, strength: 0.5 }); bassSrc = g.loop.path; bassLoop = g.loop.url; } catch (e) { out.built.bassNote = `bass stem audio-to-audio failed (${e.message.slice(0, 60)}); transcribed their own bass stem`; }
            const normP = path.join(TMP, `enh-bass-norm-${Date.now()}.wav`); await ffmpeg(['-i', bassSrc, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', normP]).catch(() => {});
            const tr = await this.transcribeLocal(await fs.access(normP).then(() => normP).catch(() => bassSrc), { onset: 0.35, frame: 0.25, minNoteMs: 70, bpm });
            const byOnset = new Map();
            for (const n of tr.notes) { if (n.pitch < 28 || n.pitch > 55) continue; const k = Math.round(n.startBeats * 4); const prev = byOnset.get(k); if (!prev || n.pitch < prev.pitch) byOnset.set(k, n); }
            const notes = [...byOnset.values()].map((n) => ({ pitch: n.pitch, startBeats: Math.round(n.startBeats * 4) / 4, durationBeats: Math.max(0.25, Math.round(n.durationBeats * 4) / 4), velocity: n.velocity })).sort((a, b) => a.startBeats - b.startBeats).filter((n) => n.startBeats < windowBars * 4);
            if (notes.length >= 2) {
              let preset = 'Bass'; try { const k = await import('./lib/knowledge.js'); const pr = bp && k.getPresets ? k.getPresets(bp.slug) : null; const list = pr?.bass || pr?.bassPresets; if (Array.isArray(list) && list.length) preset = presetName(String(list[0])); else if (typeof list === 'string' && list) preset = presetName(list); } catch {}
              try { await this.live.loadDevice({ track: 'AI Bass', name: preset }); } catch { try { await this.live.loadDevice({ track: 'AI Bass', name: 'Bass' }); } catch {} }
              out.built.bass = await this.live.buildMelody({ name: 'AI Bass', notes, bars: windowBars, slot: 0 }).catch((e) => ({ error: e.message }));
              out.built.bass.notes = notes.length; out.built.bass.preset = preset; if (bassLoop) out.built.bass.loop = bassLoop;
              if (!out.built.bass.error) created.push('AI Bass');
            } else out.built.bass = { note: 'no clear bass line found' };
          } else out.built.bass = { skipped: 'no audible bass in the recording' };
        } catch (e) { out.deconstructError = e.message.slice(0, 160); }
      }
      // 5) never stack: everything we made starts MUTED; the reference is auditioned soloed (restores afterwards), then presentation is verified
      for (const n of created) { try { await send({ cmd: 'set_mixer', track: n, mute: true }); } catch {} }
      try { await send({ cmd: 'set_mixer', track: 'AI Enhance', mute: false }); out.audition = await this.live.audition({ tracks: ['AI Enhance'], bars: Math.min(windowBars, 8) }); } catch (e) { out.audition = { error: e.message }; }
      try {
        const set = await send({ cmd: 'describe_set' });
        const ours = new Set(created.map((n) => n.toLowerCase()));
        const audible = [], muted = [];
        for (const t of set?.tracks || []) { if (!ours.has(String(t.name).toLowerCase())) continue; const m = Boolean(t.mute ?? t.muted ?? t.mixer?.mute); (m ? muted : audible).push(t.name); }
        const wrong = audible.filter((n) => n !== 'AI Enhance');
        out.presentation = { audible, muted, verified: wrong.length === 0, ...(wrong.length ? { warning: `${wrong.join(', ')} unexpectedly audible; muting` } : {}) };
        for (const n of wrong) { try { await send({ cmd: 'set_mixer', track: n, mute: true }); } catch {} }
      } catch (e) { out.presentation = { error: e.message.slice(0, 100) }; }
      out.scores = Object.fromEntries(Object.entries(out.built).filter(([, v]) => v && v.score).map(([k, v]) => [k, v.score]));
      // UI contract: layers = [{track, status, score, lite, judge, scoreNote}] (status: built | skipped | error)
      const TRACK_OF = { tops: 'AI Tops', texture: 'AI Texture', kit: 'AI Kit', bass: 'AI Bass' };
      out.layers = [{ track: 'AI Enhance', status: clip?.error ? 'error' : 'built', role: 'reference', score: null, lite: null, judge: null, scoreNote: null }, ...Object.entries(out.built).filter(([k]) => TRACK_OF[k]).map(([k, v]) => { const sc = v?.score && !v.score.skipped && !v.score.error ? v.score : null; return { track: v?.track?.name || v?.track || TRACK_OF[k], status: v?.error ? 'error' : v?.skipped || v?.note ? 'skipped' : 'built', score: sc ? Math.round((Number(sc.confidence) || 0) * 10) : null, verdict: sc?.vsOriginal ?? null, confidence: sc?.confidence ?? null, lite: sc?.lite ?? null, judge: sc?.provider ?? null, why: sc?.why || v?.score?.skipped || v?.score?.error || null, scoreNote: sc?.scoreNote ?? null, ...(v?.error ? { error: v.error } : {}), ...(v?.skipped ? { why: v.skipped } : {}) }; })];
      out.scoreNote = Object.values(out.scores).map((sc) => sc?.scoreNote).find(Boolean) || (Object.keys(out.scores).length ? undefined : 'layers not scored (no Gemini judge available)');
      out.note = `${out.layers.filter((l) => l.status === 'built').map((l) => l.track).join(', ')} built${out.capture?.from ? ` (${out.capture.from})` : ''}; only AI Enhance audible now`;
      out.listening = 'AI Enhance (the reference) plays SOLOED for a few bars so the user hears the direction alone; AI Tops, AI Texture, AI Kit and AI Bass are muted until asked for. Offer: "A/B it against my original", "unmute the tops", "use the AI kit instead of my drums", "unmute the bass", "another take of the texture".';
      out.ms = Date.now() - t0;
      return out;
    },
    async critiqueCapture(p, refPath, opts = {}) {
      if (!audioPathOk(p)) throw new Error('critique: path outside project audio');
      if (refPath && !audioPathOk(refPath)) throw new Error('critique: reference path outside project audio');
      return (await import('./lib/ears.js')).critiqueMix(p, refPath, { genreTarget: 'genreTarget' in opts ? (opts.genreTarget || undefined) : lastBuild.genreTarget, mixDetail: Boolean(opts.mixDetail) || chat.room === 'analyse', hints: opts.hints });
    },
    async importSample({ path: src, track, name, toneFix = {}, mode = 'oneshot' }) {
      if (!audioPathOk(src)) throw new Error('import: path outside project audio');
      let cur = src; const chain = [];
      if (toneFix?.highpassHz) chain.push({ type: 'highpass', hz: Number(toneFix.highpassHz) });
      if (toneFix?.lowpassHz) chain.push({ type: 'lowpass', hz: Number(toneFix.lowpassHz) });
      if (toneFix?.compress) chain.push({ type: 'compressor', threshold_db: -18, ratio: 3, attack_ms: 8, release_ms: 120 });
      if (Number(toneFix?.gainDb)) chain.push({ type: 'gain', db: Number(toneFix.gainDb) });
      const hasFix = chain.length > 0;
      if (hasFix) {
        const py = await import('./lib/pytools.js');
        if (py.pyAvailable()) {
          const r = await this.processAudio(cur, chain, name || 'imported');
          cur = r.path;
        } else {
          const r = await this.shapeSample({ path: cur, highpassHz: toneFix.highpassHz, lowpassHz: toneFix.lowpassHz, gainDb: toneFix.gainDb, name: name || 'imported' });
          chain.push('shape_sample (pytools not installed)'); cur = r.path;
        }
      } else if (!insideOut(cur)) { const f = await publish(await fs.readFile(cur), name || 'imported', '.wav', mode === 'loop' ? 'loop' : 'oneshot'); cur = f.path; }
      const trackName = track || name || 'Sample';
      const r = mode === 'loop' ? await this.live.buildLoopLayer({ name: trackName, samplePath: cur, bars: 2 }) : await this.live.loadSample({ name: trackName, samplePath: cur, role: 'perc' }).catch(async () => { const t = await ensureTrack(await liveClient(), trackName); return this.live.loadSample({ name: t.name, samplePath: cur, role: 'perc' }); });
      return { path: cur, url: `/out/${encodeURIComponent(path.basename(cur))}`, track: trackName, chain, mode, live: r };
    },
    async restyleAudio({ path: src, which, prompt, strength = 0.5 }) {
      if (!src && which) {   // ref#N / beat / hum / absolute path
        const m = String(which).match(/^ref#(\d+)$/i);
        if (m) src = chat.recordings.refs[Number(m[1]) - 1]?.path;
        else if (which === 'beat' || which === 'hum') src = chat.recordings[which];
        else src = String(which);
      }
      if (!src || !audioPathOk(src)) throw new Error(`restyle: unknown or outside-project audio (${which || src})`);
      const audio = await import('./lib/audio.js');
      const dur = await audio.durationSeconds(src);
      const input = path.join(TMP, `restyle-ref-${Date.now()}.wav`);
      if (dur < 6) await makeLoopInput(src, input); else await ffmpeg(['-i', src, '-t', '60', '-ac', '2', '-ar', '44100', input]);
      const result = await audioToAudio({ wavPath: input, prompt: `TrackType: Music, ${String(prompt).trim().replace(/^(TrackType|Genre|Format):[^,]+,\s*/i, '')}`, strength: clamp(Number(strength), 0.3, 0.8), duration: Math.min(Math.max(6, Math.ceil(Math.min(dur, 60))), 60), model: LOOP_MODEL });
      const f = await publish(result.buffer, 'alternative', '.wav', 'loop');
      return { path: f.path, url: f.url, name: f.name, strength, basedOn: path.basename(src) };
    },
    async explain({ path: p, brief, choices = [], steps = {}, level = 'intermediate' }) {
      lastBuild.explanations ||= {};
      const key = p || `turn-${Date.now()}`;
      const rec = { path: p || null, brief, choices, steps, level, at: Date.now() };
      lastBuild.explanations[key] = rec;
      emit({ type: 'explanation', ...rec });
      await saveChat();
      return { stored: key };
    },
    async referenceTrack({ query }) {
      const sc = await import('./lib/soundcharts.js');
      const r = await sc.lookupReference(query);
      if (r.song) {
        const k = await import('./lib/knowledge.js');
        const slug = k.matchGenre((r.song.genres || []).join(' ') + ' ' + r.song.name);
        if (slug) { const bp = k.getBlueprint(slug); r.blueprint = { slug, title: bp.title }; lastBuild.genreTarget = `${bp.title}: ${bp.summary}`; }
        lastBuild.reference = { name: r.song.name, artists: r.song.artists, genres: r.song.genres, tempo: r.song.audio?.tempo, key: r.song.audio?.key, producers: r.song.producers, releaseDate: r.song.releaseDate };
      }
      r.note = r.mode === 'sandbox' ? 'Soundcharts sandbox: only test songs are available; add SOUNDCHARTS_CLIENT_ID/SECRET to .env for the full catalogue' : undefined;
      return r;
    },
    async genreGuide({ genre }) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic();
      const r = await client.messages.create({ model: 'claude-opus-5-5', max_tokens: 1200, output_config: { effort: 'low' },
        system: 'You write short, factual genre guides for music producers. Be concrete. If unsure about a name or date, leave it out rather than guess.',
        messages: [{ role: 'user', content: `Genre: ${genre}. Give: 5 lines of history (places, decades, scenes), 5 artists or tracks to study with one phrase each on why, 3 production hallmarks (drums, bass, space). End with the line: "From model knowledge; verify names before quoting."` }] });
      const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { genre, text, source: process.env.SOUNDCHARTS_API_KEY ? 'claude (Soundcharts lookup not implemented yet)' : 'claude model knowledge' };
    },
    // Stability composes the rhythm: a genre loop -> hits -> MIDI pattern with the loop's own groove
    async loopToPattern(loopPath, { bpm = lastBuild.bpm || 120, bars = 2 } = {}) {
      if (!audioPathOk(loopPath)) throw new Error('loopToPattern: path outside project audio');
      const { decodeMono16k } = await import('./lib/melody.js');
      const { detectOnsets, onsetFeatures, classifyOnset } = await import('./lib/rhythm.js');
      const x = await decodeMono16k(loopPath);
      const onsets = detectOnsets(x);
      if (!onsets.length) throw new Error('no hits detected in the loop');
      const stepSec = 60 / bpm / 4, total = clamp(Number(bars), 1, 8) * 16;
      // grid phase: the file rarely starts exactly on a 16th; estimate the common fractional offset of the strong hits and remove it
      const strong = onsets.filter((o) => (o.flux || 0) >= 0.5 * Math.max(...onsets.map((q) => q.flux || 1)));
      let sx = 0, sy = 0; for (const o of (strong.length >= 4 ? strong : onsets)) { const ph = ((o.time / stepSec) % 1) * 2 * Math.PI; sx += Math.cos(ph); sy += Math.sin(ph); }
      let phase = Math.atan2(sy, sx) / (2 * Math.PI); if (phase < 0) phase += 1;            // 0..1 of a step
      const phaseShift = phase > 0.5 ? phase - 1 : phase;                                     // -0.5..0.5 step
      const lanes = {}; const micro = Array.from({ length: 16 }, () => []); const velProf = Array.from({ length: 16 }, () => []);
      const maxFlux = Math.max(...onsets.map((o) => o.flux || 1));
      for (const o of onsets) {
        const f = onsetFeatures(x, o.sample);
        let inst = classifyOnset(f);
        if (inst === 'hat_closed' && f.rms > 0.12 && (f.centroid || 0) > 5000) inst = 'hat_open';
        const stepF = o.time / stepSec - phaseShift; const step = Math.round(stepF);
        if (step < 0) continue;
        if (step >= total) continue;
        const vel = clamp(Math.round(60 + 67 * ((o.flux || 1) / maxFlux)), 40, 127);
        (lanes[inst] ||= new Map()).set(step, Math.max(vel, lanes[inst].get(step) || 0));
        micro[step % 16].push((stepF - step) * stepSec * 1000); velProf[step % 16].push(vel / 127);
      }
      // align: Stability loops rarely start on the downbeat. Choose the rotation that puts snares/claps on the backbeat (steps 4, 12)
      // and kicks on the downbeat (step 0); ties go to the smaller rotation.
      const scoreFor = (off) => {
        let sc = 0;
        for (const [inst, m] of Object.entries(lanes)) for (const [st, v] of m) {
          const r = ((st - off) % 16 + 16) % 16, w = v / 127;
          if (inst === 'snare' || inst === 'clap') { if (r === 4 || r === 12) sc += 3 * w; else if (r === 0 || r === 8) sc -= 2 * w; }
          if (inst === 'kick') { if (r === 0) sc += 2 * w; else if (r % 4 === 0) sc += 1 * w; else if (r % 2 === 1) sc -= 0.5 * w; }   // kicks belong on beats; off-16ths cost
        }
        return sc;
      };
      let offset = 0, bestScore = -Infinity;
      for (let off = 0; off < 16; off++) { const sc = scoreFor(off); if (sc > bestScore + 1e-9) { bestScore = sc; offset = off; } }
      if (offset) for (const m of Object.values(lanes)) { const rot = new Map(); for (const [st, v] of m) rot.set((st - offset + total) % total, v); m.clear(); for (const [st, v] of rot) m.set(st, v); }
      if (offset) { const rotA = (a) => a.map((_, i) => a[(i + offset) % 16]); micro.splice(0, 16, ...rotA(micro)); velProf.splice(0, 16, ...rotA(velProf)); }   // the groove template follows the rotation
      const mean = (a) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : 0);
      const microtiming = micro.map((a) => Number(mean(a).toFixed(1)));
      const velocityProfile = velProf.map((a) => Number(mean(a).toFixed(2)));
      const offbeats = [1, 3, 5, 7, 9, 11, 13, 15].map((i) => microtiming[i]).filter(Number.isFinite);
      const swing = clamp(mean(offbeats) / (stepSec * 1000) * 2, 0, 1);
      const pattern = { name: `loop rhythm ${Math.round(bpm)}`, bpm: Math.round(bpm), bars: clamp(Number(bars), 1, 8), stepsPerBar: 16, swing: Number(swing.toFixed(2)), lanes: Object.entries(lanes).map(([instrument, m]) => ({ instrument, steps: [...m.entries()].sort((a, b) => a[0] - b[0]).map(([step, velocity]) => ({ step, velocity })) })) };
      const groove = { swing: pattern.swing, microtiming, velocityProfile, source: path.basename(loopPath) };
      return { pattern, groove, onsetCount: onsets.length, alignedOffsetSteps: offset, gridPhaseMs: Number((phaseShift * stepSec * 1000).toFixed(1)) };
    },
    async generateRhythm({ prompt, genre, bpm = lastBuild.bpm || 120, bars = 2 }) {
      let body = prompt;
      if (!body && genre) { try { const bp = await this.genreBlueprint(genre); const k = await import('./lib/knowledge.js'); const lp = k.getLoopPrompts ? k.getLoopPrompts(bp.slug) : null; body = lp?.loops?.[0]?.replace('{bpm}', String(Math.round(bpm))) || `Genre: ${bp.title}, genre-true drum loop`; } catch { body = `${genre} drum loop`; } }
      const loop = await this.generateLoop({ prompt: body || 'drum loop', bpm, bars, kind: 'drums' });
      const r = await this.loopToPattern(loop.loop.path, { bpm, bars });
      this.setGroove(r.groove);
      return { ...loop, pattern: r.pattern, groove: r.groove, onsetCount: r.onsetCount, prompt: body };
    },
    async designKit({ genre, bpm = lastBuild.bpm || 120, bars = 2, candidates = 2 }) {
      const ears = await import('./lib/ears.js');
      let bp = null, prompts = [];
      try { bp = await this.genreBlueprint(genre || lastBuild.genreTarget || ''); const k = await import('./lib/knowledge.js'); const lp = k.getLoopPrompts ? k.getLoopPrompts(bp.slug) : null; prompts = (lp?.loops || []).map((p) => p.replace('{bpm}', String(Math.round(bpm)))); } catch {}
      if (!prompts.length) prompts = [`Genre: ${genre || 'hip hop'}, genre-true drum loop`, `Genre: ${genre || 'hip hop'}, classic era drum loop, authentic drum machine and sample character`];
      const n = clamp(Number(candidates) || 2, 1, 3);
      const target = bp ? `${bp.title}: ${bp.summary}` : (genre || '');
      // candidates generate and get judged in parallel (halves the wall time); different prompt bodies, not reseeds of one
      const cands = await Promise.all([...Array(n)].map(async (_, i) => {
        const body = prompts[i % prompts.length];
        try {
          const loop = await this.generateLoop({ prompt: body, bpm, bars, kind: 'drums' });
          let judged = { verdict: null, score: null, why: 'ears unavailable' };
          try {
            const sc = await ears.scoreGenre(loop.loop.path, { genreTarget: target, scope: 'drums' });
            judged = { verdict: sc.verdict, score: sc.overall, why: sc.why, dimensions: sc.dimensions, markersMissing: sc.markersMissing, fixPrompt: sc.fixPrompt, lite: sc.lite, judge: sc.judge };
          } catch (e) { judged.why = `ears: ${e.message.slice(0, 120)}`; }
          return { path: loop.loop.path, url: loop.loop.url, prompt: body, kit: loop.kit, ...judged };
        } catch (e) { return { prompt: body, error: e.message }; }
      }));
      const ok = cands.filter((c) => c.path);
      if (!ok.length) throw new Error(`design_kit: no loop generated (${cands.map((c) => c.error).join('; ')})`);
      // pairwise comparison is far more stable than absolute scores on the lite judge: let A/B decide when there are two
      let best = ok[0], comparison = null;
      if (ok.length >= 2) {
        try { const cmp = await ears.compareAuthenticity(ok[0].path, ok[1].path, { genreTarget: target, scope: 'drums' }); best = cmp.winner == null ? ok.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] : cmp.winner === 'B' ? ok[1] : ok[0]; comparison = { winner: cmp.winner, confidence: cmp.confidence, why: cmp.why, provider: cmp.provider, lite: cmp.lite }; }
        catch (e) { best = ok.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0]; comparison = { error: e.message.slice(0, 120) }; }
      }
      const r = await this.loopToPattern(best.path, { bpm, bars });
      this.setGroove(r.groove);
      return { genre: bp?.title || genre, best: { path: best.path, url: best.url, prompt: best.prompt, verdict: best.verdict, score: best.score, why: best.why }, comparison, scoreNote: (best.lite || comparison?.lite) ? (await import('./lib/ears.js')).LITE_SCORE_NOTE + '; the order-swapped A/B comparison decided the pick' : 'the order-swapped A/B comparison decided the pick', candidates: cands.map((c) => ({ url: c.url, verdict: c.verdict, score: c.score, why: c.why, error: c.error })), kit: best.kit, pattern: r.pattern, groove: r.groove };
    },
    // slice the best hit per drum class out of any drum audio (loop or Demucs drum stem)
    async sliceKitFromAudio(srcPath, { name = 'kit' } = {}) {
      if (!audioPathOk(srcPath)) throw new Error('slice kit: path outside project audio');
      const { decodeMono16k } = await import('./lib/melody.js');
      const { detectOnsets, onsetFeatures, classifyOnset } = await import('./lib/rhythm.js');
      const x = await decodeMono16k(srcPath);
      const onsets = detectOnsets(x);
      const byKind = {};
      for (const o of onsets) { const f = onsetFeatures(x, o.sample); let k = classifyOnset(f); if (k === 'hat_closed' && f.rms > 0.12 && (f.centroid || 0) > 5000) k = 'hat_open'; (byKind[k] ||= []).push({ ...o, rms: f.rms }); }
      const kit = [];
      const allTimes = onsets.map((o) => o.time).sort((a, b) => a - b);
      const gapAfter = (t) => { const nx = allTimes.find((x) => x > t + 0.03); return nx ? nx - t : 1; };
      for (const [k, list] of Object.entries(byKind)) {
        const picks = list.sort((a, b) => (Math.min(gapAfter(b.time), 0.4) + b.rms) - (Math.min(gapAfter(a.time), 0.4) + a.rms)).slice(0, 2);
        for (const [i, best] of picks.entries()) {
          const want = k === 'kick' ? 0.6 : k === 'snare' ? 0.4 : k === 'hat_open' ? 0.5 : 0.15;
          const len = Math.max(0.05, Math.min(want, gapAfter(best.time) - 0.006));
          const piece = await this.slice(srcPath, { startSeconds: Math.max(0, best.time - 0.005), lengthSeconds: len, fadeMs: Math.max(5, len * 150), name: `${name}-${k}${i ? '-alt' : ''}` });
          kit.push({ kind: k, alt: i > 0, samplePath: piece.path, path: piece.path, url: piece.url, time: Number(best.time.toFixed(3)) });
        }
      }
      return { kit, classesFound: Object.keys(byKind), onsetCount: onsets.length };
    },
    // Compose a full genre-true track with Stable Audio 3, then deconstruct it into an editable Live session
    async composeTrack({ genre, bpm, bars = 16, prompt, candidates = 1 }) {
      const t0 = Date.now(); const timings = {};
      const stage = (label, extra) => emit({ type: 'tool_done', name: 'compose_track', ok: true, summary: `compose: ${label}`, ...(extra ? { data: extra } : {}) });
      const ears = await import('./lib/ears.js');
      const py = await import('./lib/pytools.js');
      if (!py.pyAvailable()) throw new Error('compose_track needs the open-source toolbelt (Demucs/basic-pitch): run bash tools/py/setup.sh');
      let bp = null; try { bp = await this.genreBlueprint(genre || lastBuild.genreTarget || ''); } catch {}
      bpm = clamp(Number(bpm) || (bp?.tempo ? Number(String(bp.tempo).match(/\d+/)?.[0]) : 0) || lastBuild.bpm || 92, 60, 180);
      bars = clamp(Number(bars) || 16, 8, 32);
      lastBuild.bpm = Math.round(bpm);   // transcription converts seconds -> beats with lastBuild.bpm: set it BEFORE the stems are read
      const seconds = clamp(Math.ceil(bars * 4 * 60 / bpm), 20, 180);
      let body = prompt;
      if (!body) {
        try { const k = await import('./lib/knowledge.js'); const lp = bp && k.getLoopPrompts ? k.getLoopPrompts(bp.slug) : null; body = (lp?.track || lp?.loops?.[0])?.replace(/\{bpm\}/g, String(Math.round(bpm))); } catch {}
        body = body || `${bp?.title || genre || 'hip hop'} beat, authentic drums and bass`;
      }
      const target = bp ? `${bp.title}: ${bp.summary}` : (genre || '');
      // 1) compose candidates, judge
      const cands = [];
      for (let i = 0; i < clamp(Number(candidates) || 1, 1, 2); i++) {
        stage(`composing ${bars} bars at ${Math.round(bpm)} BPM with Stable Audio 3${i ? ' (second candidate)' : ''}`);
        const full = composePrompt({ kind: 'track', title: bp?.title, bpm, body: `${body.replace(/,\s*no (melody|vocals|bass|drums)/gi, '')}, full arrangement with intro, verse and hook` });
        const res = await textToAudio({ prompt: full, duration: seconds, model: LOOP_MODEL });
        const f = await publish(res.buffer, `${(bp?.slug || genre || 'track').replace(/[^a-z0-9]+/gi, '-')}-track`, '.wav', 'loop');
        let judged = { verdict: null, score: null, why: 'ears unavailable' };
        if (target) { stage('Gemini judging authenticity (strict rubric)'); try { const sc = await ears.scoreGenre(f.path, { genreTarget: target, scope: 'full' }); judged = { verdict: sc.verdict, score: sc.overall, why: sc.why, dimensions: sc.dimensions, markersMissing: sc.markersMissing, fixPrompt: sc.fixPrompt }; } catch (e) { judged.why = `ears: ${e.message.slice(0, 100)}`; } }
        cands.push({ path: f.path, url: f.url, prompt: full, ...judged });
        if ((judged.score ?? 0) >= 7 || judged.verdict === 'uncertain') break;   // only a clearly 'off' candidate buys a second (5-min) render
      }
      const best = cands.sort((a, b) => (b.score ?? 5) - (a.score ?? 5))[0];
      timings.compose = Date.now() - t0;
      // 2) stems
      stage('separating stems with Demucs (1-2 minutes)');
      const t1 = Date.now();
      const st = await py.stems(best.path, { outDir: path.join(TMP, `stems-${Date.now()}`) });
      const stems = st.stems || st;
      timings.stems = Date.now() - t1;
      const stemRefs = {};
      for (const [k, p] of Object.entries(stems)) if (p) stemRefs[k] = this.addRef(`${k} of ${path.basename(best.path)}`, p).name;
      // 3) drums -> kit + pattern
      stage('extracting the drum kit and MIDI groove from the drum stem');
      const kitR = await this.sliceKitFromAudio(stems.drums, { name: `${bp?.slug || 'track'}` });
      const rhythm = await this.loopToPattern(stems.drums, { bpm, bars });
      this.setGroove(rhythm.groove);
      // stems from generated tracks can be quiet: normalize before transcription
      const norm = async (p) => { const out = path.join(TMP, `norm-${path.basename(p)}`); try { await ffmpeg(['-i', p, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', out]); return out; } catch { return p; } };
      const bassSrc = stems.bass ? await norm(stems.bass) : null, otherSrc = stems.other ? await norm(stems.other) : null;
      const stemLevels = {};
      try { const a = await import('./lib/analyze.js'); for (const [k, p] of Object.entries(stems)) if (p) { const pr = await a.analyzeAudio(p); stemLevels[k] = pr.loudness?.integratedLufs ?? null; } } catch {}
      // 4) bass -> notes
      stage('transcribing the bass line (basic-pitch)');
      let bassNotes = [];
      try {
        const tr = await this.transcribeLocal(bassSrc, { onset: 0.35, frame: 0.25, minNoteMs: 70 });
        const byOnset = new Map();
        for (const n of tr.notes) { if (n.pitch < 28 || n.pitch > 55) continue; const k = Math.round(n.startBeats * 4); const prev = byOnset.get(k); if (!prev || n.pitch < prev.pitch) byOnset.set(k, n); }
        bassNotes = [...byOnset.values()].map((n) => ({ pitch: n.pitch, startBeats: Math.round(n.startBeats * 4) / 4, durationBeats: Math.max(0.25, Math.round(n.durationBeats * 4) / 4), velocity: n.velocity })).sort((a, b) => a.startBeats - b.startBeats);
      } catch (e) { stage(`bass transcription failed: ${e.message.slice(0, 80)}`); }
      // 5) other -> keys
      stage('transcribing chords and keys (basic-pitch)');
      let keysNotes = [];
      try {
        const tr = await this.transcribeLocal(otherSrc, { onset: 0.4, frame: 0.25, minNoteMs: 100 });
        const perStep = new Map();
        for (const n of tr.notes) { if (n.pitch < 48 || n.pitch > 84) continue; const k = Math.round(n.startBeats * 2) / 2; const arr = perStep.get(k) || []; if (arr.length < 6) arr.push({ pitch: n.pitch, startBeats: k, durationBeats: Math.max(0.5, Math.round(n.durationBeats * 2) / 2), velocity: n.velocity }); perStep.set(k, arr); }
        keysNotes = [...perStep.values()].flat().sort((a, b) => a.startBeats - b.startBeats);
      } catch (e) { stage(`keys transcription failed: ${e.message.slice(0, 80)}`); }
      // 6) sections -> A/B bar ranges
      stage('reading the arrangement sections');
      let sections = [];
      try { const an = await py.analyzeMusic(best.path); sections = (an.sections || []).map((sc) => ({ startBar: Math.max(1, Math.floor(sc.start / (240 / bpm)) + 1), endBar: Math.min(bars, Math.ceil(sc.end / (240 / bpm))) })).filter((sc) => sc.endBar > sc.startBar); } catch {}
      const A = { startBar: 1, endBar: Math.min(bars, 8) };
      const later = sections.filter((sc) => sc.startBar > A.endBar).sort((a, b) => (b.endBar - b.startBar) - (a.endBar - a.startBar))[0];
      const B = later ? { startBar: later.startBar, endBar: Math.min(bars, later.startBar + 7) } : { startBar: Math.min(bars, 9), endBar: Math.min(bars, 16) };
      const sliceSteps = (lanes, range) => lanes.map((l) => ({ instrument: l.instrument, steps: l.steps.filter((x) => x.step >= (range.startBar - 1) * 16 && x.step < range.endBar * 16).map((x) => ({ step: x.step - (range.startBar - 1) * 16, velocity: x.velocity })) })).filter((l) => l.steps.length);
      const sliceNotes = (notes, range) => notes.filter((n) => n.startBeats >= (range.startBar - 1) * 4 && n.startBeats < range.endBar * 4).map((n) => ({ ...n, startBeats: n.startBeats - (range.startBar - 1) * 4 }));
      const barsA = A.endBar - A.startBar + 1, barsB = Math.max(1, B.endBar - B.startBar + 1);
      // 7) build in Live — into NEW scenes, on the role tracks, never replacing the producer's sounds or presets
      stage('building the session in Live');
      const send = await liveClient();
      await send({ cmd: 'set_tempo', bpm: Math.round(bpm) }); lastBuild.bpm = Math.round(bpm);
      const label = (bp?.title || genre || 'Track').replace(/\s*\(.*\)\s*/, '').slice(0, 28);
      const scA = await send({ cmd: 'create_scene', index: -1, name: `${label} A ${Math.round(bpm)} BPM` });
      const scB = await send({ cmd: 'create_scene', index: -1, name: `${label} B ${Math.round(bpm)} BPM` });
      const slotA = Number.isInteger(scA?.index) ? scA.index : 0, slotB = Number.isInteger(scB?.index) ? scB.index : slotA + 1;
      const built = { scenes: { A: slotA, B: slotB } };
      const kitMain = kitR.kit.filter((k) => !k.alt);
      const patA = { ...rhythm.pattern, bars: barsA, lanes: sliceSteps(rhythm.pattern.lanes, A) };
      const patB = { ...rhythm.pattern, bars: barsB, lanes: sliceSteps(rhythm.pattern.lanes, B) };
      try { built.drums = await this.live.buildKit({ name: 'Drums', kit: kitMain, pattern: patA, bars: barsA, slot: slotA }); if (patB.lanes.length) { const map = built.drums.padMap || {}; const patBm = { ...patB, lanes: patB.lanes }; built.drumsB = await this.live.buildKit({ name: 'Drums', kit: kitMain.map((k) => ({ ...k, note: map[k.label || k.kind] })), pattern: patBm, bars: barsB, slot: slotB }); } } catch (e) { built.drums = { error: e.message }; }
      const hasInstrument = async (track) => { try { const d = await this.live.listDevices({ track, params: false }); return (d.devices || []).some((x) => /simpler|sampler|instrument|rack|impulse/i.test(`${x.class_name} ${x.name}`)); } catch { return false; } };
      const presetFor = async (role, fallbackQuery) => { try { const k = await import('./lib/knowledge.js'); const pr = bp && k.getPresets ? k.getPresets(bp.slug) : null; const list = pr?.[role] || pr?.[`${role}Presets`]; if (Array.isArray(list) && list.length) return presetName(String(list[0])); if (typeof list === 'string' && list) return presetName(list); } catch {} return fallbackQuery; };
      const builtTracks = ['Drums'];
      if (bassNotes.length) { try { const nA = sliceNotes(bassNotes, A), nB = sliceNotes(bassNotes, B); const existed = await hasInstrument('Bass'); built.bass = await this.live.buildMelody({ name: 'Bass', notes: nA.length ? nA : bassNotes.slice(0, 16), bars: barsA, slot: slotA }); if (nB.length) await this.live.buildMelody({ name: 'Bass', notes: nB, bars: barsB, slot: slotB }); builtTracks.push('Bass'); if (!existed) { const preset = await presetFor('bass', 'Hip-Hop Sub Bass'); try { built.bass.preset = (await this.live.loadDevice({ track: 'Bass', name: preset })).device?.name || preset; } catch (e) { built.bass.presetError = e.message; } } else built.bass.preset = 'kept the existing instrument'; } catch (e) { built.bass = { error: e.message }; } }
      if (keysNotes.length) { try { const nA = sliceNotes(keysNotes, A), nB = sliceNotes(keysNotes, B); const existed = await hasInstrument('Keys'); built.keys = await this.live.buildMelody({ name: 'Keys', notes: nA.length ? nA : keysNotes.slice(0, 24), bars: barsA, slot: slotA }); if (nB.length) await this.live.buildMelody({ name: 'Keys', notes: nB, bars: barsB, slot: slotB }); builtTracks.push('Keys'); if (!existed) { const preset = await presetFor('keys', 'Grand Piano'); try { built.keys.preset = (await this.live.loadDevice({ track: 'Keys', name: preset })).device?.name || preset; } catch (e) { built.keys.presetError = e.message; } } else built.keys.preset = 'kept the existing instrument'; } catch (e) { built.keys = { error: e.message }; } }
      try { await this.live.mixBalance({ only: builtTracks }); } catch {}
      try { await send({ cmd: 'fire_scene', index: slotA }); await send({ cmd: 'show_view', view: 'Session' }); } catch {}
      built.stemLevelsLufs = stemLevels;
      timings.total = Date.now() - t0;
      return { track: { path: best.path, url: best.url, prompt: best.prompt }, verdict: best.verdict, score: best.score, why: best.why, styleRead: best.styleRead, candidates: cands.length, stems: stemRefs, kit: kitMain.map((k) => ({ kind: k.kind, samplePath: k.samplePath })), pattern: { bars, lanes: rhythm.pattern.lanes.map((l) => `${l.instrument}:${l.steps.length}`), swing: rhythm.pattern.swing }, bassNotes: bassNotes.length, keysNotes: keysNotes.length, sections, scenes: { A, B }, built, timings };
    },
    async restyleMix({ prompt, strength = 0.45, bars }) {
      const r = await this.render({ bars });
      const input = path.join(TMP, `restyle-in-${Date.now()}.wav`);
      const dur = await (await import('./lib/audio.js')).durationSeconds(r.path);
      if (dur < 6) await makeLoopInput(r.path, input); else await fs.copyFile(r.path, input);
      const result = await audioToAudio({ wavPath: input, prompt: `TrackType: Music, ${String(prompt).trim().replace(/^(TrackType|Genre|Format):[^,]+,\s*/i, '')}, cohesive full mix at ${Math.round(lastBuild.bpm || 120)} BPM`, strength: clamp(Number(strength), 0.2, 0.8), duration: Math.min(Math.max(6, Math.ceil(dur)), 60), model: LOOP_MODEL });
      const f = await publish(result.buffer, 'restyle', '.wav', 'loop');
      return { path: f.path, url: f.url, name: f.name, strength, basedOn: r.url };
    },
    // closed loop: Gemini hears -> proposes a prompt -> Stability regenerates -> Gemini scores; keep the best
    async refineSound({ path: startPath, intent, currentPrompt = intent, role = 'drum', rounds = 2, track }) {
      if (!audioPathOk(startPath)) throw new Error('refine: path outside project audio');
      const ears = await import('./lib/ears.js');
      const kind = TONAL.has(String(role).toLowerCase()) ? 'tone' : 'drum';
      let best = { path: startPath, prompt: currentPrompt, match: null, round: 0 };
      const history = [];
      let current = { ...best };
      for (let r = 1; r <= clamp(Number(rounds), 1, 3); r++) {
        const prop = await ears.proposePrompt(current.path, { intent, currentPrompt: current.prompt, kind });
        if (r === 1) { best.match = prop.match; history.push({ round: 0, prompt: current.prompt, heard: prop.heard, match: prop.match }); }
        if (prop.match >= 9) break;
        const useA2A = Boolean(prop.useAudioToAudio);
        const out = await synthesize({ prompt: prop.newPrompt, name: `${role}-refined`, kind: kind === 'tone' ? 'tone' : undefined, mode: useA2A ? 'oneshot' : 'text', audioPath: useA2A ? current.path : undefined, strength: useA2A ? clamp(Number(prop.strength) || 0.5, 0.3, 0.8) : undefined, oneshotSeconds: kind === 'tone' ? 2.5 : 1.0 });
        const one = out.files.find((f) => f.kind === 'oneshot') || out.files[0];
        const judged = await ears.judge(one.path, intent);
        history.push({ round: r, prompt: prop.newPrompt, viaAudioToAudio: useA2A, gap: prop.gap, heard: judged.text.split('\n')[0], match: judged.match });
        current = { path: one.path, url: one.url, prompt: prop.newPrompt, match: judged.match, round: r };
        if (judged.match != null && (best.match == null || judged.match > best.match)) best = { ...current };
        if (judged.match >= 9) break;
      }
      let applied = null;
      if (track && best.path !== startPath) { try { applied = await this.live.loadSample({ name: track, samplePath: best.path, role }); } catch (e) { applied = { error: e.message }; } }
      return { best: { path: best.path, url: best.url || `/out/${encodeURIComponent(path.basename(best.path))}`, prompt: best.prompt, match: best.match, round: best.round }, history, appliedToTrack: applied ? track : null, applied };
    },
    async undoSound({ track }) {
      const key = String(track).toLowerCase();
      const hist = lastBuild.soundHistory[key] || [];
      if (!hist.length) throw new Error(`no previous sound recorded for ${track}`);
      const prev = hist[hist.length - 1];
      const r = await this.live.loadSample({ name: track, samplePath: prev.samplePath, role: prev.role });   // throws -> stack untouched
      hist.pop();
      lastBuild.soundHistory[key] = hist;   // loadSample pushed the current one; keep the stack sane
      lastBuild.soundHistory[key].pop();
      return { restored: path.basename(prev.samplePath), remainingUndos: hist.length, live: r };
    },
    async genreBlueprint(genre) {
      const k = await import('./lib/knowledge.js').catch(() => null);
      if (!k) throw new Error('knowledge base not built yet (lib/knowledge.js)');
      const slug = k.matchGenre(String(genre || ''));
      if (!slug) { try { const g = await k.ensureBlueprint(genre); if (g.slug) { const bp = k.getBlueprint(g.slug); return { ...bp, generated: g.generated }; } } catch (e) { throw new Error(`no blueprint for "${genre}" and generating one failed: ${e.message}`); } }
      return k.getBlueprint(slug);
    },
    productionDna: async (p) => { if (!audioPathOk(p)) throw new Error('dna: path outside project audio'); return (await import('./lib/ears.js')).productionDna(p); },
    async critiqueMix(refPath, opts = {}) {
      const r = await this.render({});
      if (refPath && !audioPathOk(refPath)) throw new Error('critique: reference path outside project audio');
      const c = await (await import('./lib/ears.js')).critiqueMix(r.path, refPath, { genreTarget: opts.genreTarget || lastBuild.genreTarget, mixDetail: Boolean(opts.mixDetail) || chat.room === 'analyse' });
      return { ...c, render: { url: r.url, profile: r.profile?.ratings } };
    },
    async labelPieces(paths) {
      const { labelPiece } = await import('./lib/ears.js');
      const out = [];
      for (const p of (paths || []).slice(0, 12)) { if (!audioPathOk(p)) { out.push({ path: p, error: 'outside project audio' }); continue; } try { out.push({ path: p, ...(await labelPiece(p)) }); } catch (e) { out.push({ path: p, error: e.message }); } }
      return { pieces: out };
    },
    // open-source toolbelt (tools/py via lib/pytools.js); each degrades to a clear error when not installed
    async stems(p) { if (!audioPathOk(p)) throw new Error('stems: path outside project audio'); const m = await import('./lib/pytools.js'); const r = await m.stems(p, { outDir: path.join(TMP, `stems-${Date.now()}`) }); return r; },
    async analyzeMusic(p) { if (!audioPathOk(p)) throw new Error('analyze_music: path outside project audio'); const m = await import('./lib/pytools.js'); const r = await m.analyzeMusic(p); if (r?.groove) this.setGroove({ ...r.groove, source: path.basename(p) }); return r; },
    async transcribeLocal(p, opts) { if (!audioPathOk(p)) throw new Error('transcribe: path outside project audio'); const m = await import('./lib/pytools.js'); const r = await m.transcribeLocal(p, opts); const bpm = opts?.bpm || await syncTempo(); const notes = (r.notes || []).map((n) => ({ pitch: n.pitch, startBeats: Number((n.startSeconds * bpm / 60).toFixed(3)), durationBeats: Math.max(0.125, Number((n.durationSeconds * bpm / 60).toFixed(3))), velocity: clamp(Math.round(n.velocity || 100), 1, 127) })); return { notes, bars: Math.max(1, Math.ceil(Math.max(0, ...notes.map((n) => n.startBeats + n.durationBeats)) / 4)), bpm, midiPath: r.midiPath, engine: 'basic-pitch' }; },
    async processAudio(p, chain, name = 'processed') { if (!audioPathOk(p)) throw new Error('process: path outside project audio'); const m = await import('./lib/pytools.js'); const out = path.join(TMP, `proc-${Date.now()}.wav`); const r = await m.processAudio(p, chain, out); const f = await publish(await fs.readFile(r.out || out), name, '.wav', 'oneshot'); return { path: f.path, url: f.url, name: f.name, peakDbfs: r.peakDbfs }; },
    async masterAudio(lufs = -12) { const src = lastBuild.lastRender; if (!src) throw new Error('master: render a preview first'); const m = await import('./lib/pytools.js'); const out = path.join(TMP, `master-${Date.now()}.wav`); const r = await m.masterAudio(src, out, lufs); const f = await publish(await fs.readFile(r.out || out), 'master', '.wav', 'loop'); return { path: f.path, url: f.url, lufs: r.lufs, peakDbfs: r.peakDbfs }; },
    async shapeSample(a) {
      const { path: src, trimStartMs = 0, lengthMs, fadeOutMs = 10, gainDb = 0, highpassHz, lowpassHz, widen, name = 'shaped' } = a;
      if (!audioPathOk(src)) throw new Error('shape: path outside project audio');
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const out = path.join(TMP, `${id}-shape.wav`);
      const af = [];
      if (highpassHz) af.push(`highpass=f=${clamp(Number(highpassHz), 20, 20000)}`);
      if (lowpassHz) af.push(`lowpass=f=${clamp(Number(lowpassHz), 20, 20000)}`);
      if (gainDb) af.push(`volume=${clamp(Number(gainDb), -30, 24)}dB`);
      const fade = clamp(Number(fadeOutMs), 1, 2000) / 1000;
      const args = ['-ss', String(Math.max(0, Number(trimStartMs) || 0) / 1000), '-i', src];
      if (lengthMs) { const len = clamp(Number(lengthMs), 20, 20000) / 1000; args.push('-t', String(len)); af.push(`afade=t=out:st=${Math.max(0, len - fade).toFixed(3)}:d=${fade}`); }
      else af.push('areverse', `afade=t=in:st=0:d=${fade}`, 'areverse');
      args.push('-af', af.join(','), '-ac', '2', '-ar', '44100', out);
      await ffmpeg(args);
      let widened = false, f = null;
      if (widen && Number(widen) > 0) { try { const r = await this.processAudio(out, [{ type: 'widen', amount: clamp(Number(widen), 0, 1) }], name); f = { path: r.path, url: r.url, name: r.name }; widened = true; } catch (e) { console.warn('[shape] widen skipped:', e.message); } }
      if (!f) f = await publish(await fs.readFile(out), name, '.wav', 'oneshot');
      const audio = await import('./lib/audio.js');
      const { analyzeAudio } = await import('./lib/analyze.js');
      let width = null; try { width = (await analyzeAudio(f.path))?.stereo?.width ?? null; } catch {}
      return { path: f.path, url: f.url, name: f.name, durationSeconds: await audio.durationSeconds(f.path), stereoWidth: width != null ? Number(width.toFixed(2)) : null, widened };
    },
    async tuneSample({ path: src, semitones, targetMidi, targetNote, name = 'tuned', preserveFormants, allowLarge = false, role = '' }) {
      const vocal = /vox|vocal|chop|voice|adlib|ad-lib|hook/i.test(`${role} ${name} ${path.basename(String(src || ''))}`);
      if (preserveFormants == null) preserveFormants = vocal;
      if (!audioPathOk(src)) throw new Error('tune: path outside project audio');
      const { analyzeAudio } = await import('./lib/analyze.js');
      let detected = null, applied = Number(semitones);
      if (!Number.isFinite(applied)) {
        const prof = await analyzeAudio(src);
        detected = prof.pitch?.midi ?? null;
        let target = Number(targetMidi);
        if (!Number.isFinite(target) && targetNote) { const m = String(targetNote).trim().match(/^([A-Ga-g])([#b]?)(-?\d)$/); if (m) { const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); target = (Number(m[3]) + 1) * 12 + base; } }
        if (detected == null || !Number.isFinite(target)) throw new Error(`tune: could not detect pitch or parse target (${detected}, ${targetNote ?? targetMidi})`);
        applied = target - detected;
        const exactOctave = Boolean(targetNote && /-?\d$/.test(String(targetNote).trim())) || Number.isFinite(Number(targetMidi));
        if (!exactOctave || allowLarge) { while (applied > 6) applied -= 12; while (applied < -6) applied += 12; }   // nearest octave only when no octave was asked for
      }
      applied = clamp(applied, -24, 24);
      let note;
      if (vocal && !allowLarge && Math.abs(applied) > 3) { note = `vocal shift limited to ±3 st (asked ${applied.toFixed(1)}); pass allowLarge to override`; applied = clamp(applied, -3, 3); }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const out = path.join(TMP, `${id}-tune.wav`);
      const ratio = Math.pow(2, applied / 12);
      try { await ffmpeg(['-i', src, '-af', `rubberband=pitch=${ratio.toFixed(5)}${preserveFormants ? ':formant=preserved' : ''}`, '-ac', '2', '-ar', '44100', out]); }
      catch { await ffmpeg(['-i', src, '-af', `asetrate=44100*${ratio.toFixed(5)},aresample=44100`, '-ac', '2', '-ar', '44100', out]); }
      const f = await publish(await fs.readFile(out), name, '.wav', 'oneshot');
      return { path: f.path, url: f.url, name: f.name, detectedMidi: detected, appliedSemitones: Number(applied.toFixed(2)), preserveFormants, ...(note ? { note } : {}) };
    },
    async layerSamples({ layers = [], name = 'layered' }) {
      if (layers.length < 2 || layers.length > 4) throw new Error('layer: give 2-4 layers');
      for (const l of layers) if (!audioPathOk(l.path)) throw new Error('layer: path outside project audio');
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const out = path.join(TMP, `${id}-layer.wav`);
      const args = []; const chains = [];
      layers.forEach((l, i) => {
        args.push('-i', l.path);
        const f = ['aresample=44100', 'aformat=channel_layouts=stereo'];
        if (l.offsetMs) f.push(`adelay=${Math.max(0, Number(l.offsetMs))}|${Math.max(0, Number(l.offsetMs))}`);
        if (l.highpassHz) f.push(`highpass=f=${clamp(Number(l.highpassHz), 20, 20000)}`);
        if (l.lowpassHz) f.push(`lowpass=f=${clamp(Number(l.lowpassHz), 20, 20000)}`);
        f.push(`volume=${clamp(Number(l.gainDb) || 0, -30, 12)}dB`);
        chains.push(`[${i}:a]${f.join(',')}[a${i}]`);
      });
      const mix = `${layers.map((_, i) => `[a${i}]`).join('')}amix=inputs=${layers.length}:duration=longest:normalize=0,alimiter=limit=0.89[out]`;
      args.push('-filter_complex', `${chains.join(';')};${mix}`, '-map', '[out]', '-ac', '2', '-ar', '44100', out);
      await ffmpeg(args);
      const f = await publish(await fs.readFile(out), name, '.wav', 'oneshot');
      const audio = await import('./lib/audio.js');
      return { path: f.path, url: f.url, name: f.name, durationSeconds: await audio.durationSeconds(f.path) };
    },
    async reviewMix() {
      const { analyzeAudio } = await import('./lib/analyze.js');
      const { renderPreview } = await import('./lib/render.js');
      const whole = await this.render({});
      const perLayer = {};
      const bpm = lastBuild.bpm || 120;
      for (const [key, clip] of Object.entries(lastBuild.clips || {})) {
        const sound = lastBuild.samples[key]; if (!sound?.samplePath || !(clip.steps?.length || clip.notes?.length)) continue;
        const outPath = path.join(TMP, `solo-${key.replace(/\W+/g, '_')}-${Date.now()}.wav`);
        try {
          await renderPreview({ bpm, bars: clip.bars || 1, layers: [{ name: key, samplePath: sound.samplePath, steps: clip.steps, notes: clip.notes, swing: clip.swing || 0 }], outPath });
          const p = await analyzeAudio(outPath);
          perLayer[key] = { loudnessLufs: p.loudness?.integratedLufs, subWeight: p.ratings?.subWeight, lowEnd: p.ratings?.lowEnd, brightness: p.ratings?.brightness, loudness: p.ratings?.loudness, role: sound.role };
        } catch (e) { perLayer[key] = { error: e.message }; }
      }
      const issues = [];
      const lvl = (r) => r?.level;
      const subHeavy = Object.entries(perLayer).filter(([, v]) => lvl(v.subWeight) === 'high');
      if (subHeavy.length > 1) issues.push({ severity: 'high', text: `${subHeavy.length} layers are 'high' in the 20-60 Hz band (${subHeavy.map(([k]) => k).join(', ')}): sub masking`, fix: 'keep one sub owner (kick or bass); highpass the others at 60-100 Hz via shape_sample or EQ, or lower their level' });
      const L = (k) => perLayer[k]?.loudnessLufs;
      const snareKey = Object.keys(perLayer).find((k) => /snare|clap/.test(k)), hatKey = Object.keys(perLayer).find((k) => /hat/.test(k)), kickKey = Object.keys(perLayer).find((k) => /kick/.test(k));
      if (snareKey && hatKey && Number.isFinite(L(snareKey)) && Number.isFinite(L(hatKey)) && L(hatKey) > L(snareKey) - 3) issues.push({ severity: 'high', text: `hats at ${L(hatKey).toFixed(1)} LUFS vs snare ${L(snareKey).toFixed(1)}: hats within 3 dB of the snare`, fix: `set_mixer ${hatKey} volume 0.55-0.62` });
      if (kickKey && snareKey && Number.isFinite(L(kickKey)) && Number.isFinite(L(snareKey)) && L(kickKey) < L(snareKey) - 2) issues.push({ severity: 'medium', text: `kick at ${L(kickKey).toFixed(1)} LUFS is below snare ${L(snareKey).toFixed(1)}`, fix: 'raise kick level or lower snare' });
      for (const [k, v] of Object.entries(perLayer)) if (/hat|perc|rim/.test(k) && lvl(v.lowEnd) === 'high') issues.push({ severity: 'medium', text: `${k} is 'high' in 60-250 Hz for a top-end role`, fix: `shape_sample ${k} highpassHz 200-300 or EQ highpass` });
      if (whole.profile?.ratings?.punch?.level === 'low') issues.push({ severity: 'medium', text: `whole mix crest factor ${whole.profile.ratings.punch.value} dB: low transient contrast`, fix: 'shorter tails on hats/perc (shape_sample), lower sustained layers, less limiting/saturation' });
      if (whole.profile?.ratings?.width?.level === 'low') issues.push({ severity: 'high', text: `whole mix stereo width ${whole.profile.ratings.width.value}: effectively mono`, fix: 'shape_sample widen 0.5-0.7 on hats/perc/texture/pads layers (never kick/bass), pan hats and perc apart, add_effect Chorus or Auto Pan on textures/pads, send textures to the ping-pong Delay return' });
      for (const [k, v] of Object.entries(perLayer)) if (!/kick|bass|sub|808/.test(k) && lvl(v.width) === 'low' && /hat|perc|shaker|tex|pad|fx|chop|vox|clap|snap|key|lead|pluck/.test(k)) issues.push({ severity: 'medium', text: `${k} is mono (width ${v.width?.value ?? 0})`, fix: `shape_sample ${k} widen ${/pad|tex|fx|vox|chop|key/.test(k) ? '0.7' : '0.5'} and re-load, or add_effect Chorus/Auto Pan on the track` });
      if (whole.profile?.ratings?.brightness?.level === 'low' && whole.profile?.ratings?.air?.level === 'low') issues.push({ severity: 'medium', text: 'whole mix brightness and air both low', fix: 'brighter hat sound or open hat layer, or a top-end layer' });
      if (!issues.length) issues.push({ severity: 'low', text: 'no rule triggered; levels and band distribution within template ranges', fix: null });
      return { whole: { url: whole.url, ratings: whole.profile?.ratings, summary: whole.profile?.summary, durationSeconds: whole.durationSeconds }, perLayer, issues, note: 'offline render without Live devices/mixer; relative comparisons only' };
    },
    async chop(refPath, { maxPieces = 8, pieceSeconds = 0.35, name = 'chop' } = {}) {
      const { decodeMono16k } = await import('./lib/melody.js');
      const { detectOnsets, onsetFeatures, classifyOnset } = await import('./lib/rhythm.js');
      const x = await decodeMono16k(refPath);
      const onsets = detectOnsets(x).slice(0, 64);
      const picked = onsets.sort((a, b) => b.flux - a.flux).slice(0, clamp(Number(maxPieces), 1, 16)).sort((a, b) => a.time - b.time);
      const { estimateBpm } = await import('./lib/rhythm.js');
      const pieces = [];
      for (const [i, o] of picked.entries()) {
        const f = onsetFeatures(x, o.sample);
        const piece = await this.slice(refPath, { startSeconds: Math.max(0, o.time - 0.01), lengthSeconds: pieceSeconds, name: `${name}-${i + 1}` });
        pieces.push({ index: i + 1, startSeconds: Number(o.time.toFixed(3)), lengthSeconds: pieceSeconds, kind: classifyOnset(f), loudnessDb: Number((20 * Math.log10(Math.max(f.rms, 1e-6))).toFixed(1)), samplePath: piece.path, name: piece.name, url: piece.url });
      }
      let bpm = null; try { bpm = Math.round(estimateBpm(onsets)); } catch {}
      return { pieces, bpm, onsetCount: onsets.length };
    },
    listen: async (p, q) => { if (!audioPathOk(p)) throw new Error('listen: path outside project audio'); return (await import('./lib/ears.js')).listen(p, q); },
    analyze: async (p) => { if (!audioPathOk(p)) throw new Error('analyze: path outside project audio'); return (await import('./lib/analyze.js')).analyzeAudio(p); },
    compare: async (a, b) => { if (!audioPathOk(a) || !audioPathOk(b)) throw new Error('compare: path outside project audio'); const m = await import('./lib/analyze.js'); const [pa, pb] = await Promise.all([m.analyzeAudio(a), m.analyzeAudio(b)]); return { ...m.compareProfiles(pa, pb), a: pa.ratings, b: pb.ratings }; },
    async render({ bars } = {}) {
      const { renderPreview } = await import('./lib/render.js');
      const { analyzeAudio } = await import('./lib/analyze.js');
      const layers = [];
      for (const [key, clip] of Object.entries(lastBuild.clips || {})) {
        const sound = lastBuild.samples[key];
        if (!(clip.steps?.length || clip.notes?.length)) continue;
        const padKeys = Object.keys(lastBuild.samples).filter((k) => k.startsWith(`${key}#`));
        if (!sound?.samplePath && clip.notes?.length && padKeys.length) {   // Drum Rack kit: one layer per pad, so the review hears the real drums
          for (const pk of padKeys) { const pitch = Number(pk.split('#')[1]); const ns = clip.notes.filter((n) => n.pitch === pitch); if (ns.length) layers.push({ name: pk, samplePath: lastBuild.samples[pk].samplePath, steps: ns.map((n) => ({ step: Math.round(n.startBeats * 4), velocity: n.velocity })), swing: 0 }); }
          continue;
        }
        if (!sound?.samplePath && clip.notes?.length) {   // preset-based layer (Live instrument): stand in with a generic synth voice so the review hears it
          layers.push({ name: key, samplePath: await genericVoice(/bass|sub|808/.test(key) ? 'bass' : 'synth'), notes: clip.notes, swing: 0, gainDb: -6, standIn: true });
          continue;
        }
        if (!sound?.samplePath) continue;
        layers.push({ name: key, samplePath: sound.samplePath, steps: clip.steps, notes: clip.notes, swing: clip.swing || 0 });
      }
      if (!layers.length) throw new Error('nothing to render: no tracks with both a sound and a clip in the registry');
      const bpm = await syncTempo();
      const maxBars = Math.max(1, ...Object.values(lastBuild.clips).map((c) => c.bars || 1));
      const outPath = path.join(OUT_DIR, `preview-${Date.now()}.wav`);
      const r = await renderPreview({ bpm, bars: clamp(Number(bars) || maxBars, 1, 16), layers, outPath });
      const profile = await analyzeAudio(r.path);
      lastBuild.lastRender = r.path;
      return { path: r.path, url: `/out/${encodeURIComponent(path.basename(r.path))}`, durationSeconds: r.durationSeconds, layers: layers.map((l) => l.name), bpm, profile };
    },
    transcribe: async (p, opts) => { if (!audioPathOk(p)) throw new Error('transcribe: path outside project audio'); return (await import('./lib/transcribe.js')).transcribe(p, opts); },
    judge: async (p, intent) => { if (!audioPathOk(p)) throw new Error('judge: path outside project audio'); return (await import('./lib/ears.js')).judge(p, intent); },
    writeMelody: async (o) => { const { describeToMelody } = await import('./lib/melody.js'); const r = await describeToMelody(o); return { notes: r.notes, bars: r.bars, key: r.key, source: r.source }; },
    beatboxToPattern: async (p, o) => (await import('./lib/rhythm.js')).beatboxToPattern(p, o),
    humToNotes: async (p, o) => (await import('./lib/melody.js')).humToNotes(p, o),
    live: {
      /** setTempo(bpm) or setTempo({ bpm, warpClips }): with warpClips the user's unwarped audio clips are warped first so they follow the new tempo. */
      setTempo: async (arg) => {
        const { bpm, warpClips = false } = typeof arg === 'object' && arg ? arg : { bpm: arg };
        if (!Number.isFinite(Number(bpm))) throw new Error('setTempo: bpm required');
        const target = clamp(Number(bpm), 40, 300);
        const send = await liveClient();
        let warped = [], unwarpedLeft = [], capped = false;
        if (warpClips && await scriptAtLeast('5.8')) {
          const r = okOrThrow(await send({ cmd: 'set_tempo', bpm: target, warp_clips: true }), 'set_tempo');
          warped = r.warped || []; unwarpedLeft = r.unwarped_left || r.unwarpedLeft || [];
          lastBuild.bpm = target; tempoCache.at = Date.now();
          const note = [r.note, r.arrangement_scanned === false ? 'Live 10 warps only Session clips from the API: audio clips in the Arrangement keep their old speed (warp them by hand)' : null].filter(Boolean).join('; ') || undefined;
          return { ...r, bpm: target, warped, unwarpedLeft, ...(note ? { note } : {}) };
        }
        if (warpClips) {   // older script: find the unwarped audio clips ourselves and warp each before moving the tempo
          const set = await send({ cmd: 'describe_set' });
          for (const t of set?.tracks || []) {
            if (t.is_midi) continue;
            const clips = Array.isArray(t.clips) ? t.clips : [];
            if (clips.length >= 16) capped = true;   // describe_set reports at most 16 session clips per track
            for (const c of clips) {
              if (!c || !(c.name != null || c.has_clip)) continue;
              const slot = c.slot ?? c.index ?? clips.indexOf(c);
              if (c.is_audio === false || c.warping === true) continue;   // describe_set reports is_audio + warping per clip
              const mode = /drum|beat|loop|perc|kit|kick|snare|hat/i.test(`${t.name} ${c.name || ''}`) ? 'beats' : 'complex_pro';
              const w = await send({ cmd: 'set_clip_warp', track: t.name, slot, warp: true, warp_mode: mode }).catch((e) => ({ error: e.message }));
              if (w?.ok) warped.push({ track: t.name, clip: c.name || `slot ${slot}`, mode }); else unwarpedLeft.push({ track: t.name, clip: c.name || `slot ${slot}`, error: w?.error });
            }
          }
        }
        const r = okOrThrow(await send({ cmd: 'set_tempo', bpm: target }), 'set_tempo');
        lastBuild.bpm = target; tempoCache.at = Date.now();
        return { ...r, bpm: target, warped, unwarpedLeft, ...(capped ? { note: 'first 16 session clips per track checked; arrangement clips not scanned (ADEHack < 5.8)' } : {}) };
      },
      /** ADEHack 5.8: move the song position. beat 0 = bar 1. Older scripts: throws a clear error. */
      setPosition: async (arg = {}) => { const beat = typeof arg === 'object' && arg ? arg.beat : arg; if (!(await scriptAtLeast('5.8'))) throw new Error('set_position needs ADEHack 5.8 (installed; relaunch Live)'); return okOrThrow(await (await liveClient())({ cmd: 'set_position', beat: Math.max(0, Number(beat) || 0) }), 'set_position'); },
      jump: async (arg = {}) => { const bar = typeof arg === 'object' && arg ? arg.bar : arg; if (!(await scriptAtLeast('5.8'))) throw new Error('jump needs ADEHack 5.8 (installed; relaunch Live)'); return okOrThrow(await (await liveClient())({ cmd: 'jump', bar: Math.max(1, Math.round(Number(bar) || 1)) }), 'jump'); },
      listTracks: async () => {
        const r = okOrThrow(await (await liveClient())({ cmd: 'list_tracks' }), 'list_tracks');
        const present = new Set(r.tracks.map((t) => t.name.toLowerCase()));
        for (const k of Object.keys(lastBuild.samples)) if (!present.has(k.split('#')[0])) delete lastBuild.samples[k];   // prune tracks the user removed in Live (pad entries are 'track#note')
        for (const k of Object.keys(lastBuild.tracks)) if (!present.has(String(lastBuild.tracks[k]?.name || '').toLowerCase())) delete lastBuild.tracks[k];
        r.tracks = r.tracks.map((t) => { const s = lastBuild.samples[t.name.toLowerCase()]; return s ? { ...t, soundPath: s.samplePath, soundRole: s.role } : t; });
        r.note = 'soundPath = the wav a track plays; pass it to listen / judge_sound';
        return r;
      },
      show: async () => { const send = await liveClient(); const r = await send({ cmd: 'show_view', view: 'Session' }); await send({ cmd: 'show_view', view: 'Detail/Clip' }); return r; },
      play: async () => (await liveClient())({ cmd: 'play' }),
      stop: async () => (await liveClient())({ cmd: 'stop' }),
      deleteTrack: async (name) => { const send = await liveClient(); const t = await trackByName(send, name); if (!t) throw new Error(`no track named ${name}`); const ours = Object.values(lastBuild.tracks).some((x) => String(x.name).toLowerCase() === t.name.toLowerCase()) || /^AI /.test(t.name); if (!ours) throw new Error(`refusing to delete "${t.name}": this session did not create it (mute it with set_mixer instead)`); const r = okOrThrow(await send({ cmd: 'delete_track', track: t.name }), 'delete_track'); forgetTrack(t.name); await saveChat(); return r; },
      async buildLane({ name, instrument, samplePath, steps, bars = 1, swing = 0, slot = 0, humanize = 0, useGroove = false, fire = true }) {
        const send = await liveClient();
        const t = await ensureTrack(send, name);
        let load = null;
        if (samplePath) { const slotPath = await toSlot(samplePath, instrument || name, 'Snare'); load = await sendWithRetry(send, { cmd: 'load_sample', path: slotPath, track: t.name }); if (load?.ok) { try { await send({ cmd: 'set_device_param', track: t.name, device: 'Simpler', param: 'Vol < Vel', value: 0.65 }); } catch {} } if (load?.ok) rememberSound(t.name, samplePath, slotPath, instrument || name); }
        const notes = stepsToNotes(steps, swing, humanize, lastBuild.bpm || 120, useGroove ? lastBuild.groove : null);
        const clip = okOrThrow(await send({ cmd: 'create_clip', track: t.name, slot: Number(slot) || 0, length: bars * 4, notes, fire: fire !== false, name, show: false }), 'create_clip');
        lastBuild.tracks[instrument || name] = { index: t.index, name: t.name };
        if (!Number(slot)) rememberClip(t.name, { steps, bars, swing, humanize });
        return { track: t, notes: notes.length, loadedSample: Boolean(load?.ok), loadError: load && !load.ok ? load.error : undefined, clip: clip.mode };
      },
      async buildMelody({ name, samplePath, notes, bars, slot = 0 }) {
        const send = await liveClient();
        const t = await ensureTrack(send, name);
        let load = null;
        if (samplePath) { const slotPath = await toSlot(samplePath, name, 'Synth'); load = await sendWithRetry(send, { cmd: 'load_sample', path: slotPath, track: t.name }); if (load?.ok) rememberSound(t.name, samplePath, slotPath, 'synth'); }
        const clip = okOrThrow(await send({ cmd: 'create_clip', track: t.name, slot: Number(slot) || 0, length: melodyBars(notes, bars) * 4, notes: melodyToLiveNotes(notes), fire: true, name, show: false }), 'create_clip');
        lastBuild.tracks[name.toLowerCase()] = { index: t.index, name: t.name };
        if (!Number(slot)) rememberClip(t.name, { notes, bars: melodyBars(notes, bars) });
        return { track: t, notes: notes.length, loadedSample: Boolean(load?.ok), loadError: load && !load.ok ? load.error : undefined, clip: clip.mode };
      },
      async updateLayer({ name, steps, notes, bars = 1, swing = 0, slot = 0, humanize = 0, useGroove = false }) {
        const send = await liveClient();
        const t = await trackByName(send, name); if (!t) throw new Error(`no track named ${name}`);
        const liveNotes = notes ? melodyToLiveNotes(notes) : stepsToNotes(steps || [], swing, humanize, lastBuild.bpm || 120, useGroove ? lastBuild.groove : null);
        const length = notes ? melodyBars(notes, bars) * 4 : bars * 4;
        const clip = okOrThrow(await send({ cmd: 'create_clip', track: t.name, slot: Number(slot) || 0, length, notes: liveNotes, fire: true, name: t.name, show: false }), 'create_clip');
        if (!Number(slot)) rememberClip(t.name, notes ? { notes, bars: length / 4 } : { steps: steps || [], bars, swing });
        return { track: t, notes: liveNotes.length, clip: clip.mode };
      },
      // ---- hands: devices, mixer, scenes, arrangement (ADEHack v4 protocol) ----
      async loadDevice({ track, name, device }) {
        name = name || device; const send = await liveClient(); const t = await ensureTrack(send, track);   // creates the MIDI track if it doesn't exist yet
        const existing = await send({ cmd: 'list_devices', track: t.name, params: true });
        const same = existing?.ok ? (existing.devices || []).find((d) => String(d.name).toLowerCase() === String(name).toLowerCase() || String(d.class_name || '').toLowerCase() === String(name).toLowerCase().replace(/\s+/g, '')) : null;
        if (same) return { ok: true, reused: true, track: t.name, device: { index: same.index, name: same.name, class_name: same.class_name }, params: same.params || [], note: `${same.name} already on ${t.name}; adjusting it instead of adding a second one` };
        return okOrThrow(await send({ cmd: 'load_device', track: t.name, name }), `load_device ${name}`);
      },
      async setSend({ track, send: sendId, level }) { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'set_send', track: t.name, send: sendId, level: clamp(Number(level), 0, 1) }), 'set_send'); },
      browse: async ({ root = 'sounds', query, depth = 2 } = {}) => okOrThrow(await (await liveClient())({ cmd: 'browse', root, ...(query ? { query } : {}), depth }), 'browse'),
      async mixBalance({ template = 'drums-default', overrides = [], only = null } = {}) {
        const T = { kick: [0.85, 0], snare: [0.8, 0], clap: [0.74, 0.08], hat_closed: [0.62, 0.18], hat: [0.62, 0.18], hats: [0.62, 0.18], hat_open: [0.58, 0.22], rim: [0.55, -0.25], perc: [0.56, -0.3], tom: [0.66, -0.1], tom_low: [0.66, -0.1], tom_high: [0.64, 0.12], vox: [0.68, 0.1], 'vox chop': [0.68, 0.1], synth: [0.72, 0], bass: [0.72, 0], saw: [0.7, 0], pad: [0.6, 0], lead: [0.66, -0.05], keys: [0.66, 0.05], melody: [0.68, 0] };
        const send = await liveClient();
        const tracks = okOrThrow(await send({ cmd: 'list_tracks' }), 'list_tracks').tracks;
        const applied = [];
        const ownNames = new Set([...Object.values(lastBuild.tracks).map((t) => String(t.name).toLowerCase()), ...Object.keys(lastBuild.samples).map((k) => k.split('#')[0])]);
        const onlySet = Array.isArray(only) && only.length ? new Set(only.map((n) => String(n).toLowerCase())) : ownNames;   // never reset the user's own faders
        for (const t of tracks) {
          const key = t.name.toLowerCase();
          if (onlySet && !onlySet.has(key)) continue;
          const role = (lastBuild.samples[key]?.role || key).toLowerCase();
          const tpl = T[role] || T[key] || Object.entries(T).find(([k]) => key.includes(k) || role.includes(k))?.[1];
          if (!tpl) continue;
          const ov = overrides.find((o) => String(o.track).toLowerCase() === key) || {};
          const r = await send({ cmd: 'set_mixer', track: t.name, volume: clamp(Number(ov.volume ?? tpl[0]), 0, 1), pan: clamp(Number(ov.pan ?? tpl[1]), -1, 1) });
          applied.push({ track: t.name, role, volume: ov.volume ?? tpl[0], pan: ov.pan ?? tpl[1], ok: Boolean(r?.ok) });
        }
        return { ok: true, template, applied };
      },
      async setParam({ track, device, param, value }) { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'set_device_param', track: t.name, device, param, value: Number(value) }), 'set_device_param'); },
      async listDevices(arg) {
        const { track, params = true } = typeof arg === 'object' && arg ? arg : { track: arg };
        const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`);
        const r = okOrThrow(await send({ cmd: 'list_devices', track: t.name, params: Boolean(params) }), 'list_devices');
        const known = lastBuild.samples[t.name.toLowerCase()];
        for (const d of r.devices || []) {
          if (/simpler|sampler/i.test(d.class_name || '')) {
            const slotFile = path.join(OUT_DIR, `${d.name}.wav`);
            d.soundPath = known?.samplePath || (await fs.access(slotFile).then(() => slotFile, () => undefined));
          }
        }
        return r;
      },
      async deleteDevice({ track, device }) { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'delete_device', track: t.name, device }), 'delete_device'); },
      async setMixer({ track, volume, pan, mute, solo, arm }) { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); const cmd = { cmd: 'set_mixer', track: t.name }; if (volume != null) cmd.volume = clamp(Number(volume), 0, 1); if (pan != null) cmd.pan = clamp(Number(pan), -1, 1); if (mute != null) cmd.mute = Boolean(mute); if (solo != null) cmd.solo = Boolean(solo); if (arm != null) cmd.arm = Boolean(arm); return okOrThrow(await send(cmd), 'set_mixer'); },
      async setSimpler({ track, ...opts }) { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'set_simpler', track: t.name, ...opts }), 'set_simpler'); },
      async sampleInfo({ track }) { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'sample_info', track: t.name }), 'sample_info'); },
      // loop/texture as a layer: load the file into Simpler, warp it to tempo, trigger with one long C3 note
      async addLoopLayer({ name, prompt, kind = 'tops', bars = 2, bpm, matchMix = true, strength, seedPath, slot = 0 }) {
        const self = makeCtx(emit);   // `this` here is the live object; generateLoop/seedMix live on the ctx
        strength = Number(strength) || (kind === 'tops' || kind === 'fx' ? 0.8 : 0.6);   // tops seeded from a mix with a kick keep the kick unless they move far enough
        const tempo = bpm || await syncTempo();
        const hasLayers = Object.keys(lastBuild.clips || {}).length > 0 || Boolean(lastBuild.lastCapture);
        const init = seedPath ? seedPath : (matchMix && hasLayers ? 'mix' : null);
        const g = await self.generateLoop({ prompt, bpm: tempo, bars, kind: kind === 'bass' || kind === 'chords' || kind === 'melody' ? 'texture' : kind, init, strength });
        const warpMode = kind === 'drums' || kind === 'tops' ? 'beats' : kind === 'bass' ? 'tones' : 'complex_pro';
        const trackName = lastBuild.project && !/^AI /.test(name) ? `AI ${name}` : name;
        const r = await this.live.loadAudioClip({ track: trackName, slot, samplePath: g.loop.path, warpMode, overwrite: true });
        rememberClip(trackName, { audio: true, bars: g.loop.bars, slot });
        return { track: r.track || trackName, clip: r.clip, loop: g.loop, warpMode, note: g.loop.seeded ? `generated from the set's own sound (audio-to-audio, strength ${g.loop.seeded.strength})` : 'generated from text (nothing to seed from yet)' };
      },
      async buildLoopLayer({ name, samplePath, bars = 2, kind = 'loop', gainDb }) {
        const send = await liveClient();
        const t = await ensureTrack(send, name);
        const slotPath = await toSlot(samplePath, kind === 'texture' ? 'pad' : 'perc', 'Perc');
        const load = okOrThrow(await sendWithRetry(send, { cmd: 'load_sample', path: slotPath, track: t.name }), 'load_sample');
        rememberSound(t.name, samplePath, slotPath, kind);
        const simp = await send({ cmd: 'set_simpler', track: t.name, mode: 'classic', warp: true, warp_mode: kind === 'texture' ? 'complex' : 'beats', loop: true, voices: 1, retrigger: true, ...(gainDb != null ? { gain_db: Number(gainDb) } : {}) });
        const notes = [{ pitch: 60, start: 0, duration: bars * 4, velocity: 100 }];
        const clip = okOrThrow(await send({ cmd: 'create_clip', track: t.name, slot: 0, length: bars * 4, notes, fire: true, name, show: false }), 'create_clip');
        lastBuild.tracks[name.toLowerCase()] = { index: t.index, name: t.name };
        rememberClip(t.name, { notes: [{ pitch: 60, startBeats: 0, durationBeats: bars * 4, velocity: 100 }], bars });
        return { track: t, loaded: Boolean(load?.ok), simpler: simp?.ok ? simp.done : simp?.error, clip: clip.mode, bars };
      },
      async loadToPad({ track, note, samplePath, label }) {
        const send = await liveClient(); const t = await ensureTrack(send, track);
        const slotPath = await toSlot(samplePath, label || 'perc', 'Perc');
        const r = await send({ cmd: 'load_to_pad', track: t.name, note: Number(note), path: slotPath, ...(label ? { name: label } : {}) });
        if (!r?.ok) throw new Error(r?.error || 'load_to_pad failed (needs ADEHack 5.6)');
        rememberSound(`${t.name}#${note}`, samplePath, slotPath, label || 'pad');
        return r;
      },
      // one Drum Rack track for the whole kit (fewer tracks); falls back to per-lane tracks on older scripts
      async buildKit({ name = 'Drums', kit = [], pattern, bars, slot = 0, useGroove = false, humanize = 0, fire = true }) {
        const send = await liveClient();
        const GM = { kick: 36, snare: 38, clap: 39, rim: 37, hat_closed: 42, hat_open: 46, tom_low: 45, tom_high: 50, ride: 51, crash: 49, perc: 54 };
        const b = bars || pattern?.bars || 2;
        const probe = await send({ cmd: 'pad_info', track: 'nonexistent-probe' });
        const hasPads = probe && !/unknown cmd/i.test(probe.error || '');
        if (hasPads) {
          const t = await ensureTrack(send, name);
          // never overwrite a pad the producer already has: find occupied pads and place new sounds on free ones
          const info = await send({ cmd: 'pad_info', track: t.name, all: false });
          const occupied = new Set((info?.pads || []).filter((p) => p.has_chain).map((p) => p.note));
          const noteFor = {};
          let cursor = 36;
          const freeNote = (preferred) => { if (preferred != null && !occupied.has(preferred)) { occupied.add(preferred); return preferred; } while (occupied.has(cursor) && cursor < 100) cursor++; const n = cursor; occupied.add(n); cursor++; return n; };
          const pads = [];
          for (const k of kit) { const key = k.label || k.kind; const pref = k.note ?? GM[k.kind]; const have = pref != null ? lastBuild.samples[`${t.name.toLowerCase()}#${pref}`] : null; if (have && have.samplePath === k.samplePath) { noteFor[key] = pref; if (k.kind) noteFor[k.kind] ??= pref; pads.push({ note: pref, label: key, reused: true }); continue; } const note = freeNote(pref); noteFor[key] = note; if (k.kind) noteFor[k.kind] ??= note; try { await this.loadToPad({ track: t.name, note, samplePath: k.samplePath, label: key }); pads.push({ note, label: key }); } catch (e) { pads.push({ note, label: key, error: e.message }); } }
          const notes = [];
          const kitBpm = await syncTempo(); const grooveT = useGroove ? (pattern?.groove || lastBuild.groove) : null;
          for (const lane of pattern?.lanes || []) { const padNote = noteFor[lane.instrument] ?? noteFor[LANE_LABEL[lane.instrument]] ?? GM[lane.instrument] ?? 54; for (const n of stepsToNotes(lane.steps, pattern?.swing || 0, humanize, kitBpm, grooveT)) notes.push({ ...n, pitch: padNote }); }
          const clip = okOrThrow(await send({ cmd: 'create_clip', track: t.name, slot: Number(slot) || 0, length: b * 4, notes, fire: fire !== false, name, show: false }), 'create_clip');
          lastBuild.tracks.drums = { index: t.index, name: t.name };
          if (!Number(slot)) rememberClip(t.name, { notes: notes.map((n) => ({ pitch: n.pitch, startBeats: n.start, durationBeats: n.duration, velocity: n.velocity })), bars: b });
          return { track: t, mode: 'drum_rack', pads, padMap: noteFor, notes: notes.length, clip: clip.mode, reusedExistingPads: occupied.size - pads.length };
        }
        const built = [];
        for (const lane of pattern?.lanes || []) { const k = kit.find((x) => (x.label || x.kind) === lane.instrument || x.kind === lane.instrument); const label = LANE_LABEL[lane.instrument] || lane.instrument; built.push(await this.buildLane({ name: label, instrument: lane.instrument, samplePath: k?.samplePath, steps: lane.steps, bars: b, swing: pattern.swing || 0, slot, useGroove: true, fire })); }
        return { mode: 'per_lane_fallback', note: 'Drum Rack pad loading needs ADEHack 5.6; built one track per lane instead', tracks: built.map((x) => x.track?.name) };
      },
      describeSet: async ({ detail = 'brief' } = {}) => { const r = okOrThrow(await (await liveClient())({ cmd: 'describe_set' }), 'describe_set'); if (detail === 'full') return r; return { ...r, tracks: (r.tracks || []).map((t) => ({ index: t.index, name: t.name, is_midi: t.is_midi, devices: (t.devices || []).map((d) => d.name || d.class_name).slice(0, 6), clipCount: Array.isArray(t.clips) ? t.clips.length : t.clip_count, muted: t.mute ?? t.muted, selected: t.selected })), returns: undefined, master: undefined, note: 'brief view; detail:"full" adds mixer and clips' }; },
      async getClipNotes({ track, slot = 0 }) { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'get_clip_notes', track: t.name, slot: Number(slot) || 0 }), 'get_clip_notes'); },
      setTrackColor: async ({ track, colorIndex, color_index }) => { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'set_track_color', track: t.name, color_index: Number(colorIndex ?? color_index) }), 'set_track_color'); },
      captureMidi: async () => okOrThrow(await (await liveClient())({ cmd: 'capture_midi' }), 'capture_midi'),
      clipEdit: async ({ track, slot = 0, ...ops }) => { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'clip_edit', track: t.name, slot: Number(slot) || 0, ...ops }), 'clip_edit'); },
      duplicateClip: async ({ track, slot = 0, toSlot, to_slot }) => { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'duplicate_clip', track: t.name, slot: Number(slot) || 0, to_slot: Number(toSlot ?? to_slot) }), 'duplicate_clip'); },
      duplicateScene: async ({ index }) => okOrThrow(await (await liveClient())({ cmd: 'duplicate_scene', index: Number(index) }), 'duplicate_scene'),
      duplicateTrack: async ({ track, name }) => { const send = await liveClient(); const t = await trackByName(send, track); if (!t) throw new Error(`no track named ${track}`); return okOrThrow(await send({ cmd: 'duplicate_track', track: t.name, ...(name ? { name } : {}) }), 'duplicate_track'); },
      transportSetup: async (opts = {}) => okOrThrow(await (await liveClient())({ cmd: 'transport_setup', ...opts }), 'transport_setup'),
      createScene: async ({ name, index } = {}) => {
        const send = await liveClient();
        const scenes = (await send({ cmd: 'list_scenes' }))?.scenes || [];
        if (index != null && index >= 0 && index < scenes.length) {
          const existing = scenes[index];
          const named = await send({ cmd: 'rename_scene', index, name });   // v5 script; older script answers unknown cmd
          return { ok: true, index, name: named?.ok ? name : existing.name, existed: true, note: named?.ok ? 'renamed existing scene' : 'scene already exists; rename not supported by this script version' };
        }
        return okOrThrow(await send({ cmd: 'create_scene', index: -1, name }), 'create_scene');
      },
      fireScene: async (arg) => { const index = typeof arg === 'object' && arg ? arg.index : arg; return okOrThrow(await (await liveClient())({ cmd: 'fire_scene', index: Number(index) }), 'fire_scene'); },
      listScenes: async () => okOrThrow(await (await liveClient())({ cmd: 'list_scenes' }), 'list_scenes'),
      /** Solo the named tracks for `bars`, play, then restore: the only honest way to hear a new layer against (not on top of) the set. */
      async audition({ tracks = [], bars = 4, unsoloAfter = true } = {}) {
        const send = await liveClient();
        const set = await send({ cmd: 'describe_set' });
        const before = Object.fromEntries((set?.tracks || []).map((t) => [t.name, { solo: Boolean(t.solo ?? t.mixer?.solo), mute: Boolean(t.mute ?? t.muted ?? t.mixer?.mute) }]));
        const want = new Set(tracks.map((n) => String(n).toLowerCase()));
        const names = (set?.tracks || []).map((t) => t.name).filter((n) => want.has(n.toLowerCase()));
        if (!names.length) throw new Error(`audition: none of ${tracks.join(', ')} exist`);
        for (const n of names) { await send({ cmd: 'set_mixer', track: n, solo: true, mute: false }); }
        const bpm = await syncTempo(); const seconds = Math.ceil(clamp(Number(bars) || 4, 1, 32) * 240 / bpm) + 0.5;
        await send({ cmd: 'play_for', seconds });
        if (unsoloAfter) setTimeout(async () => { try { for (const n of names) await send({ cmd: 'set_mixer', track: n, solo: before[n]?.solo || false }); } catch {} }, seconds * 1000 + 300);
        return { auditioning: names, bars, seconds, restoreAfter: unsoloAfter, note: 'soloed so you hear only these; other tracks come back when it stops' };
      },
      // ---- ADEHack 5.7: audio clips, warping, undo, meters, recording the producer's own playing ----
      undo: async ({ steps = 1 } = {}) => okOrThrow(await (await liveClient())({ cmd: 'undo', steps: clamp(Number(steps) || 1, 1, 20) }), 'undo'),
      redo: async ({ steps = 1 } = {}) => okOrThrow(await (await liveClient())({ cmd: 'redo', steps: clamp(Number(steps) || 1, 1, 20) }), 'redo'),
      clipInfo: async ({ track, slot = 0 }) => okOrThrow(await (await liveClient())({ cmd: 'clip_info', track, slot: Number(slot) || 0 }), 'clip_info'),
      setClipWarp: async ({ track, slot = 0, warp = true, warpMode, pitchCoarse, gain }) => okOrThrow(await (await liveClient())({ cmd: 'set_clip_warp', track, slot: Number(slot) || 0, warp: Boolean(warp), ...(warpMode ? { warp_mode: warpMode } : {}), ...(pitchCoarse != null ? { pitch_coarse: clamp(Number(pitchCoarse), -48, 48) } : {}), ...(gain != null ? { gain: clamp(Number(gain), 0, 1) } : {}) }), 'set_clip_warp'),
      async loadAudioClip({ track, slot = 0, samplePath, warpMode = 'complex_pro', overwrite = false }) {
        if (!audioPathOk(samplePath)) throw new Error('load_audio_clip: path outside project audio');
        const send = await liveClient();
        const slotPath = await toSlot(samplePath, 'synth', 'Synth', { noWiden: true });   // audio clips keep the file as-is
        try { await send({ cmd: 'show_view', view: 'Session' }); } catch {}   // Live 10 drops browser items into the highlighted slot only while Session view is visible
        const r = okOrThrow(await sendWithRetry(send, { cmd: 'load_audio_clip', track, slot: Number(slot) || 0, name: path.basename(slotPath), warp_mode: warpMode, overwrite: Boolean(overwrite) }), 'load_audio_clip');
        rememberSound(track, samplePath, slotPath, 'audio');
        if (!lastBuild.tracks[String(track).toLowerCase()]) lastBuild.tracks[String(track).toLowerCase()] = { index: r.index ?? -1, name: r.track || track };
        return r;
      },
      meters: async ({ ticks = 10 } = {}) => okOrThrow(await (await liveClient())({ cmd: 'meters', ticks: clamp(Number(ticks) || 10, 2, 40) }), 'meters'),
      setArm: async ({ track, arm = true, monitoring }) => okOrThrow(await (await liveClient())({ cmd: 'set_arm', track, arm: Boolean(arm), ...(monitoring ? { monitoring } : {}) }), 'set_arm'),
      sessionRecord: async ({ track, slot = 0, bars = 4, fromBar } = {}) => okOrThrow(await (await liveClient())({ cmd: 'session_record', track, slot: Number(slot) || 0, bars: clamp(Number(bars) || 4, 1, 32), ...(fromBar != null && await scriptAtLeast('5.8') ? { from_bar: Math.max(1, Math.round(Number(fromBar))) } : {}) }), 'session_record'),
      recordArrangement: async ({ bars, scenes, stop, fromBar } = {}) => {
        const send = await liveClient();
        if (stop) return okOrThrow(await send({ cmd: 'arrangement_record', stop: true }), 'arrangement_record');
        const seek = fromBar != null && await scriptAtLeast('5.8') ? { from_bar: Math.max(1, Math.round(Number(fromBar))) } : {};
        if (Array.isArray(scenes) && scenes.length) return okOrThrow(await send({ cmd: 'arrangement_record', at: 'end', scenes: scenes.map((sc) => ({ index: Number(sc.index) || 0, bars: clamp(Number(sc.bars) || 8, 1, 64) })), ...seek }), 'arrangement_record');
        return okOrThrow(await send({ cmd: 'arrangement_record', at: 'end', bars: clamp(Number(bars) || 8, 1, 64), ...seek }), 'arrangement_record');
      },
      async loadSample({ name, samplePath, role }) {
        const send = await liveClient();
        const t = await trackByName(send, name); if (!t) throw new Error(`no track named ${name}`);
        const slotPath = await toSlot(samplePath, role || name, 'Snare');
        const r = okOrThrow(await sendWithRetry(send, { cmd: 'load_sample', path: slotPath, track: t.name ?? t.index }), 'load_sample');
        try { await send({ cmd: 'set_device_param', track: t.name, device: 'Simpler', param: 'Vol < Vel', value: 0.65 }); } catch {}
        rememberSound(t.name, samplePath, slotPath, role || name);
        return { track: t, replaced: r.replaced, devices: r.devices };
      },
    },
  };
}

app.post('/api/live/arrange', async (req, res) => {
  try {
    const bars = clamp(Number(req.body?.bars) || 8, 1, 64);
    const send = await liveClient();
    const r = okOrThrowHttp(await send({ cmd: 'arrangement_record', bars }));
    res.json({ ok: true, bars, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
function okOrThrowHttp(r) { if (!r?.ok) throw new Error(r?.error || 'Live rejected the command'); return r; }
app.post('/api/refine', async (req, res) => {
  try {
    const { path: p, intent, currentPrompt, role, rounds, track } = req.body || {};
    if (!p || !intent) throw new Error('path and intent required');
    const ctx = makeCtx(() => {});
    res.json(await ctx.refineSound({ path: String(p), intent: String(intent), currentPrompt: currentPrompt || intent, role: role || 'drum', rounds: rounds || 2, track }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/settings', (_req, res) => res.json(chat.settings));
app.post('/api/settings', async (req, res) => { chat.settings = { ...chat.settings, ...(req.body || {}) }; await saveChat(); res.json(chat.settings); });
app.get('/api/explanations', (_req, res) => res.json(lastBuild.explanations || {}));
// ---- Prompt Lab: pick a genre, edit the Stability prompt + parameters, generate, get a strict rubric score, use as kit ----
app.get('/api/knowledge', async (_req, res) => {
  try { const k = await import('./lib/knowledge.js'); res.json({ genres: k.listGenres().map((g) => ({ slug: g.slug, title: g.title, tempo: g.tempo || null })) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/knowledge/:slug', async (req, res) => {
  try { const k = await import('./lib/knowledge.js'); const bp = k.getBlueprint(req.params.slug); const lp = k.getLoopPrompts ? k.getLoopPrompts(req.params.slug) : null; res.json({ ...bp, prompts: lp ? { loops: lp.loops, texture: lp.texture, oneshots: lp.oneshots } : null, presets: k.getPresets ? k.getPresets(req.params.slug) : null }); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
app.post('/api/lab/generate', async (req, res) => {
  try {
    const { prompt, model = LOOP_MODEL, bpm = 120, bars = 2, steps, cfgScale, seed, genre, kind = 'drums' } = req.body || {};
    if (!prompt) throw new Error('prompt required');
    const seconds = clamp(Math.ceil(clamp(Number(bars), 1, 16) * 4 * 60 / clamp(Number(bpm), 40, 300)) + 1, 6, 180);
    const body = String(prompt).replace(/\{bpm\}/g, String(Math.round(bpm))).replace(/^(TrackType|Genre|Format):[^,]+,\s*/i, '');
    const full = `TrackType: ${kind === 'music' ? 'Music' : 'Instrument'}, ${body}`;
    const result = await textToAudio({ prompt: full, duration: seconds, model, ...(steps ? { steps: Number(steps) } : {}), ...(cfgScale ? { cfg_scale: Number(cfgScale) } : {}), ...(seed ? { seed: Number(seed) } : {}) });
    const f = await publish(result.buffer, `lab-${(genre || kind).replace(/[^a-z0-9]+/gi, '-')}`, '.wav', 'loop');
    let score = null;
    if (genre) { try { const k = await import('./lib/knowledge.js'); const slug = k.matchGenre(genre) || genre; const bp = k.getBlueprint(slug); const markers = (bp.markdown.match(/^- .*$/gm) || []).filter((l) => /kick|snare|hat|bass|swing|clap|perc|chord/i.test(l)).slice(0, 10).map((l) => l.replace(/^- /, '').slice(0, 90)); score = await (await import('./lib/ears.js')).scoreGenre(f.path, { genreTarget: `${bp.title}: ${bp.summary}`, markers, scope: kind === 'music' ? 'full' : 'drums' }); } catch (e) { score = { error: e.message }; } }
    res.json({ path: f.path, url: f.url, prompt: full, seed: result.seed, seconds, model, score });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/score', async (req, res) => {
  try { const { path: p, genre } = req.body || {}; if (!audioPathOk(p)) throw new Error('path outside project audio'); const k = await import('./lib/knowledge.js'); const slug = k.matchGenre(genre || '') || genre; const bp = slug ? k.getBlueprint(slug) : null; res.json(await (await import('./lib/ears.js')).scoreGenre(p, { genreTarget: bp ? `${bp.title}: ${bp.summary}` : genre })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/lab/use-kit', async (req, res) => {
  try {
    const { path: p, bpm = lastBuild.bpm || 120, bars = 2, name = 'Drums' } = req.body || {};
    const ctx = makeCtx(() => {});
    const kit = await ctx.sliceKitFromAudio(p, { name: 'lab' });
    const r = await ctx.loopToPattern(p, { bpm, bars });
    ctx.setGroove(r.groove);
    lastBuild.bpm = Number(bpm);
    const built = await ctx.live.buildKit({ name, kit: kit.kit.filter((k) => !k.alt), pattern: r.pattern, bars, slot: 0 });
    res.json({ kit: kit.kit.map((k) => k.kind), pattern: r.pattern.lanes.map((l) => `${l.instrument}:${l.steps.length}`), built });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/loop-pattern', async (req, res) => {   // Stability loop (or any drum audio) -> MIDI pattern + groove
  try { const ctx = makeCtx(() => {}); res.json(await ctx.loopToPattern(String(req.body?.path || ''), { bpm: Number(req.body?.bpm) || lastBuild.bpm || 120, bars: Number(req.body?.bars) || 2 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/render', async (req, res) => {
  try { const ctx = makeCtx(() => {}); const r = await ctx.render({ bars: req.body?.bars }); res.json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/analyze', async (req, res) => {
  try {
    let p = req.body?.path;
    if (req.body?.uploadId) { const u = await getUpload(req.body.uploadId); if (!u) throw new Error('upload not found'); p = u.path; }
    if (!audioPathOk(p)) throw new Error('path outside project audio');
    res.json(await (await import('./lib/analyze.js')).analyzeAudio(p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// one producer turn at a time: two turns editing the same Live set and registry would interleave and confuse both
let chatQueue = Promise.resolve();
let chatBusy = false;
app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  const emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (chatBusy) emit({ type: 'tool_done', name: 'queue', ok: true, summary: 'another producer turn is still running; yours starts when it finishes' });
  const myTurn = chatQueue.then(() => runChatTurn(req, res, emit));
  chatQueue = myTurn.catch(() => {});
  await myTurn;
});
const turns = { last: null };   // { id, status:'running'|'done'|'error', events:[], text, startedAt, endedAt }
async function runChatTurn(req, res, emit0) {
  chatBusy = true;
  const turn = { id: `${Date.now()}`, status: 'running', events: [], text: '', startedAt: Date.now() };
  turns.last = turn;
  const emit = (e) => { turn.events.push(e); if (e.type === 'text') turn.text = e.text; try { emit0(e); } catch {} };
  emit({ type: 'turn', id: turn.id });
  const beat = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 15000);   // SSE comment, keeps proxies/browsers from idling the stream
  try {
    const { text = '', beatId, humId, refIds = [], reset } = req.body || {};
    if (reset) { resetSession(); await saveChat(); }
    if (!hasKey(process.env.ANTHROPIC_API_KEY)) throw new Error('ANTHROPIC_API_KEY is not set in .env (the producer agent needs Claude)');
    const { runProducer } = await import('./lib/agent.js');
    await reconcileHistory();
    const attachedThisTurn = [];
    const beat = beatId && await getUpload(beatId); if (beat) { chat.recordings.beat = beat.path; attachedThisTurn.push('beat'); }
    const hum = humId && await getUpload(humId); if (hum) { chat.recordings.hum = hum.path; attachedThisTurn.push('hum'); }
    const refs = (await Promise.all((Array.isArray(refIds) ? refIds : []).map(getUpload))).filter(Boolean);
    for (const r of refs) { if (!chat.recordings.refs.some((x) => x.path === r.path)) chat.recordings.refs.push({ name: r.name, path: r.path }); attachedThisTurn.push(`ref#${chat.recordings.refs.findIndex((x) => x.path === r.path) + 1}`); }
    const missing = (Array.isArray(refIds) ? refIds.length : 0) + (beatId ? 1 : 0) + (humId ? 1 : 0) - refs.length - (beat ? 1 : 0) - (hum ? 1 : 0);
    if (missing) emit({ type: 'tool_done', name: 'attachments', ok: false, summary: `${missing} attachment(s) could not be found on the server, please re-attach` });
    const recordings = { ...chat.recordings, refs: chat.recordings.refs.length ? chat.recordings.refs : undefined, attachedThisTurn };
    // style guidance: when the producer names a genre, hand Claude the blueprint summary up front
    let userText = String(text);
    try {
      const k = await import('./lib/knowledge.js');
      const explicit = userText.match(/\[genre:\s*([^\]]+)\]/i);
      const startsBuild = chat.history.length === 0 || /\b(make|build|turn|compose|start|create|produce|give me|let's|lets)\b/i.test(userText.replace(/\[[^\]]*\]/g, ''));
      let slug = explicit ? k.matchGenre(explicit[1]) : (startsBuild ? k.matchGenre(userText) : null);
      if (!slug && explicit) { try { emit({ type: 'tool', name: 'style', summary: `writing a blueprint for ${explicit[1].trim()}` }); slug = (await k.ensureBlueprint(explicit[1])).slug; } catch (e) { emit({ type: 'tool_done', name: 'style', ok: false, summary: `blueprint generation failed: ${e.message.slice(0, 80)}` }); } }
      if (slug) { const bp = k.getBlueprint(slug); if (bp?.summary) { userText += `\n\n[genre blueprint: ${bp.title}] ${bp.summary}${bp.intro ? `\n[genre history: ${bp.intro}]` : ''}`; lastBuild.genreTarget = `${bp.title}: ${bp.summary}`; emit({ type: 'tool_done', name: 'style', ok: true, summary: `style guide loaded: ${bp.title}` }); } }
    } catch {}
    chat.room = (userText.match(/\[room:\s*(create|analyse|tweak)\]/i) || [])[1]?.toLowerCase() || 'create';
    await syncTempo();   // defaults inside this turn follow the set's tempo, not the last build's
    if (lastBuild.project && !lastBuild.project.toldAgent) {
      const pj = lastBuild.project; const cr = pj.critique && !pj.critique.error ? pj.critique : null;
      userText += `\n\n[existing project scan] The user has THEIR OWN set open in Live (${Math.round(pj.tempo)} BPM, ${pj.tracks.length} tracks: ${pj.tracks.map((t) => `${t.name}${t.devices?.length ? ' [' + t.devices.join(', ') + ']' : ''}`).join('; ').slice(0, 900)}). Work INSIDE this project: add to it, never delete or replace their material, match their tempo and key.${cr ? ` You already listened to ${pj.capture?.seconds || ''} s of it. Style read: ${cr.styleRead}. Drums: ${cr.drums}. Bass: ${cr.bass?.type} (${cr.bass?.suggestion}). Sound design: ${cr.soundDesign}. Suggested moves: ${(cr.moves || []).join(' | ')}.` : pj.capture?.silent ? ' The capture was silent (nothing was playing at the playhead); ask them to place the playhead on the section before you listen again.' : ''}${pj.capture?.path ? ` Capture file: ${pj.capture.path}` : ''}`;
      pj.toldAgent = true;
      emit({ type: 'tool_done', name: 'project', ok: true, summary: `working inside your set: ${pj.tracks.length} tracks, ${Math.round(pj.tempo)} BPM` });
    }   // Analyse room = mix detail allowed in critiques
    let out;
    try { out = await runProducer({ history: chat.history, userText, recordings, ctx: makeCtx(emit) }); }
    catch (e) {
      if (/thinking/i.test(e?.message || '') && /signature|bound/i.test(e?.message || '')) { console.warn('[chat] thinking block rejected, stripping and retrying'); chat.history = stripThinking(chat.history); out = await runProducer({ history: chat.history, userText, recordings, ctx: makeCtx(emit) }); }
      else throw e;
    }
    chat.history = safeHistory(repairHistory(out.history), 120);
    if (out.error) emit({ type: 'tool_done', name: 'turn', ok: false, summary: `the producer stopped early: ${String(out.error).slice(0, 140)}` });
    await saveChat();
    emit({ type: 'text', text: out.text });
    // Arrangement mode: Live 10 can't create arrangement clips via API, so record the playing scene onto the timeline after changes
    const BUILD_TOOLS = /^(build_drum_layer|build_melody_layer|update_layer|import_sample|generate_loop|replace_sound|refine_sound|build_kit|load_to_pad|design_kit|compose_track)$/;
    const changedEv = turn.events.filter((e) => e.type === 'tool' && BUILD_TOOLS.test(e.name));
    const changed = changedEv.length > 0;
    const sceneIdx = Math.max(0, ...changedEv.map((e) => Number(e.input?.slot) || 0));
    if (chat.settings.arrangementMode && changed && !lastBuild.project) {   // never record over a user's own arrangement
      try {
        const send = await liveClient();
        const bars = clamp(Number(chat.settings.arrangementBars) || 8, 1, 64);
        emit({ type: 'tool', name: 'arrangement_mode', summary: `arrangement mode: recording ${bars} bars onto the timeline` });
        const r = await send({ cmd: 'arrangement_record', scenes: [{ index: sceneIdx, bars }], at: 'end' });
        emit({ type: 'tool_done', name: 'arrangement_mode', ok: Boolean(r?.ok), summary: r?.ok ? `laid out ${bars} bars in Arrangement (press Tab in Live)` : `arrangement recording failed: ${r?.error}` });
      } catch (e) { emit({ type: 'tool_done', name: 'arrangement_mode', ok: false, summary: `arrangement mode: ${e.message}` }); }
    }
    turn.status = 'done';
    emit({ type: 'done', tracks: lastBuild.tracks });
  } catch (e) {
    console.error('[chat]', e);
    turn.status = 'error';
    emit({ type: 'error', error: e.message });
  } finally { chatBusy = false; turn.endedAt = Date.now(); clearInterval(beat); }
  res.end();
}
app.get('/api/chat/last', (_req, res) => res.json(turns.last ? { ...turns.last, events: turns.last.events.slice(-200) } : { status: 'none' }));
function resetSession() {   // a true fresh start: nothing remembered about the previous set, sounds, style or project
  // slot files the old set still references stay off-limits for a day (Live caches samples by filename)
  lastBuild.retiredSlots = { ...(lastBuild.retiredSlots || {}), ...Object.fromEntries(Object.values(lastBuild.samples || {}).map((s) => [path.basename(s.slotPath || ''), Date.now()]).filter(([k]) => k)) };
  chat.history = []; chat.recordings = { refs: [] };
  for (const k of ['samples', 'tracks', 'clips', 'soundHistory', 'explanations']) lastBuild[k] = {};
  for (const k of ['groove', 'melody', 'project', 'reference', 'genreTarget', 'lastCapture', 'lastRender', 'bpm']) lastBuild[k] = null;
}
app.post('/api/chat/reset', async (_req, res) => { resetSession(); await saveChat(); res.json({ ok: true }); });

app.use((err, req, res, _next) => {   // multer limits, bad JSON, anything thrown synchronously -> JSON, not HTML
  console.error('[http]', err.message);
  if (req.file) fs.unlink(req.file.path).catch(() => {});
  res.status(err.status || err.statusCode || 500).json({ error: err.message || 'server error' });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.message || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.message || e));
// Training mode ("recreate this by ear"): routes under /api/training/* and /training-audio/*, page at /training.html.
try { const { mountTraining } = await import('./lib/training.js'); mountTraining(app, { makeCtx, tmpDir: TMP }); }
catch (e) { console.warn('[training] not mounted:', e.message); }
const server = app.listen(PORT, () => {
  console.log(`ADE Hack running at http://localhost:${PORT}`);
  console.log(`Ableton sees: ${OUT_DIR}`);
  console.log(`Stability key: ${hasKey(process.env.STABILITY_API_KEY) ? 'ok' : 'MISSING'} | Anthropic key: ${hasKey(process.env.ANTHROPIC_API_KEY) ? 'ok' : 'not set (rule-based patterns)'}`);
});
server.requestTimeout = 0; server.headersTimeout = 0; server.keepAliveTimeout = 65000; server.timeout = 0;   // producer turns can run for many minutes
