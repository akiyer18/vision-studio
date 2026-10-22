# tools/capture — hear what Ableton Live actually outputs

Wraps **AudioTee** (https://github.com/makeusabrew/audiotee, MIT License, Copyright (c) 2025 Nick Payne), vendored at commit
`56ac954369a09318e46b88a6eec33c2d2b0d32a3` in `audiotee/` (272 KB of Swift; the `.build/` output is git-ignored).
AudioTee records a macOS **process tap** (Core Audio, macOS 14.2+): we tap only the Ableton Live process, so the agent hears the
producer's real mix — their tracks, devices and mixer — with no routing changes and nothing else on the system.

Build: `bash tools/capture/build.sh` (Swift 6.2 via Xcode on this machine; ~20 s). Binary: `audiotee/.build/release/audiotee` (~300 KB).

Node API (`lib/capture.js`): `captureAvailable()`, `findLivePid()`, `captureLive({ seconds, pid?, outPath, allowSystemFallback=true })`
→ `{ path, seconds, pid, scope: 'process'|'system', peakDbfs, silent, bytes, format }`.

Observed on this Mac (2026-10-21): with `--sample-rate 44100 --stereo` AudioTee emits `pcm_s16le` 44.1 kHz stereo (metadata JSON on stderr,
`stream_start`/`stream_stop` events). A process that is not producing audio yields no bytes (Core Audio only starts the tap device once the
process outputs), so the server starts Live's transport before capturing; if the per-process tap stays empty the capture falls back to the
system-wide tap (everything the user hears, which includes Live).

Permissions: macOS asks once for **System Audio Recording** for the app that hosts the node process (Terminal, VS Code, Claude...).
If a capture produces no stream within 10 s: System Settings › Privacy & Security › Screen & System Audio Recording › enable that app, then retry.

MIT License text: see https://github.com/makeusabrew/audiotee/blob/main/README.md#license (reproduced in audiotee/README.md).
