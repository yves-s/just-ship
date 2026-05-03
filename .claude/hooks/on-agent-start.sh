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

# Send event (async, silent fail)
if [ -f "$CWD/.claude/scripts/send-event.sh" ]; then
  bash "$CWD/.claude/scripts/send-event.sh" "$TICKET_NUMBER" "$AGENT_TYPE" agent_started &
fi

exit 0
