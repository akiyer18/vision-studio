# Status — final day, 22 Oct 2026

AI producing assistant for Ableton Live 10 ("Claude Code for beats", team Vision Studio). Claude Opus 5.5 orchestrates
76 tools, Stable Audio 2.5 + 3 generate sound, Gemini listens and judges, the ADEHack remote script (5.8) drives Live
over TCP, and a Training mode teaches production by ear. Repo: akiyer18/vision-studio (`main`; `master` is
fast-forwarded by the user with `git push origin main:master`).

## What shipped today (22 Oct)
Each line maps to a "known problem" from yesterday's status; every item below was checked against the code at the end of the day.
1. **Enhance v2** (server): whole-mix audio-to-audio is a reference + seed only. Capture 8-16 bars from bar 1, Demucs
   stems, audio-to-audio per stem on short windows: drums -> "AI Tops" loop clip (strength 0.8), other -> "AI Texture",
   bass -> transcribed MIDI on a Live bass preset ("AI Bass"), clean hit-pipeline kit ("AI Kit"). Each layer scored
   against its original stem (order-swapped A/B via compareAuthenticity; one more take when the original wins at
   confidence >= 0.7, the better take kept); the result's `layers[]` carries score 0-10, verdict better / weaker / even,
   judge model, why and scoreNote.
2. **No stacking** (server + UI): layers created by enhance start muted except the audited one (AI Enhance soloed via
   `audition`, kits are built with fire:false and muted right away); after the build describe_set verifies it and the
   result carries `presentation: {audible, muted, verified, warning?}`; the UI shows "what you are hearing".
3. **Capture from bar 1** (ADEHack 5.8 + server): `set_position {beat}` / `jump {bar}`; `arrangement_record`,
   `session_record`, `play_for` accept `from_beat` / `from_bar`; every capture seeks to bar 1 on 5.8+, older scripts
   fall back to the playhead with a note. Agent tool `set_position {bar}` -> ctx.live.jump. Replies report the
   REQUESTED beats plus a raw `readback` (Live 10 reads current_song_time back stale while stopped).
4. **Tempo intent** (agent + ADEHack 5.8 + server): in a set with user tracks the set_tempo tool refuses without
   `confirmed:true` (`{ok:false, needsConfirmation:true, userTracks}`); the agent passes it only when the user named a
   BPM or said "slow it down / speed it up / change the tempo", otherwise it asks in one line ("Your set is at 98; <genre>
   usually sits at 128. Move it, or keep 98?") and builds at theirs. `set_tempo {bpm, warp_clips:true}` warps unwarped
   audio clips first and reports `warped` / `unwarped_left` (Live 10 exposes only Session clips to the API:
   `arrangement_scanned:false` + a note; Arrangement audio keeps its speed); older scripts are emulated with
   `set_clip_warp` per clip. Never during enhance or scan.
5. **Gemini quota** (ears): `GEMINI_API_KEYS=k2,k3` rotates keys per (key, model) on daily quota before falling to lite
   models; `GEMINI_PAID=1` disables lite fallbacks and fails loudly; `geminiStatus()` exposes active key / blocked
   pairs and rejected keys (`badKeys`); lite answers carry scoreNote "lite judge, lower confidence". `/api/health`
   exposes it as `gemini` (object) and `geminiStatus` (one line, e.g. "ok (key 1/1, flash)").
6. **Slot pool** (server): `SLOT_POOL` (default 8) slot files per role; an exhausted pool recycles the oldest slot not
   loaded in any Live track; only when every slot is in use does it error ("all N <role> sound slots are loaded by
   tracks in this set; remove_layer ... or replace_sound ...").
7. **UI**: per-layer Play / Keep / Another / Undo on layer cards, busy-aware; audible/muted state per layer; lite-judge
   badge wherever a score is shown; Projector mode toggle (localStorage, P key); "Training" link. Play / Keep /
   Another / Undo and "Listen to Live" send canned chat sentences; Show in Live, Lay out and Work on my Live project
   call /api/live/show, /api/live/arrange and /api/project/scan directly. Light-theme redesign with a first-run empty
   state, Options disclosure and collapsed tool rows (3805d08); 44 headless-Chrome checks green.
8. **Docs**: DEMO.md (3-minute final pitch), README.md, this file, CONTRACT.md 5.8 appendix.
9. **Creator in control + genre history** (agent): every layer build ends with quoted keep / another take / undo
   chips; first mention of a genre gets two sentences of history and three references from the blueprint
   (`lib/knowledge.getIntro` pulls the "Era & tempo" and "References" sections, each capped at 320 chars, into one
   "History: ... Listen to: ..." line (the references are flagged as names to double-check); blueprints lacking both get no intro).
10. **Training mode** (`lib/training.js`, `public/training.html`): `POST /api/training/start {level, genre?}` ->
    Stable Audio 3 example (beginner 4 bars drums; intermediate 8 bars drums + bass; advanced + chords/texture) with
    level-dependent hints; `/check {id}` captures the user's bars from bar 1 and compares (A/B authenticity + pattern
    and bass match) -> score, closest, off, nextHint; `/reveal {id}` builds the target's parts on muted "Target *"
    tracks with a plain-language "how this was built". Routes: POST /api/training/start|check|reveal, GET
    /api/training/levels, /api/training/:id (publicView: paths and stems never, pattern / bass notes / key / prompt
    only once revealed or as the level allows), /api/training/:id/progress, static /training-audio. Mounted from
    server.js via `mountTraining(app, { makeCtx, tmpDir })`.
11. **Preflight + key check** (`scripts/live-check.mjs`, `scripts/check-keys.mjs`): go/no-go for the demo (health,
    every key called for real, script 5.8, jump read-back, warp-clips at the current tempo, describe_set, Place + slot
    files indexed, 2-bar play from bar 1 with meters, Python toolbelt); PASS / WARN / FAIL with the fix, exit 1 on FAIL.
    `scripts/test-knowledge.mjs` and `scripts/test-agent.mjs` green again (76 tools).
12. **Review fixes** (c66e1fc, from the read-only review of the day's commits): reveal accepts temp-dir sources
    (Target Keys / Target Mix now land), kits are built silent (fire:false + mute) so nothing stacks during enhance and
    reveal, the enhance layer score contract matches the UI (score 0-10 / verdict / judge / why), a rejected Gemini key
    is skipped on every model and no longer disables the lite fallback, captureLive seeks even when the version
    handshake times out, set_tempo rejects a missing bpm, preset names lose their parenthetical, training hides the
    answer until reveal and flags playhead captures. UI follow-ups from the browser review (layer row wrapping on
    phones, Reset clearing layer memory, enhance stages not flipping the tool row green, liveTracks mute state after
    reload) are in the UI fork.

## How to run
```bash
cd ~/ade-hack && npm install && cp .env.example .env   # fill STABILITY_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY (+ GEMINI_API_KEYS, GEMINI_PAID, HF_TOKEN, SLOT_POOL)
bash ableton/install.sh      # ADEHack 5.8 into the Live 10 bundle; fully relaunch Live; Preferences > Link/MIDI > Control Surface = ADEHack
bash tools/py/setup.sh       # optional toolbelt (Demucs, basic-pitch, librosa, pedalboard) - needed for stems / Training reveal
npm start                    # http://localhost:3000 (studio), /training.html (Training mode); GET /api/health
node scripts/live-check.mjs  # go/no-go preflight once Live is relaunched (add --no-play when the PA is live, --no-warp to leave clips alone)
node scripts/check-keys.mjs  # every API key, one real call each
node tests/smoke.mjs         # offline regression suite (must be green before every commit)
```
Live needs the **ADE Hack** Place (`~/Music/Ableton/User Library/ADE Hack`) added once, and the terminal running the
server needs macOS System Audio Recording permission (AudioTee capture of Live). Never run test chat turns against the
server while someone is using the UI (it resets their history).

## Known limitations (say them out loud)
- Gemini flash models have daily quotas; with every key exhausted the judge is a lite model and is labelled as such.
  Music Flamingo (ZeroGPU) is optional and usually out of quota.
- Live 10 API: no group / return track creation, no sidechain routing, samples cached by filename (hence the slot pool),
  no `add_new_notes` (Live 11), no `Track.arrangement_clips` (Live 11: `set_tempo warp_clips` warps Session clips only),
  and `current_song_time` reads back stale after a seek while stopped (replies use the requested beats). Remote scripts
  load only at Live startup: every reinstall needs a full relaunch.
- Whole-mix audio-to-audio smears at medium strength; per-stem is better but still a reference. `compose_track` takes
  5-7 minutes on this Intel i5 / 8 GB Mac (Demucs + Stable Audio 3).
- Enhance v2 and Training mode were verified offline (smoke suite, unit tests) and in one live session each at most;
  the real-producer A/B listening session (STATUS item 7 yesterday) is still the open quality measure.
- `master` on GitHub trails `main` until the user fast-forwards it.

## Handoff (after the hackathon)
- Start at `lib/agent.js` (system prompt = the product's behaviour) and `server.js makeCtx` (every tool's implementation).
  Protocol with Live: `ableton/README.md` + CONTRACT.md. Knowledge: `knowledge/genres/*.md` (add a blueprint = add a file).
- Quality levers in order: a paid Gemini tier (stable judge), per-stem enhance windows and strengths, Live 11+ (AbletonOSC,
  `add_new_notes`, group tracks, sidechain), a commercially licensed listener instead of Flamingo, permissive replacements
  for the GPL toolbelt pieces (pedalboard, rubberband, GPL ffmpeg build) if this becomes a product.
- Ideas not built: musician-level selection per user, Logic Pro integration (the team's product doc targets Logic;
  explanations already cover both DAWs), Soundcharts real catalogue for `reference_track` (needs paid credentials).
