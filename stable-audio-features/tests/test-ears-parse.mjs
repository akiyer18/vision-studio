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

// E5: account-level bad keys are dropped from the rotation and shown in the status
ears._markQuota();
ears._markBadKey(1);
s = ears.geminiStatus();
ok(s.badKeys.length === 1 && s.badKeys[0] === 1 && s.flashAvailable === true, "one bad key listed, flash still available: " + JSON.stringify(s));
ok(/key 2 rejected/.test(ears.geminiStatusText()), "status text names the rejected key: " + ears.geminiStatusText());
ears._markBadKey(0); ears._markBadKey(2);
ok(ears.geminiStatus().flashAvailable === false && /every Gemini key was rejected/.test(ears.geminiStatusText()), "all keys bad -> no flash, clear status text: " + ears.geminiStatusText());
ears._markQuota();
ok(ears.geminiStatus().badKeys.length === 0, "clear() also clears bad keys");

// E4 + E5 through the cascade with a stubbed HTTP call: key 1 out of daily quota, key 2 revoked, key 3 fine -> flash answers on key 3
const seen = [];
ears._setRequestImpl(async (model, parts, { keyIdx }) => {
  seen.push(`${model}#${keyIdx}`);
  if (keyIdx === 0) throw new Error("429 quota exceeded for this model per day (billing plan)");
  if (keyIdx === 1) throw new Error("400 API key not valid. Please pass a valid API key.");
  return { text: "ok", ms: 1, provider: "gemini", model, lite: /lite/i.test(model), keyIndex: keyIdx };
});
let r = await ears._textGemini("ONLY JSON please", { judge: true });
ok(r.keyIndex === 2 && r.lite === false, "rotation: flash answered on key 3: " + JSON.stringify({ keyIndex: r.keyIndex, model: r.model, seen }));
ok(ears.geminiStatus().badKeys.includes(1), "revoked key 2 marked bad after the 400");
const seenBefore = seen.length;
r = await ears._textGemini("ONLY JSON please", { judge: true });
ok(!seen.slice(seenBefore).some((x) => x.endsWith("#1")), "bad key never retried on any model: " + seen.slice(seenBefore).join(","));
// E4: good key out of quota on every flash model + one revoked key -> lite fallback still happens (not accountOnly)
ears._markQuota();
ears._setRequestImpl(async (model, parts, { keyIdx }) => {
  seen.push(`${model}#${keyIdx}`);
  if (/lite/i.test(model)) return { text: "lite ok", ms: 1, provider: "gemini", model, lite: true, keyIndex: keyIdx };
  if (keyIdx === 1) throw new Error("403 PERMISSION_DENIED: API key not valid");
  throw new Error("429 quota exceeded per day for this billing plan");
});
r = await ears._textGemini("ONLY JSON please", { judge: true });
ok(r.lite === true && /lite/i.test(r.model), "quota on the good keys + one revoked key -> degrades to a lite judge: " + JSON.stringify({ model: r.model, lite: r.lite }));
// E4: EVERY key revoked -> accountOnly: throws instead of a lite judge
ears._markQuota();
ears._setRequestImpl(async (model, parts, { keyIdx }) => { throw new Error("403 PERMISSION_DENIED: API key not valid"); });
let threw = null;
try { await ears._textGemini("ONLY JSON please", { judge: true }); } catch (e) { threw = e; }
ok(threw && threw.accountOnly === true && /API key/.test(threw.message), "all keys revoked -> accountOnly error, no lite call: " + (threw && threw.message.slice(0, 80)));
ears._setRequestImpl(null); ears._markQuota();

// no keys at all
delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS;
ok(ears.geminiAvailable() === false && ears.geminiStatus().keysTotal === 0 && ears.geminiStatus().activeKeyIndex === null && ears.geminiStatusText() === "no GEMINI_API_KEY", "no keys");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
