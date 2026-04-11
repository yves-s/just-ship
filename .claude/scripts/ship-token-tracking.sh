#!/bin/bash
# ship-token-tracking.sh — Deterministic per-ticket token tracking
# Usage: bash .claude/scripts/ship-token-tracking.sh <ticket_number> [project_root]
# Called by /ship (step 5c) and on-session-end.sh
# Computes token delta between /develop snapshot and current state, patches Board.
# Exit 0 always (non-blocking).

set -euo pipefail

TICKET_NUMBER="${1:-}"
PROJECT_ROOT="${2:-$PWD}"

[ -z "$TICKET_NUMBER" ] && exit 0

# Resolve scripts dir relative to this script (works in both .claude/ and .claude-plugin/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find snapshot file — check main repo .claude/ (canonical location)
# In worktrees, PROJECT_ROOT may be the worktree path; resolve to main repo.
# git rev-parse --git-common-dir returns an absolute path in worktrees (e.g. /repo/.git),
# so we cd into it directly — NOT $PROJECT_ROOT/$GIT_COMMON which would double the path.
GIT_COMMON=$(cd "$PROJECT_ROOT" && git rev-parse --git-common-dir 2>/dev/null) || true
if [ -n "$GIT_COMMON" ] && [ "$GIT_COMMON" != ".git" ]; then
  MAIN_ROOT=$(cd "$GIT_COMMON/.." && pwd)
else
  MAIN_ROOT="$PROJECT_ROOT"
fi

SNAPSHOT_FILE="$MAIN_ROOT/.claude/.token-snapshot-T-$TICKET_NUMBER.json"

# Read start snapshot (written by /develop step 3e)
START_JSON='{"total_tokens":0,"estimated_cost_usd":0,"input_tokens":0,"cache_read_tokens":0,"cache_creation_tokens":0,"output_tokens":0}'
if [ -f "$SNAPSHOT_FILE" ]; then
  START_JSON=$(cat "$SNAPSHOT_FILE")
fi

# Calculate current session totals using the MAIN repo path (sessions are stored under main repo CWD, not worktree)
SAFE_CWD=$(echo "$MAIN_ROOT" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
SESSION_FILE=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1 || true)

[ -z "$SESSION_FILE" ] && exit 0

END_JSON=$(bash "$SCRIPT_DIR/calculate-session-cost.sh" "$(basename "$SESSION_FILE" .jsonl)" "$MAIN_ROOT" 2>/dev/null || echo "")

[ -z "$END_JSON" ] && exit 0

# Compute deltas
DELTA_JSON=$(node -e "
  const start = JSON.parse(process.argv[1]);
  const end = JSON.parse(process.argv[2]);
  const d = {
    total_tokens: Math.max(0, (end.total_tokens||0) - (start.total_tokens||0)),
    estimated_cost: parseFloat(Math.max(0, (end.estimated_cost_usd||0) - (start.estimated_cost_usd||0)).toFixed(4)),
    input_tokens: Math.max(0, (end.input_tokens||0) - (start.input_tokens||0)),
    cache_read_tokens: Math.max(0, (end.cache_read_tokens||0) - (start.cache_read_tokens||0)),
    cache_creation_tokens: Math.max(0, (end.cache_creation_tokens||0) - (start.cache_creation_tokens||0)),
    output_tokens: Math.max(0, (end.output_tokens||0) - (start.output_tokens||0)),
  };
  process.stdout.write(JSON.stringify(d));
" "$START_JSON" "$END_JSON" 2>/dev/null || echo "")

[ -z "$DELTA_JSON" ] && exit 0

# Check if delta has any tokens
DELTA_TOKENS=$(echo "$DELTA_JSON" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).total_tokens))" 2>/dev/null || echo "0")

if [ "$DELTA_TOKENS" != "0" ]; then
  # Patch board — add delta to existing values
  EXISTING=$(bash "$SCRIPT_DIR/board-api.sh" get "tickets/$TICKET_NUMBER" 2>/dev/null || echo "")
  if [ -n "$EXISTING" ]; then
    PATCH_JSON=$(node -e "
      const existing = JSON.parse(process.argv[1]);
      const delta = JSON.parse(process.argv[2]);
      const e = existing.data || existing;
      const patch = {
        total_tokens: (e.total_tokens || 0) + (delta.total_tokens || 0),
        estimated_cost: parseFloat(((e.estimated_cost || 0) + (delta.estimated_cost || 0)).toFixed(4)),
        input_tokens: (e.input_tokens || 0) + (delta.input_tokens || 0),
        cache_read_tokens: (e.cache_read_tokens || 0) + (delta.cache_read_tokens || 0),
        cache_creation_tokens: (e.cache_creation_tokens || 0) + (delta.cache_creation_tokens || 0),
        output_tokens: (e.output_tokens || 0) + (delta.output_tokens || 0),
      };
      process.stdout.write(JSON.stringify(patch));
    " "$EXISTING" "$DELTA_JSON" 2>/dev/null || echo "")

    if [ -n "$PATCH_JSON" ]; then
      bash "$SCRIPT_DIR/board-api.sh" patch "tickets/$TICKET_NUMBER" "$PATCH_JSON" >/dev/null 2>&1 || true
    fi
  fi

  # Output for session summary
  DELTA_COST=$(echo "$DELTA_JSON" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).estimated_cost))" 2>/dev/null || echo "0")
  echo "✓ tokens — $DELTA_TOKENS tokens, \$$DELTA_COST"
fi

# Clean up snapshot
rm -f "$SNAPSHOT_FILE" 2>/dev/null || true

exit 0
