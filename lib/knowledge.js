// Genre production knowledge: blueprints in knowledge/genres/*.md, verified Live preset map in knowledge/live-presets.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GENRES_DIR = path.join(here, "..", "knowledge", "genres");
export const PRESETS_FILE = path.join(here, "..", "knowledge", "live-presets.md");

export const REQUIRED_SECTIONS = [
  "## Summary", "## Era & tempo", "## Drum sounds (Stable Audio-ready)", "## Pattern archetypes", "## Bass",
  "## Harmony & keys", "## Hooks & melodic devices", "## Textures & FX", "## Arrangement", "## Mix signature",
  "## References (verify)", "## Common mistakes", "## Stable Audio loop prompts", "## Sources",
];

// aliases that are everyday words ("pop", "trance", "funk"...) count only when they are clearly used as a genre:
// the whole message is just the name, a music noun follows ("pop song"), or a request verb precedes ("make me some trance").
const AMBIGUOUS = new Set(["pop", "rap", "jazz", "trance", "ambient", "edm", "house", "disco", "funk", "drill", "trap", "groove", "138",
  "deep", "rumble", "perc", "garage", "drag", "drone", "140", "174", "soul", "rage", "minimal", "liquid", "bassline"]);
// load-time rule (see load()): any single-word alias of 6 letters or fewer that is not the genre's own slug/title is ambiguous too
const dynAmbiguous = new Set();
const isAmbiguous = (a) => AMBIGUOUS.has(a) || dynAmbiguous.has(a);
// a style word must FOLLOW the alias ("garage shuffle", "trap beat 140") ...
const GENRE_NOUN = "(beat|beats|track|tracks|song|songs|tune|music|production|instrumental|type beat|vibe|vibes|style|genre|groove|banger|anthem|drop|loop|loops|kit|drums|chords|bassline|record|remix|feel|flavou?r|sound|energy|arrangement|pad|pads|lead|set|mix|producer|artist|classic|session|jam|cut|number|idea|sketch|demo|project|direction|shuffle|swing|bounce|pattern|rhythm|\\d{2,3}( ?bpm)?)";
// ... or a request verb must PRECEDE it and the alias must end the request ("make it drill", "something like trap", "sound of trance")
const GENRE_VERB = "(make me|make us|make it|make this|make that|turn it into|produce|build me|build|write|create|cook up|cook|give me|i want|i need|i'd like|we want|let's do|let's make|let's try|let's go|going for|something|do|try|start|sketch|aiming for|in the style of|sound of|sounds like|more like|like|into|modern|classic|dark|uplifting|dirty|melodic|hard|soft|lo-fi|lofi|dusty|90s|80s|2000s|70s|old school|new|french|uk|us|west coast|east coast|k|j|synth|indie|dance|bedroom|big room|progressive|psy|acid|nu|neo|future)";
const TAIL = "(\\s+(please|pls|plz|now|next|instead|with|in|at|for|around|and)\\b.*)?";
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function genreUse(a, t) {
  const A = esc(a);
  if (new RegExp(`^(?:(?:a|an|some|the|just|more)\\s+)?${A}(?:\\s+(?:please|pls|plz))?$`).test(t.trim())) return true;   // the whole query is the name
  return new RegExp(`\\b${A}\\b[ -]+${GENRE_NOUN}\\b`).test(t) || new RegExp(`\\b${GENRE_VERB}\\s+(a |an |the |my |this |that |some |more )?(\\w+[ -])?${A}${TAIL}$`).test(t);
}

let cache = null;
function load() {
  if (cache) return cache;
  const files = fs.existsSync(GENRES_DIR) ? fs.readdirSync(GENRES_DIR).filter((f) => f.endsWith(".md")).sort() : [];
  const genres = {};
  for (const file of files) {
    const markdown = fs.readFileSync(path.join(GENRES_DIR, file), "utf8");
    const title = (markdown.match(/^#\s+(.+)$/m) || [, file])[1].trim();
    const slug = (markdown.match(/^slug:\s*(\S+)/m) || [, file.replace(/\.md$/, "")])[1].trim();
    const aliases = (markdown.match(/^aliases:\s*(.+)$/m) || [, ""])[1].split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
    const tempo = (markdown.match(/^tempo:\s*(.+)$/m) || [, ""])[1].trim();
    const summary = section(markdown, "## Summary").trim();
    genres[slug] = { slug, title, aliases: [...new Set([slug, title.toLowerCase(), ...aliases])], tempo, summary, markdown, file };
  }
  // short everyday words that happen to be aliases ("deep", "rumble", "goa") only count in a clear genre context
  dynAmbiguous.clear();
  const owners = new Map();   // alias -> slugs, for collision warnings
  for (const g of Object.values(genres)) {
    for (const alias of g.aliases) {
      const a = norm(alias);
      if (!a || /\badjacent\b/.test(a)) continue;
      if (!/\s/.test(a) && a.replace(/[^a-z]/g, "").length <= 6 && a !== g.slug && a !== norm(g.title)) dynAmbiguous.add(a);
      if (!owners.has(a)) owners.set(a, []);
      owners.get(a).push(g.slug);
    }
  }
  for (const [a, slugs] of owners) if (slugs.length > 1) console.warn(`[knowledge] alias "${a}" is claimed by ${slugs.join(", ")}; the genre whose slug/title equals it wins, else the first file`);
  cache = genres;
  return genres;
}
function section(md, heading) {
  const i = md.indexOf(heading);
  if (i < 0) return "";
  const rest = md.slice(i + heading.length);
  const j = rest.search(/\n## /);
  return j < 0 ? rest : rest.slice(0, j);
}

export function listGenres() {
  return Object.values(load()).map(({ slug, title, tempo, aliases }) => ({ slug, title, tempo, aliases: aliases.slice(0, 8) }));
}

const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9&#+\-\s]/g, " ").replace(/\s+/g, " ").trim();

/** Best genre slug for a free-text request, or null. Longest alias match wins; "[genre: x]" prefix wins over everything. */
export function matchGenre(text) {
  const g = load();
  const t = norm(text);
  if (!t) return null;
  const tag = String(text).toLowerCase().match(/\[genre:\s*([^\]]+)\]/);   // on the raw text: norm() may strip the brackets
  if (tag) { const hit = matchGenre(tag[1]); if (hit) return hit; }
  let best = null, bestLen = 0, bestExact = false;
  for (const genre of Object.values(g)) {
    for (const alias of genre.aliases) {
      const a = norm(alias).replace(/\s*\(adjacent\)$/, "");
      if (!a) continue;
      // word-boundary containment (so "trap" does not match "strap", but "lo-fi" matches "lo-fi hip hop")
      const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
      if (!re.test(t)) continue;
      if (isAmbiguous(a) && !tag && !genreUse(a, t)) continue;   // "make the snare pop" is not a request for pop music
      const exact = a === genre.slug || a === norm(genre.title);   // on an alias collision, the genre that IS the alias wins
      if (a.length > bestLen || (a.length === bestLen && exact && !bestExact)) { best = genre.slug; bestLen = a.length; bestExact = exact; }
    }
  }
  return best;
}

/** Full blueprint for prompt injection and the genre_blueprint tool. summary <= 1200 chars. */
export function getBlueprint(slug) {
  const g = load()[slug];
  if (!g) return null;
  let summary = g.summary.replace(/\s+/g, " ").trim();
  if (summary.length > 1200) summary = summary.slice(0, 1197).replace(/\s+\S*$/, "") + "...";
  return { slug: g.slug, title: g.title, tempo: g.tempo, markdown: g.markdown, summary };
}

/** Preset rows for a genre from knowledge/live-presets.md (verified names). */
export function getPresets(slug) {
  if (!fs.existsSync(PRESETS_FILE)) return null;
  const md = fs.readFileSync(PRESETS_FILE, "utf8");
  const g = load()[slug];
  if (!g) return null;
  const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Genre") && !l.startsWith("|---"));
  const wanted = [g.title.toLowerCase(), ...g.aliases];
  const row = rows.find((l) => { const name = norm(l.split("|")[1]); return wanted.some((w) => norm(w).split(" ")[0] && name.includes(norm(w).split("(")[0].trim())) || name.includes(norm(g.slug.replace(/-/g, " ")).split(" ")[0]); });
  if (!row) return null;
  const [, genre, drums, bass, keys, lead, fx] = row.split("|").map((c) => c.trim());
  return { genre, drums, bass, keys, lead, fx, line: row.trim() };
}

/** Stable Audio prompt bodies parsed from the "Stable Audio loop prompts" section (server adds TrackType/BPM). */
export function getLoopPrompts(slug) {
  const g = load()[slug];
  if (!g) return null;
  const sec = section(g.markdown, "## Stable Audio loop prompts");
  if (!sec) return null;
  const pick = (key) => [...sec.matchAll(new RegExp(`^- (?:oneshot )?${key}:\\s*(.+)$`, "gmi"))].map((m) => m[1].trim());
  const loops = pick("loop"), texture = pick("texture")[0] || null, track = pick("track")[0] || null, kick = pick("kick")[0] || null, snare = pick("snare")[0] || null, hat = pick("hat")[0] || null, perc = pick("perc")[0] || null;
  const firstBullet = (heading) => { const m = section(g.markdown, heading).match(/^\s*-\s+(.+)$/m); return m ? m[1].trim() : null; };
  const production = firstBullet("## Mix signature"), era = firstBullet("## Era & tempo");
  const fill = (s, bpm) => (s ? s.replace(/\{bpm\}/g, String(Math.round(bpm))) : null);
  return { slug, title: g.title, loops, texture, track, oneshots: { kick, snare, hat, perc }, production, era, withBpm: (bpm) => ({ loops: loops.map((l) => fill(l, bpm)), texture: fill(texture, bpm), track: fill(track, bpm) }) };
}

export function validateBlueprint(slug) {
  const g = load()[slug];
  if (!g) return { ok: false, missing: ["<no such genre>"] };
  const missing = REQUIRED_SECTIONS.filter((h) => !g.markdown.includes(h));
  const tooLong = g.summary.replace(/\s+/g, " ").trim().length > 1200;
  return { ok: !missing.length && !tooLong, missing, summaryChars: g.summary.replace(/\s+/g, " ").trim().length, tooLong };
}


export function invalidate() { cache = null; }

/** When no blueprint matches, have Claude write one in the house format and save it as gen-<slug>.md (cached forever after). */
export async function ensureBlueprint(genreText) {
  const hit = matchGenre(genreText);
  if (hit) return { slug: hit, generated: false };
  const name = String(genreText || "").replace(/\[genre:\s*|\]/gi, "").trim();
  if (!name || name.length > 60 || !/^[\w\s&'’\-\/.+#]+$/.test(name)) return { slug: null, generated: false };
  const slug = "gen-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (load()[slug]) return { slug, generated: false };
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const example = load()["techno"]?.markdown?.slice(0, 6000) || "";
  const r = await client.messages.create({
    model: "claude-opus-5-5", max_tokens: 9000, output_config: { effort: "medium" },
    system: "You write production blueprints for music producers: concrete sounds, patterns, bass types, harmony, textures, arrangement, mistakes, Stable Audio prompt bodies. Factual; leave out names or dates you are unsure of. Output ONLY the markdown file.",
    messages: [{ role: "user", content: `Write a blueprint markdown file for the style "${name}" in EXACTLY the structure of this example (same front lines: "# Title", "slug: ${slug}", "aliases: ..." (8-15 comma-separated aliases a producer might type, include "${name.toLowerCase()}"), "tempo: ...", then the same "## " section headings in the same order, including "## Summary" (dense, under 1100 characters: tempo, kick, snare, hats/perc, bass TYPE and movement, harmony/keys, textures, arrangement, 3 common mistakes) and "## Stable Audio loop prompts" with at least 3 "- loop:" bullets using {bpm}, 2 "- texture:" bullets and "- oneshot kick/snare/hat/perc:" bullets written as descriptive Stable Audio prompt bodies).\n\nEXAMPLE FILE:\n${example}` }],
  });
  const md = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").replace(/^```(?:markdown)?\s*|```\s*$/g, "").trim();
  if (!/^#\s+/.test(md) || !md.includes("## Summary")) throw new Error("generated blueprint was not in the expected format");
  let fixed = md.replace(/^slug:.*$/m, `slug: ${slug}`);
  // keep only aliases that cannot be mistaken for everyday words: multi-word, longer than 7 chars, or containing the requested name
  const lname = name.toLowerCase();
  fixed = fixed.replace(/^aliases:\s*(.+)$/m, (_, list) => {
    const kept = [...new Set(list.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean).filter((a) => /\s/.test(a) || a.length > 7 || a.includes(lname)))];
    if (!kept.includes(lname)) kept.unshift(lname);
    return `aliases: ${kept.join(", ")}`;
  });
  if (!fixed.includes("## Sources")) fixed += "\n\n## Sources\n- Written from model knowledge on request; names and dates are to be verified.\n";
  const file = path.join(GENRES_DIR, `${slug}.md`);
  fs.writeFileSync(file, fixed + "\n", "utf8");
  invalidate();
  const v = validateBlueprint(slug);
  if (!v.ok) { try { fs.unlinkSync(file); } catch {} invalidate(); throw new Error(`generated blueprint incomplete (${v.missing.join(", ") || "summary too long"}; stop_reason ${r.stop_reason})`); }
  return { slug, generated: true };
}
