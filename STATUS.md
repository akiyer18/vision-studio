# Status — final day, 22 Oct 2026

AI producing assistant for Ableton Live 10 ("Claude Code for beats", team Vision Studio). Claude Opus 5.5 orchestrates
75 tools, Stable Audio 2.5 + 3 generate sound, Gemini listens and judges, the ADEHack remote script (5.8) drives Live
over TCP, and a Training mode teaches production by ear. Repo: akiyer18/vision-studio (`main`; `master` is
fast-forwarded by the user with `git push origin main:master`).

## What shipped today (22 Oct)
Each line maps to a "known problem" from yesterday's status; "(verify)" = confirm against the final code before the pitch.
1. **Enhance v2** (server): whole-mix audio-to-audio is a reference + seed only. Capture 8-16 bars from bar 1, Demucs
   stems, audio-to-audio per stem on short windows: drums -> "AI Tops" loop clip (strength 0.8), other -> "AI Texture",
   bass -> transcribed MIDI on a Live bass preset ("AI Bass"), clean hit-pipeline kit ("AI Kit"). Each layer scored
   against the original (pairwise A/B, retry once on a clear loss), scores + scoreNote returned. (verify: layer names, retry)
2. **No stacking** (server + UI): layers created by enhance start muted except the audited one (AI Enhance soloed via
   `audition`); the result carries `presentation: {audible, muted}` and the UI shows "what you are hearing". (verify)
3. **Capture from bar 1** (ADEHack 5.8 + server): `set_position {beat}` / `jump {bar}`; `arrangement_record`,
   `session_record`, `play_for` accept `from_beat` / `from_bar`; every capture seeks to bar 1 on 5.8+, older scripts
   fall back to the playhead with a note. Agent tool `set_position {bar}`. (verify: tool present)
4. **Tempo intent** (agent + ADEHack 5.8 + server): the agent asks before moving the tempo of a set with user tracks;
   `set_tempo {bpm, warp_clips:true}` warps unwarped audio clips first and reports `warped` / `unwarped_left`; older
   scripts are emulated with `set_clip_warp` per clip. Never during enhance or scan. (verify: question wording)
5. **Gemini quota** (ears): `GEMINI_API_KEYS=k2,k3` rotates keys per (key, model) on daily quota before falling to lite
   models; `GEMINI_PAID=1` disables lite fallbacks and fails loudly; `geminiStatus()` exposes active key / blocked
   pairs; lite answers carry scoreNote "lite judge, lower confidence". (verify: env names, status export wired to /api/health)
6. **Slot pool** (server): `SLOT_POOL` (default 8) slot files per role; an exhausted pool recycles the oldest slot not
   loaded in any Live track; only when every slot is in use does it error, telling the agent to remove or replace a layer. (verify)
7. **UI**: per-layer Play / Keep / Another / Undo on layer cards, busy-aware; audible/muted state per layer; lite-judge
   badge wherever a score is shown; Projector mode toggle (localStorage); "Training" link. (verify: button wiring)
8. **Docs**: DEMO.md (3-minute final pitch), README.md, this file, CONTRACT.md 5.8 appendix.
9. **Creator in control + genre history** (agent): every layer build ends with quoted keep / another take / undo
   chips; first mention of a genre gets two sentences of history and three references from the blueprint
   (`lib/knowledge` pulls "history" / "artists" sections; blueprints lacking them fall back silently). (verify)
10. **Training mode** (`lib/training.js`, `public/training.html`): `POST /api/training/start {level, genre?}` ->
    Stable Audio 3 example (beginner 4 bars drums; intermediate 8 bars drums + bass; advanced + chords/texture) with
    level-dependent hints; `/check {id}` captures the user's bars from bar 1 and compares (A/B authenticity + pattern
    and bass match) -> score, closest, off, nextHint; `/reveal {id}` builds the target's parts on muted "Target *"
    tracks with a plain-language "how this was built". Mounted from server.js via `mountTraining(app, deps)`. (verify: routes, mount)

## How to run
```bash
cd ~/ade-hack && npm install && cp .env.example .env   # fill STABILITY_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY (+ GEMINI_API_KEYS, GEMINI_PAID, HF_TOKEN, SLOT_POOL)
bash ableton/install.sh      # ADEHack 5.8 into the Live 10 bundle; fully relaunch Live; Preferences > Link/MIDI > Control Surface = ADEHack
bash tools/py/setup.sh       # optional toolbelt (Demucs, basic-pitch, librosa, pedalboard) - needed for stems / Training reveal
npm start                    # http://localhost:3000 (studio), /training.html (Training mode); GET /api/health
node tests/smoke.mjs         # offline regression suite (must be green before every commit)
```
Live needs the **ADE Hack** Place (`~/Music/Ableton/User Library/ADE Hack`) added once, and the terminal running the
server needs macOS System Audio Recording permission (AudioTee capture of Live). Never run test chat turns against the
server while someone is using the UI (it resets their history).

## Known limitations (say them out loud)
- Gemini flash models have daily quotas; with every key exhausted the judge is a lite model and is labelled as such.
  Music Flamingo (ZeroGPU) is optional and usually out of quota.
- Live 10 API: no group / return track creation, no sidechain routing, samples cached by filename (hence the slot pool),
  no `add_new_notes` (Live 11). Remote scripts load only at Live startup: every reinstall needs a full relaunch.
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
