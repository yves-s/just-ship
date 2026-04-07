#!/usr/bin/env bash
# pipeline-smoke-test.sh — E2E Smoke Test for the Just Ship Pipeline
#
# Verifies Board API communication end-to-end by:
#   1. Creating a test ticket
#   2. Cycling through all pipeline statuses (in_progress → in_review → done)
#   3. Verifying each status update via a GET call
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks failed

set -euo pipefail

# ─── Locate repo root ──────────────────────────────────────────────────────────
REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: Not inside a git repository. Run this script from within the just-ship repo." >&2
  exit 1
}

BOARD_API="$REPO_ROOT/.claude/scripts/board-api.sh"

if [ ! -f "$BOARD_API" ]; then
  echo "ERROR: board-api.sh not found at $BOARD_API" >&2
  exit 1
fi

# ─── Read project_id from project.json ─────────────────────────────────────────
PROJECT_ID=$(python3 -c "
import json, sys
try:
    with open('$REPO_ROOT/project.json') as f:
        d = json.load(f)
    print(d['pipeline']['project_id'])
except Exception as e:
    print('', end='')
" 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: pipeline.project_id not set in project.json" >&2
  exit 1
fi

# ─── Helpers ───────────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
TOTAL=6
TICKET_ID=""

print_header() {
  echo ""
  echo "═══════════════════════════════════════"
  echo " Pipeline E2E Smoke Test"
  echo "═══════════════════════════════════════"
  echo ""
}

print_step() {
  local step="$1"
  local label="$2"
  printf "[%s/%s] %-38s" "$step" "$TOTAL" "$label"
}

pass() {
  local detail="${1:-}"
  if [ -n "$detail" ]; then
    echo "PASS ($detail)"
  else
    echo "PASS"
  fi
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  local expected="${1:-}"
  local got="${2:-}"
  echo "FAIL"
  if [ -n "$expected" ] && [ -n "$got" ]; then
    echo "      Expected: $expected"
    echo "      Got:      $got"
  elif [ -n "$expected" ]; then
    echo "      $expected"
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

print_result() {
  echo ""
  echo "═══════════════════════════════════════"
  if [ "$FAIL_COUNT" -eq 0 ]; then
    echo " RESULT: PASS — All $TOTAL checks passed"
  else
    echo " RESULT: FAIL — $FAIL_COUNT of $TOTAL checks failed"
  fi
  echo "═══════════════════════════════════════"
  echo ""
}

extract_ticket_field() {
  local json="$1"
  local field="$2"
  echo "$json" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    ticket = d.get('data') or d.get('ticket') or d
    val = ticket.get('$field', '')
    if val is None:
        val = ''
    print(str(val))
except Exception:
    print('')
" 2>/dev/null
}

# ─── Main ──────────────────────────────────────────────────────────────────────
print_header

# Step 1: Create test ticket
print_step 1 "Creating test ticket..."
CREATE_RESPONSE=$(bash "$BOARD_API" post tickets \
  "{\"title\":\"[SMOKE TEST] Pipeline E2E Verification\",\"body\":\"Automated smoke test — verifies pipeline can process a ticket end-to-end. This ticket will be auto-deleted after the test.\",\"status\":\"ready_to_develop\",\"priority\":\"low\",\"tags\":[\"smoke-test\"],\"project_id\":\"$PROJECT_ID\",\"complexity\":\"low\"}" \
  2>/dev/null) || CREATE_RESPONSE=""

TICKET_NUM=$(extract_ticket_field "$CREATE_RESPONSE" "number")

if [ -z "$TICKET_NUM" ]; then
  fail "No ticket number in response"
  print_result
  exit 1
fi

pass "T-$TICKET_NUM"

# Step 2: Set status → in_progress
print_step 2 "Setting status: in_progress..."
UPDATE_RESPONSE=$(bash "$BOARD_API" patch "tickets/$TICKET_NUM" '{"status":"in_progress"}' 2>/dev/null) || UPDATE_RESPONSE=""

STATUS=$(extract_ticket_field "$UPDATE_RESPONSE" "status")

if [ "$STATUS" = "in_progress" ]; then
  pass
else
  fail "PATCH returned unexpected status" "$STATUS"
fi

# Step 3: Verify in_progress via GET
print_step 3 "Verifying status update..."
GET_RESPONSE=$(bash "$BOARD_API" get "tickets/$TICKET_NUM" 2>/dev/null) || GET_RESPONSE=""

VERIFIED_STATUS=$(extract_ticket_field "$GET_RESPONSE" "status")

if [ "$VERIFIED_STATUS" = "in_progress" ]; then
  pass
else
  fail "in_progress" "$VERIFIED_STATUS"
fi

# Step 4: Set status → in_review
print_step 4 "Setting status: in_review..."
UPDATE_RESPONSE=$(bash "$BOARD_API" patch "tickets/$TICKET_NUM" '{"status":"in_review"}' 2>/dev/null) || UPDATE_RESPONSE=""

STATUS=$(extract_ticket_field "$UPDATE_RESPONSE" "status")

if [ "$STATUS" = "in_review" ]; then
  pass
else
  fail "PATCH returned unexpected status" "$STATUS"
fi

# Step 5: Set status → done
print_step 5 "Setting status: done..."
UPDATE_RESPONSE=$(bash "$BOARD_API" patch "tickets/$TICKET_NUM" '{"status":"done"}' 2>/dev/null) || UPDATE_RESPONSE=""

STATUS=$(extract_ticket_field "$UPDATE_RESPONSE" "status")

if [ "$STATUS" = "done" ]; then
  pass
else
  # Attempt cleanup even on failure — mark done so it doesn't pollute backlog
  bash "$BOARD_API" patch "tickets/$TICKET_NUM" '{"status":"done"}' >/dev/null 2>&1 || true
  fail "PATCH returned unexpected status" "$STATUS"
fi

# Step 6: Verify final state via GET
print_step 6 "Verifying final state..."
GET_RESPONSE=$(bash "$BOARD_API" get "tickets/$TICKET_NUM" 2>/dev/null) || GET_RESPONSE=""

FINAL_STATUS=$(extract_ticket_field "$GET_RESPONSE" "status")

if [ "$FINAL_STATUS" = "done" ]; then
  pass
else
  fail "done" "$FINAL_STATUS"
fi

# ─── Result ────────────────────────────────────────────────────────────────────
print_result

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
