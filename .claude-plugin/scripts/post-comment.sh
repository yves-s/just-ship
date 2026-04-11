#!/bin/bash
# post-comment.sh — Post a comment to a Board ticket
# Usage: bash .claude/scripts/post-comment.sh <ticket_number> "body" [type]
# Types: triage, preview, qa (enables dedup on re-runs)
#
# Credential resolution (3-tier fallback):
#   Tier 1: PIPELINE_KEY + BOARD_API_URL from environment (Plugin-native)
#   Tier 2: PIPELINE_KEY from env + board_url from project.json → pipeline.board_url
#   Tier 3: write-config.sh read-workspace (legacy ~/.just-ship/ fallback)
#
# Silent fail — never blocks the pipeline. Always exits 0.

set -euo pipefail
trap 'exit 0' ERR

TICKET_NUMBER="${1:-}"
BODY="${2:-${COMMENT_BODY:-}}"
TYPE="${3:-}"

[ -z "$TICKET_NUMBER" ] || [ -z "$BODY" ] && exit 0

# --- Resolve credentials ---
# Tier 0: Map plugin userConfig env vars
: "${PIPELINE_KEY:=${CLAUDE_USER_CONFIG_BOARD_API_KEY:-}}"
: "${BOARD_API_URL:=${CLAUDE_USER_CONFIG_BOARD_API_URL:-}}"

API_KEY="${PIPELINE_KEY:-}"
API_URL="${BOARD_API_URL:-}"

# Tier 1: Both from environment — skip file I/O entirely
if [ -z "$API_KEY" ] || [ -z "$API_URL" ]; then
  # Tier 2: Key from env + board_url from project.json
  if [ -n "$API_KEY" ] && [ -z "$API_URL" ]; then
    if [ -f "project.json" ]; then
      API_URL=$(node -e "
        try { const p = require('./project.json'); process.stdout.write(p.pipeline?.board_url || ''); }
        catch(e) { process.stdout.write(''); }
      " 2>/dev/null) || API_URL=""
    fi
  fi

  # Tier 3: Legacy fallback via write-config.sh
  if [ -z "$API_KEY" ] || [ -z "$API_URL" ]; then
    if [ ! -f "project.json" ]; then exit 0; fi

    WORKSPACE_ID=$(node -e "
      try { const p = require('./project.json'); process.stdout.write(p.pipeline?.workspace_id || ''); }
      catch(e) { process.stdout.write(''); }
    " 2>/dev/null)

    [ -z "$WORKSPACE_ID" ] && exit 0

    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    WS_JSON=$("$SCRIPT_DIR/write-config.sh" read-workspace --id "$WORKSPACE_ID" 2>/dev/null) || exit 0
    [ -z "$WS_JSON" ] && exit 0

    : "${API_URL:=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url || '')")}"
    : "${API_KEY:=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key || '')")}"
  fi
fi

[ -z "$API_URL" ] || [ -z "$API_KEY" ] && exit 0

# Build JSON payload using env vars (no shell interpolation into JS to avoid injection)
PAYLOAD=$(COMMENT_BODY="$BODY" COMMENT_TYPE="$TYPE" node -e "
  const obj = { body: process.env.COMMENT_BODY, author: 'pipeline' };
  if (process.env.COMMENT_TYPE) obj.type = process.env.COMMENT_TYPE;
  process.stdout.write(JSON.stringify(obj));
" 2>/dev/null || true)

[ -z "$PAYLOAD" ] && exit 0

curl -s --max-time 3 -X POST "${API_URL}/api/tickets/${TICKET_NUMBER}/comments" \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: ${API_KEY}" \
  -d "$PAYLOAD" \
  >/dev/null 2>&1 || true

exit 0
