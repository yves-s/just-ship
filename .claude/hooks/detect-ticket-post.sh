#!/bin/bash
# detect-ticket-post.sh — PostToolUse Hook
# Re-detects ticket number from branch after Bash commands.
# Only writes .active-ticket if the value changed (avoids unnecessary disk I/O).
#
# Fired by: settings.json → hooks.PostToolUse (matcher: Bash)
# Input: JSON on stdin with { tool_name, tool_input, cwd, ... }
# Performance: Must complete in <50ms. No Python, no Node, no network calls.

set -euo pipefail

EVENT_JSON=$(cat)
CWD=$(echo "$EVENT_JSON" | /usr/bin/sed -n 's/.*"cwd" *: *"\([^"]*\)".*/\1/p')

[ -z "$CWD" ] && exit 0
cd "$CWD" || exit 0

# Only run in projects with pipeline config
[ ! -f "project.json" ] && exit 0

# Extract ticket number from current branch
# Supports both formats: feature/T-551-foo and feature/551-foo
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
TICKET_NUMBER=$(echo "$BRANCH" | /usr/bin/sed -n 's|^[a-z]*/T\{0,1\}-\{0,1\}\([0-9][0-9]*\)-.*|\1|p')

ACTIVE_TICKET_FILE="$CWD/.claude/.active-ticket"
CURRENT=$(cat "$ACTIVE_TICKET_FILE" 2>/dev/null | tr -d '[:space:]') || true

# Only write if value changed
if [ "$TICKET_NUMBER" != "$CURRENT" ]; then
  if [ -n "$TICKET_NUMBER" ]; then
    echo "$TICKET_NUMBER" > "$ACTIVE_TICKET_FILE"
  else
    : > "$ACTIVE_TICKET_FILE" 2>/dev/null || true
  fi
fi

exit 0
