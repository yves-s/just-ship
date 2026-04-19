#!/bin/bash
# epic-completion-check.test.sh — Acceptance Criteria verification for T-905
# Tests cross-project epic auto-completion via /ship guardrails.
# Usage: bash .claude/scripts/epic-completion-check.test.sh

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/epic-completion-check.sh"
TESTS=0
PASS=0
FAIL=0

TEST_TEMP=$(mktemp -d)
TEST_PROJECT="$TEST_TEMP/test-project"
MOCK_STATE="$TEST_TEMP/mock-state"

mkdir -p "$TEST_PROJECT/.claude/scripts"
mkdir -p "$MOCK_STATE"

cleanup() { rm -rf "$TEST_TEMP"; }
trap cleanup EXIT

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

cp "$SCRIPT" "$TEST_PROJECT/.claude/scripts/epic-completion-check.sh"

# --- Mock board-api.sh ------------------------------------------------------
# Simulates board responses for epic + children. Controlled via files in
# $MOCK_STATE. Tracks PATCH calls in $MOCK_STATE/patches.log for assertions.
cat > "$TEST_PROJECT/.claude/scripts/board-api.sh" <<MOCKEOF
#!/bin/bash
# Mock board-api.sh for epic-completion-check tests.
MOCK_STATE_DIR="$MOCK_STATE"

METHOD="\$1"
ENDPOINT="\$2"
BODY="\${3:-}"

if [ "\$METHOD" = "get" ]; then
  # Route: tickets/<N> → return single child/epic fixture by number
  if [[ "\$ENDPOINT" =~ ^tickets/([0-9]+)\$ ]]; then
    NUM="\${BASH_REMATCH[1]}"
    FIXTURE="\$MOCK_STATE_DIR/ticket-\$NUM.json"
    if [ -f "\$FIXTURE" ]; then
      cat "\$FIXTURE"
      exit 0
    fi
    echo '{"error":"not_found"}' >&2
    exit 2
  fi

  # Route: tickets?limit=... → return full list fixture
  if [[ "\$ENDPOINT" =~ ^tickets\? ]]; then
    FIXTURE="\$MOCK_STATE_DIR/list.json"
    if [ -f "\$FIXTURE" ]; then
      cat "\$FIXTURE"
      exit 0
    fi
    echo '{"data":{"tickets":[]}}'
    exit 0
  fi
fi

if [ "\$METHOD" = "patch" ]; then
  # Log the patch for assertion and succeed.
  echo "\$ENDPOINT|\$BODY" >> "\$MOCK_STATE_DIR/patches.log"
  echo '{"data":{}}'
  exit 0
fi

echo "unknown method" >&2
exit 1
MOCKEOF
chmod +x "$TEST_PROJECT/.claude/scripts/board-api.sh"

# Helper: reset mock state between tests
reset_mock() {
  rm -f "$MOCK_STATE"/*.json "$MOCK_STATE"/*.log
}

# Helper: seed fixture files
seed_child() {
  # $1=number $2=parent_id (or "null") $3=status
  local num="$1" parent="$2" status="$3"
  local parent_json
  if [ "$parent" = "null" ]; then
    parent_json="null"
  else
    parent_json="\"$parent\""
  fi
  cat > "$MOCK_STATE/ticket-$num.json" <<EOF
{"data":{"id":"child-$num","number":$num,"parent_ticket_id":$parent_json,"status":"$status","ticket_type":"task","project_id":"p1"}}
EOF
}

seed_list() {
  # $1 = JSON array of ticket objects
  local list_json="$1"
  cat > "$MOCK_STATE/list.json" <<EOF
{"data":{"tickets":$list_json}}
EOF
}

assert_patched() {
  local description="$1" expected_pattern="$2"
  if [ ! -f "$MOCK_STATE/patches.log" ]; then
    test_fail "$description" "No PATCH calls recorded"
    return
  fi
  if grep -qE "$expected_pattern" "$MOCK_STATE/patches.log"; then
    test_pass "$description"
  else
    test_fail "$description" "Expected pattern '$expected_pattern' not found. Got: $(cat "$MOCK_STATE/patches.log")"
  fi
}

assert_no_patch() {
  local description="$1"
  if [ ! -f "$MOCK_STATE/patches.log" ] || [ ! -s "$MOCK_STATE/patches.log" ]; then
    test_pass "$description"
  else
    test_fail "$description" "Expected no PATCH calls. Got: $(cat "$MOCK_STATE/patches.log")"
  fi
}

echo "Testing epic-completion-check.sh — T-905 Acceptance Criteria"
echo ""

# ───────────────────────────────────────────────────────────────────────────
# AC1: Cross-project epic completes only after the last child is done
# ───────────────────────────────────────────────────────────────────────────
echo "Test: AC1 — Cross-project epic staggered completion"

# Epic has 3 children across 2 projects; two done, one still in_progress.
reset_mock
seed_child 100 "epic-abc" "done"
seed_list '[
  {"id":"epic-abc","number":42,"ticket_type":"epic","epic_state":"in_progress","parent_ticket_id":null,"project_id":null,"title":"Cross-proj epic"},
  {"id":"child-100","number":100,"ticket_type":"task","parent_ticket_id":"epic-abc","project_id":"engine","status":"done"},
  {"id":"child-101","number":101,"ticket_type":"task","parent_ticket_id":"epic-abc","project_id":"board","status":"done"},
  {"id":"child-102","number":102,"ticket_type":"task","parent_ticket_id":"epic-abc","project_id":"engine","status":"in_progress"}
]'

OUTPUT=$(cd "$TEST_PROJECT" && bash "$TEST_PROJECT/.claude/scripts/epic-completion-check.sh" 100 2>&1)
assert_no_patch "AC1a: epic stays unchanged while a child is in_progress"

# Now finish the last child — all 3 done → epic must transition.
reset_mock
seed_child 102 "epic-abc" "done"
seed_list '[
  {"id":"epic-abc","number":42,"ticket_type":"epic","epic_state":"in_progress","parent_ticket_id":null,"project_id":null,"title":"Cross-proj epic"},
  {"id":"child-100","number":100,"ticket_type":"task","parent_ticket_id":"epic-abc","project_id":"engine","status":"done"},
  {"id":"child-101","number":101,"ticket_type":"task","parent_ticket_id":"epic-abc","project_id":"board","status":"done"},
  {"id":"child-102","number":102,"ticket_type":"task","parent_ticket_id":"epic-abc","project_id":"engine","status":"done"}
]'

OUTPUT=$(cd "$TEST_PROJECT" && bash "$TEST_PROJECT/.claude/scripts/epic-completion-check.sh" 102 2>&1)
assert_patched "AC1b: epic transitions after last child done" 'tickets/42\|.*epic_state.*completed'

if echo "$OUTPUT" | grep -q "✓ epic T-42 completed"; then
  test_pass "AC1c: success output printed with epic number + progress"
else
  test_fail "AC1c: success output" "Got: $OUTPUT"
fi

# ───────────────────────────────────────────────────────────────────────────
# AC2: Single-project epic still transitions correctly (regression guard)
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: AC2 — Single-project epic still works"

reset_mock
seed_child 200 "epic-single" "done"
seed_list '[
  {"id":"epic-single","number":50,"ticket_type":"epic","epic_state":"in_progress","parent_ticket_id":null,"project_id":"p1","title":"Single-proj epic"},
  {"id":"child-200","number":200,"ticket_type":"task","parent_ticket_id":"epic-single","project_id":"p1","status":"done"},
  {"id":"child-201","number":201,"ticket_type":"task","parent_ticket_id":"epic-single","project_id":"p1","status":"done"}
]'

OUTPUT=$(cd "$TEST_PROJECT" && bash "$TEST_PROJECT/.claude/scripts/epic-completion-check.sh" 200 2>&1)
assert_patched "AC2: single-project epic transitions to completed" 'tickets/50\|.*epic_state.*completed'

# ───────────────────────────────────────────────────────────────────────────
# AC3: Idempotent — already-completed epic is NOT re-patched
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: AC3 — Idempotent, no re-transition on already-done epic"

reset_mock
seed_child 300 "epic-done" "done"
seed_list '[
  {"id":"epic-done","number":60,"ticket_type":"epic","epic_state":"completed","parent_ticket_id":null,"project_id":null,"title":"Already done"},
  {"id":"child-300","number":300,"ticket_type":"task","parent_ticket_id":"epic-done","project_id":"p1","status":"done"}
]'

OUTPUT=$(cd "$TEST_PROJECT" && bash "$TEST_PROJECT/.claude/scripts/epic-completion-check.sh" 300 2>&1)
assert_no_patch "AC3: completed epic is not re-patched (idempotent)"

# ───────────────────────────────────────────────────────────────────────────
# AC4: Child without parent_ticket_id is a no-op
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: AC4 — Orphan child is a no-op"

reset_mock
seed_child 400 "null" "done"
seed_list '[
  {"id":"child-400","number":400,"ticket_type":"task","parent_ticket_id":null,"project_id":"p1","status":"done"}
]'

OUTPUT=$(cd "$TEST_PROJECT" && bash "$TEST_PROJECT/.claude/scripts/epic-completion-check.sh" 400 2>&1)
assert_no_patch "AC4: orphan child produces no PATCH"

# ───────────────────────────────────────────────────────────────────────────
# AC5: Canceled epic is also idempotent (terminal state)
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: AC5 — Canceled epic stays canceled"

reset_mock
seed_child 500 "epic-canceled" "done"
seed_list '[
  {"id":"epic-canceled","number":70,"ticket_type":"epic","epic_state":"canceled","parent_ticket_id":null,"project_id":"p1","title":"Canceled epic"},
  {"id":"child-500","number":500,"ticket_type":"task","parent_ticket_id":"epic-canceled","project_id":"p1","status":"done"}
]'

OUTPUT=$(cd "$TEST_PROJECT" && bash "$TEST_PROJECT/.claude/scripts/epic-completion-check.sh" 500 2>&1)
assert_no_patch "AC5: canceled epic is not transitioned"

# ───────────────────────────────────────────────────────────────────────────
# AC6: Script is always exit-0 (non-blocking)
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "Test: AC6 — Non-blocking exit"

reset_mock
# Missing ticket fixture → GET fails
cd "$TEST_PROJECT" && bash "$SCRIPT" 999 2>&1 >/dev/null
if [ $? -eq 0 ]; then
  test_pass "AC6a: missing ticket → exit 0 (non-blocking)"
else
  test_fail "AC6a: missing ticket → exit 0" "Got non-zero exit"
fi

# Missing ticket number argument
cd "$TEST_PROJECT" && bash "$SCRIPT" 2>&1 >/dev/null
if [ $? -eq 0 ]; then
  test_pass "AC6b: empty argument → exit 0"
else
  test_fail "AC6b: empty argument → exit 0" "Got non-zero exit"
fi

# ───────────────────────────────────────────────────────────────────────────
# Summary
# ───────────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
echo "Tests: $TESTS · Passed: $PASS · Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
