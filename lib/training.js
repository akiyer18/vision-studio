// Training mode: "recreate this by ear". Stable Audio generates a short target at a chosen difficulty, the producer
// rebuilds it in Live, the tool scores the attempt (tempo, drum pattern, bass notes, ears) and can reveal the target's
// parts inside the session on muted "Target ..." tracks with a plain-language "how this was built".
//
// MOUNT (server.js, after makeCtx is defined and before app.listen):
//   import { mountTraining } from './lib/training.js';
//   mountTraining(app, { makeCtx, tmpDir: TMP });
// deps:
//   makeCtx(emit) -> ctx      server.js closure. Used: ctx.captureLive, ctx.loopToPattern, ctx.sliceKitFromAudio, ctx.stems,
//                             ctx.transcribeLocal, ctx.genreBlueprint, ctx.live.buildKit / buildMelody / loadDevice /
//                             loadAudioClip / setMixer / play / stop
//   tmpDir (optional)         server.js TMP (default <repo>/.tmp). Working copies live there so audioPathOk() accepts them.
// Everything else is imported from lib/* directly (stability, prompts, knowledge, ears, pytools, audio).

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
export const TRAINING_DIR = path.join(ROOT, 'samples', 'training');
const STATE_FILE = path.join(ROOT, '.tmp', 'training-sessions.json');   // not under the static folder
const LOOP_MODEL = process.env.STABILITY_LOOP_MODEL || 'stable-audio-3';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

// ---------- levels (pure) ----------
export const LEVELS = {
  beginner: { bars: 4, layers: ['drums'], label: 'Beginner', brief: '4 bars of drums. You get the tempo and the pattern in words.' },
  intermediate: { bars: 8, layers: ['drums', 'bass'], label: 'Intermediate', brief: '8 bars, drums and bass. You get the tempo, the key and which layers exist.' },
  advanced: { bars: 8, layers: ['drums', 'bass', 'keys'], label: 'Advanced', brief: '8 bars, full groove with chords or texture. You only get the genre.' },
};
export const levelSpec = (level) => LEVELS[String(level || '').toLowerCase()] ? { level: String(level).toLowerCase(), ...LEVELS[String(level).toLowerCase()] } : { level: 'beginner', ...LEVELS.beginner };

const COMMON_KEYS = ['F minor', 'A minor', 'C minor', 'G minor', 'D minor', 'E minor'];
/** First "X minor/major" found in a blueprint's harmony section, else a common key. Pure. */
export function pickKey(markdown = '', seed = 0) {
  const sec = String(markdown).split(/^## /m).find((s) => /^Harmony/i.test(s)) || '';
  const m = sec.match(/\b([A-G](?:#|b)?)\s+(minor|major)\b/i);
  if (m) return `${m[1].toUpperCase()} ${m[2].toLowerCase()}`;
  return COMMON_KEYS[Math.abs(Math.round(seed)) % COMMON_KEYS.length];
}

/** The Stable Audio prompt body for a level, from the blueprint's own loop prompts. Pure. */
export function targetPromptBody({ level, loopPrompts, title, key, bpm }) {
  const lp = loopPrompts || {};
  const loops = (lp.loops || []).filter(Boolean);
  const drumLoop = loops.length ? loops[Math.abs(Math.round(bpm || 0)) % loops.length] : `${title || 'house'} drum loop at {bpm} BPM, kick, snare, hats, tight and dry, no melody`;
  if (level === 'beginner') return { kind: 'drums', body: drumLoop };
  const stripNeg = (s) => String(s).replace(/,?\s*no (melody|bass|vocals|chords|keys)\b/gi, '').trim();
  if (level === 'intermediate') return { kind: 'track', body: `${stripNeg(drumLoop)}, with a simple repeating bass line in ${key}, root notes and octaves, drums and bass only, no chords, no keys, no pads, no vocals` };
  const track = lp.track ? stripNeg(lp.track) : `${title || 'house'} groove at {bpm} BPM, drums, bass and chords`;
  return { kind: 'track', body: `${track}, in ${key}, drums, bass and a chord or pad layer, no vocals` };
}

// ---------- pattern comparison (pure) ----------
const GROUP = (inst) => /kick/.test(inst) ? 'kick' : /snare|clap|rim/.test(inst) ? 'backbeat' : 'hats';
const GROUP_LABEL = { kick: 'kick', backbeat: 'snare/clap', hats: 'hats/perc' };
const GROUP_WEIGHT = { kick: 0.4, backbeat: 0.4, hats: 0.2 };

function groupSteps(pattern, bars) {
  const total = bars * 16, out = { kick: new Set(), backbeat: new Set(), hats: new Set() };
  for (const l of pattern?.lanes || []) for (const s of l.steps || []) { const st = typeof s === 'number' ? s : s.step; if (st < total) out[GROUP(l.instrument)].add(st); }
  return out;
}
const near = (set, st) => set.has(st) || set.has(st - 1) || set.has(st + 1);

/** Compare two 16th-step patterns (target vs attempt). Returns per-group F1 (±1 step tolerance) and a weighted overall 0..1. */
export function comparePatterns(target, attempt, bars) {
  const b = clamp(Number(bars) || Math.min(target?.bars || 1, attempt?.bars || 1), 1, 8);
  const T = groupSteps(target, b), A = groupSteps(attempt, b);
  const groups = {};
  let wsum = 0, acc = 0;
  for (const g of Object.keys(GROUP_WEIGHT)) {
    const t = [...T[g]], a = [...A[g]];
    if (!t.length && !a.length) continue;
    const recall = t.length ? t.filter((s) => near(A[g], s)).length / t.length : 0;
    const precision = a.length ? a.filter((s) => near(T[g], s)).length / a.length : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    groups[g] = { label: GROUP_LABEL[g], targetHits: t.length, attemptHits: a.length, recall: Number(recall.toFixed(2)), precision: Number(precision.toFixed(2)), f1: Number(f1.toFixed(2)) };
    if (t.length) { wsum += GROUP_WEIGHT[g]; acc += GROUP_WEIGHT[g] * f1; }
  }
  return { bars: b, groups, overall: wsum ? Number((acc / wsum).toFixed(2)) : 0 };
}

/** "kick: 1, 2, 3, 4 · snare/clap: 2, 4 · hats/perc: offbeat 8ths" for bar 1 of a pattern. Pure. */
export function describePattern(pattern) {
  const G = groupSteps(pattern, 1);
  const label = (st) => `${Math.floor(st / 4) + 1}${['', 'e', '&', 'a'][st % 4]}`;
  const parts = [];
  for (const g of ['kick', 'backbeat', 'hats']) {
    const s = [...G[g]].sort((a, b) => a - b);
    if (!s.length) continue;
    const all16 = s.length >= 14, all8 = s.length >= 7 && s.every((x) => x % 2 === 0), off8 = s.length >= 3 && s.every((x) => x % 4 === 2), four = s.length === 4 && s.every((x) => x % 4 === 0);
    parts.push(`${GROUP_LABEL[g]}: ${all16 ? 'straight 16ths' : all8 ? 'straight 8ths' : off8 ? 'offbeat 8ths' : four ? 'four on the floor' : s.map(label).join(', ')}`);
  }
  return parts.join(' · ') || 'no clear hits';
}

// ---------- bass comparison (pure) ----------
function rootPerBeat(notes, beats) {
  const out = new Array(beats).fill(null);
  for (const n of notes || []) { const b0 = Math.max(0, Math.floor(n.startBeats)), b1 = Math.min(beats, Math.ceil(n.startBeats + Math.max(0.25, n.durationBeats || 0.25))); for (let b = b0; b < b1; b++) if (out[b] == null || n.pitch < out[b]) out[b] = n.pitch; }
  return out;
}
const mode = (arr) => { const c = new Map(); for (const v of arr) if (v != null) c.set(v, (c.get(v) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };

/** Pitch-class agreement per beat where the target has a bass note, plus root (most common pitch class) match. Pure. */
export function compareBass(targetNotes, attemptNotes, bars) {
  const beats = clamp(Number(bars) || 4, 1, 16) * 4;
  const t = rootPerBeat(targetNotes, beats), a = rootPerBeat(attemptNotes, beats);
  const idx = t.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return { measured: false, note: 'no bass notes found in the target' };
  const pc = (m) => ((m % 12) + 12) % 12;
  const hit = idx.filter((i) => a[i] != null && pc(a[i]) === pc(t[i])).length;
  const covered = idx.filter((i) => a[i] != null).length;
  const tRoot = mode(idx.map((i) => pc(t[i]))), aRoot = mode(a.filter((v) => v != null).map(pc));
  return { measured: true, beatsWithBass: idx.length, agreement: Number((hit / idx.length).toFixed(2)), coverage: Number((covered / idx.length).toFixed(2)), targetRoot: tRoot != null ? NOTE_NAMES[tRoot] : null, attemptRoot: aRoot != null ? NOTE_NAMES[aRoot] : null, rootMatch: tRoot != null && tRoot === aRoot };
}

// ---------- scoring + hints (pure) ----------
/** 0-100 from the measurements; weights shift to what was measured. Pure. */
export function scoreAttempt({ level, tempoDiff, pattern, bass }) {
  const parts = [];
  if (Number.isFinite(tempoDiff)) parts.push({ w: 0.15, v: tempoDiff <= 1 ? 1 : tempoDiff <= 3 ? 0.8 : tempoDiff <= 6 ? 0.5 : tempoDiff <= 12 ? 0.2 : 0 });
  if (pattern) parts.push({ w: level === 'beginner' ? 0.85 : 0.5, v: pattern.overall });
  if (bass?.measured) parts.push({ w: 0.35, v: 0.7 * bass.agreement + 0.3 * (bass.rootMatch ? 1 : 0) });
  const wsum = parts.reduce((s, p) => s + p.w, 0);
  return wsum ? Math.round((parts.reduce((s, p) => s + p.w * p.v, 0) / wsum) * 100) : 0;
}

/** closest / off lists + the next hint, worded for the level (beginner = the answer, advanced = a nudge). Pure. */
export function feedbackFor({ level, target, tempoDiff, attemptBpm, pattern, bass, ears }) {
  const closest = [], off = [], hints = [];
  const exact = level === 'beginner', nudge = level === 'advanced';
  if (Number.isFinite(tempoDiff)) {
    if (tempoDiff <= 1) closest.push(`tempo: ${attemptBpm} BPM matches`);
    else { off.push(`tempo: yours is ${attemptBpm} BPM, ${tempoDiff} BPM ${attemptBpm > target.bpm ? 'too fast' : 'too slow'}`); hints.push(exact || level === 'intermediate' ? `set the tempo to ${target.bpm} BPM` : `the tempo is ${attemptBpm > target.bpm ? 'slower' : 'faster'} than yours; count it against the kick`); }
  }
  if (pattern) {
    const tDesc = target.patternWords || describePattern(target.pattern);
    for (const [g, r] of Object.entries(pattern.groups)) {
      if (r.f1 >= 0.8) closest.push(`${r.label}: pattern matches (${Math.round(r.f1 * 100)}%)`);
      else if (r.targetHits && !r.attemptHits) { off.push(`${r.label}: missing in your version`); hints.push(exact ? `add the ${r.label}: ${tDesc.split(' · ').find((p) => p.startsWith(r.label)) || tDesc}` : `there is a ${r.label} part you have not placed yet`); }
      else if (r.targetHits) { off.push(`${r.label}: ${Math.round(r.f1 * 100)}% match (${r.attemptHits} hits vs ${r.targetHits} in the target)`); hints.push(exact ? `${r.label} in the target: ${tDesc.split(' · ').find((p) => p.startsWith(r.label)) || tDesc}` : nudge ? `listen again to where the ${r.label} ${r.attemptHits > r.targetHits ? 'is NOT playing' : 'adds hits'}` : `the ${r.label} has ${r.targetHits} hits per ${pattern.bars} bar${pattern.bars > 1 ? 's' : ''}; you have ${r.attemptHits}`); }
      else if (r.attemptHits) off.push(`${r.label}: the target has none, you added ${r.attemptHits}`);
    }
  }
  if (bass?.measured) {
    if (bass.agreement >= 0.75) closest.push(`bass: ${Math.round(bass.agreement * 100)}% of the notes agree${bass.rootMatch ? ', same root' : ''}`);
    else if (bass.coverage < 0.3) { off.push('bass: mostly missing'); hints.push(nudge ? 'the bass plays under most beats; find its root first' : `the bass sits on ${bass.targetRoot}${target.key ? ` (${target.key})` : ''}, mostly root notes`); }
    else { off.push(`bass: ${Math.round(bass.agreement * 100)}% of the notes agree${bass.rootMatch ? ' (root is right)' : ` (your root ${bass.attemptRoot || '?'}, target ${bass.targetRoot})`}`); hints.push(bass.rootMatch ? 'the root is right; check which beats move to another note' : nudge ? 'your bass root is off; sing the lowest note of the target and find it on the keyboard' : `move the bass root to ${bass.targetRoot}`); }
  }
  if (ears?.closer?.length) for (const c of ears.closer.slice(0, 2)) hints.push(String(c));
  return { closest, off, nextHint: hints[0] || (off.length ? 'listen once more and fix the first item in the list' : 'that is it: press Reveal to compare the parts side by side') };
}

/** Hints shown at the start, by level. Pure. */
export function startHints({ level, title, bpm, key, bars, layers, patternWords }) {
  if (level === 'beginner') return [`Genre: ${title}`, `Tempo: ${bpm} BPM`, `${bars} bars, ${layers.join(' + ')}`, patternWords ? `Pattern: ${patternWords}` : null].filter(Boolean);
  if (level === 'intermediate') return [`Genre: ${title}`, `Tempo: ${bpm} BPM`, key ? `Key: ${key} (as prompted; trust your ears)` : null, `${bars} bars: ${layers.join(' + ')}`].filter(Boolean);
  return [`Genre: ${title}`, `${bars} bars`];
}

// ---------- the module ----------
export function mountTraining(app, deps = {}) {
  const { makeCtx } = deps;
  if (typeof makeCtx !== 'function') throw new Error('mountTraining: deps.makeCtx required');
  const TMP = deps.tmpDir || path.join(ROOT, '.tmp');
  const sessions = new Map();
  const ready = (async () => { await fs.mkdir(TRAINING_DIR, { recursive: true }); try { for (const s of JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))) sessions.set(s.id, s); } catch {} })();
  const save = async () => { try { await fs.writeFile(STATE_FILE, JSON.stringify([...sessions.values()].slice(-40))); } catch {} };
  const get = (id) => { const s = sessions.get(String(id || '')); if (!s) throw new Error('unknown training session; press Start first'); return s; };
  const progress = (s, label) => { (s.progress ||= []).push({ at: Date.now(), label }); if (s.progress.length > 30) s.progress.shift(); };
  const ctxFor = (s) => makeCtx((ev) => { if (ev?.summary) progress(s, String(ev.summary)); });
  const err = (res, e, code = 500) => res.status(code).json({ error: e?.message || String(e) });

  app.use('/training-audio', express.static(TRAINING_DIR));

  app.get('/api/training/levels', (_req, res) => res.json({ levels: Object.entries(LEVELS).map(([level, l]) => ({ level, ...l })) }));
  app.get('/api/training/:id/progress', async (req, res) => { try { await ready; const s = get(req.params.id); res.json({ id: s.id, busy: Boolean(s.busy), progress: s.progress || [] }); } catch (e) { err(res, e, 404); } });
  app.get('/api/training/:id', async (req, res) => { try { await ready; const { targetPath, workPath, stems, ...pub } = get(req.params.id); res.json(pub); } catch (e) { err(res, e, 404); } });

  // ---- start: generate the target
  app.post('/api/training/start', async (req, res) => {
    try {
      await ready;
      const spec = levelSpec(req.body?.level);
      const { textToAudio } = await import('./stability.js');
      const { composePrompt } = await import('./prompts.js');
      const k = await import('./knowledge.js');
      const genres = k.listGenres();
      const slug = k.matchGenre(String(req.body?.genre || '')) || (req.body?.genre && genres.find((g) => g.slug === req.body.genre)?.slug) || genres[Math.floor(Math.random() * genres.length)].slug;
      const bp = k.getBlueprint(slug);
      const lp = k.getLoopPrompts(slug);
      const bpm = clamp(Number(req.body?.bpm) || Number(String(bp?.tempo || '').match(/\d+/)?.[0]) || 120, 60, 180);
      const key = spec.level === 'beginner' ? null : pickKey(bp?.markdown, bpm);
      const { kind, body } = targetPromptBody({ level: spec.level, loopPrompts: lp, title: bp?.title, key, bpm });
      const prompt = composePrompt({ kind, title: bp?.title, bpm, body, production: lp?.production || undefined });
      const exact = spec.bars * 4 * 60 / bpm;
      const seconds = clamp(Math.ceil(exact) + 1, 6, 60);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const s = { id, level: spec.level, genre: slug, title: bp?.title || slug, bpm: Math.round(bpm), key, bars: spec.bars, layers: spec.layers, prompt, createdAt: Date.now(), progress: [] };
      sessions.set(id, s);
      progress(s, `Stable Audio composing ${spec.bars} bars of ${s.title} at ${s.bpm} BPM`);
      const r = await textToAudio({ prompt, duration: seconds, model: LOOP_MODEL });
      const rawPath = path.join(TMP, `training-raw-${id}.wav`), workPath = path.join(TMP, `training-${id}.wav`), targetPath = path.join(TRAINING_DIR, `${id}.wav`);
      await fs.mkdir(TMP, { recursive: true });
      await fs.writeFile(rawPath, r.buffer);
      const { ffmpeg } = await import('./audio.js');
      try { await ffmpeg(['-i', rawPath, '-af', `atrim=0:${exact.toFixed(4)},afade=t=out:st=${Math.max(0, exact - 0.012).toFixed(3)}:d=0.012`, '-ac', '2', '-ar', '44100', workPath]); } catch { await fs.copyFile(rawPath, workPath); }
      await fs.copyFile(workPath, targetPath);
      s.targetPath = targetPath; s.workPath = workPath; s.seed = r.seed; s.seconds = Number(exact.toFixed(2)); s.audioUrl = `/training-audio/${id}.wav`;
      // what is in it (offline, fast): the drum grid, for the beginner hint and for scoring
      try { const ctx = ctxFor(s); const rp = await ctx.loopToPattern(workPath, { bpm: s.bpm, bars: Math.min(s.bars, 4) }); s.pattern = rp.pattern; s.patternWords = describePattern(rp.pattern); } catch (e) { s.patternNote = `pattern not readable: ${e.message.slice(0, 80)}`; }
      s.hints = startHints({ ...s, patternWords: s.level === 'beginner' ? s.patternWords : null });
      progress(s, 'target ready');
      await save();
      res.json({ id, audioUrl: s.audioUrl, level: s.level, genre: s.genre, title: s.title, bpm: s.bpm, key: s.key, bars: s.bars, layers: s.layers, seconds: s.seconds, hints: s.hints, brief: spec.brief });
    } catch (e) { err(res, e); }
  });

  // stems of the target, computed once (Demucs, ~20 s per 10 s on this Mac)
  const targetStems = async (s, ctx) => {
    if (s.stems && (await fs.access(s.stems.drums || '').then(() => true).catch(() => false))) return s.stems;
    const py = await import('./pytools.js');
    if (!py.pyAvailable()) return null;
    progress(s, 'separating the target into stems (Demucs)');
    const r = await ctx.stems(s.workPath); s.stems = r.stems || r; await save(); return s.stems;
  };
  const bassNotesOf = async (ctx, stemPath, bpm, bars) => {
    const { ffmpeg } = await import('./audio.js');
    const norm = path.join(TMP, `training-bass-${Date.now()}.wav`);
    const src = await ffmpeg(['-i', stemPath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', norm]).then(() => norm).catch(() => stemPath);
    const tr = await ctx.transcribeLocal(src, { onset: 0.35, frame: 0.25, minNoteMs: 70, bpm });
    const byOnset = new Map();
    for (const n of tr.notes || []) { if (n.pitch < 28 || n.pitch > 55) continue; const k = Math.round(n.startBeats * 4); const prev = byOnset.get(k); if (!prev || n.pitch < prev.pitch) byOnset.set(k, n); }
    return [...byOnset.values()].map((n) => ({ pitch: n.pitch, startBeats: Math.round(n.startBeats * 4) / 4, durationBeats: Math.max(0.25, Math.round(n.durationBeats * 4) / 4), velocity: n.velocity })).sort((a, b) => a.startBeats - b.startBeats).filter((n) => n.startBeats < bars * 4);
  };

  // ---- check: record the producer's attempt from bar 1 and compare
  app.post('/api/training/check', async (req, res) => {
    try {
      await ready;
      const s = get(req.body?.id);
      if (s.busy) throw new Error('still working on the previous request');
      s.busy = true; s.progress = [];
      try {
        const ctx = ctxFor(s);
        const bars = clamp(Number(req.body?.bars) || s.bars, 1, 16);
        progress(s, `recording ${bars} bars of your Live set from bar 1`);
        const cap = await ctx.captureLive({ bars });
        if (cap.silent) throw new Error(`Live played (almost) nothing: ${cap.note || 'is the set playing?'}`);
        const attemptBpm = Math.round(Number(cap.bpm) || s.bpm), tempoDiff = Math.abs(attemptBpm - s.bpm);
        const out = { id: s.id, level: s.level, capture: { url: cap.url, seconds: cap.seconds, bpm: attemptBpm }, tempo: { target: s.bpm, attempt: attemptBpm, diff: tempoDiff } };
        // drums: both on the same grid at the TARGET tempo over the same bar count
        const cmpBars = Math.min(bars, s.bars, 4);
        let pattern = null;
        try {
          if (!s.pattern) { const rp = await ctx.loopToPattern(s.workPath, { bpm: s.bpm, bars: cmpBars }); s.pattern = rp.pattern; s.patternWords = describePattern(rp.pattern); }
          progress(s, 'reading your drum pattern');
          const ap = await ctx.loopToPattern(cap.path, { bpm: s.bpm, bars: cmpBars });
          pattern = comparePatterns(s.pattern, ap.pattern, cmpBars);
          out.drums = { ...pattern, yours: describePattern(ap.pattern) };
        } catch (e) { out.drums = { error: e.message.slice(0, 120) }; }
        // bass (intermediate+): stems of both, transcribe, compare pitch classes per beat
        let bass = null;
        if (s.layers.includes('bass') && req.body?.deep !== false) {
          try {
            const st = await targetStems(s, ctx);
            if (!st?.bass) out.bass = { measured: false, note: 'python toolbelt (Demucs/basic-pitch) not available: bass not measured' };
            else {
              if (!s.bassNotes) s.bassNotes = await bassNotesOf(ctx, st.bass, s.bpm, s.bars);
              progress(s, 'separating and transcribing your bass');
              const cst = await ctx.stems(cap.path); const cstems = cst.stems || cst;
              const mine = cstems.bass ? await bassNotesOf(ctx, cstems.bass, s.bpm, bars) : [];
              bass = compareBass(s.bassNotes, mine, Math.min(bars, s.bars));
              out.bass = { ...bass, targetNotes: s.bassNotes.length, yourNotes: mine.length };
            }
          } catch (e) { out.bass = { measured: false, error: e.message.slice(0, 120) }; }
        }
        // ears: what would bring the attempt closer to the target (Gemini; optional)
        let ears = null;
        try {
          const E = await import('./ears.js');
          if (E.geminiAvailable()) { progress(s, 'Gemini comparing your version with the target'); const c = await E.critiqueMix(cap.path, s.workPath, { genreTarget: s.title }); ears = { closer: Array.isArray(c?.vsReference?.closer) ? c.vsReference.closer.map((x) => (typeof x === 'string' ? x : x?.move || x?.text || JSON.stringify(x))).slice(0, 3) : [], heard: c?.vsReference?.referenceRead || null, lite: Boolean(c?.lite), scoreNote: c?.scoreNote || (c?.lite ? 'lite judge, lower confidence' : null) }; }
        } catch (e) { ears = { error: e.message.slice(0, 100) }; }
        out.ears = ears;
        out.score = scoreAttempt({ level: s.level, tempoDiff, pattern, bass });
        Object.assign(out, feedbackFor({ level: s.level, target: s, tempoDiff, attemptBpm, pattern, bass, ears }));
        if (ears?.scoreNote) out.scoreNote = ears.scoreNote;
        s.attempts = [...(s.attempts || []), { at: Date.now(), score: out.score }].slice(-10);
        out.attempts = s.attempts.length; out.best = Math.max(...s.attempts.map((a) => a.score));
        progress(s, `scored ${out.score}/100`);
        await save();
        res.json(out);
      } finally { s.busy = false; }
    } catch (e) { err(res, e); }
  });

  // ---- reveal: the target's parts on muted "Target ..." tracks next to the producer's own, plus how it was built
  app.post('/api/training/reveal', async (req, res) => {
    try {
      await ready;
      const s = get(req.body?.id);
      if (s.busy) throw new Error('still working on the previous request');
      s.busy = true; s.progress = [];
      try {
        const ctx = ctxFor(s);
        const k = await import('./knowledge.js');
        const bp = k.getBlueprint(s.genre);
        const built = { tracks: [] }, how = [];
        const stems = s.layers.length > 1 ? await targetStems(s, ctx).catch((e) => { built.stemsError = e.message.slice(0, 100); return null; }) : null;
        const drumSrc = stems?.drums || s.workPath;
        // 1) drums: kit sliced from the target's own drum audio + the MIDI grid it plays
        progress(s, 'slicing the target kit and reading its MIDI grid');
        try {
          const kitR = await ctx.sliceKitFromAudio(drumSrc, { name: `target-${s.id}` });
          const rp = await ctx.loopToPattern(drumSrc, { bpm: s.bpm, bars: Math.min(s.bars, 4) });
          const kit = kitR.kit.filter((x) => !x.alt);
          const have = new Set(kit.map((x) => x.kind));
          const pattern = { ...rp.pattern, lanes: rp.pattern.lanes.map((l) => ({ ...l, instrument: have.has(l.instrument) ? l.instrument : /snare|clap|rim/.test(l.instrument) ? (have.has('snare') ? 'snare' : have.has('clap') ? 'clap' : l.instrument) : /hat|ride|perc|shaker/.test(l.instrument) ? (have.has('hat_closed') ? 'hat_closed' : l.instrument) : l.instrument })).filter((l) => have.has(l.instrument)) };
          progress(s, 'building Target Drums in Live');
          const r = await ctx.live.buildKit({ name: 'Target Drums', kit, pattern, bars: pattern.bars, slot: 0, useGroove: false, humanize: 0 });
          built.tracks.push('Target Drums'); built.drums = { pads: kit.map((x) => x.kind), notes: r.notes, mode: r.mode };
          how.push(`Drums: ${describePattern(rp.pattern)}${rp.pattern.swing ? `, swing ${rp.pattern.swing}` : ''}. The pads on Target Drums are the target's own hits, sliced out so you can hear each sound alone.`);
          const ds = bp?.markdown ? (bp.markdown.split(/^## /m).find((x) => /^Drum sounds/i.test(x)) || '').split('\n').filter((l) => /^\s*-\s+/.test(l)).slice(0, 2).map((l) => l.replace(/^\s*-\s+/, '').trim()) : [];
          if (ds.length) how.push(`Sound choice in ${s.title}: ${ds.join(' ')}`);
        } catch (e) { built.drumsError = e.message.slice(0, 140); }
        // 2) bass: transcribed from the bass stem onto a Live bass preset (editable notes)
        if (s.layers.includes('bass') && stems?.bass) {
          try {
            progress(s, 'transcribing the target bass line');
            if (!s.bassNotes) s.bassNotes = await bassNotesOf(ctx, stems.bass, s.bpm, s.bars);
            if (s.bassNotes.length >= 2) {
              let preset = 'Bass'; try { const pr = k.getPresets(s.genre); const list = pr?.bass || pr?.bassPresets; if (Array.isArray(list) && list.length) preset = list[0]; else if (typeof list === 'string' && list) preset = list.split(/[,|/]/)[0].trim(); } catch {}
              try { await ctx.live.loadDevice({ track: 'Target Bass', name: preset }); } catch { try { await ctx.live.loadDevice({ track: 'Target Bass', name: 'Bass' }); } catch {} }
              const r = await ctx.live.buildMelody({ name: 'Target Bass', notes: s.bassNotes, bars: s.bars, slot: 0 });
              built.tracks.push('Target Bass'); built.bass = { notes: r.notes, preset };
              const roots = [...new Set(s.bassNotes.map((n) => noteName(n.pitch)))].slice(0, 4);
              const onBeat = s.bassNotes.filter((n) => Number.isInteger(n.startBeats)).length, offBeat = s.bassNotes.length - onBeat;
              how.push(`Bass: ${s.bassNotes.length} notes over ${s.bars} bars around ${roots.join(', ')}${s.key ? ` (${s.key})` : ''}; ${offBeat > onBeat ? 'mostly between the kicks (offbeat), which is what makes it bounce' : 'mostly on the beat, locked to the kick'}. Notes are editable on Target Bass.`);
            } else how.push('Bass: too quiet or too sparse to transcribe; listen to the bass stem on Target Mix.');
          } catch (e) { built.bassError = e.message.slice(0, 140); }
        }
        // 3) keys/texture: the melodic stem as a warped audio clip (advanced), and the whole target as a reference clip
        if (s.layers.includes('keys') && stems?.other) {
          try { progress(s, 'placing the chord/texture stem'); await ctx.live.loadAudioClip({ track: 'Target Keys', slot: 0, samplePath: stems.other, warpMode: 'complex_pro', overwrite: true }); built.tracks.push('Target Keys'); how.push('Keys: the chord/texture layer is on Target Keys as audio; hold it against your chords to hear where the voicing differs.'); } catch (e) { built.keysError = e.message.slice(0, 140); }
        }
        try { await ctx.live.loadAudioClip({ track: 'Target Mix', slot: 0, samplePath: s.workPath, warpMode: 'complex_pro', overwrite: true }); built.tracks.push('Target Mix'); } catch (e) { built.mixError = e.message.slice(0, 140); }
        // never stack: everything we added starts muted; the producer unmutes what they want to compare
        for (const t of built.tracks) { try { await ctx.live.setMixer({ track: t, mute: true }); } catch {} }
        // optional: what an audio model hears in the target (sound words a producer can act on)
        try { const E = await import('./ears.js'); if (E.geminiAvailable()) { progress(s, 'Gemini describing the target sounds'); const d = await E.productionDna(s.workPath); const dr = d?.drums || {}; const words = [dr.kick ? `kick: ${dr.kick}` : null, dr.snare ? `snare: ${dr.snare}` : null, dr.hats ? `hats: ${dr.hats}` : null, d?.bassType ? `bass: ${d.bassType}` : null].filter(Boolean); if (words.length) how.push(`Heard in the target${d.lite ? ' (lite judge)' : ''}: ${words.join('; ')}.`); } } catch {}
        how.push(`Workflow: tempo ${s.bpm} BPM first, then the kick, then the backbeat, then hats and the bass; A/B each Target track against your own by unmuting it alone.`);
        s.revealed = true; await save();
        progress(s, 'revealed');
        res.json({ id: s.id, built, muted: built.tracks, how, howText: how.join('\n'), presentation: { audible: [], muted: built.tracks }, note: 'Target tracks are muted: unmute one at a time to compare with yours.' });
      } finally { s.busy = false; }
    } catch (e) { err(res, e); }
  });
}

export default { mountTraining, LEVELS, levelSpec, comparePatterns, describePattern, compareBass, scoreAttempt, feedbackFor, startHints, pickKey, targetPromptBody };
