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

# Resolve main project root (handles worktree CWD gracefully).
# In a worktree, git-common-dir → main-repo/.git, parent = project root.
# In the main repo, git-common-dir → ".git", fall back to CWD.
GIT_COMMON=$(cd "$CWD" && git rev-parse --git-common-dir 2>/dev/null) || true
if [ -n "$GIT_COMMON" ] && [ "$GIT_COMMON" != ".git" ]; then
  PROJECT_ROOT=$(cd "$GIT_COMMON/.." && pwd)
else
  PROJECT_ROOT="$CWD"
fi

ACTIVE_TICKET_FILE="$PROJECT_ROOT/.claude/.active-ticket"
[ ! -f "$ACTIVE_TICKET_FILE" ] && exit 0

TICKET_NUMBER=$(cat "$ACTIVE_TICKET_FILE" 2>/dev/null | tr -d '[:space:]')

if [ -n "$TICKET_NUMBER" ]; then
  # Send orchestrator completed event (sync — SessionEnd has short timeout)
  if [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/send-event.sh" ]; then
    bash "${CLAUDE_PLUGIN_ROOT}/scripts/send-event.sh" "$TICKET_NUMBER" orchestrator completed
  fi
fi

# Track token usage via ship-token-tracking.sh (delta-based, not full session)
if [ -n "$TICKET_NUMBER" ]; then
  if [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/ship-token-tracking.sh" ]; then
    bash "${CLAUDE_PLUGIN_ROOT}/scripts/ship-token-tracking.sh" "$TICKET_NUMBER" "$PROJECT_ROOT" 2>/dev/null || true
  fi
fi

# Clean up active ticket
: > "$ACTIVE_TICKET_FILE" 2>/dev/null || true

exit 0
