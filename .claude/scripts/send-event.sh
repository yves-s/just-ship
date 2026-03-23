#!/bin/bash
# send-event.sh — Send pipeline event to Dev Board
# Usage: bash .claude/scripts/send-event.sh <ticket_number> <agent_type> <event_type> [metadata_json]
#
# Reads workspace_id from project.json, resolves credentials via write-config.sh.
# Silent fail — never blocks the pipeline.

TICKET_NUMBER="$1"
AGENT_TYPE="$2"
EVENT_TYPE="$3"
METADATA="${4:-{}}"

[ -z "$TICKET_NUMBER" ] || [ -z "$AGENT_TYPE" ] || [ -z "$EVENT_TYPE" ] && exit 0

# Read workspace_id from project.json
if [ ! -f "project.json" ]; then exit 0; fi

WORKSPACE_ID=$(node -e "
  try { const p = require('./project.json'); process.stdout.write(p.pipeline?.workspace_id || ''); }
  catch(e) { process.stdout.write(''); }
" 2>/dev/null)

[ -z "$WORKSPACE_ID" ] && exit 0

# Resolve credentials via write-config.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WS_JSON=$("$SCRIPT_DIR/write-config.sh" read-workspace --id "$WORKSPACE_ID" 2>/dev/null)
[ -z "$WS_JSON" ] && exit 0

API_URL=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url || '')")
API_KEY=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key || '')")

[ -z "$API_URL" ] || [ -z "$API_KEY" ] && exit 0

curl -s --max-time 3 -X POST "${API_URL}/api/events" \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: ${API_KEY}" \
  -d "{\"ticket_number\": ${TICKET_NUMBER}, \"agent_type\": \"${AGENT_TYPE}\", \"event_type\": \"${EVENT_TYPE}\", \"metadata\": ${METADATA}}" \
  >/dev/null 2>&1 &
