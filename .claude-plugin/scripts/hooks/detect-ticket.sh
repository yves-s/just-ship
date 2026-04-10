#!/bin/bash
# detect-ticket.sh — SessionStart Hook
# Extracts ticket number from branch name and persists it for the session.
# Sends an orchestrator "agent_started" event to the Dev Board.
#
# Fired by: settings.json → hooks.SessionStart
# Input: JSON on stdin with { cwd, session_id, source, ... }
# Output: Writes TICKET_NUMBER to $CLAUDE_ENV_FILE + .claude/.active-ticket

set -euo pipefail

# Read hook input from stdin
EVENT_JSON=$(cat)
CWD=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")

[ -z "$CWD" ] && exit 0
cd "$CWD" || exit 0

# Only run in projects with pipeline config (workspace_id in project.json)
if [ ! -f "$CWD/project.json" ] || ! python3 -c "import json; d=json.load(open('$CWD/project.json')); assert d.get('pipeline',{}).get('workspace_id')" 2>/dev/null; then
  exit 0
fi

# Get current branch name
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
[ -z "$BRANCH" ] && exit 0

# Extract ticket number from branch: feature/T-551-foo → 551, fix/42-bar → 42
TICKET_NUMBER=$(echo "$BRANCH" | sed -n 's|^[a-z]*/T\{0,1\}-\{0,1\}\([0-9][0-9]*\)-.*|\1|p')

ACTIVE_TICKET_FILE="$CWD/.claude/.active-ticket"

if [ -n "$TICKET_NUMBER" ]; then
  # Persist ticket number for this session
  echo "$TICKET_NUMBER" > "$ACTIVE_TICKET_FILE"

  # Set env var for all subsequent Bash tool calls in this session
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "TICKET_NUMBER=$TICKET_NUMBER" >> "$CLAUDE_ENV_FILE"
  fi

  # Send orchestrator started event (async, silent fail)
  if [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/send-event.sh" ]; then
    bash "${CLAUDE_PLUGIN_ROOT}/scripts/send-event.sh" "$TICKET_NUMBER" orchestrator agent_started &
  fi
else
  # No ticket branch — clear active ticket
  : > "$ACTIVE_TICKET_FILE" 2>/dev/null || true
fi

exit 0
