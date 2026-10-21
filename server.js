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

async function publish(buffer, name, ext, kind) {
  const file = `${slug(name)}-${Date.now()}${ext}`;
  const full = path.join(OUT_DIR, file);
  await fs.writeFile(full, buffer);
  return { name: file, url: `/out/${encodeURIComponent(file)}`, path: full, kind };
}

function buildPrompt(prompt, mode) {
  const p = String(prompt || '').trim();
  if (mode === 'loop') return `${p || 'drum loop'}, tight drum loop, dry, clean, punchy`;
  return `${p || 'drum hit'}, single one-shot drum sample, dry, punchy, clean transient, no melody, no music`;
}

app.get('/api/health', (_req, res) => {
  res.json({
    stabilityKey: hasKey(process.env.STABILITY_API_KEY),
    anthropicKey: hasKey(process.env.ANTHROPIC_API_KEY),
    outDir: OUT_DIR,
  });
});

app.post('/api/synth', upload.single('audio'), async (req, res) => {
  const id = Date.now();
  try {
    if (!hasKey(process.env.STABILITY_API_KEY)) throw new Error('STABILITY_API_KEY is not set in .env');
    const { prompt = '', name = 'sound' } = req.body;
    let mode = req.body.mode || 'oneshot';
    if (!req.file) mode = 'text';
    const strength = clamp(parseFloat(req.body.strength), 0.01, 1) || 0.7;
    const model = req.body.model || 'stable-audio-2.5';
    const files = [];
    let result;

    if (mode === 'text') {
      result = await textToAudio({ prompt: buildPrompt(prompt, req.body.mode), duration: 6, model });
    } else {
      const raw = path.join(TMP, `${id}-raw.wav`);
      const input = path.join(TMP, `${id}-input.wav`);
      await toWav(req.file.path, raw);
      if (mode === 'loop') await makeLoopInput(raw, input);
      else await makeOneShotLoop(raw, input);
      files.push(await publish(await fs.readFile(raw), `${name}-hum`, '.wav', 'raw'));
      result = await audioToAudio({ wavPath: input, prompt: buildPrompt(prompt, mode), strength, duration: 6, model });
    }

    const gen = path.join(TMP, `${id}-gen.wav`);
    await fs.writeFile(gen, result.buffer);
    if (mode !== 'loop') {
      const one = path.join(TMP, `${id}-oneshot.wav`);
      const norm = path.join(TMP, `${id}-oneshot-norm.wav`);
      await sliceFirstHit(gen, one, { seconds: clamp(Number(req.body.oneshotSeconds), 0.2, 6) || 1.0 });
      await normalize(one, norm);
      files.unshift(await publish(await fs.readFile(norm), name, '.wav', 'oneshot'));
    }
    files.push(await publish(result.buffer, `${name}-full`, '.wav', 'loop'));
    res.json({ files, seed: result.seed, mode });
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
  const p = String(req.body?.path || '');
  if (!p.startsWith(OUT_DIR)) return res.status(400).json({ error: 'path outside output dir' });
  execFile('open', ['-R', p], (err) => (err ? res.status(500).json({ error: err.message }) : res.json({ ok: true })));
});

// Live 10's browser index only scans a Place once (when it is added), so freshly written files are invisible to
// browser.load_item. We therefore keep fixed "slot" files (ADE Kick.wav, ADE Saw.wav, ...) that get indexed once and
// overwrite them with the latest sound before each load. Simpler reads the file from disk, so it gets the new audio.
const SLOT_ROLES = ['kick', 'snare', 'clap', 'hat', 'perc', 'tom', 'rim', 'saw', 'bass', 'pad', 'pluck', 'lead', 'keys', 'melody', 'synth', 'drum'];
export function slotNameFor(srcPath, hint = '', fallback = 'Drum') {
  const text = `${String(hint)} ${path.basename(srcPath)}`.toLowerCase();
  const role = SLOT_ROLES.find((r) => text.includes(r)) || fallback.toLowerCase();
  return `ADE ${role[0].toUpperCase()}${role.slice(1)}.wav`;
}
async function toSlot(srcPath, hint = '', fallback = 'Drum') {
  if (!srcPath.startsWith(OUT_DIR)) throw new Error('path outside output dir');
  const dest = path.join(OUT_DIR, slotNameFor(srcPath, hint, fallback));
  if (dest !== srcPath) await fs.copyFile(srcPath, dest);
  return dest;
}

async function sendWithRetry(send, cmd, tries = 6, delayMs = 700) {
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
    const p = await toSlot(String(req.body?.path || ''), req.body?.role || '');
    const send = await liveClient();
    const reply = await sendWithRetry(send, { cmd: 'load_sample', path: p, ...(req.body?.track != null ? { track: req.body.track } : {}) });
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
    const { notes, bpm, bars, track = 'selected', slot = 0, fire = true, name = 'Melody' } = req.body || {};
    if (!notes?.length) throw new Error('no notes');
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
    if (drums?.pattern?.lanes) {
      const t = await step('create Drums track', { cmd: 'create_midi_track', name: 'Drums', index: -1 });
      if (drums.samplePath) await step('load drum sample', { cmd: 'load_sample', path: await toSlot(drums.samplePath, drums.role || '', 'Drum'), track: t.index }, true);
      await step('drums clip', { cmd: 'create_clip', track: t.index, slot: 0, length: drums.pattern.bars * 4, notes: patternToLiveNotes(drums.pattern, drums.mapping || 'single'), fire: true, name: 'Drums' });
    }
    if (synth?.notes?.length) {
      const synthName = (synth.role || 'Saw').replace(/^./, (c) => c.toUpperCase());
      const t = await step(`create ${synthName} track`, { cmd: 'create_midi_track', name: synthName, index: -1 });
      if (synth.samplePath) await step('load saw sample', { cmd: 'load_sample', path: await toSlot(synth.samplePath, synth.role || '', 'Synth'), track: t.index }, true);
      await step(`${synthName} clip`, { cmd: 'create_clip', track: t.index, slot: 0, length: melodyBars(synth.notes, synth.bars) * 4, notes: melodyToLiveNotes(synth.notes), fire: true, name: synthName });
    }
    res.json({ ok: true, steps });
  } catch (e) { res.status(500).json({ error: e.message, steps }); }
});

app.listen(PORT, () => {
  console.log(`ADE Hack running at http://localhost:${PORT}`);
  console.log(`Ableton sees: ${OUT_DIR}`);
  console.log(`Stability key: ${hasKey(process.env.STABILITY_API_KEY) ? 'ok' : 'MISSING'} | Anthropic key: ${hasKey(process.env.ANTHROPIC_API_KEY) ? 'ok' : 'not set (rule-based patterns)'}`);
});
