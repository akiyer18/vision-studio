// Offline checks for lib/ears.js: key rotation bookkeeping, tier handling, status shape, scoreNote. No network.
process.env.GEMINI_API_KEY = "key-one";
process.env.GEMINI_API_KEYS = "key-two, key-one ,key-three";   // duplicate + spaces on purpose
delete process.env.GEMINI_PAID; delete process.env.GEMINI_TIER;
const ears = await import("../lib/ears.js");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("FAIL:", m); } };

ok(ears.geminiKeys().length === 3 && ears.geminiKeys()[0] === "key-one", "keys: GEMINI_API_KEY first, deduped, trimmed");
ok(ears.geminiAvailable() === true, "available with keys");
ok(ears.geminiTier() === "free", "default tier free");
let s = ears.geminiStatus();
ok(s.keysTotal === 3 && s.activeKeyIndex === 0 && s.flashAvailable === true && Array.isArray(s.blocked) && s.blocked.length === 0 && s.tier === "free", "status shape " + JSON.stringify(s));
ok(/^ok \(key 1\/3, flash\)$/.test(ears.geminiStatusText()), "status text ok: " + ears.geminiStatusText());

// block the flash judge models on every key -> flashAvailable false, lite-only text
const judge = (process.env.GEMINI_JUDGE_MODELS || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash").split(",").slice(0, 3);
for (const m of judge) for (let k = 0; k < 3; k++) ears._markQuota(k, m);
s = ears.geminiStatus();
ok(s.flashAvailable === false && s.blocked.length === judge.length * 3 && s.blocked.every((b) => typeof b.key === "number" && b.model && b.until), "all keys blocked -> flashAvailable false, blocked listed");
ok(/lite judges only, lower confidence/.test(ears.geminiStatusText()), "status text lite-only: " + ears.geminiStatusText());
// free one key on one flash model -> flash available again
ears._markQuota(1, judge[0], -1);
ok(ears.geminiStatus().flashAvailable === true, "one unblocked (key, model) pair restores flashAvailable");
ears._markQuota();   // clear
ok(ears.geminiStatus().blocked.length === 0, "clear");

// paid tier
process.env.GEMINI_PAID = "1";
ok(ears.geminiTier() === "paid" && ears.geminiStatus().tier === "paid", "GEMINI_PAID=1 -> paid");
ok(/paid/.test(ears.geminiStatusText()), "status text mentions paid");
delete process.env.GEMINI_PAID; process.env.GEMINI_TIER = "paid";
ok(ears.geminiTier() === "paid", "GEMINI_TIER=paid -> paid");
delete process.env.GEMINI_TIER;

// scoreNote
ok(ears.LITE_SCORE_NOTE === "lite judge, lower confidence", "LITE_SCORE_NOTE string");
ok(ears.scoreNoteFor(true) === ears.LITE_SCORE_NOTE && ears.scoreNoteFor(false) === undefined, "scoreNoteFor");

// no keys at all
delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS;
ok(ears.geminiAvailable() === false && ears.geminiStatus().keysTotal === 0 && ears.geminiStatus().activeKeyIndex === null && ears.geminiStatusText() === "no GEMINI_API_KEY", "no keys");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
