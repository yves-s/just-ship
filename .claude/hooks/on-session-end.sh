#!/bin/bash
# on-session-end.sh — SessionEnd Hook
# Sends an orchestrator "completed" event and cleans up .active-ticket.
#
# Fired by: settings.json → hooks.SessionEnd
# Input: JSON on stdin with { cwd, session_id, ... }

set -euo pipefail

EVENT_JSON=$(cat)
CWD=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")

[ -z "$CWD" ] && exit 0

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

# Clean up active ticket
: > "$ACTIVE_TICKET_FILE" 2>/dev/null || true

exit 0
