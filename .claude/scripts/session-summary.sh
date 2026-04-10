#!/bin/bash
# session-summary.sh — Render a formatted session summary after /develop
# Usage: bash .claude/scripts/session-summary.sh <ticket_number> <ticket_title> <summary_text> <qa_result> [pr_url] [preview_url]
# Reads token data from calculate-session-cost.sh using the main repo's session.
# Output: Formatted terminal box on stdout.

set -euo pipefail

TICKET_NUM="${1:-}"
TICKET_TITLE="${2:-}"
SUMMARY_TEXT="${3:-}"
QA_RESULT="${4:-passed}"
PR_URL="${5:-}"
PREVIEW_URL="${6:-}"

if [ -z "$TICKET_NUM" ] || [ -z "$TICKET_TITLE" ]; then
  echo "Usage: session-summary.sh <ticket_number> <ticket_title> <summary_text> <qa_result> [pr_url] [preview_url]" >&2
  exit 1
fi

# --- Collect git stats ---
MERGE_BASE=$(git merge-base main HEAD 2>/dev/null || echo "")
if [ -n "$MERGE_BASE" ]; then
  FILE_COUNT=$(git diff --name-only "$MERGE_BASE" HEAD 2>/dev/null | wc -l | tr -d ' ')
  DIFF_STAT=$(git diff --stat "$MERGE_BASE" HEAD 2>/dev/null | tail -1 | sed 's/^ *//')
  COMMIT_COUNT=$(git rev-list --count "$MERGE_BASE"..HEAD 2>/dev/null || echo "0")
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

  # Extract insertions/deletions from diff stat line
  INSERTIONS=$(echo "$DIFF_STAT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
  DELETIONS=$(echo "$DIFF_STAT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")
else
  FILE_COUNT="0"
  INSERTIONS="0"
  DELETIONS="0"
  COMMIT_COUNT="0"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
fi

# --- Collect token data ---
# Find the main repo path (strip .worktrees/T-xxx if present)
REPO_ROOT="$PWD"
if [[ "$REPO_ROOT" =~ \.worktrees/T-[0-9]+ ]]; then
  REPO_ROOT="${REPO_ROOT%/.worktrees/T-*}"
fi

# Find the session file from the main repo's project dir
SAFE_CWD=$(echo "$REPO_ROOT" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
SESSION_FILE=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1 || true)

TOKEN_JSON=""
if [ -n "$SESSION_FILE" ]; then
  SESSION_ID=$(basename "$SESSION_FILE" .jsonl)
  TOKEN_JSON=$(bash "$(dirname "$0")/calculate-session-cost.sh" "$SESSION_ID" "$REPO_ROOT" 2>/dev/null || true)
fi

# Parse token data if available
HAS_TOKENS=false
if [ -n "$TOKEN_JSON" ]; then
  INPUT_TOKENS=$(echo "$TOKEN_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.input_tokens||0))" 2>/dev/null || echo "0")
  OUTPUT_TOKENS=$(echo "$TOKEN_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.output_tokens||0))" 2>/dev/null || echo "0")
  CACHE_READ=$(echo "$TOKEN_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.cache_read_tokens||0))" 2>/dev/null || echo "0")
  CACHE_WRITE=$(echo "$TOKEN_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.cache_creation_tokens||0))" 2>/dev/null || echo "0")
  TOTAL_TOKENS=$(echo "$TOKEN_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.total_tokens||0))" 2>/dev/null || echo "0")
  COST_USD=$(echo "$TOKEN_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.estimated_cost_usd||0))" 2>/dev/null || echo "0")

  # Detect model from session JSONL — pass path via env var to prevent shell injection
  MODEL=$(JS_SESSION_FILE="$SESSION_FILE" node -e "
    const fs = require('fs');
    const lines = fs.readFileSync(process.env.JS_SESSION_FILE, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj?.message?.model) { process.stdout.write(obj.message.model); process.exit(0); }
      } catch {}
    }
    process.stdout.write('unknown');
  " 2>/dev/null || echo "unknown")

  # Friendly model name
  MODEL_SHORT=$(echo "$MODEL" | sed 's/claude-opus-4-6/Opus/;s/claude-opus-4-20250514/Opus/;s/claude-sonnet-4-6/Sonnet/;s/claude-sonnet-4-20250514/Sonnet/;s/claude-haiku-4-5-20251001/Haiku/')

  if [ "$TOTAL_TOKENS" != "0" ]; then
    HAS_TOKENS=true
  fi
fi

# --- Format numbers with thousands separator ---
fmt() {
  printf "%'d" "$1" 2>/dev/null || echo "$1"
}

# --- Render the summary ---
echo ""
echo "┌─ T-${TICKET_NUM} · ${TICKET_TITLE}"
echo "│"

# Summary text (wrap lines with │ prefix)
if [ -n "$SUMMARY_TEXT" ]; then
  echo "$SUMMARY_TEXT" | fold -s -w 60 | while IFS= read -r line; do
    echo "│  ${line}"
  done
  echo "│"
fi

# Changes block
echo "├─ Changes"
echo "│    Files:   ${FILE_COUNT} changed"
echo "│    Lines:   +${INSERTIONS} / -${DELETIONS}"
echo "│    Commits: ${COMMIT_COUNT}"
echo "│    Branch:  ${BRANCH}"
echo "│"

# Tokens block (optional)
if [ "$HAS_TOKENS" = true ]; then
  echo "├─ Tokens"
  printf "│    Input:       %s\n" "$(fmt "$INPUT_TOKENS")"
  printf "│    Output:      %s\n" "$(fmt "$OUTPUT_TOKENS")"
  printf "│    Cache Read:  %s\n" "$(fmt "$CACHE_READ")"
  printf "│    Cache Write: %s\n" "$(fmt "$CACHE_WRITE")"
  printf "│    Total:       %s\n" "$(fmt "$TOTAL_TOKENS")"
  echo "│"

  # Cost block
  echo "├─ Cost"
  echo "│    Model:    ${MODEL_SHORT}"
  printf "│    Estimate: \$%s\n" "${COST_USD}"
  echo "│"
fi

# Links block
echo "├─ Links"
if [ -n "$PR_URL" ]; then
  echo "│    PR:      ${PR_URL}"
fi
if [ -n "$PREVIEW_URL" ]; then
  echo "│    Preview: ${PREVIEW_URL}"
fi
echo "│    QA:      ${QA_RESULT}"
echo "│"
echo "└─ Done. Ready to ship."
echo ""
