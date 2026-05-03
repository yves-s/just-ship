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

# Resolve ticket number — prefer project-root copy, fall back to CWD copy.
# In a worktree, CWD has its own .active-ticket (T-1063 sync). Either location
# may carry the active ticket; we read whichever has a value.
PROJECT_ACTIVE="$PROJECT_ROOT/.claude/.active-ticket"
CWD_ACTIVE="$CWD/.claude/.active-ticket"

TICKET_NUMBER=""
if [ -f "$PROJECT_ACTIVE" ]; then
  TICKET_NUMBER=$(cat "$PROJECT_ACTIVE" 2>/dev/null | tr -d '[:space:]')
fi
if [ -z "$TICKET_NUMBER" ] && [ -f "$CWD_ACTIVE" ]; then
  TICKET_NUMBER=$(cat "$CWD_ACTIVE" 2>/dev/null | tr -d '[:space:]')
fi

# CRITICAL: send "completed" event BEFORE clearing .active-ticket. If clear
# happens first, a parallel SubagentStop firing concurrently would see an
# empty file and silently drop its event. Order matters here. (T-1063 AC#3)
if [ -n "$TICKET_NUMBER" ]; then
  if [ -f "$PROJECT_ROOT/.claude/scripts/send-event.sh" ]; then
    bash "$PROJECT_ROOT/.claude/scripts/send-event.sh" "$TICKET_NUMBER" orchestrator completed
  fi
fi

# Track token usage via ship-token-tracking.sh (delta-based, not full session)
if [ -n "$TICKET_NUMBER" ]; then
  if [ -f "$PROJECT_ROOT/.claude/scripts/ship-token-tracking.sh" ]; then
    bash "$PROJECT_ROOT/.claude/scripts/ship-token-tracking.sh" "$TICKET_NUMBER" "$PROJECT_ROOT" 2>/dev/null || true
  fi
fi

# Clean up active ticket in BOTH locations (project root + worktree CWD).
# Without the worktree cleanup, a subsequent session reusing the same worktree
# would see a stale ticket number and emit events for the wrong ticket.
[ -f "$PROJECT_ACTIVE" ] && : > "$PROJECT_ACTIVE" 2>/dev/null || true
if [ "$CWD_ACTIVE" != "$PROJECT_ACTIVE" ] && [ -f "$CWD_ACTIVE" ]; then
  : > "$CWD_ACTIVE" 2>/dev/null || true
fi

exit 0
