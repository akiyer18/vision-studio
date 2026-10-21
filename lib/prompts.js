// Stable Audio prompt composition: one place that knows the TrackType grammar, the genre tag, BPM filling and negative space.
// See docs/stable-audio-prompt-guide.md. Pure functions, no I/O.

const TRACK_TYPE = { drums: "Instrument", texture: "Instrument", oneshot: "SFX", track: "Music" };
const NEGATIVE = {
  drums: ["no melody", "no vocals", "no bass"],
  texture: ["no drums", "no vocals"],
  oneshot: ["single hit", "dry", "no reverb tail", "no music"],
  track: ["cohesive full mix"],
};
const PRODUCTION_WORDS = /dry|wet|room|tape|vinyl|saturat|reverb|lo-fi|clean/i;

/** Remove a leading "TrackType: X," / "Genre: Y," / "Format: Z," that a user (or a blueprint bullet) may have pasted. */
export function stripTrackType(body) {
  return String(body || "").replace(/^\s*(?:(?:TrackType|Genre|Format)\s*:\s*[^,]+,\s*)+/i, "").trim();
}

const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/^[,\s]+|[,\s.]+$/g, "").trim();
const hasPhrase = (hay, phrase) => new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(hay);

/**
 * composePrompt({ kind, slug, bpm, body, title, production, era }) -> one Stable Audio prompt string.
 * kind: drums | texture | oneshot | track. body may contain {bpm}. production/era come from getLoopPrompts(slug).
 */
export function composePrompt({ kind = "drums", slug, bpm, body = "", title, production, era } = {}) {
  const k = TRACK_TYPE[kind] ? kind : "drums";
  const parts = [`TrackType: ${TRACK_TYPE[k]}`];
  if (title) parts.push(`Genre: ${clean(title)}`);
  let b = stripTrackType(body);
  const bpmN = Number(bpm);
  if (Number.isFinite(bpmN) && bpmN > 0) b = b.replace(/\{bpm\}/g, String(Math.round(bpmN)));
  else b = b.replace(/,?\s*\{bpm\}\s*bpm/gi, "").replace(/\{bpm\}/g, "");
  b = clean(b);
  if (b) parts.push(b);
  if (Number.isFinite(bpmN) && bpmN > 0 && k !== "oneshot" && !/\bbpm\b/i.test(b)) parts.push(`${Math.round(bpmN)} BPM`);
  if (era) { const e = clean(era); if (e && !hasPhrase(b, e)) parts.push(e); }
  if (production && !PRODUCTION_WORDS.test(b)) { const p = clean(production); if (p) parts.push(p); }
  for (const w of NEGATIVE[k]) { if (!hasPhrase(parts.join(", "), w)) parts.push(w); }
  return parts.join(", ");
}

export default { composePrompt, stripTrackType };
