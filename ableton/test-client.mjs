// Run: node ~/ade-hack/ableton/test-client.mjs
import net from 'node:net';
import assert from 'node:assert/strict';
import { sendToLive, isLiveReachable, patternToLiveNotes, GM_DRUM_NOTES } from './client.js';

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, err });
    console.log(`FAIL ${name} (${Date.now() - t0} ms)\n     ${err && err.stack ? err.stack : err}`);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// Fake Live: echoes {"ok":true,"echo":cmd}; cmd "hang" never replies; cmd "garbage" replies non-JSON; cmd "fail" replies ok:false.
const fake = net.createServer((sock) => {
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let cmd;
      try { cmd = JSON.parse(line); } catch { sock.write(JSON.stringify({ ok: false, error: 'bad json' }) + '\n'); continue; }
      if (cmd.cmd === 'hang') return; // sleep forever
      if (cmd.cmd === 'garbage') { sock.write('this is not json\n'); return; }
      if (cmd.cmd === 'fail') { sock.write(JSON.stringify({ ok: false, error: 'nope' }) + '\n'); return; }
      if (cmd.cmd === 'slow') {
        // reply in two chunks to exercise buffering
        const s = JSON.stringify({ ok: true, echo: cmd }) + '\n';
        sock.write(s.slice(0, 5));
        setTimeout(() => sock.write(s.slice(5)), 50);
        return;
      }
      sock.write(JSON.stringify({ ok: true, echo: cmd }) + '\n');
    }
  });
  sock.on('error', () => {});
});
const port = await listen(fake);

// A port with nothing listening: grab an ephemeral port, then close it.
const tmp = net.createServer();
const deadPort = await listen(tmp);
await new Promise((r) => tmp.close(r));

await test('round trip echoes the command', async () => {
  const reply = await sendToLive({ cmd: 'set_tempo', bpm: 128 }, { port });
  assert.deepEqual(reply, { ok: true, echo: { cmd: 'set_tempo', bpm: 128 } });
});

await test('reply split across chunks is buffered until newline', async () => {
  const reply = await sendToLive({ cmd: 'slow', x: 1 }, { port });
  assert.deepEqual(reply, { ok: true, echo: { cmd: 'slow', x: 1 } });
});

await test('ok:false resolves (does not reject)', async () => {
  const reply = await sendToLive({ cmd: 'fail' }, { port });
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'nope');
});

await test('invalid JSON reply rejects', async () => {
  await assert.rejects(sendToLive({ cmd: 'garbage' }, { port }), /Invalid JSON reply/);
});

await test('timeout rejects within ~1.2 s when timeoutMs=1000', async () => {
  const t0 = Date.now();
  await assert.rejects(sendToLive({ cmd: 'hang' }, { port, timeoutMs: 1000 }), /Timed out after 1000 ms/);
  const dt = Date.now() - t0;
  assert.ok(dt >= 950 && dt <= 1200, `expected ~1000 ms, got ${dt} ms`);
});

await test('connect refused gives the friendly message', async () => {
  await assert.rejects(
    sendToLive({ cmd: 'ping' }, { port: deadPort }),
    (err) => {
      assert.equal(err.message, `Ableton remote script not reachable on 127.0.0.1:${deadPort} — is Live running with the ADEHack control surface selected?`);
      return true;
    },
  );
});

await test('isLiveReachable: true on fake server, false on dead port, never throws', async () => {
  assert.equal(await isLiveReachable({ port }), true);
  assert.equal(await isLiveReachable({ port: deadPort }), false);
});

await test('patternToLiveNotes: 2-bar pattern, swing 0.5, gm mapping', () => {
  const pattern = {
    bpm: 120, bars: 2, stepsPerBar: 16, swing: 0.5,
    lanes: [
      { instrument: 'kick', steps: [{ step: 0, velocity: 100 }, { step: 16, velocity: 110 }] },
      { instrument: 'snare', steps: [{ step: 4, velocity: 90 }, { step: 28, velocity: 95 }] },
      { instrument: 'hat_closed', steps: [{ step: 1, velocity: 60 }, { step: 3, velocity: 70 }, { step: 31, velocity: 80 }] },
    ],
  };
  const { notes, length } = patternToLiveNotes(pattern);
  assert.equal(length, 8);
  assert.equal(notes.length, 7);
  const byPitch = (p) => notes.filter((n) => n.pitch === p).map((n) => n.start);
  assert.deepEqual(byPitch(36), [0, 4]);           // kick: step 0 -> 0, step 16 -> 4
  assert.deepEqual(byPitch(38), [1, 7]);           // snare: step 4 -> 1, step 28 -> 7
  // hats on odd steps: step*0.25 + 0.5*0.5*0.25 = +0.0625
  assert.deepEqual(byPitch(42), [0.3125, 0.8125, 7.8125]);
  for (const n of notes) assert.equal(n.duration, 0.125);
  assert.equal(notes.find((n) => n.pitch === 36 && n.start === 4).velocity, 110);
  assert.ok(notes.every((n, i) => i === 0 || notes[i - 1].start <= n.start), 'sorted by start');
  assert.equal(GM_DRUM_NOTES.perc, 54);
});

await test('patternToLiveNotes: single mapping puts every hit on singleNote', () => {
  const pattern = { bpm: 120, bars: 1, stepsPerBar: 16, swing: 0,
    lanes: [{ instrument: 'kick', steps: [{ step: 0, velocity: 100 }] }, { instrument: 'snare', steps: [{ step: 8, velocity: 100 }] }] };
  const { notes, length } = patternToLiveNotes(pattern, { mapping: 'single', singleNote: 48 });
  assert.equal(length, 4);
  assert.deepEqual(notes.map((n) => [n.pitch, n.start]), [[48, 0], [48, 2]]);
});

await new Promise((r) => fake.close(r));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
