#!/bin/bash
# develop-epic-guardrail.test.sh — Acceptance Criteria verification for T-905
# Tests the epic guardrail snippet in commands/develop.md by running it in
# isolation against sample ticket JSON responses.
# Usage: bash .claude/scripts/develop-epic-guardrail.test.sh

set +e

TESTS=0
PASS=0
FAIL=0

test_pass() {
  echo "  ✓ $1"
  PASS=$((PASS + 1))
  TESTS=$((TESTS + 1))
}

test_fail() {
  echo "  ✗ $1"
  echo "    $2"
  FAIL=$((FAIL + 1))
  TESTS=$((TESTS + 1))
}

# Extract the guardrail snippet from commands/develop.md. The guardrail must
# exit non-zero for epics so /develop never creates a worktree on an epic.
guardrail() {
  local ticket_json="$1"
  local exit_code=0
  local output=""

  # Identical logic to commands/develop.md Step 1.5.
  output=$(echo "$ticket_json" | (
    TICKET_JSON=$(cat)
    TICKET_TYPE=$(echo "$TICKET_JSON" | node -e "
      try {
        const j = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
        process.stdout.write(String(j?.data?.ticket_type || j?.ticket_type || ''));
      } catch(e) { process.stdout.write(''); }
    " 2>/dev/null)

    if [ "$TICKET_TYPE" = "epic" ]; then
      echo "✗ Epics are containers — pick a child ticket." >&2
      exit 1
    fi
    exit 0
  ) 2>&1)
  exit_code=$?

  echo "$exit_code|$output"
}

echo "Testing /develop epic guardrail — T-905"
echo ""

# ───────────────────────────────────────────────────────────────────────────
# AC1: Epic ticket blocks /develop with exit 1 and informative message
# ───────────────────────────────────────────────────────────────────────────
echo "Test: AC1 — Epic blocks /develop"

EPIC_JSON='{"data":{"id":"abc","number":42,"ticket_type":"epic","title":"Some epic","status":"in_progress"}}'
RESULT=$(guardrail "$EPIC_JSON")
EXIT="${RESULT%%|*}"
MSG="${RESULT#*|}"

if [ "$EXIT" = "1" ]; then
  test_pass "AC1a: epic produces exit code 1"
else
  test_fail "AC1a: exit code" "Got exit=$EXIT, msg=$MSG"
fi

if echo "$MSG" | grep -q "Epics are containers"; then
  test_pass "AC1b: informative error message"
else
  test_fail "AC1b: message" "Got: $MSG"
fi

# ───────────────────────────────────────────────────────────────────────────
# AC2: Regular task passes the guardrail (exit 0, no message)
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: AC2 — Task tickets pass through"

TASK_JSON='{"data":{"id":"xyz","number":100,"ticket_type":"task","title":"Regular task","status":"ready_to_develop"}}'
RESULT=$(guardrail "$TASK_JSON")
EXIT="${RESULT%%|*}"

if [ "$EXIT" = "0" ]; then
  test_pass "AC2: task produces exit 0 (continues to develop)"
else
  test_fail "AC2: task exit" "Got exit=$EXIT"
fi

# ───────────────────────────────────────────────────────────────────────────
# AC3: Missing ticket_type defaults to non-epic → passes
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: AC3 — Missing ticket_type defaults to pass"

NO_TYPE_JSON='{"data":{"id":"xyz","number":100,"title":"No type","status":"ready_to_develop"}}'
RESULT=$(guardrail "$NO_TYPE_JSON")
EXIT="${RESULT%%|*}"

if [ "$EXIT" = "0" ]; then
  test_pass "AC3: missing ticket_type → treated as task"
else
  test_fail "AC3: missing type" "Got exit=$EXIT"
fi

# ───────────────────────────────────────────────────────────────────────────
# AC4: Malformed JSON does not spuriously block (exit 0)
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: AC4 — Malformed JSON does not spuriously block"

BAD_JSON='this is not json'
RESULT=$(guardrail "$BAD_JSON")
EXIT="${RESULT%%|*}"

if [ "$EXIT" = "0" ]; then
  test_pass "AC4: malformed JSON → does not block (parse failure treated as non-epic)"
else
  test_fail "AC4: malformed JSON" "Got exit=$EXIT"
fi

# ───────────────────────────────────────────────────────────────────────────
# Verify commands/develop.md still contains the guardrail snippet
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: commands/develop.md contains Epic-Guardrail section"

DEVELOP_MD="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/commands/develop.md"
if [ ! -f "$DEVELOP_MD" ]; then
  test_fail "guardrail snippet in develop.md" "develop.md not found at $DEVELOP_MD"
elif grep -q "Epic-Guardrail" "$DEVELOP_MD" && grep -q "Epics are containers" "$DEVELOP_MD"; then
  test_pass "commands/develop.md has Epic-Guardrail section with correct message"
else
  test_fail "guardrail snippet in develop.md" "Missing 'Epic-Guardrail' or 'Epics are containers' in develop.md"
fi

echo ""
echo "────────────────────────────────────────"
echo "Tests: $TESTS · Passed: $PASS · Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
