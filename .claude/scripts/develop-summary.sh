#!/bin/bash
# develop-summary.sh — Render the develop-complete block at the end of /develop.
# Renders skills/reporter/templates/develop-complete.md with the provided values.
#
# Usage:
#   bash .claude/scripts/develop-summary.sh \
#     <ticket_number> <ticket_title> <summary_text> \
#     <build_status> <tests_passed> <tests_total> <qa_result> \
#     [<pr_url>] [<preview_url>]
#
# Inputs:
#   - Positional args carry the variable contract (template Variables table).
#   - Git stats (files_changed / insertions / deletions / commit_count / branch)
#     are collected from `git diff --stat main..HEAD`.
#   - Token totals + cost + model are read from the active session via
#     calculate-session-cost.sh (matched against the main repo, not the worktree).
#   - Team roster is read from .claude/.reporter-team-roster.json if present
#     (written by pipeline/run.ts in the Pre-Develop step). When absent or
#     empty, the Team block elides — no fake rows.
#
# Output: The rendered develop-complete template on stdout.
# Optional rows (PR / Preview / Session / Team) elide per the template contract
# when their inputs are empty.

set -euo pipefail

TICKET_NUMBER="${1:-}"
TICKET_TITLE="${2:-}"
SUMMARY_TEXT="${3:-}"
BUILD_STATUS="${4:-passed}"
TESTS_PASSED="${5:-0}"
TESTS_TOTAL="${6:-0}"
QA_RESULT="${7:-passed}"
PR_URL="${8:-}"
PREVIEW_URL="${9:-}"

if [ -z "$TICKET_NUMBER" ] || [ -z "$TICKET_TITLE" ]; then
  echo "Usage: develop-summary.sh <ticket_number> <ticket_title> <summary_text> <build_status> <tests_passed> <tests_total> <qa_result> [pr_url] [preview_url]" >&2
  exit 1
fi

# --- Icon mapping (template contract) ---
case "$QA_RESULT" in
  passed)        QA_ICON="✓" ;;
  needs-review)  QA_ICON="⚠" ;;
  skipped)       QA_ICON="—" ;;
  *)             QA_ICON="—" ;;
esac

case "$BUILD_STATUS" in
  passed) BUILD_ICON="✓" ;;
  failed) BUILD_ICON="✗" ;;
  *)      BUILD_ICON="✓" ;;
esac

# --- Git stats ---
MERGE_BASE=$(git merge-base main HEAD 2>/dev/null || echo "")
if [ -n "$MERGE_BASE" ]; then
  FILES_CHANGED=$(git diff --name-only "$MERGE_BASE" HEAD 2>/dev/null | wc -l | tr -d ' ')
  COMMIT_COUNT=$(git rev-list --count "$MERGE_BASE"..HEAD 2>/dev/null || echo "0")
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  DIFF_STAT=$(git diff --shortstat "$MERGE_BASE" HEAD 2>/dev/null || echo "")
  # `grep` can exit non-zero when there are no insertions/deletions yet (empty diff).
  # `set -e` would abort the script — use `|| true` to fall through to the default of 0.
  INSERTIONS=$(echo "$DIFF_STAT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' | head -1 || true)
  DELETIONS=$(echo "$DIFF_STAT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' | head -1 || true)
  INSERTIONS="${INSERTIONS:-0}"
  DELETIONS="${DELETIONS:-0}"
else
  FILES_CHANGED="0"
  INSERTIONS="0"
  DELETIONS="0"
  COMMIT_COUNT="0"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
fi

# --- Resolve main repo root (worktrees → strip the .worktrees/T-N suffix) ---
REPO_ROOT="$PWD"
if [[ "$REPO_ROOT" =~ \.worktrees/T-[0-9]+ ]]; then
  REPO_ROOT="${REPO_ROOT%/.worktrees/T-*}"
fi

# --- Team roster (optional, written by pipeline/run.ts Pre-Develop) ---
TEAM_FILE=""
for candidate in \
  "$REPO_ROOT/.claude/.reporter-team-roster.json" \
  "$PWD/.claude/.reporter-team-roster.json"; do
  if [ -f "$candidate" ]; then
    TEAM_FILE="$candidate"
    break
  fi
done

TEAM_ROWS=""
if [ -n "$TEAM_FILE" ]; then
  TEAM_ROWS=$(JS_TEAM_FILE="$TEAM_FILE" node -e "
    const fs = require('fs');
    let data;
    try { data = JSON.parse(fs.readFileSync(process.env.JS_TEAM_FILE, 'utf8')); }
    catch { process.exit(0); }
    const team = Array.isArray(data?.team) ? data.team : (Array.isArray(data) ? data : []);
    if (!team.length) process.exit(0);

    function humanizeTokens(n) {
      n = Number(n) || 0;
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
      return String(n);
    }

    const maxRoleLen = Math.max(...team.map(a => String(a.role || '').length));
    // Always render ✓ — the develop-complete block fires AFTER all agents finished.
    // Pre-Develop writes ▸ (running) to the roster as a placeholder; the renderer
    // overrides it because by render time, the agents are done.
    const lines = team.map(a => {
      const role = String(a.role || '').padEnd(maxRoleLen);
      const tokens = humanizeTokens(a.tokens);
      return \`✓ \${role} · \${tokens} tokens\`;
    });
    process.stdout.write(lines.join('\\n'));
  " 2>/dev/null || true)
fi

# --- Token data (optional — Session row elides if total is 0/unknown) ---
SAFE_CWD=$(echo "$REPO_ROOT" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
SESSION_FILE=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1 || true)

TOTAL_TOKENS_HUMAN=""
COST_USD=""
MODEL_SHORT=""
if [ -n "$SESSION_FILE" ]; then
  SESSION_ID=$(basename "$SESSION_FILE" .jsonl)
  TOKEN_JSON=$(bash "$(dirname "$0")/calculate-session-cost.sh" "$SESSION_ID" "$REPO_ROOT" 2>/dev/null || true)
  if [ -n "$TOKEN_JSON" ]; then
    TOTAL_TOKENS=$(echo "$TOKEN_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.total_tokens||0))" 2>/dev/null || echo "0")
    COST_USD=$(echo "$TOKEN_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.estimated_cost_usd||0))" 2>/dev/null || echo "0")
    if [ "$TOTAL_TOKENS" != "0" ] && [ -n "$TOTAL_TOKENS" ]; then
      TOTAL_TOKENS_HUMAN=$(node -e "
        const n = Number(process.argv[1]) || 0;
        if (n >= 1_000_000) process.stdout.write((n / 1_000_000).toFixed(1) + 'M');
        else if (n >= 1_000) process.stdout.write(Math.round(n / 1_000) + 'k');
        else process.stdout.write(String(n));
      " "$TOTAL_TOKENS" 2>/dev/null || echo "")
      MODEL=$(JS_SESSION_FILE="$SESSION_FILE" node -e "
        const fs = require('fs');
        const lines = fs.readFileSync(process.env.JS_SESSION_FILE, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try { const obj = JSON.parse(line); if (obj?.message?.model) { process.stdout.write(obj.message.model); process.exit(0); } } catch {}
        }
      " 2>/dev/null || echo "")
      MODEL_SHORT="$MODEL"
    fi
  fi
fi

# --- Render the template (develop-complete.md) ---
echo "✓ T-${TICKET_NUMBER} · ${TICKET_TITLE}"

if [ -n "$SUMMARY_TEXT" ]; then
  echo ""
  printf "%s\n" "$SUMMARY_TEXT"
fi

# Team block — elide entirely when no roster file or empty
if [ -n "$TEAM_ROWS" ]; then
  echo ""
  echo "Team"
  echo "────"
  printf "%s\n" "$TEAM_ROWS"
fi

echo ""
printf "Build   %s %s\n" "$BUILD_ICON" "$BUILD_STATUS"
printf "Tests   ✓ %s/%s\n" "$TESTS_PASSED" "$TESTS_TOTAL"
printf "QA      %s %s\n" "$QA_ICON" "$QA_RESULT"
printf "Diff    %s files · +%s / −%s · %s commits\n" "$FILES_CHANGED" "$INSERTIONS" "$DELETIONS" "$COMMIT_COUNT"
printf "Branch  %s\n" "$BRANCH"
if [ -n "$PR_URL" ]; then
  printf "PR      %s\n" "$PR_URL"
fi
if [ -n "$PREVIEW_URL" ]; then
  printf "Preview %s\n" "$PREVIEW_URL"
fi

# Session row — elide when total tokens is 0/unknown
if [ -n "$TOTAL_TOKENS_HUMAN" ]; then
  echo ""
  printf "Session · %s tokens · \$%s · %s\n" "$TOTAL_TOKENS_HUMAN" "$COST_USD" "$MODEL_SHORT"
fi
