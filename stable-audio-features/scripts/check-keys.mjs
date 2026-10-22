#!/usr/bin/env node
// scripts/check-keys.mjs — verify every API key in .env with one cheap authenticated call per provider.
//   node scripts/check-keys.mjs [--json]      (also used by scripts/live-check.mjs)
// Never prints key values. Exit 1 when a configured key fails; a missing optional key is a WARN.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true });

const TIMEOUT_MS = 12000;
async function get(url, headers = {}, init = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, headers, signal: ctl.signal });
    let body = null; const text = await res.text();
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, ok: res.ok, body };
  } finally { clearTimeout(t); }
}
const short = (b) => (typeof b === 'string' ? b : JSON.stringify(b)).replace(/\s+/g, ' ').slice(0, 160);
const masked = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-3)} (${k.length} chars)` : 'not set');

/** Each check returns {status:'PASS'|'WARN'|'FAIL', detail, fix?}. */
export const KEY_CHECKS = {
  ANTHROPIC_API_KEY: {
    required: true, used: 'Claude producer agent (lib/agent.js)',
    async run(key) {
      const r = await get('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
      if (!r.ok) return { status: 'FAIL', detail: `HTTP ${r.status}: ${short(r.body)}`, fix: r.status === 401 ? 'key rejected: regenerate it at console.anthropic.com and update .env' : 'see the error; check billing / org access' };
      const ids = (r.body.data || []).map((m) => m.id);
      const want = 'claude-opus-5-5';
      return { status: ids.includes(want) ? 'PASS' : 'WARN', detail: `${ids.length} models visible${ids.includes(want) ? `, ${want} available` : `, ${want} NOT listed (agent MODEL)`}`, fix: ids.includes(want) ? null : 'the agent model is not available to this key; pick one from the list via MODEL in lib/agent.js' };
    },
  },
  STABILITY_API_KEY: {
    required: true, used: 'Stable Audio sound + loop generation',
    async run(key) {
      const r = await get('https://api.stability.ai/v1/user/balance', { Authorization: `Bearer ${key}` });
      if (!r.ok) return { status: 'FAIL', detail: `HTTP ${r.status}: ${short(r.body)}`, fix: r.status === 401 ? 'key rejected: platform.stability.ai > API keys, update .env' : 'see the error' };
      const credits = Number(r.body.credits);
      if (credits < 25) return { status: 'WARN', detail: `${credits.toFixed(1)} credits left`, fix: 'low balance: a demo burns a few credits per generation; top up at platform.stability.ai' };
      return { status: 'PASS', detail: `${credits.toFixed(1)} credits` };
    },
  },
  GEMINI_API_KEY: {
    required: false, used: 'ears: listening / judging (lib/ears.js)',
    async run(key) {
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      const list = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200`, { 'x-goog-api-key': key });
      if (!list.ok) return { status: 'FAIL', detail: `HTTP ${list.status}: ${short(list.body)}`, fix: list.status === 400 || list.status === 403 ? 'key rejected: aistudio.google.com > API keys, update .env' : 'see the error' };
      const names = (list.body.models || []).map((m) => String(m.name).replace(/^models\//, ''));
      if (!names.includes(model)) return { status: 'FAIL', detail: `key ok (${names.length} models) but ${model} is not available to it`, fix: 'set GEMINI_MODEL in .env to one of the listed flash models' };
      // one tiny generation on the configured model: proves quota is not exhausted today
      const gen = await get(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': key, 'content-type': 'application/json' },
        { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }], generationConfig: { maxOutputTokens: 5 } }) });
      if (gen.status === 429) return { status: 'WARN', detail: `key ok, ${model} listed, but quota exhausted (429): ${short(gen.body?.error?.message || gen.body)}`, fix: 'daily free-tier quota hit: add a second key in GEMINI_API_KEYS or wait; judging falls back to lite models' };
      if (!gen.ok) return { status: 'FAIL', detail: `generateContent on ${model}: HTTP ${gen.status}: ${short(gen.body?.error?.message || gen.body)}` };
      const text = gen.body?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      return { status: 'PASS', detail: `${model} answered (${JSON.stringify(text.trim().slice(0, 20))}), ${names.length} models visible` };
    },
  },
  GEMINI_API_KEYS: {
    required: false, used: 'extra Gemini keys for quota rotation', multi: true,
    async run(keys) {
      const out = [];
      for (const [i, key] of keys.entries()) {
        const r = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': key });
        out.push(`#${i + 1} ${masked(key)}: ${r.ok ? 'ok' : `HTTP ${r.status}`}`);
      }
      const bad = out.filter((l) => !/: ok$/.test(l));
      return { status: bad.length ? 'FAIL' : 'PASS', detail: out.join('; '), fix: bad.length ? 'remove or replace the rejected extra key(s)' : null };
    },
  },
  HF_TOKEN: {
    required: false, used: 'Hugging Face (ears fallback / models)',
    async run(key) {
      const r = await get('https://huggingface.co/api/whoami-v2', { Authorization: `Bearer ${key}` });
      if (!r.ok) return { status: 'FAIL', detail: `HTTP ${r.status}: ${short(r.body)}`, fix: 'token rejected: huggingface.co/settings/tokens, update .env' };
      return { status: 'PASS', detail: `user ${r.body.name || '?'}, token role ${r.body.auth?.accessToken?.role || r.body.auth?.type || '?'}` };
    },
  },
};

export async function checkKeys(env = process.env) {
  const results = [];
  for (const [name, spec] of Object.entries(KEY_CHECKS)) {
    const raw = (env[name] || '').trim();
    if (!raw) { results.push({ name, status: spec.required ? 'FAIL' : 'WARN', detail: `not set (${spec.used})`, fix: spec.required ? `add ${name} to .env and restart the server` : null }); continue; }
    try {
      const value = spec.multi ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw;
      const r = await spec.run(value);
      results.push({ name, ...r, detail: `${masked(spec.multi ? value[0] : raw)}: ${r.detail}` });
    } catch (err) {
      results.push({ name, status: 'FAIL', detail: `${masked(raw)}: ${err.name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000} s` : err.message}`, fix: 'network / DNS? retry; the provider may be down' });
    }
  }
  return results;
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  const results = await checkKeys();
  for (const r of results) { console.log(`${r.status.padEnd(4)}  ${r.name} — ${r.detail}`); if (r.fix && r.status !== 'PASS') console.log(`      fix: ${r.fix}`); }
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
  const fails = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${fails ? 'KEYS: NO-GO' : 'KEYS: GO'} · ${results.filter((r) => r.status === 'PASS').length} pass · ${results.filter((r) => r.status === 'WARN').length} warn · ${fails} fail`);
  process.exit(fails ? 1 : 0);
}
