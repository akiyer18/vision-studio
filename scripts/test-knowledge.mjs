import { listGenres, matchGenre, getBlueprint, getPresets, validateBlueprint, getLoopPrompts, REQUIRED_SECTIONS } from "../lib/knowledge.js";
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const genres = listGenres();
assert(genres.length === 23, `expected 23 genres, got ${genres.length}`);
for (const g of genres) {
  const v = validateBlueprint(g.slug);
  assert(v.ok, `${g.slug}: missing ${v.missing.join(", ")} tooLong=${v.tooLong} (${v.summaryChars} chars)`);
  const bp = getBlueprint(g.slug);
  assert(bp && bp.summary.length <= 1200 && bp.summary.length > 300, `${g.slug}: summary ${bp && bp.summary.length} chars`);
  assert(/TrackType: SFX/.test(bp.markdown), `${g.slug}: no SFX-form sound description`);
  assert(/\d+:\d{2,3}/.test(bp.markdown), `${g.slug}: no step:velocity pattern map`);
  assert(/## Sources\n(- https?:\/\/\S+\n?){2,}/.test(bp.markdown + "\n"), `${g.slug}: fewer than 2 sources`);
  const p = getPresets(g.slug);
  assert(p && p.bass && p.drums, `${g.slug}: no preset row (${p ? JSON.stringify(p).slice(0, 80) : "null"})`);
  const lp = getLoopPrompts(g.slug);
  assert(lp && lp.loops.length === 3 && lp.texture && lp.oneshots.kick && lp.oneshots.snare, `${g.slug}: loop prompts incomplete (${lp ? lp.loops.length : "none"})`);
  assert(lp && lp.loops.every((l) => /\{bpm\}/.test(l)) && !lp.loops.some((l) => /TrackType/.test(l)), `${g.slug}: loop prompts must carry {bpm} and no TrackType tag`);
  assert(lp && /^TrackType: SFX/.test(lp.oneshots.kick) && /^TrackType: SFX/.test(lp.oneshots.snare), `${g.slug}: one-shot prompts must be SFX form`);
  assert(lp && lp.withBpm(120).loops[0].includes("120 BPM"), `${g.slug}: withBpm substitution`);
}
const aliases = {
  "can you make me a 2000s hiphop beat": "hiphop-2000s", "y2k rap": "hiphop-2000s", "g-funk": "hiphop-2000s", "a dirty south crunk anthem": "hiphop-2000s", "neptunes style": "hiphop-2000s",
  "boom bap": "boom-bap-90s", "90s hip hop": "boom-bap-90s", "lofi": "lofi-hiphop", "lo-fi hip hop": "lofi-hiphop", "chillhop beat": "lofi-hiphop",
  "trap beat 140": "trap", "uk drill": "drill", "ny drill type beat": "drill", "neo soul groove": "neo-soul", "deep house at 122": "deep-house",
  "tech house like fisher": "tech-house", "berlin techno": "techno", "2-step garage": "uk-garage", "ukg": "uk-garage", "liquid dnb": "drum-and-bass",
  "jungle": "drum-and-bass", "afrobeats": "afrobeats", "reggaeton perreo": "reggaeton", "dembow": "reggaeton", "dubstep 140": "dubstep", "synthwave outrun": "synthwave",
  "[genre: trap] something dark": "trap", "make it punchier": null, "I love this strap": null,
  "make me a rap beat": "hiphop-2000s", "an r&b slow jam": "soul-rnb", "rnb track": "soul-rnb", "a big room edm drop": "edm-bigroom-progressive", "progressive house at 128": "edm-bigroom-progressive",
  "future bass chords": "future-bass", "a pop song like dua lipa": "pop", "nu-disco groove": "funk-disco", "funk beat with slap bass": "funk-disco", "jazz hop beat": "jazz-hop", "jazzy hip hop": "jazz-hop",
  "uplifting trance 138": "trance", "ambient drone track": "ambient", "make the snare pop": null, "add more soul to the chords": null,
};
let resolved = 0;
for (const [text, want] of Object.entries(aliases)) { const got = matchGenre(text); assert(got === want, `matchGenre(${JSON.stringify(text)}) = ${got}, want ${want}`); if (want && got === want) resolved++; }
assert(resolved >= 36, `only ${resolved} aliases resolved`);
console.log(`genres: ${genres.length} · aliases resolved: ${resolved} · sections required: ${REQUIRED_SECTIONS.length} · ${fails ? fails + " FAIL" : "ALL PASS"}`);
process.exit(fails ? 1 : 0);
