#!/bin/bash
set -euo pipefail
DSH_REPO="$(cd "$(dirname "$(/bin/realpath "$0")")/.." && pwd)"
DSH_RUNTIME_BIN="$DSH_REPO/../runtime/bin"
export PATH="$DSH_RUNTIME_BIN:$HOME/.local/bin:$PATH"
export CHOKIDAR_USEPOLLING=1
export RDSH_ORIG_BIN="$DSH_REPO/scripts/launch-local-dsh.node.sh"
export RDSH_AUTH_AUTOSYNC="${RDSH_AUTH_AUTOSYNC:-0}"
export RDSH_PASSTHROUGH="${RDSH_PASSTHROUGH:-1}"
exec "$DSH_RUNTIME_BIN/dsh" "$@"
