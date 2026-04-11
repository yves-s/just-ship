#!/bin/bash
# send-event.sh — Send pipeline event to Dev Board
# Usage: bash .claude/scripts/send-event.sh <ticket_number> <agent_type> <event_type> [metadata_json]
#
# Credential resolution (3-tier fallback):
#   Tier 1: PIPELINE_KEY + BOARD_API_URL from environment (Plugin-native)
#   Tier 2: PIPELINE_KEY from env + board_url from project.json → pipeline.board_url
#   Tier 3: write-config.sh read-workspace (legacy ~/.just-ship/ fallback)
#
# Silent fail — never blocks the pipeline.

TICKET_NUMBER="$1"
AGENT_TYPE="$2"
EVENT_TYPE="$3"
METADATA="${4:-{}}"

[ -z "$TICKET_NUMBER" ] || [ -z "$AGENT_TYPE" ] || [ -z "$EVENT_TYPE" ] && exit 0

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
    WS_JSON=$("$SCRIPT_DIR/write-config.sh" read-workspace --id "$WORKSPACE_ID" 2>/dev/null)
    [ -z "$WS_JSON" ] && exit 0

    : "${API_URL:=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url || '')")}"
    : "${API_KEY:=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key || '')")}"
  fi
fi

[ -z "$API_URL" ] || [ -z "$API_KEY" ] && exit 0

# Build JSON payload safely via env vars (prevents shell injection)
PAYLOAD=$(JS_TN="$TICKET_NUMBER" JS_AT="$AGENT_TYPE" JS_ET="$EVENT_TYPE" JS_MD="$METADATA" node -e "
  const obj = { ticket_number: Number(process.env.JS_TN), agent_type: process.env.JS_AT, event_type: process.env.JS_ET };
  try { obj.metadata = JSON.parse(process.env.JS_MD); } catch { obj.metadata = {}; }
  process.stdout.write(JSON.stringify(obj));
" 2>/dev/null || true)

[ -z "$PAYLOAD" ] && exit 0

curl -s --max-time 3 -X POST "${API_URL}/api/events" \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: ${API_KEY}" \
  -d "$PAYLOAD" \
  >/dev/null 2>&1
