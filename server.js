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
      await sliceFirstHit(gen, one, { seconds: 1.0 });
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

// ---- Send straight into Ableton via the ADEHack remote script (ableton/client.js, TCP 9004) ----
async function liveClient() {
  let sendToLive;
  try { ({ sendToLive } = await import('./ableton/client.js')); }
  catch { throw new Error('ableton/client.js missing - run ableton/install.sh'); }
  return async (cmd) => {
    try { return await sendToLive(cmd); }
    catch (e) { throw new Error(`${e.message} Fix: fully quit and relaunch Live 10, then Preferences > Link/MIDI > Control Surface = "ADEHack".`); }
  };
}

app.post('/api/live/sample', async (req, res) => {
  try {
    const p = String(req.body?.path || '');
    if (!p.startsWith(OUT_DIR)) throw new Error('path outside output dir');
    const send = await liveClient();
    const reply = await send({ cmd: 'load_sample', path: p });
    if (!reply?.ok) throw new Error(reply?.error || 'Live rejected load_sample');
    res.json(reply);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/live/pattern', async (req, res) => {
  try {
    const { pattern, mapping = 'gm', slot = 0, fire = true } = req.body || {};
    if (!pattern?.lanes) throw new Error('pattern missing');
    const stepBeats = 0.25, swing = (pattern.swing || 0) * 0.5 * stepBeats;
    const notes = [];
    for (const lane of pattern.lanes) {
      const pitch = mapping === 'single' ? 60 : (GM_DRUM_NOTES[lane.instrument] ?? 60);
      for (const s of lane.steps) notes.push({ pitch, start: s.step * stepBeats + (s.step % 2 ? swing : 0), duration: 0.125, velocity: s.velocity });
    }
    const send = await liveClient();
    const tempo = await send({ cmd: 'set_tempo', bpm: pattern.bpm });
    const clip = await send({ cmd: 'create_clip', track: 'selected', slot: Number(slot) || 0, length: pattern.bars * 4, notes, fire: Boolean(fire) });
    if (!clip?.ok) throw new Error(clip?.error || 'Live rejected create_clip');
    res.json({ ok: true, tempo, clip, noteCount: notes.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`ADE Hack running at http://localhost:${PORT}`);
  console.log(`Ableton sees: ${OUT_DIR}`);
  console.log(`Stability key: ${hasKey(process.env.STABILITY_API_KEY) ? 'ok' : 'MISSING'} | Anthropic key: ${hasKey(process.env.ANTHROPIC_API_KEY) ? 'ok' : 'not set (rule-based patterns)'}`);
});
