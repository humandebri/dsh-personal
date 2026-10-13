#!/bin/bash
set -euo pipefail
DSH_REPO="$(cd "$(dirname "$(/bin/realpath "$0")")/.." && pwd)"
DSH_RUNTIME_BIN="$DSH_REPO/../runtime/bin"
export PATH="$DSH_RUNTIME_BIN:$HOME/.local/bin:$PATH"
export CHOKIDAR_USEPOLLING=1
exec "$DSH_RUNTIME_BIN/node" "$DSH_REPO/apps/cli/lib/bin.js" "$@"
