// Offline tests for Training mode: pure scoring/hint logic + the router mounts on a fake app. `node tests/test-training.mjs`
let fails = 0, passes = 0;
const ok = (cond, msg, extra = '') => { if (cond) passes++; else { fails++; console.log('FAIL', msg, extra); } };

const T = await import('../lib/training.js');
const { comparePatterns, describePattern, compareBass, scoreAttempt, feedbackFor, startHints, pickKey, targetPromptBody, levelSpec, mountTraining } = T;

// ---- levels
ok(levelSpec('ADVANCED').bars === 8 && levelSpec('advanced').layers.includes('keys'), 'levelSpec advanced');
ok(levelSpec('nope').level === 'beginner', 'levelSpec falls back to beginner');

// ---- patterns
const lane = (instrument, steps) => ({ instrument, steps: steps.map((step) => ({ step, velocity: 100 })) });
const house = { bars: 1, lanes: [lane('kick', [0, 4, 8, 12]), lane('clap', [4, 12]), lane('hat_closed', [2, 6, 10, 14])] };
const same = comparePatterns(house, house, 1);
ok(same.overall === 1, 'identical patterns score 1', JSON.stringify(same));
const noHats = { bars: 1, lanes: [lane('kick', [0, 4, 8, 12]), lane('snare', [4, 12])] };
const r2 = comparePatterns(house, noHats, 1);
ok(r2.groups.kick.f1 === 1 && r2.groups.backbeat.f1 === 1 && r2.groups.hats.f1 === 0, 'snare counts as backbeat, missing hats = 0', JSON.stringify(r2.groups));
ok(r2.overall === 0.8, 'weighted overall without hats', String(r2.overall));
const late = { bars: 1, lanes: [lane('kick', [1, 5, 9, 13])] };
ok(comparePatterns({ bars: 1, lanes: [lane('kick', [0, 4, 8, 12])] }, late, 1).groups.kick.f1 === 1, '±1 step tolerance');
const empty = comparePatterns({ bars: 1, lanes: [] }, house, 1);
ok(empty.overall === 0 && !empty.groups.kick?.targetHits, 'empty target scores 0 without crashing');
ok(describePattern(house) === 'kick: four on the floor · snare/clap: 2, 4 · hats/perc: offbeat 8ths', 'describePattern words', describePattern(house));
ok(/1, 2&/.test(describePattern({ bars: 1, lanes: [lane('kick', [0, 6])] })), 'describePattern labels e/&/a', describePattern({ bars: 1, lanes: [lane('kick', [0, 6])] }));

// ---- bass
const n = (pitch, startBeats, durationBeats = 1) => ({ pitch, startBeats, durationBeats, velocity: 100 });
const tb = [n(41, 0, 2), n(41, 2, 2), n(44, 4, 2), n(41, 6, 2)];   // F F G# F
const b1 = compareBass(tb, tb, 2);
ok(b1.measured && b1.agreement === 1 && b1.rootMatch && b1.targetRoot === 'F', 'identical bass agrees 100%', JSON.stringify(b1));
const b2 = compareBass(tb, [n(53, 0, 8)], 2);   // F an octave up, sustained
ok(b2.agreement === 0.75 && b2.rootMatch, 'octave-insensitive, per-beat agreement', JSON.stringify(b2));
ok(compareBass([], tb, 2).measured === false, 'no target bass -> not measured');

// ---- scoring + feedback
const perfect = scoreAttempt({ level: 'beginner', tempoDiff: 0, pattern: same, bass: null });
ok(perfect === 100, 'perfect beginner = 100', String(perfect));
const meh = scoreAttempt({ level: 'intermediate', tempoDiff: 8, pattern: r2, bass: b2 });
ok(meh > 50 && meh < 90, 'intermediate mixed score in range', String(meh));
const fb = feedbackFor({ level: 'beginner', target: { bpm: 124, pattern: house }, tempoDiff: 8, attemptBpm: 132, pattern: r2, bass: null });
ok(fb.off.some((x) => /too fast/.test(x)) && /124 BPM/.test(fb.nextHint), 'beginner gets the exact tempo hint', JSON.stringify(fb));
ok(fb.off.some((x) => /hats\/perc: missing/.test(x)), 'missing hats reported', JSON.stringify(fb.off));
const fbAdv = feedbackFor({ level: 'advanced', target: { bpm: 124, pattern: house }, tempoDiff: 8, attemptBpm: 116, pattern: r2, bass: b2 });
ok(!/124/.test(fbAdv.nextHint) && /slower|faster/.test(fbAdv.nextHint), 'advanced only gets a nudge', fbAdv.nextHint);
const fbDone = feedbackFor({ level: 'beginner', target: { bpm: 124, pattern: house }, tempoDiff: 0, attemptBpm: 124, pattern: same });
ok(/Reveal/.test(fbDone.nextHint) && fbDone.off.length === 0, 'perfect attempt points to Reveal');

// ---- hints + prompts
ok(startHints({ level: 'beginner', title: 'Deep House', bpm: 122, bars: 4, layers: ['drums'], patternWords: 'kick: four on the floor' }).some((h) => /Pattern/.test(h)), 'beginner hint has the pattern');
ok(startHints({ level: 'advanced', title: 'Deep House', bpm: 122, key: 'F minor', bars: 8, layers: ['drums', 'bass', 'keys'] }).every((h) => !/BPM|Key/.test(h)), 'advanced hints hide bpm/key');
ok(pickKey('## Harmony & keys\n- usually in A minor or F minor') === 'A minor', 'pickKey reads the blueprint');
ok(/minor|major/.test(pickKey('', 3)), 'pickKey falls back');
const lp = { loops: ['deep house drum loop at {bpm} BPM, kick, clap, no melody'], track: 'deep house groove at {bpm} BPM, no vocals' };
ok(targetPromptBody({ level: 'beginner', loopPrompts: lp, bpm: 122 }).kind === 'drums', 'beginner = drums prompt');
const inter = targetPromptBody({ level: 'intermediate', loopPrompts: lp, key: 'F minor', bpm: 122 });
ok(inter.kind === 'track' && /bass line in F minor/.test(inter.body) && !/no melody/.test(inter.body), 'intermediate adds bass, drops no-melody', inter.body);
ok(/chord/.test(targetPromptBody({ level: 'advanced', loopPrompts: lp, key: 'F minor', bpm: 122 }).body), 'advanced adds chords');

// ---- router mounts on a fake app with the documented deps
const routes = [];
const fakeApp = { use: (p) => routes.push(`use ${typeof p === 'string' ? p : '/'}`), get: (p) => routes.push(`get ${p}`), post: (p) => routes.push(`post ${p}`) };
mountTraining(fakeApp, { makeCtx: () => ({}) });
for (const r of ['use /training-audio', 'get /api/training/levels', 'post /api/training/start', 'post /api/training/check', 'post /api/training/reveal', 'get /api/training/:id/progress']) ok(routes.includes(r), `route ${r}`, routes.join(', '));
let threw = false; try { mountTraining(fakeApp, {}); } catch { threw = true; } ok(threw, 'mount without makeCtx throws');

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
