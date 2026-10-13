#!/bin/bash
set -euo pipefail
DSH_RUNTIME_DIR="$(cd "$(dirname "$0")" && pwd)"
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
unset CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY
"$DSH_RUNTIME_DIR/bin/claude" auth login --claudeai
"$DSH_RUNTIME_DIR/bin/claude" auth status --text
