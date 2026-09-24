#!/bin/bash
# Build a locally signed native launcher without changing the installed app.
set -euo pipefail
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo 'usage: build-macos-launcher.sh OUTPUT.app [ICON.icns]' >&2
  exit 2
fi
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUTPUT="$1"
ICON="${2:-$ROOT/resources/DSH.icns}"
if [ -e "$OUTPUT" ]; then
  echo 'Output already exists; choose a fresh staging path.' >&2
  exit 1
fi
[ -f "$ICON" ]
mkdir -p "$OUTPUT/Contents/MacOS" "$OUTPUT/Contents/Resources"
cp "$ROOT/macos/Info.plist" "$OUTPUT/Contents/Info.plist"
cp "$ICON" "$OUTPUT/Contents/Resources/DSH.icns"
cp "$ROOT/scripts/launch-dsh.sh" "$OUTPUT/Contents/Resources/launch-dsh.sh"
xcrun swiftc -swift-version 5 -O -target arm64-apple-macos12.0 \
  -module-cache-path "${TMPDIR:-/tmp}/dsh-swift-module-cache" \
  "$ROOT"/macos/*.swift -o "$OUTPUT/Contents/MacOS/DSH"
/usr/bin/codesign --force --sign - --identifier ai.deepseek.dsh.launcher "$OUTPUT"
/usr/bin/codesign --verify --strict "$OUTPUT"
/usr/bin/plutil -lint "$OUTPUT/Contents/Info.plist"
