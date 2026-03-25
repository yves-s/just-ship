#!/bin/bash
# on-agent-stop.sh — SubagentStop Hook
# Sends a "completed" event when any subagent finishes.
#
# NOTE: SubagentStop does NOT include agent_type in its payload (only agent_id).
# We resolve agent_type from the mapping written by on-agent-start.sh.
#
# Fired by: settings.json → hooks.SubagentStop
# Input: JSON on stdin with { agent_id, agent_transcript_path, cwd, ... }

set -euo pipefail

EVENT_JSON=$(cat)
CWD=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")
AGENT_ID=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('agent_id',''))" 2>/dev/null || echo "")

[ -z "$CWD" ] || [ -z "$AGENT_ID" ] && exit 0

# Resolve agent_type from mapping written by on-agent-start.sh
# Sanitize agent_id to match the safe filename written by on-agent-start.sh
SAFE_ID=$(echo "$AGENT_ID" | sed 's/[^a-zA-Z0-9._-]/_/g')
AGENT_MAP_FILE="$CWD/.claude/.agent-map/$SAFE_ID"
if [ ! -f "$AGENT_MAP_FILE" ]; then
  exit 0
fi
AGENT_TYPE=$(cat "$AGENT_MAP_FILE" 2>/dev/null | tr -d '[:space:]')
rm -f "$AGENT_MAP_FILE"  # Clean up mapping entry

[ -z "$AGENT_TYPE" ] && exit 0

ACTIVE_TICKET_FILE="$CWD/.claude/.active-ticket"
[ ! -f "$ACTIVE_TICKET_FILE" ] && exit 0

TICKET_NUMBER=$(cat "$ACTIVE_TICKET_FILE" 2>/dev/null | tr -d '[:space:]')
[ -z "$TICKET_NUMBER" ] && exit 0

# Send event (sync — must complete before hook exits, otherwise event is lost)
if [ -f "$CWD/.claude/scripts/send-event.sh" ]; then
  bash "$CWD/.claude/scripts/send-event.sh" "$TICKET_NUMBER" "$AGENT_TYPE" completed
fi

exit 0
