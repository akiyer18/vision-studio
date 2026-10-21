#!/usr/bin/env bash
# Installs the ADEHack MIDI Remote Script into Ableton Live 10.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/ADEHack"
APP_DIR="/Applications/Ableton Live 10 Standard.app/Contents/App-Resources/MIDI Remote Scripts"
USER_DIR="$HOME/Music/Ableton/User Library/Remote Scripts"

if [ -d "$APP_DIR" ]; then
  DEST="$APP_DIR/ADEHack"
else
  echo "App path not found ($APP_DIR); falling back to User Library Remote Scripts."
  DEST="$USER_DIR/ADEHack"
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC"/*.py "$DEST"/
find "$DEST" -name '*.pyc' -delete
echo "Installed to: $DEST"
ls -1 "$DEST"

cat <<NEXT

Next steps:
  1. Restart Ableton Live 10 (fully quit it first).
  2. Preferences > Link/MIDI > Control Surface dropdown > pick "ADEHack" (Input/Output: None).
  3. Test: node ableton/client.js ping   (or: printf '{"cmd":"ping"}\n' | nc 127.0.0.1 9004)
  Log: $(ls -d "$HOME"/Library/Preferences/Ableton/Live\ 10*/Log.txt 2>/dev/null || echo "$HOME/Library/Preferences/Ableton/Live 10.x.x/Log.txt")
       grep ADEHack in it (Remote Script errors also land there).
NEXT
