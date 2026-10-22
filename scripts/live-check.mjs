#!/usr/bin/env node
// scripts/live-check.mjs — go/no-go preflight for a demo: run the moment Live is relaunched and the server is up.
//   node scripts/live-check.mjs [--no-warp] [--no-play] [--server http://localhost:3000] [--json]
// Every check prints PASS / WARN / FAIL / SKIP with the fix on the next line. Exit 1 on any FAIL.
// Read-only on the user's set except for two things the brief asks for, both opt-out:
//   --no-warp  skips `set_tempo --warp-clips` at the current tempo (warps unwarped audio clips; Live Undo reverts)
//   --no-play  skips the 2-bar playback from bar 1 (audible; the playhead is put back afterwards)
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sendToLive, jump, setTempo, setPosition, playFor, notReachableMessage } from '../ableton/client.js';

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const SERVER = opt('--server', process.env.ADE_SERVER || 'http://localhost:3000');
const PLACE = process.env.ADE_OUT_DIR || path.join(os.homedir(), 'Music/Ableton/User Library/ADE Hack');
const ROLES = ['Kick', 'Snare', 'Clap', 'Hat', 'OpenHat', 'Rim', 'Perc', 'Tom', 'Synth'];
const PY = path.join(root, 'tools/py/.venv/bin/python');

const results = [];
function report(status, name, detail, fix) {
  results.push({ status, name, detail, fix });
  const pad = status.padEnd(4);
  console.log(`${pad}  ${name}${detail ? ' — ' + detail : ''}`);
  if (fix && (status === 'FAIL' || status === 'WARN')) console.log(`      fix: ${fix}`);
}
async function check(name, fn, fix) {
  try {
    const r = await fn();                       // fn returns {status?, detail, fix?} or a detail string
    if (typeof r === 'string') report('PASS', name, r);
    else report(r.status || 'PASS', name, r.detail, r.fix || fix);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
  report('FAIL', name, msg, fix && fix.startsWith(msg) ? fix.slice(msg.length).trim() || null : fix);
  }
}
const bars2seconds = (bars, bpm) => bars * 4 * 60 / bpm;
const ms = (s) => new Promise((r) => setTimeout(r, s));

console.log(`ADE Hack preflight · server ${SERVER} · Live script on 127.0.0.1:9004 · ${new Date().toISOString()}\n`);
const installed = (await fs.readFile(path.join(root, 'ableton/VERSION'), 'utf8')).trim();

// 1. server health ---------------------------------------------------------------------------------------------
let health = null;
await check('server /api/health', async () => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  let res;
  try { res = await fetch(`${SERVER}/api/health`, { signal: ctl.signal }); } finally { clearTimeout(t); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  health = await res.json();
  const problems = [];
  if (!health.anthropicKey) problems.push('ANTHROPIC_API_KEY missing');
  if (!health.stabilityKey) problems.push('STABILITY_API_KEY missing');
  if (!health.live?.reachable) problems.push('server cannot reach the Live script');
  else if (health.live.restartNeeded || health.live.running !== installed) problems.push(`script ${health.live.running} running, ${installed} installed (restart Live)`);
  const ears = `ears=${health.ears ? 'on' : 'OFF'} (${health.earsStatus || '?'}) gemini=${health.geminiStatus || health.gemini || '?'}`;
  if (problems.length) return { status: 'FAIL', detail: `${problems.join('; ')}; ${ears}`, fix: 'keys: edit .env and restart `npm start`; script: fully quit Live, relaunch, pick ADEHack under Preferences > Link/MIDI' };
  return { status: health.ears ? 'PASS' : 'WARN', detail: `keys ok, script ${health.live.running} == ${installed}, ${ears}`, fix: health.ears ? null : 'no GEMINI_API_KEY / HF_TOKEN in .env: listening and judging will be text-only' };
}, `is the server up? \`npm start\` in ${root}`);

// 2. script ping / version ----------------------------------------------------------------------------------------
let ping = null;
await check('script ping + version', async () => {
  ping = await sendToLive({ cmd: 'ping' }, { timeoutMs: 2000 });
  if (!ping.ok) throw new Error(`ping replied ${JSON.stringify(ping)}`);
  const v = await sendToLive({ cmd: 'version' }, { timeoutMs: 2000 });
  if (!v.ok) throw new Error('version is not a known command: the script in Live is pre-5');
  const need = ['set_position', 'jump', 'set_tempo', 'arrangement_record', 'session_record', 'play_for', 'describe_set', 'browse', 'meters'];
  const missing = need.filter((c) => !(v.cmds || []).includes(c));
  if (String(v.version) !== installed) return { status: 'FAIL', detail: `Live runs ${v.version}, ableton/VERSION is ${installed}`, fix: 'bash ableton/install.sh, then fully quit and relaunch Live' };
  if (missing.length) return { status: 'FAIL', detail: `version ${v.version} but commands missing: ${missing.join(', ')}`, fix: 'bash ableton/install.sh and relaunch Live' };
  return `${v.version}, ${v.cmds.length} commands, tempo ${ping.tempo}, ${ping.tracks.length} tracks, playing=${ping.is_playing}, record=${ping.record_mode}`;
}, notReachableMessage() + ' Fully quit Live, relaunch, Preferences > Link/MIDI > Control Surface > ADEHack.');
const live = Boolean(ping && ping.ok);
const busy = live && (ping.is_playing || ping.record_mode);

// 3. jump 1 then read the position -------------------------------------------------------------------------------
let originalPosition = null;
await check('jump to bar 1 + read position', async () => {
  if (!live) return { status: 'SKIP', detail: 'no script' };
  if (busy) return { status: 'SKIP', detail: 'Live is playing/recording; not moving the playhead' };
  const before = await sendToLive({ cmd: 'arrangement_info' });
  originalPosition = Number(before.current_song_time ?? 0);
  const j = await jump(1);
  if (!j.ok) throw new Error(`jump replied ${JSON.stringify(j)}`);
  const after = await sendToLive({ cmd: 'arrangement_info' });
  const pos = Number(after.current_song_time);
  if (!(j.position === 0 && j.bar === 1 && Math.abs(pos) < 1e-6)) throw new Error(`expected position 0 / bar 1, got reply ${JSON.stringify(j)} and arrangement_info ${pos}`);
  return `playhead was at beat ${originalPosition}, jump -> beat ${pos} bar ${j.bar} (${j.beats_per_bar} beats/bar); arrangement ${after.bars} bars, loop ${after.loop?.on ? 'ON' : 'off'}`;
}, 'bash ableton/install.sh (needs 5.8+) and relaunch Live');

// 4. set_tempo --warp-clips at the current tempo ----------------------------------------------------------------------
await check('set_tempo --warp-clips at current tempo', async () => {
  if (!live) return { status: 'SKIP', detail: 'no script' };
  if (flag('--no-warp')) return { status: 'SKIP', detail: '--no-warp' };
  const r = await setTempo(ping.tempo, { warpClips: true, timeoutMs: 15000 });
  if (!r.ok) throw new Error(`set_tempo replied ${JSON.stringify(r)}`);
  if (Math.abs(r.tempo - ping.tempo) > 1e-6) throw new Error(`tempo moved from ${ping.tempo} to ${r.tempo}`);
  const w = (r.warped || []).map((x) => `${x.track}/${x.clip}:${x.mode}`).join(', ');
  const left = (r.unwarped_left || []).map((x) => `${x.track}/${x.clip} (${x.error})`).join(', ');
  const scope = r.arrangement_scanned ? 'session + arrangement' : 'session clips only (Live 10 has no arrangement clip API)';
  const detail = `tempo ${r.tempo} unchanged; warped ${r.warped?.length || 0}${w ? ' [' + w + ']' : ''}; unwarped_left ${r.unwarped_left?.length || 0}${left ? ' [' + left + ']' : ''}; ${scope}`;
  if ((r.unwarped_left || []).length) return { status: 'WARN', detail, fix: 'those clips stay unwarped: warp them by hand (clip view > Warp) or stop the recording first' };
  if ((r.warped || []).length) return { status: 'WARN', detail, fix: 'the preflight just warped these clips at the current tempo; Edit > Undo in Live if you did not want that' };
  return detail;
}, 'bash ableton/install.sh (needs 5.8+) and relaunch Live');

// 5. describe_set brief -----------------------------------------------------------------------------------------------
await check('describe_set', async () => {
  if (!live) return { status: 'SKIP', detail: 'no script' };
  const d = await sendToLive({ cmd: 'describe_set' }, { timeoutMs: 8000 });
  if (!d.ok) throw new Error(`describe_set replied ${JSON.stringify(d)}`);
  const tracks = d.tracks || [];
  const soloed = tracks.filter((t) => t.mixer?.solo).map((t) => t.name);
  const muted = tracks.filter((t) => t.mixer?.mute).map((t) => t.name);
  const armed = tracks.filter((t) => t.mixer?.arm).map((t) => t.name);
  const clips = tracks.reduce((n, t) => n + (t.clips?.length || 0), 0);
  const detail = `${tracks.length} tracks (${tracks.filter((t) => t.is_midi).length} MIDI), ${clips} session clips, ${d.scenes?.length ?? '?'} scenes, ${d.tempo} BPM ${d.signature || ''}, loop ${d.loop?.on ? 'ON' : 'off'}` +
    (soloed.length ? `; SOLOED: ${soloed.join(', ')}` : '') + (muted.length ? `; muted: ${muted.join(', ')}` : '') + (armed.length ? `; armed: ${armed.join(', ')}` : '');
  if (soloed.length) return { status: 'WARN', detail, fix: 'un-solo before the demo: every audition/capture will only hear the soloed track(s)' };
  return detail;
});

// 6. ADE Hack Place + slot files per role --------------------------------------------------------------------------------
await check('ADE Hack Place + slot files indexed', async () => {
  let files;
  try { files = await fs.readdir(PLACE); } catch { return { status: 'FAIL', detail: `folder missing: ${PLACE}`, fix: 'start the server once (it creates it) and add it in Live: Places > Add Folder... > that folder' }; }
  const onDisk = {};
  for (const f of files) { const m = f.match(/^ADE (\w+) (\d+)\.wav$/); if (m && ROLES.includes(m[1])) (onDisk[m[1]] = onDisk[m[1]] || []).push(+m[2]); }
  const diskLine = ROLES.map((r) => `${r}:${(onDisk[r] || []).length}`).join(' ');
  if (!Object.keys(onDisk).length) return { status: 'FAIL', detail: `no "ADE <Role> N.wav" slot files in ${PLACE}`, fix: 'start the server once: it seeds the slot pool (SLOT_POOL, default 8 per role)' };
  if (!live) return { status: 'WARN', detail: `on disk ${diskLine}; indexing not checked (no script)` };
  const b = await sendToLive({ cmd: 'browse', root: 'user_folders', query: 'ade ', depth: 3, limit: 200 }, { timeoutMs: 8000 });
  if (!b.ok) throw new Error(`browse replied ${JSON.stringify(b)}`);
  const indexed = {};
  for (const it of b.items || []) { const m = String(it.name).match(/^ADE (\w+) (\d+)(\.wav)?$/); if (m && ROLES.includes(m[1]) && !it.is_folder) (indexed[m[1]] = indexed[m[1]] || new Set()).add(+m[2]); }
  const idxLine = ROLES.map((r) => `${r}:${indexed[r]?.size || 0}`).join(' ');
  const short = ROLES.filter((r) => (onDisk[r] || []).length && (indexed[r]?.size || 0) < (onDisk[r] || []).length);
  const none = ROLES.filter((r) => (onDisk[r] || []).length && !(indexed[r]?.size || 0));
  const detail = `disk ${diskLine} | indexed ${idxLine}`;
  if (none.length === ROLES.filter((r) => onDisk[r]).length) return { status: 'FAIL', detail: `nothing indexed under Places: ${detail}`, fix: `in Live: Places > Add Folder... > ${PLACE} (or remove + re-add it), then rerun` };
  if (short.length) return { status: 'WARN', detail, fix: `Live has not indexed every slot file (${short.join(', ')}): Places > remove "ADE Hack" and re-add it, or restart Live` };
  return detail;
});

// 7. 2-bar playback from bar 1 + meters --------------------------------------------------------------------------------
await check('2-bar play from bar 1 + meters', async () => {
  if (!live) return { status: 'SKIP', detail: 'no script' };
  if (busy) return { status: 'SKIP', detail: 'Live is already playing/recording' };
  if (flag('--no-play')) return { status: 'SKIP', detail: '--no-play' };
  const seconds = bars2seconds(2, ping.tempo);
  const p = await playFor(seconds, { fromBar: 1 });
  if (!p.ok || p.position !== 0) throw new Error(`play_for from_bar:1 replied ${JSON.stringify(p)}`);
  const ticks = Math.max(5, Math.min(40, Math.round(seconds * 10) - 2));
  const m = await sendToLive({ cmd: 'meters', ticks }, { timeoutMs: 4000 + ticks * 100 });
  await ms(Math.max(0, (seconds + 0.6) * 1000 - ticks * 100));
  const after = await sendToLive({ cmd: 'ping' });
  if (after.is_playing) { await sendToLive({ cmd: 'stop' }); }
  if (!m.ok) throw new Error(`meters replied ${JSON.stringify(m)}`);
  const loud = (m.tracks || []).filter((t) => !t.silent).map((t) => `${t.name} ${Number(t.peak).toFixed(2)}`);
  const detail = `played ${seconds.toFixed(1)} s from bar 1 at ${ping.tempo} BPM; master peak ${Number(m.master?.peak ?? m.master ?? 0).toFixed(2)}; audible: ${loud.length ? loud.join(', ') : 'none'}; stopped=${!after.is_playing || 'forced'}`;
  if (!loud.length) return { status: 'WARN', detail, fix: 'nothing came out of the arrangement from bar 1: fine for an empty set, otherwise check the master routing / Back to Arrangement' };
  return detail;
}, 'bash ableton/install.sh (needs 5.8+) and relaunch Live');
report('SKIP', 'server capture from bar 1', 'no cheap server route: capture runs inside the agent (enhance_project / listen_live) and would record the set', null);

// restore the playhead we moved
if (live && originalPosition !== null && !flag('--no-play')) {
  try { await setPosition({ beat: originalPosition }); console.log(`      playhead restored to beat ${originalPosition}`); } catch (e) { report('WARN', 'restore playhead', String(e.message || e)); }
}

// 8. python toolbelt ----------------------------------------------------------------------------------------------------
await check('python toolbelt (tools/py/.venv)', async () => {
  try { await fs.access(PY); } catch { return { status: 'FAIL', detail: `${PY} missing`, fix: 'bash tools/py/setup.sh' }; }
  const { stdout } = await execFileP(PY, ['-I', path.join(root, 'tools/py/adetools.py'), 'versions'], { timeout: 120000, maxBuffer: 1 << 20 });
  const line = stdout.trim().split('\n').pop();
  const v = JSON.parse(line);                       // {ok, python, versions:{numpy:"1.26.4", ... | "ERROR ..."}}
  if (v.ok === false) throw new Error(v.error || line);
  const versions = v.versions || v;
  const bad = Object.entries(versions).filter(([, val]) => /error/i.test(String(val))).map(([k, val]) => `${k}: ${val}`);
  if (bad.length) return { status: 'FAIL', detail: bad.join('; '), fix: 'bash tools/py/setup.sh (reinstalls the pinned wheels)' };
  return `python ${v.python || '?'}: ` + Object.entries(versions).map(([k, val]) => `${k} ${val}`).join(', ');
}, 'bash tools/py/setup.sh');

// summary ------------------------------------------------------------------------------------------------------------------
const count = (s) => results.filter((r) => r.status === s).length;
const fails = count('FAIL');
console.log(`\n${fails ? 'NO-GO' : 'GO'} · ${count('PASS')} pass · ${count('WARN')} warn · ${fails} fail · ${count('SKIP')} skip`);
if (flag('--json')) console.log(JSON.stringify({ go: !fails, server: SERVER, installed, results }, null, 1));
process.exit(fails ? 1 : 0);
