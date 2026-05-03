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

# Only run in projects with pipeline config (workspace_id in project.json)
if [ ! -f "$CWD/project.json" ] || ! python3 -c "import json; d=json.load(open('$CWD/project.json')); assert d.get('pipeline',{}).get('workspace_id')" 2>/dev/null; then
  exit 0
fi

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

# Resolve ticket number from .active-ticket — try CWD first, fall back to project root.
# In a worktree, CWD/.claude/.active-ticket may be empty/missing while the main
# repo's copy holds the value (or vice versa). The project-root fallback uses
# git-common-dir to find the main repo from inside a worktree, mirroring the
# logic in on-session-end.sh. See T-1063 (.active-ticket worktree-aware sync).
read_active_ticket() {
  local file="$1"
  [ -f "$file" ] || return 1
  local val
  val=$(cat "$file" 2>/dev/null | tr -d '[:space:]')
  [ -n "$val" ] || return 1
  printf '%s' "$val"
}

TICKET_NUMBER=$(read_active_ticket "$CWD/.claude/.active-ticket" || true)

if [ -z "$TICKET_NUMBER" ]; then
  GIT_COMMON=$(cd "$CWD" && git rev-parse --git-common-dir 2>/dev/null) || true
  if [ -n "$GIT_COMMON" ] && [ "$GIT_COMMON" != ".git" ]; then
    PROJECT_ROOT=$(cd "$GIT_COMMON/.." && pwd 2>/dev/null) || PROJECT_ROOT=""
    if [ -n "$PROJECT_ROOT" ] && [ "$PROJECT_ROOT" != "$CWD" ]; then
      TICKET_NUMBER=$(read_active_ticket "$PROJECT_ROOT/.claude/.active-ticket" || true)
    fi
  fi
fi

[ -z "$TICKET_NUMBER" ] && exit 0

# Send event (sync — must complete before hook exits, otherwise event is lost)
if [ -f "$CWD/.claude/scripts/send-event.sh" ]; then
  bash "$CWD/.claude/scripts/send-event.sh" "$TICKET_NUMBER" "$AGENT_TYPE" completed
fi

exit 0
