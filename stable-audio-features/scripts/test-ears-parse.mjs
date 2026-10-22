// Offline tests for lib/ears.js parsing helpers (no network).
import assert from "node:assert/strict";
import { parseMatch, normalizeCritique, CRITIQUE_PROMPT } from "../lib/ears.js";

// parseMatch
assert.equal(parseMatch("**MATCH:** 7/10"), 7);
assert.equal(parseMatch("Match: 3 / 10"), 3);
assert.equal(parseMatch("fits well.\nMATCH: 8/10"), 8);
assert.equal(parseMatch("I would rate it 6 out of 10"), 6);
assert.equal(parseMatch("no number here"), null);
assert.equal(parseMatch(""), null);
assert.equal(parseMatch("MATCH: 11/10"), null);

// normalizeCritique: full object passes through
const full = normalizeCritique({
  styleRead: "mid-2000s Dirty South", styleAccuracy: { target: "2000s hip hop", verdict: "Close", why: "snare too clean" },
  drums: "808 kick, clap", bass: { present: false, type: "none", suggestion: "808 glide bass following the kick" },
  harmonyMelody: "piano stabs", soundDesign: "no snaps", groove: "straight", arrangement: "one loop",
  moves: ["add snaps on 2 and 4", "808 bass", "shaker 16ths", "vinyl layer", "open hat", "extra move"], mixNotes: "", provider: "gemini:x", ms: 12,
});
assert.equal(full.styleAccuracy.verdict, "close");
assert.equal(full.bass.present, false);
assert.equal(full.moves.length, 5, "moves capped at 5");
assert.equal(full.provider, "gemini:x");
assert.equal(full.ms, 12);

// normalizeCritique: missing / malformed fields never crash
const sparse = normalizeCritique({ styleRead: 42, bass: "808", moves: "not an array", styleAccuracy: { verdict: "meh" } });
assert.equal(sparse.styleRead, "42");
assert.equal(sparse.bass.present, null);
assert.equal(sparse.bass.type, null);
assert.deepEqual(sparse.moves, []);
assert.equal(sparse.styleAccuracy.verdict, null);
assert.equal(sparse.mixNotes, null);
assert.deepEqual(Object.keys(normalizeCritique(null)).sort(), ["arrangement", "bass", "drums", "groove", "harmonyMelody", "mixNotes", "moves", "soundDesign", "styleAccuracy", "styleRead"]);
const withDetail = normalizeCritique({ mixDetail: { lowEnd: "ok" }, vsReference: { closer: ["x"] } });
assert.equal(withDetail.mixDetail.lowEnd, "ok");
assert.deepEqual(withDetail.vsReference.closer, ["x"]);

// prompt variants
const p1 = CRITIQUE_PROMPT({ genreTarget: "Era: early 2000s..." });
assert.ok(p1.includes("judge style accuracy against it") && p1.includes("Era: early 2000s"));
assert.ok(p1.includes("mixNotes stays empty") && !p1.includes('"mixDetail"'));
const p2 = CRITIQUE_PROMPT({ mixDetail: true });
assert.ok(p2.includes('"mixDetail"') && p2.includes("except inside the mixDetail field"));
assert.ok(p2.includes("No target style was given"));
console.log("ears parse tests: parseMatch 7 cases · normalizeCritique 4 fixtures · prompt variants 2 · ALL PASS");
