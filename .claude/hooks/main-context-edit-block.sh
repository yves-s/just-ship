#!/bin/bash
# main-context-edit-block.sh — PreToolUse Hook (Edit, Write, NotebookEdit)
#
# Blocks state-mutating tool calls from the main Claude Code context while a
# ticket is active. Forces edits to flow through a subagent so the skill
# loader (pipeline/lib/load-skills.ts) can inject the domain skill into the
# subagent's system prompt.
#
# Fired by: settings.json → hooks.PreToolUse (matcher: Edit | Write | NotebookEdit)
# Input: JSON on stdin with { tool_name, tool_input, cwd, agent_id?, ... }
# Output:
#   exit 0 → allow tool call
#   exit 2 → block tool call (Claude sees stderr as the reason)
#
# Detection contract:
#   1) Subagent signal — allow if ANY of:
#        a) hook payload contains "agent_id" (Claude Code sets this in
#           subagent contexts)
#        b) CLAUDE_AGENT_DEPTH env var is set and > 0
#        c) .claude/.agent-map/ contains at least one entry (subagent is
#           currently running, marker written by on-agent-start.sh, removed
#           by on-agent-stop.sh)
#   2) Active-ticket signal — block only if .claude/.active-ticket exists
#      AND is non-empty (must be the main context AND a ticket must be active)
#   3) File-path allow-list — never block paths under:
#        .claude/rules/**, .claude/scripts/**, .claude/hooks/**,
#        .worktrees/T-*/**, .claude/.active-ticket, .claude/.agent-map/**,
#        .claude/.token-snapshot-*.json, .claude/.reporter-team-roster.json,
#        anything outside $CWD (e.g. /tmp, ~/.claude)
#   4) Read-only-defensive default — when CWD or active-ticket cannot be
#      determined, exit 0 (false positives are more expensive than false
#      negatives; the rule explicitly says so).

set -euo pipefail

EVENT_JSON=$(cat)

# ─────────────────────────────────────────────
# Subagent detection — allow path #1: stdin payload has agent_id
# ─────────────────────────────────────────────
# Match "agent_id" key with a non-empty string OR non-null value.
# Claude Code emits agent_id only inside subagent contexts.
if echo "$EVENT_JSON" | /usr/bin/grep -Eq '"agent_id"[[:space:]]*:[[:space:]]*"[^"]+"'; then
  exit 0
fi

# ─────────────────────────────────────────────
# Subagent detection — allow path #2: CLAUDE_AGENT_DEPTH env var
# ─────────────────────────────────────────────
DEPTH="${CLAUDE_AGENT_DEPTH:-0}"
if [ -n "$DEPTH" ] && [ "$DEPTH" != "0" ]; then
  exit 0
fi

# ─────────────────────────────────────────────
# Extract cwd and tool_input.file_path with sed (no python/node dependency).
# Strategy mirrors quality-gate.sh: anchor file_path to tool_input scope so we
# don't accidentally match a file_path key in tool_output or elsewhere.
# ─────────────────────────────────────────────
TOOL_INPUT_JSON=$(echo "$EVENT_JSON" | /usr/bin/sed -n 's/.*"tool_input" *: *{\(.*\)}/{\1}/p' | head -1)
if [ -n "$TOOL_INPUT_JSON" ]; then
  FILE_PATH=$(echo "$TOOL_INPUT_JSON" | /usr/bin/sed -n 's/.*"file_path" *: *"\([^"]*\)".*/\1/p' | head -1)
else
  FILE_PATH=$(echo "$EVENT_JSON" | /usr/bin/sed -n 's/.*"file_path" *: *"\([^"]*\)".*/\1/p' | head -1)
fi
CWD=$(echo "$EVENT_JSON" | /usr/bin/sed -n 's/.*"cwd" *: *"\([^"]*\)".*/\1/p' | head -1)

# Read-only-defensive: if we can't determine context, don't block.
[ -z "$CWD" ] && exit 0
[ -z "$FILE_PATH" ] && exit 0

# ─────────────────────────────────────────────
# Active-ticket signal: required for the block to fire at all.
# ─────────────────────────────────────────────
ACTIVE_TICKET_FILE="$CWD/.claude/.active-ticket"
[ ! -f "$ACTIVE_TICKET_FILE" ] && exit 0

TICKET_NUMBER=$(cat "$ACTIVE_TICKET_FILE" 2>/dev/null | tr -d '[:space:]')
[ -z "$TICKET_NUMBER" ] && exit 0

# ─────────────────────────────────────────────
# Subagent detection — allow path #3: agent-map has live entries
# (a subagent is currently running). Cleanup of stale entries is the
# responsibility of on-agent-stop.sh; here we trust the marker.
# ─────────────────────────────────────────────
AGENT_MAP_DIR="$CWD/.claude/.agent-map"
if [ -d "$AGENT_MAP_DIR" ]; then
  if [ -n "$(/usr/bin/find "$AGENT_MAP_DIR" -mindepth 1 -maxdepth 1 -type f -print -quit 2>/dev/null)" ]; then
    exit 0
  fi
fi

# ─────────────────────────────────────────────
# File-path allow-list: framework-governance paths, worktrees, ephemeral
# session state. Resolve relative paths against $CWD before matching.
# ─────────────────────────────────────────────
case "$FILE_PATH" in
  /*) ABS_PATH="$FILE_PATH" ;;
  *)  ABS_PATH="$CWD/$FILE_PATH" ;;
esac

# Normalize the path to resolve ".." and "." segments before any containment
# or allow-list check. Without normalization, a path such as
# ".worktrees/T-9999/../../../pipeline/run.ts" would match the worktrees
# allow-list pattern even though its real destination is a project file.
# Use python3 (system binary, no project dep) for pure string normalization —
# os.path.normpath does not touch the filesystem, so it works for new files too.
if command -v python3 >/dev/null 2>&1; then
  ABS_PATH=$(python3 -c "import os.path,sys; print(os.path.normpath(sys.argv[1]))" "$ABS_PATH" 2>/dev/null) || true
fi

# Anything outside $CWD is not a project file — never block.
case "$ABS_PATH" in
  "$CWD"/*) ;;
  *) exit 0 ;;
esac

# Strip $CWD/ prefix for cleaner pattern matching.
REL_PATH="${ABS_PATH#"$CWD"/}"

case "$REL_PATH" in
  .claude/rules/*)               exit 0 ;;
  .claude/scripts/*)             exit 0 ;;
  .claude/hooks/*)               exit 0 ;;
  .worktrees/T-*)                exit 0 ;;
  .claude/.active-ticket)        exit 0 ;;
  .claude/.agent-map/*)          exit 0 ;;
  .claude/.token-snapshot-*.json) exit 0 ;;
  .claude/.reporter-team-roster.json) exit 0 ;;
  .claude/.sidekick-thread)      exit 0 ;;
  .claude/.quality-gate-cache)   exit 0 ;;
esac

# ─────────────────────────────────────────────
# All conditions met — block the tool call.
# ─────────────────────────────────────────────
echo "" >&2
echo "⚠ main-context-edit-block: Hauptkontext darf bei aktivem Ticket T-${TICKET_NUMBER} nicht editieren." >&2
echo "  File:    $REL_PATH" >&2
echo "  Reason:  Edits müssen durch einen Subagent laufen, damit der Skill-Loader greift." >&2
echo "  Action:  Spawne einen Subagent (Agent-Tool mit subagent_type=backend|frontend|data-engineer)" >&2
echo "           oder führe '/develop T-${TICKET_NUMBER}' im richtigen Kontext aus." >&2
echo "  Override: Edits unter .claude/rules/, .claude/scripts/, .claude/hooks/ und .worktrees/T-*/" >&2
echo "           sind erlaubt (Framework-Governance + Worktree-Subagent)." >&2
echo "" >&2
exit 2
