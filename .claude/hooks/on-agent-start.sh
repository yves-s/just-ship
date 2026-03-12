#!/bin/bash
# on-agent-start.sh — SubagentStart Hook
# Sends an "agent_started" event when any subagent is spawned.
#
# Fired by: settings.json → hooks.SubagentStart
# Input: JSON on stdin with { agent_type, agent_id, cwd, ... }

set -euo pipefail

EVENT_JSON=$(cat)
CWD=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")
AGENT_TYPE=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('agent_type',''))" 2>/dev/null || echo "")

[ -z "$CWD" ] || [ -z "$AGENT_TYPE" ] && exit 0

ACTIVE_TICKET_FILE="$CWD/.claude/.active-ticket"
[ ! -f "$ACTIVE_TICKET_FILE" ] && exit 0

TICKET_NUMBER=$(cat "$ACTIVE_TICKET_FILE" 2>/dev/null | tr -d '[:space:]')
[ -z "$TICKET_NUMBER" ] && exit 0

# Send event (async, silent fail)
if [ -f "$CWD/.claude/scripts/send-event.sh" ]; then
  bash "$CWD/.claude/scripts/send-event.sh" "$TICKET_NUMBER" "$AGENT_TYPE" agent_started &
fi

exit 0
