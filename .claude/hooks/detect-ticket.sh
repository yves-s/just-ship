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

# Persist .active-ticket in BOTH the CWD and the project root so subagent hooks
# can find it regardless of which CWD they run in (T-1063 worktree-aware sync).
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null) || GIT_COMMON=""
if [ -n "$GIT_COMMON" ] && [ "$GIT_COMMON" != ".git" ]; then
  PROJECT_ROOT=$(cd "$GIT_COMMON/.." && pwd 2>/dev/null) || PROJECT_ROOT="$CWD"
else
  PROJECT_ROOT="$CWD"
fi

CWD_ACTIVE="$CWD/.claude/.active-ticket"
PROJECT_ACTIVE="$PROJECT_ROOT/.claude/.active-ticket"

if [ -n "$TICKET_NUMBER" ]; then
  # Persist ticket number for this session — both locations
  mkdir -p "$CWD/.claude" 2>/dev/null || true
  echo "$TICKET_NUMBER" > "$CWD_ACTIVE"
  if [ "$CWD_ACTIVE" != "$PROJECT_ACTIVE" ]; then
    mkdir -p "$PROJECT_ROOT/.claude" 2>/dev/null || true
    echo "$TICKET_NUMBER" > "$PROJECT_ACTIVE"
  fi

  # Set env var for all subsequent Bash tool calls in this session
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "TICKET_NUMBER=$TICKET_NUMBER" >> "$CLAUDE_ENV_FILE"
  fi

  # Send orchestrator started event (async, silent fail)
  if [ -f "$CWD/.claude/scripts/send-event.sh" ]; then
    bash "$CWD/.claude/scripts/send-event.sh" "$TICKET_NUMBER" orchestrator agent_started &
  fi
else
  # No ticket branch — clear active ticket in both locations
  : > "$CWD_ACTIVE" 2>/dev/null || true
  if [ "$CWD_ACTIVE" != "$PROJECT_ACTIVE" ]; then
    : > "$PROJECT_ACTIVE" 2>/dev/null || true
  fi
fi

exit 0
