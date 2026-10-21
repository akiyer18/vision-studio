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

export function notReachableMessage(host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return `Ableton remote script not reachable on ${host}:${port} — is Live running with the ADEHack control surface selected?`;
}

/**
 * Send one command to the Live remote script and resolve with its reply object.
 * Opens a fresh socket per call. Resolves even when reply.ok === false (caller decides).
 * Rejects on: connection refused / unreachable, timeout, invalid JSON reply, socket closed before a reply.
 */
export function sendToLive(cmd, { host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = 3000 } = {}) {
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
      socket.write(JSON.stringify(cmd) + '\n');
    });
  });
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
    '  node ableton/client.js set_tempo <bpm>',
    '  node ableton/client.js load_sample </abs/file.wav>',
    "  node ableton/client.js create_clip '<json notes array | pattern json>' [--track selected|N] [--slot N] [--length beats] [--mapping gm|single] [--no-fire]",
    "  node ableton/client.js raw '<full json cmd>'",
    '',
    'Env: ADE_LIVE_HOST, ADE_LIVE_PORT, ADE_LIVE_TIMEOUT_MS',
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
    timeoutMs: Number(process.env.ADE_LIVE_TIMEOUT_MS) || 3000,
  };

  let cmd;
  switch (sub) {
    case 'ping':
      cmd = { cmd: 'ping' };
      break;
    case 'set_tempo': {
      const bpm = Number(rest[0]);
      if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('set_tempo needs a numeric bpm');
      cmd = { cmd: 'set_tempo', bpm };
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
      const track = flags.track === undefined ? 'selected' : (/^\d+$/.test(flags.track) ? Number(flags.track) : flags.track);
      cmd = {
        cmd: 'create_clip',
        track,
        slot: flags.slot !== undefined ? Number(flags.slot) : 0,
        length: flags.length !== undefined ? Number(flags.length) : length,
        notes,
        fire: flags.fire !== false,
      };
      if (!Array.isArray(parsed) && parsed.bpm) cmd.bpm = Number(parsed.bpm);
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

  const reply = await sendToLive(cmd, opts);
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
