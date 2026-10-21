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
function insideOut(p) {
  const r = path.relative(OUT_DIR, path.resolve(String(p || '')));
  return r && !r.startsWith('..') && !path.isAbsolute(r);
}

async function publish(buffer, name, ext, kind) {
  const file = `${slug(name)}-${Date.now()}${ext}`;
  const full = path.join(OUT_DIR, file);
  await fs.writeFile(full, buffer);
  return { name: file, url: `/out/${encodeURIComponent(file)}`, path: full, kind };
}

function buildPrompt(prompt, mode, kind) {
  const p = String(prompt || '').trim();
  if (kind === 'tone') return `${p || 'analog synth'}, single sustained note, clean, no drums, no percussion`;
  if (kind === 'raw') return p;
  if (mode === 'loop') return `${p || 'drum loop'}, tight drum loop, dry, clean, punchy`;
  return `${p || 'drum hit'}, single one-shot drum sample, dry, punchy, clean transient, no melody, no music`;
}

app.get('/api/health', (_req, res) => {
  res.json({
    stabilityKey: hasKey(process.env.STABILITY_API_KEY),
    anthropicKey: hasKey(process.env.ANTHROPIC_API_KEY),
    ears: Boolean(process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN),
    outDir: OUT_DIR,
  });
});

const TONAL = new Set(['synth', 'saw', 'bass', 'pad', 'lead', 'pluck', 'keys', 'melody', 'rhodes', 'piano', 'chords', 'tone']);
// The whole sound pipeline as a function: (recording?) -> Stability -> one-shot + full file in the Ableton folder.
async function synthesize({ prompt = '', mode = 'oneshot', kind, name = 'sound', audioPath, offsetSeconds, strength = 0.7, model = 'stable-audio-2.5', oneshotSeconds }) {
  if (!hasKey(process.env.STABILITY_API_KEY)) throw new Error('STABILITY_API_KEY is not set in .env');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  if (!audioPath) mode = 'text';
  if (!kind) kind = TONAL.has(String(name).toLowerCase()) ? 'tone' : undefined;
  const files = [];
  let result;
  const wantSec = clamp(Number(oneshotSeconds), 0.2, 20) || (kind === 'tone' ? 2.5 : 1.0);
  const genSec = Math.max(6, Math.ceil(wantSec + 1));
  if (mode === 'text') {
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
    result = await audioToAudio({ wavPath: input, prompt: buildPrompt(prompt, mode, kind), strength: clamp(Number(strength), 0.01, 1) || 0.7, duration: genSec, model });
  }
  const gen = path.join(TMP, `${id}-gen.wav`);
  await fs.writeFile(gen, result.buffer);
  if (mode !== 'loop') {
    const one = path.join(TMP, `${id}-oneshot.wav`);
    const norm = path.join(TMP, `${id}-oneshot-norm.wav`);
    await sliceFirstHit(gen, one, { seconds: wantSec });
    await normalize(one, norm);
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
const ROLE_OF = { kick: 'Kick', snare: 'Snare', clap: 'Clap', hat_closed: 'Hat', hat: 'Hat', hat_open: 'OpenHat', rim: 'Rim', perc: 'Perc', tom_low: 'Tom', tom_high: 'Tom', tom: 'Tom', ride: 'Perc', crash: 'Perc', drum: 'Snare',
  synth: 'Synth', saw: 'Synth', bass: 'Synth', pad: 'Synth', pluck: 'Synth', lead: 'Synth', keys: 'Synth', melody: 'Synth', rhodes: 'Synth', piano: 'Synth' };
const POOL_SIZE = { Kick: 6, Snare: 6, Clap: 6, Hat: 6, OpenHat: 6, Rim: 6, Perc: 6, Tom: 6, Synth: 8 };
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
async function nextSlot(role) {
  let counters = {};
  try { counters = JSON.parse(await fs.readFile(COUNTER_FILE, 'utf8')); } catch {}
  const indexed = await indexedSlotNames();
  const n = POOL_SIZE[role] || 6;
  let pick = null;
  for (let i = 0; i < n; i++) {
    const k = ((counters[role] || 0) + i) % n + 1;
    const name = `ADE ${role} ${k}.wav`;
    if (!indexed || indexed.has(name)) { pick = { name, k }; break; }
  }
  if (!pick) {   // pool not indexed yet (user must re-add the Place once); fall back to the old single role slot
    const legacy = `ADE ${role === 'OpenHat' ? 'Hat Open' : role}.wav`;
    console.warn(`[slot] pool for ${role} not indexed by Live, falling back to ${legacy}`);
    return legacy;
  }
  counters[role] = pick.k;
  await fs.writeFile(COUNTER_FILE, JSON.stringify(counters));
  return pick.name;
}
async function toSlot(srcPath, hint = '', fallback = 'Snare') {
  if (!insideOut(srcPath)) throw new Error('path outside output dir');
  const name = await nextSlot(roleFor(hint, fallback));
  const dest = path.join(OUT_DIR, name);
  if (dest !== srcPath) await fs.copyFile(srcPath, dest);
  return dest;
}
export const slotNameFor = (srcPath, hint, fallback) => roleFor(hint, fallback);

// what the last build put where, so tweaks can replace clips/samples in place
const lastBuild = { bpm: null, tracks: {} };   // tracks: { kick: {index,name}, ..., synth: {...}, drums: {...} }
const LANE_LABEL = { kick: 'Kick', snare: 'Snare', clap: 'Clap', hat_closed: 'Hats', hat_open: 'Open Hats', rim: 'Rim', perc: 'Perc', tom_low: 'Tom', tom_high: 'Tom Hi', ride: 'Ride', crash: 'Crash' };

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
    for (const s of lane.steps) notes.push({ pitch, start: s.step * stepBeats + (s.step % 2 ? swing : 0), duration: 0.125, velocity: s.velocity });
  }
  return notes;
}

const melodyToLiveNotes = (notes) => notes.map((n) => ({ pitch: n.pitch, start: n.startBeats, duration: n.durationBeats, velocity: n.velocity }));
const melodyBars = (notes, bars) => bars || Math.max(1, Math.ceil(Math.max(0, ...notes.map((n) => n.startBeats + n.durationBeats)) / 4));

// ---- Send straight into Ableton via the ADEHack remote script (ableton/client.js, TCP 9004) ----
async function liveClient() {
  let sendToLive;
  try { ({ sendToLive } = await import('./ableton/client.js')); }
  catch { throw new Error('ableton/client.js missing - run ableton/install.sh'); }
  return async (cmd) => {
    try { return await sendToLive(cmd, { timeoutMs: cmd.cmd === 'load_sample' ? 8000 : 4000 }); }
    catch (e) { throw new Error(`${e.message} Fix: fully quit and relaunch Live 10, then Preferences > Link/MIDI > Control Surface = "ADEHack".`); }
  };
}

app.post('/api/live/sample', async (req, res) => {
  try {
    const p = await toSlot(String(req.body?.path || ''), req.body?.instrument || req.body?.role || '', 'Snare');
    const send = await liveClient();
    let track = req.body?.track;
    if (track == null && req.body?.instrument) {
      if (!lastBuild.tracks[req.body.instrument]) throw new Error(`no track for ${req.body.instrument} in the current build`);
      track = lastBuild.tracks[req.body.instrument].index;
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
      await toWav(req.file.path, raw);
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
        if (sample) await softStep(`load ${label} sound`, { cmd: 'load_sample', path: await toSlot(sample, lane.instrument, 'Snare'), track: t.index }, true);
        await step(`${label} clip`, { cmd: 'create_clip', track: t.index, slot: 0, length: drums.pattern.bars * 4, notes: patternToLiveNotes({ ...drums.pattern, lanes: [lane] }, 'single'), fire: true, name: label, show: false });
      }
    } else if (drums?.pattern?.lanes) {
      const t = await step('create Drums track', { cmd: 'create_midi_track', name: 'Drums', index: -1 });
      nb.tracks.drums = { index: t.index, name: 'Drums' };
      if (drums.samplePath) await softStep('load drum sample', { cmd: 'load_sample', path: await toSlot(drums.samplePath, drums.role || '', 'Snare'), track: t.index }, true);
      await step('drums clip', { cmd: 'create_clip', track: t.index, slot: 0, length: drums.pattern.bars * 4, notes: patternToLiveNotes(drums.pattern, drums.mapping || 'single'), fire: true, name: 'Drums', show: false });
    }
    if (synth?.notes?.length) {
      const synthName = (synth.role || 'Saw').replace(/^./, (c) => c.toUpperCase());
      const t = await step(`create ${synthName} track`, { cmd: 'create_midi_track', name: synthName, index: -1 });
      nb.tracks.synth = { index: t.index, name: synthName };
      if (synth.samplePath) await softStep(`load ${synthName} sound`, { cmd: 'load_sample', path: await toSlot(synth.samplePath, synth.role || 'synth', 'Synth'), track: t.index }, true);
      await step(`${synthName} clip`, { cmd: 'create_clip', track: t.index, slot: 0, length: melodyBars(synth.notes, synth.bars) * 4, notes: melodyToLiveNotes(synth.notes), fire: true, name: synthName });
    }
    Object.assign(lastBuild, nb);
    await send({ cmd: 'show_view', view: 'Session' });
    res.json({ ok: true, steps, tracks: lastBuild.tracks });
  } catch (e) { res.status(500).json({ error: e.message, steps }); }
});

// ---- live tweaking: replace clips / samples / tempo in place while Live plays ----
app.get('/api/live/state', (_req, res) => res.json(lastBuild));
app.post('/api/live/show', async (_req, res) => {
  try { const send = await liveClient(); res.json(await send({ cmd: 'show_view', view: 'Session' })); }
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
      const r = await send({ cmd: 'create_clip', track: lastBuild.tracks.drums.index, slot: 0, length: pattern.bars * 4, notes: patternToLiveNotes(pattern, 'single'), fire: true, name: 'Drums', show: false });
      if (!r?.ok) throw new Error(r?.error); done.push('drums');
    } else {
      // lanes removed from the pattern: empty their clips so the old hits stop
      for (const [inst, t] of Object.entries(lastBuild.tracks)) {
        if (!LANE_LABEL[inst] || pattern.lanes.some((l) => l.instrument === inst && l.steps.length)) continue;
        if (instruments && !instruments.includes(inst)) continue;
        const r = await send({ cmd: 'create_clip', track: t.index, slot: 0, length: pattern.bars * 4, notes: [], fire: false, name: t.name, show: false });
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
        const r = await send({ cmd: 'create_clip', track: t.index, slot: 0, length: pattern.bars * 4, notes: patternToLiveNotes({ ...pattern, lanes: [lane] }, 'single'), fire: true, name: t.name, show: false });
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
const chat = { history: [] };
const uploads = new Map();   // id -> wav path (this process only)

app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) throw new Error('no audio');
    const id = `${Date.now()}`;
    const wav = path.join(TMP, `${id}-upload.wav`);
    await toWav(req.file.path, wav);
    uploads.set(id, wav);
    res.json({ id, seconds: await (await import('./lib/audio.js')).durationSeconds(wav) });
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { if (req.file) fs.unlink(req.file.path).catch(() => {}); }
});

async function trackByName(send, name) {
  const r = await send({ cmd: 'list_tracks' });
  if (!r?.ok) throw new Error(r?.error || 'list_tracks failed');
  const want = String(name).toLowerCase();
  return r.tracks.find((t) => t.name.toLowerCase() === want) || null;
}
async function ensureTrack(send, name) {
  const existing = await trackByName(send, name);
  if (existing) return { index: existing.index, name: existing.name, created: false };
  const c = await send({ cmd: 'create_midi_track', name, index: -1 });
  if (!c?.ok) throw new Error(c?.error || 'create_midi_track failed');
  return { index: c.index, name: c.name || name, created: true };
}
const stepsToNotes = (steps, swing = 0) => steps.map((s) => ({ pitch: 60, start: s.step * 0.25 + (s.step % 2 ? swing * 0.125 : 0), duration: 0.125, velocity: s.velocity }));

function makeCtx(emit) {
  const okOrThrow = (r, what) => { if (!r?.ok) throw new Error(`${what}: ${r?.error || 'failed'}`); return r; };
  return {
    emit,
    async synth({ prompt, role = 'sound', kind, source, audioPath, offsetSeconds, lengthSeconds, oneshotSeconds, strength }) {
      if (!kind) kind = TONAL.has(String(role).toLowerCase()) ? 'tone' : 'drum';
      const useAudio = Boolean(audioPath) && source !== 'text';
      const out = await synthesize({ prompt, name: role, kind: kind === 'tone' ? 'tone' : undefined, mode: useAudio ? 'oneshot' : 'text', audioPath: useAudio ? audioPath : undefined, offsetSeconds, oneshotSeconds: oneshotSeconds || lengthSeconds, strength: strength ?? 0.7 });
      const one = out.files.find((f) => f.kind === 'oneshot') || out.files[0];
      const audio = await import('./lib/audio.js');
      return { path: one.path, name: one.name, url: one.url, durationSeconds: await audio.durationSeconds(one.path), peakDb: await audio.peakDb(one.path), seed: out.seed };
    },
    writePattern: async (o) => describeToPattern(o),
    listen: async (p, q) => { if (!insideOut(p) && !p.startsWith(TMP)) throw new Error('listen: path outside project audio'); return (await import('./lib/ears.js')).listen(p, q); },
    judge: async (p, intent) => { if (!insideOut(p) && !p.startsWith(TMP)) throw new Error('judge: path outside project audio'); return (await import('./lib/ears.js')).judge(p, intent); },
    writeMelody: async (o) => { const { describeToMelody } = await import('./lib/melody.js'); const r = await describeToMelody(o); return { notes: r.notes, bars: r.bars, key: r.key, source: r.source }; },
    beatboxToPattern: async (p, o) => (await import('./lib/rhythm.js')).beatboxToPattern(p, o),
    humToNotes: async (p, o) => (await import('./lib/melody.js')).humToNotes(p, o),
    live: {
      setTempo: async (bpm) => { const send = await liveClient(); const r = okOrThrow(await send({ cmd: 'set_tempo', bpm }), 'set_tempo'); lastBuild.bpm = bpm; return r; },
      listTracks: async () => okOrThrow(await (await liveClient())({ cmd: 'list_tracks' }), 'list_tracks'),
      show: async () => (await liveClient())({ cmd: 'show_view', view: 'Session' }),
      play: async () => (await liveClient())({ cmd: 'play' }),
      stop: async () => (await liveClient())({ cmd: 'stop' }),
      deleteTrack: async (name) => { const send = await liveClient(); const t = await trackByName(send, name); if (!t) throw new Error(`no track named ${name}`); const r = okOrThrow(await send({ cmd: 'delete_track', track: t.index }), 'delete_track'); for (const k of Object.keys(lastBuild.tracks)) if (lastBuild.tracks[k].name === t.name) delete lastBuild.tracks[k]; return r; },
      async buildLane({ name, instrument, samplePath, steps, bars = 1, swing = 0 }) {
        const send = await liveClient();
        const t = await ensureTrack(send, name);
        let load = null;
        if (samplePath) load = await sendWithRetry(send, { cmd: 'load_sample', path: await toSlot(samplePath, instrument || name, 'Snare'), track: t.index });
        const notes = stepsToNotes(steps, swing);
        const clip = okOrThrow(await send({ cmd: 'create_clip', track: t.index, slot: 0, length: bars * 4, notes, fire: true, name, show: false }), 'create_clip');
        lastBuild.tracks[instrument || name] = { index: t.index, name: t.name };
        return { track: t, notes: notes.length, loadedSample: Boolean(load?.ok), loadError: load && !load.ok ? load.error : undefined, clip: clip.mode };
      },
      async buildMelody({ name, samplePath, notes, bars }) {
        const send = await liveClient();
        const t = await ensureTrack(send, name);
        let load = null;
        if (samplePath) load = await sendWithRetry(send, { cmd: 'load_sample', path: await toSlot(samplePath, name, 'Synth'), track: t.index });
        const clip = okOrThrow(await send({ cmd: 'create_clip', track: t.index, slot: 0, length: melodyBars(notes, bars) * 4, notes: melodyToLiveNotes(notes), fire: true, name, show: false }), 'create_clip');
        lastBuild.tracks[name.toLowerCase()] = { index: t.index, name: t.name };
        return { track: t, notes: notes.length, loadedSample: Boolean(load?.ok), loadError: load && !load.ok ? load.error : undefined, clip: clip.mode };
      },
      async updateLayer({ name, steps, notes, bars = 1, swing = 0 }) {
        const send = await liveClient();
        const t = await trackByName(send, name); if (!t) throw new Error(`no track named ${name}`);
        const liveNotes = notes ? melodyToLiveNotes(notes) : stepsToNotes(steps || [], swing);
        const length = notes ? melodyBars(notes, bars) * 4 : bars * 4;
        const clip = okOrThrow(await send({ cmd: 'create_clip', track: t.index, slot: 0, length, notes: liveNotes, fire: true, name: t.name, show: false }), 'create_clip');
        return { track: t, notes: liveNotes.length, clip: clip.mode };
      },
      async loadSample({ name, samplePath, role }) {
        const send = await liveClient();
        const t = await trackByName(send, name); if (!t) throw new Error(`no track named ${name}`);
        const r = okOrThrow(await sendWithRetry(send, { cmd: 'load_sample', path: await toSlot(samplePath, role || name, 'Snare'), track: t.index }), 'load_sample');
        return { track: t, replaced: r.replaced, devices: r.devices };
      },
    },
  };
}

app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  const emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    const { text = '', beatId, humId, reset } = req.body || {};
    if (reset) chat.history = [];
    if (!hasKey(process.env.ANTHROPIC_API_KEY)) throw new Error('ANTHROPIC_API_KEY is not set in .env (the producer agent needs Claude)');
    const { runProducer } = await import('./lib/agent.js');
    const recordings = {};
    if (beatId && uploads.get(String(beatId))) recordings.beat = uploads.get(String(beatId));
    if (humId && uploads.get(String(humId))) recordings.hum = uploads.get(String(humId));
    const out = await runProducer({ history: chat.history, userText: String(text), recordings, ctx: makeCtx(emit) });
    chat.history = out.history;
    emit({ type: 'text', text: out.text });
    emit({ type: 'done', tracks: lastBuild.tracks });
  } catch (e) {
    console.error('[chat]', e);
    emit({ type: 'error', error: e.message });
  }
  res.end();
});
app.post('/api/chat/reset', (_req, res) => { chat.history = []; res.json({ ok: true }); });

app.listen(PORT, () => {
  console.log(`ADE Hack running at http://localhost:${PORT}`);
  console.log(`Ableton sees: ${OUT_DIR}`);
  console.log(`Stability key: ${hasKey(process.env.STABILITY_API_KEY) ? 'ok' : 'MISSING'} | Anthropic key: ${hasKey(process.env.ANTHROPIC_API_KEY) ? 'ok' : 'not set (rule-based patterns)'}`);
});
