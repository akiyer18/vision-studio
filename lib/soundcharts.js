// Soundcharts song metadata: genres, producers, composers, labels, release date, audio features (tempo, key, mode, energy...).
// Credentials: SOUNDCHARTS_CLIENT_ID/SECRET (OAuth, recommended) or SOUNDCHARTS_APP_ID/API_KEY (legacy headers).
// Without either, the public sandbox credentials are used: they only know a few test songs (Billie Eilish, Tones & I, David Bowie).
const BASE = "https://customer.api.soundcharts.com";
let token = null, tokenExp = 0;

export function soundchartsMode() {
  if (process.env.SOUNDCHARTS_CLIENT_ID && process.env.SOUNDCHARTS_CLIENT_SECRET) return "oauth";
  if (process.env.SOUNDCHARTS_APP_ID && process.env.SOUNDCHARTS_API_KEY) return "apikey";
  return "sandbox";
}
async function headers() {
  const mode = soundchartsMode();
  if (mode === "oauth") {
    if (!token || Date.now() > tokenExp - 30000) {
      const basic = Buffer.from(`${process.env.SOUNDCHARTS_CLIENT_ID}:${process.env.SOUNDCHARTS_CLIENT_SECRET}`).toString("base64");
      const r = await fetch("https://account.soundcharts.com/oauth/token", { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
      if (!r.ok) throw new Error(`soundcharts token ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const j = await r.json(); token = j.access_token; tokenExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
    }
    return { authorization: `Bearer ${token}` };
  }
  if (mode === "apikey") return { "x-app-id": process.env.SOUNDCHARTS_APP_ID, "x-api-key": process.env.SOUNDCHARTS_API_KEY };
  return { "x-app-id": "soundcharts", "x-api-key": "soundcharts" };
}
async function get(pathname) {
  const r = await fetch(BASE + pathname, { headers: await headers(), signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  if (!r.ok) { const msg = j?.errors?.[0]?.message || j?.message || text.slice(0, 200); const e = new Error(`soundcharts ${r.status}: ${msg}`); e.status = r.status; throw e; }
  return j;
}
const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** Compact, producer-relevant view of a Soundcharts song object. */
export function compactSong(o) {
  if (!o) return null;
  const a = o.audio || {};
  const key = Number.isInteger(a.key) && a.key >= 0 ? `${KEYS[a.key]} ${a.mode === 1 ? "major" : a.mode === 0 ? "minor" : ""}`.trim() : null;
  return {
    uuid: o.uuid, name: o.name, artists: (o.mainArtists || o.artists || []).map((x) => x.name), isrc: o.isrc?.value || o.isrc || null,
    releaseDate: o.releaseDate ? String(o.releaseDate).slice(0, 10) : null, durationSeconds: o.duration ?? null, explicit: o.explicit ?? null,
    genres: (o.genres || []).flatMap((g) => [g.root, ...(g.sub || [])]).filter((v, i, arr) => v && arr.indexOf(v) === i),
    producers: o.producers || [], composers: o.composers || [], labels: (o.labels || []).map((l) => l.name),
    audio: Object.keys(a).length ? { tempo: a.tempo ?? null, key, energy: a.energy ?? null, danceability: a.danceability ?? null, valence: a.valence ?? null, acousticness: a.acousticness ?? null, instrumentalness: a.instrumentalness ?? null, speechiness: a.speechiness ?? null, liveness: a.liveness ?? null, loudness: a.loudness ?? null, timeSignature: a.time_signature ?? null } : null,
    appUrl: o.appUrl || null,
  };
}
export async function songByIsrc(isrc) { const j = await get(`/api/v2.25/song/by-isrc/${encodeURIComponent(String(isrc).trim())}`); return compactSong(j.object); }
export async function songByUuid(uuid) { const j = await get(`/api/v2.25/song/${encodeURIComponent(uuid)}`); return compactSong(j.object); }
export async function searchSongs(term, limit = 5) {
  const j = await get(`/api/v2/song/search/${encodeURIComponent(String(term).trim())}?limit=${Math.max(1, Math.min(20, limit))}`);
  return (j.items || []).map((x) => ({ uuid: x.uuid, name: x.name, artists: (x.artists || x.mainArtists || []).map((a) => a.name), releaseDate: x.releaseDate ? String(x.releaseDate).slice(0, 10) : null }));
}
/** "Track by Artist" or an ISRC -> compact metadata (+ up to 3 other matches). */
export async function lookupReference(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("lookupReference: empty query");
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(q)) return { query: q, mode: soundchartsMode(), song: await songByIsrc(q), matches: [] };
  const matches = await searchSongs(q, 5);
  if (!matches.length) return { query: q, mode: soundchartsMode(), song: null, matches: [] };
  const song = await songByUuid(matches[0].uuid).catch(() => null);
  return { query: q, mode: soundchartsMode(), song, matches: matches.slice(1, 4) };
}
