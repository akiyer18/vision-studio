import { listGenres, matchGenre, getBlueprint, getPresets, validateBlueprint, REQUIRED_SECTIONS } from "../lib/knowledge.js";
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const genres = listGenres();
assert(genres.length === 15, `expected 15 genres, got ${genres.length}`);
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
}
const aliases = {
  "can you make me a 2000s hiphop beat": "hiphop-2000s", "y2k rap": "hiphop-2000s", "g-funk": "hiphop-2000s", "a dirty south crunk anthem": "hiphop-2000s", "neptunes style": "hiphop-2000s",
  "boom bap": "boom-bap-90s", "90s hip hop": "boom-bap-90s", "lofi": "lofi-hiphop", "lo-fi hip hop": "lofi-hiphop", "chillhop beat": "lofi-hiphop",
  "trap beat 140": "trap", "uk drill": "drill", "ny drill type beat": "drill", "neo soul groove": "neo-soul", "deep house at 122": "deep-house",
  "tech house like fisher": "tech-house", "berlin techno": "techno", "2-step garage": "uk-garage", "ukg": "uk-garage", "liquid dnb": "drum-and-bass",
  "jungle": "drum-and-bass", "afrobeats": "afrobeats", "reggaeton perreo": "reggaeton", "dembow": "reggaeton", "dubstep 140": "dubstep", "synthwave outrun": "synthwave",
  "[genre: trap] something dark": "trap", "make it punchier": null, "I love this strap": null,
};
let resolved = 0;
for (const [text, want] of Object.entries(aliases)) { const got = matchGenre(text); assert(got === want, `matchGenre(${JSON.stringify(text)}) = ${got}, want ${want}`); if (want && got === want) resolved++; }
assert(resolved >= 20, `only ${resolved} aliases resolved`);
console.log(`genres: ${genres.length} · aliases resolved: ${resolved} · sections required: ${REQUIRED_SECTIONS.length} · ${fails ? fails + " FAIL" : "ALL PASS"}`);
process.exit(fails ? 1 : 0);
