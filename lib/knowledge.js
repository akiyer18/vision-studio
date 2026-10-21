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
  "## References (verify)", "## Common mistakes", "## Sources",
];

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
  const tag = t.match(/\[genre:\s*([^\]]+)\]/);
  if (tag) { const hit = matchGenre(tag[1]); if (hit) return hit; }
  let best = null, bestLen = 0;
  for (const genre of Object.values(g)) {
    for (const alias of genre.aliases) {
      const a = norm(alias).replace(/\s*\(adjacent\)$/, "");
      if (!a) continue;
      // word-boundary containment (so "trap" does not match "strap", but "lo-fi" matches "lo-fi hip hop")
      const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
      if (re.test(t) && a.length > bestLen) { best = genre.slug; bestLen = a.length; }
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

export function validateBlueprint(slug) {
  const g = load()[slug];
  if (!g) return { ok: false, missing: ["<no such genre>"] };
  const missing = REQUIRED_SECTIONS.filter((h) => !g.markdown.includes(h));
  const tooLong = g.summary.replace(/\s+/g, " ").trim().length > 1200;
  return { ok: !missing.length && !tooLong, missing, summaryChars: g.summary.replace(/\s+/g, " ").trim().length, tooLong };
}
