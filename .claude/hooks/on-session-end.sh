#!/bin/bash
# on-session-end.sh — SessionEnd Hook
# Sends an orchestrator "completed" event and cleans up .active-ticket.
#
# Fired by: settings.json → hooks.SessionEnd
# Input: JSON on stdin with { cwd, session_id, ... }

set -euo pipefail

EVENT_JSON=$(cat)
CWD=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")
SESSION_ID=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || echo "")

[ -z "$CWD" ] && exit 0

# Validate CWD: must be absolute path without .. traversal
if [[ ! "$CWD" =~ ^/ ]] || [[ "$CWD" =~ \.\. ]]; then
  exit 0
fi

# Only run in projects with pipeline config (workspace_id in project.json)
if [ ! -f "$CWD/project.json" ] || ! python3 -c "import json; d=json.load(open('$CWD/project.json')); assert d.get('pipeline',{}).get('workspace_id')" 2>/dev/null; then
  exit 0
fi

ACTIVE_TICKET_FILE="$CWD/.claude/.active-ticket"
[ ! -f "$ACTIVE_TICKET_FILE" ] && exit 0

TICKET_NUMBER=$(cat "$ACTIVE_TICKET_FILE" 2>/dev/null | tr -d '[:space:]')

if [ -n "$TICKET_NUMBER" ]; then
  # Send orchestrator completed event (sync — SessionEnd has short timeout)
  if [ -f "$CWD/.claude/scripts/send-event.sh" ]; then
    bash "$CWD/.claude/scripts/send-event.sh" "$TICKET_NUMBER" orchestrator completed
  fi
fi

# Track token usage and estimated cost for this session
if [ -n "$SESSION_ID" ] && [ -n "$TICKET_NUMBER" ]; then
  COST_JSON=$(bash "$CWD/.claude/scripts/calculate-session-cost.sh" "$SESSION_ID" "$CWD" 2>/dev/null || echo "")

  if [ -n "$COST_JSON" ]; then
    NEW_TOKENS=$(echo "$COST_JSON" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).total_tokens || 0))" 2>/dev/null || echo "0")
    NEW_COST=$(echo "$COST_JSON" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).estimated_cost_usd || 0))" 2>/dev/null || echo "0")

    if [ "$NEW_TOKENS" != "0" ]; then
      EXISTING=$(bash "$CWD/.claude/scripts/board-api.sh" get "tickets/$TICKET_NUMBER" 2>/dev/null || echo "")
      if [ -n "$EXISTING" ]; then
        OLD_TOKENS=$(echo "$EXISTING" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); process.stdout.write(String(d.data?.total_tokens || 0))" 2>/dev/null || echo "0")
        OLD_COST=$(echo "$EXISTING" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); process.stdout.write(String(d.data?.estimated_cost || 0))" 2>/dev/null || echo "0")

        TOTAL_TOKENS=$(node -e "process.stdout.write(String(Number('$OLD_TOKENS') + Number('$NEW_TOKENS')))" 2>/dev/null)
        TOTAL_COST=$(node -e "process.stdout.write(String(parseFloat((Number('$OLD_COST') + Number('$NEW_COST')).toFixed(4))))" 2>/dev/null)

        bash "$CWD/.claude/scripts/board-api.sh" patch "tickets/$TICKET_NUMBER" "{\"total_tokens\": $TOTAL_TOKENS, \"estimated_cost\": $TOTAL_COST}" >/dev/null 2>&1 || true
      fi
    fi
  fi
fi

# Clean up active ticket
: > "$ACTIVE_TICKET_FILE" 2>/dev/null || true

exit 0
