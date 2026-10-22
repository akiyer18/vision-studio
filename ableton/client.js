// ableton/client.js — tiny TCP client for the ADEHack Live remote script.
// Node 18 ESM, no deps (node:net only).
//
// Protocol: newline-delimited JSON over TCP 127.0.0.1:9004.
// Each command gets exactly one JSON line back: {"ok":true,...} or {"ok":false,"error":"..."}.

import net from 'node:net';
import { pathToFileURL } from 'node:url';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 9004;

export const GM_DRUM_NOTES = {
  kick: 36,
  snare: 38,
  clap: 39,
  rim: 37,
  hat_closed: 42,
  hat_open: 46,
  tom_low: 45,
  tom_high: 50,
  ride: 51,
  crash: 49,
  perc: 54,
};

/** Default reply timeout per command: browser loads re-scan for up to ~2.4 s, recordings run for bars. */
export function defaultTimeoutMs(cmd) {
  const name = cmd && cmd.cmd;
  if (name === 'load_sample' || name === 'load_device' || name === 'load_to_pad' || name === 'load_audio_clip') return 8000;
  if (name === 'meters') return 3000 + 100 * Math.max(1, Math.min(100, Number(cmd.ticks) || 10));
  if (name === 'session_record') return 60000;
  return 3000;
}

export function notReachableMessage(host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return `Ableton remote script not reachable on ${host}:${port} — is Live running with the ADEHack control surface selected?`;
}

/**
 * Send one command to the Live remote script and resolve with its reply object.
 * Opens a fresh socket per call. Resolves even when reply.ok === false (caller decides).
 * Rejects on: connection refused / unreachable, timeout, invalid JSON reply, socket closed before a reply.
 */
export function sendToLive(cmd, { host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs } = {}) {
  if (timeoutMs === undefined || timeoutMs === null) timeoutMs = defaultTimeoutMs(cmd);
  // ts lets the remote script drop commands that sat in a socket buffer for > 15 s while Live was busy.
  const payload = cmd && typeof cmd === 'object' && cmd.ts === undefined ? { ...cmd, ts: Date.now() } : cmd;
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const socket = new net.Socket();

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on('error', () => {}); // swallow late errors after we're done
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timed out after ${timeoutMs} ms waiting for a reply from Live on ${host}:${port} (cmd: ${cmd && cmd.cmd})`));
    }, timeoutMs);

    socket.setNoDelay(true);

    socket.on('error', (err) => {
      if (err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'EHOSTUNREACH' || err.code === 'ENOTFOUND')) {
        const e = new Error(notReachableMessage(host, port));
        e.code = err.code;
        e.cause = err;
        finish(e);
      } else {
        finish(err);
      }
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl).trim();
      let reply;
      try {
        reply = JSON.parse(line);
      } catch (e) {
        finish(new Error(`Invalid JSON reply from Live: ${JSON.stringify(line.slice(0, 200))}`));
        return;
      }
      finish(null, reply);
    });

    socket.on('close', () => {
      finish(new Error(`Connection to Live on ${host}:${port} closed before a reply was received`));
    });

    socket.connect(port, host, () => {
      socket.write(JSON.stringify(payload) + '\n');
    });
  });
}

// ------------------------------------------------------------ v5.8 wrappers
// Thin helpers that build the exact protocol messages (snake_case fields) the remote script expects.

/** Optional seek before a transport command: {fromBar} (1-based) or {fromBeat} (0.0 = bar 1). */
function withFrom(cmd, { fromBar, fromBeat } = {}) {
  if (fromBeat !== undefined && fromBeat !== null) cmd.from_beat = Number(fromBeat);
  else if (fromBar !== undefined && fromBar !== null) cmd.from_bar = Number(fromBar);
  return cmd;
}

/** set_position {beat} (0.0 = bar 1) or {bar} (1-based). Reply: {ok, position, bar, beat_in_bar, beats_per_bar, is_playing}. */
export function setPosition({ beat, bar } = {}, opts) {
  const cmd = { cmd: 'set_position' };
  if (beat !== undefined && beat !== null) cmd.beat = Number(beat);
  else if (bar !== undefined && bar !== null) cmd.bar = Number(bar);
  else throw new Error('setPosition needs {beat} or {bar}');
  return sendToLive(cmd, opts);
}

/** jump to a 1-based bar: bar 1 -> beat 0, bar N -> (N-1) * beats_per_bar at the set's signature. */
export function jump(bar, opts) {
  const n = Number(bar);
  if (!Number.isInteger(n) || n < 1) throw new Error('jump needs an integer bar >= 1');
  return sendToLive({ cmd: 'jump', bar: n }, opts);
}

/**
 * set_tempo {bpm, warp_clips?}. With warpClips:true every UNWARPED audio clip is warped at the current
 * tempo first (beats for drum-looking names, complex_pro otherwise) and the reply adds
 * {warped:[{track,clip,where,slot|start_time,mode}], unwarped_left:[...], arrangement_scanned}.
 */
export function setTempo(bpm, { warpClips = false, ...opts } = {}) {
  const n = Number(bpm);
  if (!Number.isFinite(n) || n <= 0) throw new Error('setTempo needs a numeric bpm');
  const cmd = { cmd: 'set_tempo', bpm: n };
  if (warpClips) cmd.warp_clips = true;
  return sendToLive(cmd, opts);
}

/** arrangement_record with optional fromBar/fromBeat (seeks first, overriding `at`). */
export function arrangementRecord({ bars, scenes, at, stop, fromBar, fromBeat } = {}, opts) {
  const cmd = { cmd: 'arrangement_record' };
  if (stop) cmd.stop = true;
  if (bars !== undefined) cmd.bars = Number(bars);
  if (scenes !== undefined) cmd.scenes = scenes;
  if (at !== undefined) cmd.at = at;
  return sendToLive(withFrom(cmd, { fromBar, fromBeat }), opts);
}

/** play_for {seconds} with optional fromBar/fromBeat. */
export function playFor(seconds, { fromBar, fromBeat, ...opts } = {}) {
  return sendToLive(withFrom({ cmd: 'play_for', seconds: Number(seconds) }, { fromBar, fromBeat }), opts);
}

/** session_record {track, slot, bars, monitoring, overwrite, stop_after} with optional fromBar/fromBeat. */
export function sessionRecord({ track = 'selected', slot, bars, monitoring, overwrite, stopAfter, fromBar, fromBeat } = {}, opts) {
  const cmd = { cmd: 'session_record', track };
  if (slot !== undefined) cmd.slot = Number(slot);
  if (bars !== undefined) cmd.bars = Number(bars);
  if (monitoring !== undefined) cmd.monitoring = monitoring;
  if (overwrite) cmd.overwrite = true;
  if (stopAfter) cmd.stop_after = true;
  return sendToLive(withFrom(cmd, { fromBar, fromBeat }), opts);
}

/** Ping Live with a short timeout. Never throws. */
export async function isLiveReachable(opts = {}) {
  try {
    const reply = await sendToLive({ cmd: 'ping' }, { timeoutMs: 1000, ...opts });
    return !!(reply && reply.ok !== false);
  } catch {
    return false;
  }
}

/**
 * Convert a lib/pattern.js pattern into Live notes.
 * pattern: { bpm, bars, stepsPerBar:16, swing (0..1), lanes:[{instrument, steps:[{step, velocity}]}] }
 * -> { notes: [{pitch, start, duration, velocity}], length }  (beats)
 */
export function patternToLiveNotes(pattern, { mapping = 'gm', singleNote = 60 } = {}) {
  if (!pattern || typeof pattern !== 'object') throw new Error('patternToLiveNotes: pattern must be an object');
  const bars = Number(pattern.bars) || 1;
  const stepsPerBar = Number(pattern.stepsPerBar) || 16;
  const stepBeats = 4 / stepsPerBar; // 0.25 for 16ths
  const swing = Math.min(1, Math.max(0, Number(pattern.swing) || 0));
  const swingOffset = swing * 0.5 * stepBeats;
  const duration = stepBeats / 2; // 0.125 for 16ths
  const length = bars * 4;
  const lanes = Array.isArray(pattern.lanes) ? pattern.lanes : [];

  const notes = [];
  for (const lane of lanes) {
    if (!lane || !Array.isArray(lane.steps)) continue;
    let pitch;
    if (mapping === 'single') {
      pitch = singleNote;
    } else {
      pitch = GM_DRUM_NOTES[lane.instrument];
      if (pitch === undefined) pitch = singleNote;
    }
    for (const hit of lane.steps) {
      if (!hit) continue;
      const step = Number(hit.step);
      if (!Number.isFinite(step) || step < 0) continue;
      const start = step * stepBeats + (step % 2 === 1 ? swingOffset : 0);
      if (start >= length) continue;
      const velocity = Math.min(127, Math.max(1, Math.round(Number(hit.velocity) || 100)));
      notes.push({ pitch, start, duration, velocity });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { notes, length };
}

// ---------------------------------------------------------------- CLI

function usage() {
  return [
    'Usage:',
    '  node ableton/client.js ping',
    '  node ableton/client.js set_tempo <bpm> [--warp-clips]',
    '  node ableton/client.js set_position <beat>   (0.0 = bar 1)',
    '  node ableton/client.js jump <bar>            (1-based)',
    '  node ableton/client.js play_for <seconds> [--from-bar N | --from-beat B]',
    '  node ableton/client.js load_sample </abs/file.wav>',
    "  node ableton/client.js create_clip '<json notes array | pattern json>' [--track selected|N] [--slot N] [--length beats] [--mapping gm|single] [--no-fire]",
    '  node ableton/client.js load_audio_clip <file.wav | name> [--track name|N] [--slot N] [--warp-mode complex_pro] [--overwrite]',
    '  node ableton/client.js clip_info [--track name|N] [--slot N]',
    '  node ableton/client.js undo [steps] | redo [steps]',
    '  node ableton/client.js meters [ticks]',
    "  node ableton/client.js raw '<full json cmd>'",
    '',
    'Env: ADE_LIVE_HOST, ADE_LIVE_PORT, ADE_LIVE_TIMEOUT_MS (default: 8000 for load_*, 3000 otherwise)',
  ].join('\n');
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'no-fire') { flags.fire = false; continue; }
      if (key === 'overwrite') { flags.overwrite = true; continue; }
      if (key === 'warp-clips') { flags.warpClips = true; continue; }
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

async function main(argv) {
  const { flags, positional } = parseFlags(argv);
  const [sub, ...rest] = positional;
  const opts = {
    host: process.env.ADE_LIVE_HOST || DEFAULT_HOST,
    port: Number(process.env.ADE_LIVE_PORT) || DEFAULT_PORT,
  };
  const trackFlag = (f) => (f === undefined ? 'selected' : (/^\d+$/.test(f) ? Number(f) : f));

  let cmd;
  switch (sub) {
    case 'ping':
      cmd = { cmd: 'ping' };
      break;
    case 'set_tempo': {
      const bpm = Number(rest[0]);
      if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('set_tempo needs a numeric bpm');
      cmd = { cmd: 'set_tempo', bpm };
      if (flags.warpClips) cmd.warp_clips = true;
      break;
    }
    case 'set_position': {
      const beat = Number(rest[0]);
      if (!Number.isFinite(beat) || beat < 0) throw new Error('set_position needs a beat >= 0 (0.0 = bar 1)');
      cmd = { cmd: 'set_position', beat };
      break;
    }
    case 'jump': {
      const bar = Number(rest[0]);
      if (!Number.isInteger(bar) || bar < 1) throw new Error('jump needs an integer bar >= 1');
      cmd = { cmd: 'jump', bar };
      break;
    }
    case 'play_for': {
      const seconds = Number(rest[0]);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('play_for needs seconds > 0');
      cmd = withFrom({ cmd: 'play_for', seconds }, { fromBar: flags['from-bar'], fromBeat: flags['from-beat'] });
      break;
    }
    case 'load_sample': {
      if (!rest[0]) throw new Error('load_sample needs an absolute path');
      cmd = { cmd: 'load_sample', path: rest[0] };
      break;
    }
    case 'create_clip': {
      if (!rest[0]) throw new Error('create_clip needs a JSON notes array or pattern JSON');
      const parsed = JSON.parse(rest[0]);
      let notes;
      let length;
      if (Array.isArray(parsed)) {
        notes = parsed;
        const maxEnd = parsed.reduce((m, n) => Math.max(m, (n.start || 0) + (n.duration || 0)), 0);
        length = Math.max(4, Math.ceil(maxEnd / 4) * 4);
      } else {
        ({ notes, length } = patternToLiveNotes(parsed, {
          mapping: flags.mapping || 'gm',
          singleNote: flags.singleNote !== undefined ? Number(flags.singleNote) : 60,
        }));
      }
      cmd = {
        cmd: 'create_clip',
        track: trackFlag(flags.track),
        length: flags.length !== undefined ? Number(flags.length) : length,
        notes,
        fire: flags.fire !== false,
      };
      // no --slot: the script picks the first empty slot (and never overwrites a differently named clip)
      if (flags.slot !== undefined) cmd.slot = Number(flags.slot);
      if (flags.name !== undefined) cmd.name = String(flags.name);
      if (flags.overwrite) cmd.overwrite = true;
      if (!Array.isArray(parsed) && parsed.bpm) cmd.bpm = Number(parsed.bpm);
      break;
    }
    case 'load_audio_clip': {
      if (!rest[0]) throw new Error('load_audio_clip needs a file name or path');
      cmd = { cmd: 'load_audio_clip', name: rest[0], track: trackFlag(flags.track) };
      if (flags.slot !== undefined) cmd.slot = Number(flags.slot);
      if (flags['warp-mode'] !== undefined) cmd.warp_mode = String(flags['warp-mode']);
      if (flags.overwrite) cmd.overwrite = true;
      break;
    }
    case 'clip_info': {
      cmd = { cmd: 'clip_info', track: trackFlag(flags.track), slot: flags.slot !== undefined ? Number(flags.slot) : 0 };
      break;
    }
    case 'undo':
    case 'redo': {
      cmd = { cmd: sub, steps: rest[0] !== undefined ? Number(rest[0]) : 1 };
      break;
    }
    case 'meters': {
      cmd = { cmd: 'meters', ticks: rest[0] !== undefined ? Number(rest[0]) : 10 };
      break;
    }
    case 'raw': {
      if (!rest[0]) throw new Error('raw needs a full JSON command');
      cmd = JSON.parse(rest[0]);
      break;
    }
    default:
      process.stderr.write(usage() + '\n');
      return 1;
  }

  const envTimeout = Number(process.env.ADE_LIVE_TIMEOUT_MS);
  const reply = await sendToLive(cmd, { ...opts, timeoutMs: envTimeout > 0 ? envTimeout : defaultTimeoutMs(cmd) });
  process.stdout.write(JSON.stringify(reply) + '\n');
  return reply && reply.ok === false ? 1 : 0;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`error: ${err && err.message ? err.message : err}\n`);
      process.exit(1);
    });
}
