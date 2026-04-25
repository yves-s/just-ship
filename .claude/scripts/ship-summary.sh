#!/bin/bash
# ship-summary.sh — Render the ship-complete block after /ship has merged.
# Renders skills/reporter/templates/ship-complete.md with the provided values.
# Usage:
#   bash .claude/scripts/ship-summary.sh \
#     <ticket_number> <commit_subject> <pr_url> <branch> \
#     <worktree_status> <board_status> [<stale_branches_block>]
# Output: Formatted ship-complete block on stdout.

set -euo pipefail

TICKET_NUMBER="${1:-}"
COMMIT_SUBJECT="${2:-}"
PR_URL="${3:-}"
BRANCH="${4:-}"
WORKTREE_STATUS="${5:-none}"
BOARD_STATUS="${6:--}"
STALE_BRANCHES_BLOCK="${7:-}"

if [ -z "$TICKET_NUMBER" ] || [ -z "$COMMIT_SUBJECT" ] || [ -z "$PR_URL" ] || [ -z "$BRANCH" ]; then
  echo "Usage: ship-summary.sh <ticket_number> <commit_subject> <pr_url> <branch> <worktree_status> <board_status> [<stale_branches_block>]" >&2
  exit 1
fi

echo "✓ Shipped: ${COMMIT_SUBJECT}"
echo ""
printf "PR        %s\n" "${PR_URL}"
printf "Branch    %s → deleted\n" "${BRANCH}"
printf "Worktree  .worktrees/T-%s → %s\n" "${TICKET_NUMBER}" "${WORKTREE_STATUS}"
printf "Board     %s\n" "${BOARD_STATUS}"

if [ -n "$STALE_BRANCHES_BLOCK" ]; then
  echo ""
  echo "Hinweis — folgende Branches könnten aufgeräumt werden:"
  printf "%s\n" "$STALE_BRANCHES_BLOCK" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    printf "  %s\n" "$line"
  done
fi
