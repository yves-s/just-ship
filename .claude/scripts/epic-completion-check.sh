#!/bin/bash
# epic-completion-check.sh — Cross-project epic auto-completion
# Usage: bash .claude/scripts/epic-completion-check.sh <child_ticket_number>
#
# Called by /ship (step 6a) after a child transitions to `done`. Derives epic
# completion by querying every child of the parent epic across all projects in
# the workspace. When every child is `done`, transitions the epic to
# `epic_state = "completed"` (the board's status-from-state derivation will
# then surface it as `done`).
#
# Idempotent: skips epics already in `completed`/`canceled` state, and skips
# children whose ticket has no `parent_ticket_id`.
#
# Exit 0 always (non-blocking — never fails the ship).

set -euo pipefail

TICKET_NUMBER="${1:-}"
[ -z "$TICKET_NUMBER" ] && exit 0

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Fetch the child ticket to get its parent_ticket_id.
CHILD_JSON=$(bash "$SCRIPT_DIR/board-api.sh" get "tickets/$TICKET_NUMBER" 2>/dev/null) || exit 0
[ -z "$CHILD_JSON" ] && exit 0

PARENT_ID=$(echo "$CHILD_JSON" | node -e "
  try {
    const j = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
    process.stdout.write(j?.data?.parent_ticket_id || '');
  } catch(e) { process.stdout.write(''); }
" 2>/dev/null)

# No parent → not part of an epic, nothing to do.
[ -z "$PARENT_ID" ] && exit 0

# Fetch workspace tickets in one max-size call. The list endpoint has no
# offset filter and caps at 500 — workspaces beyond that bound will drop the
# oldest children from the epic check and the epic stays in_progress until a
# future child ship lands a window that includes every sibling. This is an
# acceptable fallback (worst case: epic completes one ship later).
LIST_JSON=$(bash "$SCRIPT_DIR/board-api.sh" get "tickets?limit=500&include_completed_epics=1" 2>/dev/null) || exit 0
[ -z "$LIST_JSON" ] && exit 0

# Evaluate completion state in Node (clean JSON handling beats jq for
# portability across macOS/Linux CI boxes).
RESULT=$(echo "$LIST_JSON" | node -e "
  let out = { skip: true };
  try {
    const parentId = process.argv[1];
    const j = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
    const list = j?.data?.tickets || j?.data || [];

    // Find the epic itself (ticket where id === parentId)
    const epic = list.find(t => t.id === parentId);
    if (!epic) {
      // Epic not in current page — may be in a deeper page. Emit skip so we
      // don't accidentally transition nothing. Worst case: next child ship
      // succeeds the check.
      out = { skip: true, reason: 'epic_not_in_page' };
    } else if (epic.ticket_type !== 'epic') {
      out = { skip: true, reason: 'parent_not_epic' };
    } else if (epic.epic_state === 'completed' || epic.epic_state === 'canceled') {
      // Idempotent: already in terminal state.
      out = { skip: true, reason: 'already_terminal', epic_number: epic.number, epic_state: epic.epic_state };
    } else {
      const children = list.filter(t => t.parent_ticket_id === parentId);
      const total = children.length;
      const doneCount = children.filter(c => c.status === 'done').length;
      const allDone = total > 0 && doneCount === total;
      out = {
        skip: false,
        epic_id: epic.id,
        epic_number: epic.number,
        epic_title: epic.title,
        total,
        done_count: doneCount,
        all_done: allDone,
      };
    }
  } catch (e) {
    out = { skip: true, reason: 'parse_error', error: String(e) };
  }
  process.stdout.write(JSON.stringify(out));
" "$PARENT_ID" 2>/dev/null)

[ -z "$RESULT" ] && exit 0

SKIP=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).skip))" 2>/dev/null)
if [ "$SKIP" = "true" ]; then
  exit 0
fi

ALL_DONE=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).all_done))" 2>/dev/null)
if [ "$ALL_DONE" != "true" ]; then
  exit 0
fi

EPIC_NUMBER=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).epic_number))" 2>/dev/null)
EPIC_TITLE=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).epic_title || ''))" 2>/dev/null)
DONE_COUNT=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).done_count))" 2>/dev/null)
TOTAL=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).total))" 2>/dev/null)

if [ -z "$EPIC_NUMBER" ] || [ "$EPIC_NUMBER" = "undefined" ]; then
  exit 0
fi

# Transition epic to completed. Epics use epic_state, not status —
# validateEpicUpdate rejects direct status writes on epic tickets with 400
# epic_status_immutable. The board derives status from epic_state.
if bash "$SCRIPT_DIR/board-api.sh" patch "tickets/$EPIC_NUMBER" '{"epic_state": "completed"}' >/dev/null 2>&1; then
  echo "✓ epic T-$EPIC_NUMBER completed ($DONE_COUNT/$TOTAL children done)"
else
  echo "⚠ epic T-$EPIC_NUMBER completion PATCH failed (children: $DONE_COUNT/$TOTAL) — check manually"
fi

exit 0
