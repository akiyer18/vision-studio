#!/usr/bin/env bash
# Builds AudioTee (MIT, https://github.com/makeusabrew/audiotee) — a Core Audio process-tap recorder — so the producer agent can hear Ableton Live's actual output.
# Needs macOS 14.2+ and a Swift 5.9+ toolchain (Xcode or Command Line Tools). Vendored source lives in tools/capture/audiotee (pinned commit in README.md).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/audiotee"
if [ ! -f "$SRC/Package.swift" ]; then
  echo "[capture] fetching AudioTee source (pinned 56ac954)..."
  git clone -q https://github.com/makeusabrew/audiotee "$SRC"
  (cd "$SRC" && git checkout -q 56ac954369a09318e46b88a6eec33c2d2b0d32a3 && rm -rf .git)
fi
echo "[capture] swift build -c release (first build ~20-60 s)..."
(cd "$SRC" && swift build -c release 2>&1 | tail -2)
BIN="$SRC/.build/release/audiotee"
[ -x "$BIN" ] || { echo "[capture] ERROR: build did not produce $BIN"; exit 1; }
echo "[capture] built: $BIN ($(stat -f %z "$BIN") bytes)"
echo "[capture] first use triggers macOS 'System Audio Recording' permission for the app hosting node (Terminal/VS Code/Claude): allow it, then retry."
