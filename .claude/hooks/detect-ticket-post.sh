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

# Resolve the main project root (not the worktree root).
# In a worktree, git-common-dir points to main-repo/.git, so its parent is the project root.
# In the main repo, git-common-dir returns ".git", so we fall back to CWD.
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
if [ "$GIT_COMMON" = ".git" ]; then
  PROJECT_ROOT="$CWD"
else
  # git-common-dir returns absolute path like /path/to/main-repo/.git
  PROJECT_ROOT=$(cd "$GIT_COMMON/.." && pwd)
fi

PROJECT_ACTIVE="$PROJECT_ROOT/.claude/.active-ticket"
CWD_ACTIVE="$CWD/.claude/.active-ticket"
CURRENT=$(cat "$PROJECT_ACTIVE" 2>/dev/null | tr -d '[:space:]') || true

# Only write if value changed (avoids unnecessary disk I/O).
# Mirror to both project root AND CWD so subagent hooks find the value
# regardless of which CWD they execute under (T-1063 worktree-aware sync).
if [ "$TICKET_NUMBER" != "$CURRENT" ]; then
  if [ -n "$TICKET_NUMBER" ]; then
    echo "$TICKET_NUMBER" > "$PROJECT_ACTIVE"
    if [ "$CWD_ACTIVE" != "$PROJECT_ACTIVE" ]; then
      mkdir -p "$CWD/.claude" 2>/dev/null || true
      echo "$TICKET_NUMBER" > "$CWD_ACTIVE" 2>/dev/null || true
    fi
  else
    : > "$PROJECT_ACTIVE" 2>/dev/null || true
    if [ "$CWD_ACTIVE" != "$PROJECT_ACTIVE" ]; then
      : > "$CWD_ACTIVE" 2>/dev/null || true
    fi
  fi
fi

exit 0
