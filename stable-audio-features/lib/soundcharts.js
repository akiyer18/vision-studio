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
const TEMPO_NOTE = "may be half or double time";
/** Compact, producer-relevant view of a Soundcharts song object. audio.key is kept for compatibility; keyGuess is the honest name. */
export function compactSong(o) {
  if (!o) return null;
  const a = o.audio || {};
  const key = Number.isInteger(a.key) && a.key >= 0 ? `${KEYS[a.key]} ${a.mode === 1 ? "major" : a.mode === 0 ? "minor" : ""}`.trim() : null;
  return {
    uuid: o.uuid, name: o.name, artists: (o.mainArtists || o.artists || []).map((x) => x.name), isrc: o.isrc?.value || o.isrc || null,
    releaseDate: o.releaseDate ? String(o.releaseDate).slice(0, 10) : null, durationSeconds: o.duration ?? null, explicit: o.explicit ?? null,
    genres: (o.genres || []).flatMap((g) => [g.root, ...(g.sub || [])]).filter((v, i, arr) => v && arr.indexOf(v) === i),
    producers: o.producers || [], composers: o.composers || [], labels: (o.labels || []).map((l) => l.name),
    audio: Object.keys(a).length ? { tempo: a.tempo ?? null, tempoNote: a.tempo != null ? TEMPO_NOTE : null, key, keyGuess: key, mode: a.mode ?? null, energy: a.energy ?? null, danceability: a.danceability ?? null, valence: a.valence ?? null, acousticness: a.acousticness ?? null, instrumentalness: a.instrumentalness ?? null, speechiness: a.speechiness ?? null, liveness: a.liveness ?? null, loudness: a.loudness ?? null, timeSignature: a.time_signature ?? null } : null,
    appUrl: o.appUrl || null,
  };
}
export async function songByIsrc(isrc) { const j = await get(`/api/v2.25/song/by-isrc/${encodeURIComponent(String(isrc).trim())}`); return compactSong(j.object); }
export async function songByUuid(uuid) { const j = await get(`/api/v2.25/song/${encodeURIComponent(uuid)}`); return compactSong(j.object); }
export async function searchSongs(term, limit = 5) {
  const j = await get(`/api/v2/song/search/${encodeURIComponent(String(term).trim())}?limit=${Math.max(1, Math.min(20, limit))}`);
  return (j.items || []).map((x) => ({ uuid: x.uuid, name: x.name, artists: (x.artists || x.mainArtists || []).map((a) => a.name), releaseDate: x.releaseDate ? String(x.releaseDate).slice(0, 10) : null }));
}
/** "Title by Artist" -> { title, artist|null } (splits on the LAST " by " so titles like "Stand By Me by Ben E. King" survive). */
export function splitTitleArtist(q) {
  const s = String(q || "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  const m = s.match(/^(.*\S)\s+by\s+(\S.*)$/i);
  if (!m) return { title: s, artist: null };
  let title = m[1].trim(), artist = m[2].trim();
  // greedy first group already keeps everything up to the last " by "
  title = title.replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""); artist = artist.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  return { title, artist: artist || null };
}
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** "Track by Artist" or an ISRC -> compact metadata (+ up to 3 other matches). Searches the title; prefers a match by the named artist. */
export async function lookupReference(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("lookupReference: empty query");
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(q)) { const song = await songByIsrc(q); return { query: q, mode: soundchartsMode(), song, matches: [], keyGuess: song?.audio?.keyGuess ?? null, key: song?.audio?.key ?? null, tempoNote: TEMPO_NOTE }; }
  const { title, artist } = splitTitleArtist(q);
  let matches = await searchSongs(title || q, 8);
  if (!matches.length && artist) matches = await searchSongs(q, 5);
  if (!matches.length) return { query: q, mode: soundchartsMode(), song: null, matches: [], title, artist, keyGuess: null, key: null, tempoNote: TEMPO_NOTE };
  let pick = matches[0];
  if (artist) {
    const want = normName(artist);
    const byArtist = matches.find((m) => (m.artists || []).some((a) => { const n = normName(a); return n === want || n.includes(want) || want.includes(n); }));
    if (byArtist) pick = byArtist;
  }
  const song = await songByUuid(pick.uuid).catch(() => null);
  const others = matches.filter((m) => m.uuid !== pick.uuid).slice(0, 3);
  return { query: q, mode: soundchartsMode(), title, artist, artistMatched: Boolean(artist && pick !== matches[0] || (artist && (pick.artists || []).some((a) => normName(a).includes(normName(artist))))), song, matches: others, keyGuess: song?.audio?.keyGuess ?? null, key: song?.audio?.key ?? null, tempoNote: TEMPO_NOTE };
}

/** Map a compact song (genres + release year + tempo + valence) to one of our blueprint slugs; never looks at the title.
 *  `knowledge` is the lib/knowledge.js module (needs matchGenre). Returns a slug or null. */
export function genreSlugFor(song, knowledge) {
  if (!song) return null;
  const genres = (song.genres || []).map((g) => String(g).toLowerCase());
  const gtext = genres.join(" ");
  const year = song.releaseDate ? Number(String(song.releaseDate).slice(0, 4)) : null;
  const tempo = Number(song.audio?.tempo) || null;
  const valence = song.audio?.valence != null ? Number(song.audio.valence) : null;
  const has = (re) => re.test(gtext);
  if (has(/hip[ -]?hop|\brap\b/)) {
    if (year != null && year < 2000) return "boom-bap-90s";
    if (year != null && year <= 2010) return "hiphop-2000s";
    if (tempo != null && tempo >= 138 && tempo <= 146 && has(/drill/)) return "drill";
    return "trap";
  }
  if (has(/house/)) return tempo != null && tempo < 126 ? "deep-house" : "tech-house";
  if (has(/electronic|electronica|edm|dance/)) {
    if (tempo != null && tempo >= 170) return "drum-and-bass";
    if (tempo != null && tempo >= 138 && tempo <= 142) return valence != null && valence > 0.5 ? "trance" : "dubstep";
    if (tempo != null && tempo >= 128 && tempo <= 140) return "techno";
  }
  if (has(/r&b|rnb|soul/)) return year != null && year < 2005 ? "soul-rnb" : "neo-soul";
  if (has(/\bpop\b/)) return "pop";
  if (knowledge && typeof knowledge.matchGenre === "function" && gtext) { try { return knowledge.matchGenre(gtext) || null; } catch { return null; } }
  return null;
}
