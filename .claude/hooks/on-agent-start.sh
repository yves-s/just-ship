#!/bin/bash
# on-agent-start.sh — SubagentStart Hook
# Sends an "agent_started" event when any subagent is spawned.
# Also writes agent_id→agent_type mapping so on-agent-stop.sh can resolve it
# (SubagentStop does NOT include agent_type in its payload).
#
# Fired by: settings.json → hooks.SubagentStart
# Input: JSON on stdin with { agent_type, agent_id, cwd, ... }

set -euo pipefail

EVENT_JSON=$(cat)
CWD=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")
AGENT_TYPE=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('agent_type',''))" 2>/dev/null || echo "")
AGENT_ID=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('agent_id',''))" 2>/dev/null || echo "")

[ -z "$CWD" ] || [ -z "$AGENT_TYPE" ] && exit 0

# Only run in projects with pipeline config (workspace_id in project.json)
if [ ! -f "$CWD/project.json" ] || ! python3 -c "import json; d=json.load(open('$CWD/project.json')); assert d.get('pipeline',{}).get('workspace_id')" 2>/dev/null; then
  exit 0
fi

# Write agent_id → agent_type mapping for on-agent-stop.sh
if [ -n "$AGENT_ID" ]; then
  # Sanitize agent_id to prevent path traversal
  SAFE_ID=$(echo "$AGENT_ID" | sed 's/[^a-zA-Z0-9._-]/_/g')
  AGENT_MAP_DIR="$CWD/.claude/.agent-map"
  mkdir -p "$AGENT_MAP_DIR"
  echo "$AGENT_TYPE" > "$AGENT_MAP_DIR/$SAFE_ID"
fi

ACTIVE_TICKET_FILE="$CWD/.claude/.active-ticket"
[ ! -f "$ACTIVE_TICKET_FILE" ] && exit 0

TICKET_NUMBER=$(cat "$ACTIVE_TICKET_FILE" 2>/dev/null | tr -d '[:space:]')
[ -z "$TICKET_NUMBER" ] && exit 0

# Send event (async, silent fail)
if [ -f "$CWD/.claude/scripts/send-event.sh" ]; then
  bash "$CWD/.claude/scripts/send-event.sh" "$TICKET_NUMBER" "$AGENT_TYPE" agent_started &
fi

exit 0
