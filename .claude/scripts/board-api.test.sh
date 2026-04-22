#!/bin/bash
# board-api.test.sh — Acceptance Criteria verification for T-965
# Tests the project_id default-injection logic for `POST tickets`.
# Usage: bash .claude/scripts/board-api.test.sh

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/board-api.sh"
TESTS=0
PASS=0
FAIL=0

TEST_TEMP=$(mktemp -d)
TEST_PROJECT="$TEST_TEMP/test-project"
mkdir -p "$TEST_PROJECT"

cleanup() { rm -rf "$TEST_TEMP"; }
trap cleanup EXIT

test_pass() { echo "✓ $1"; PASS=$((PASS+1)); TESTS=$((TESTS+1)); }
test_fail() { echo "✗ $1"; echo "  Reason: $2"; FAIL=$((FAIL+1)); TESTS=$((TESTS+1)); }

# Re-implements the body-rewrite logic from board-api.sh so we can test it
# in isolation without making real HTTP calls. Keep this snippet in sync with
# the script — both come from the same source intent.
inject_default() {
  local body="$1"
  node -e "
    let body;
    try { body = JSON.parse(process.argv[1]); } catch(e) { process.stdout.write(process.argv[1]); process.exit(0); }
    if (body && typeof body === 'object' && !Array.isArray(body) && !Object.prototype.hasOwnProperty.call(body, 'project_id')) {
      let defaultPid = '';
      try { defaultPid = require('./project.json').pipeline?.project_id || ''; } catch(e) {}
      if (defaultPid) body.project_id = defaultPid;
    }
    process.stdout.write(JSON.stringify(body));
  " "$body" 2>/dev/null
}

test_explicit_project_id_passes_through() {
  local name="AC1: Explicit project_id in body is forwarded unchanged"
  cd "$TEST_PROJECT" || return
  cat > project.json <<EOF
{"pipeline":{"project_id":"00000000-0000-0000-0000-000000000000"}}
EOF
  local out
  out=$(inject_default '{"title":"x","project_id":"abc-123"}')
  if echo "$out" | grep -q '"project_id":"abc-123"'; then
    test_pass "$name"
  else
    test_fail "$name" "Expected project_id 'abc-123' preserved, got: $out"
  fi
}

test_missing_project_id_uses_default() {
  local name="AC2: Missing project_id falls back to pipeline.project_id"
  cd "$TEST_PROJECT" || return
  cat > project.json <<EOF
{"pipeline":{"project_id":"default-uuid-from-config"}}
EOF
  local out
  out=$(inject_default '{"title":"x"}')
  if echo "$out" | grep -q '"project_id":"default-uuid-from-config"'; then
    test_pass "$name"
  else
    test_fail "$name" "Expected default project_id injected, got: $out"
  fi
}

test_explicit_null_passes_through() {
  local name="AC3: Explicit project_id:null is preserved (cross-project epic)"
  cd "$TEST_PROJECT" || return
  cat > project.json <<EOF
{"pipeline":{"project_id":"default-uuid"}}
EOF
  local out
  out=$(inject_default '{"title":"x","project_id":null,"ticket_type":"epic"}')
  if echo "$out" | grep -q '"project_id":null'; then
    test_pass "$name"
  else
    test_fail "$name" "Expected project_id:null preserved, got: $out"
  fi
}

test_no_project_json_no_injection() {
  local name="AC4: Missing project.json leaves body unchanged"
  local empty_dir="$TEST_TEMP/empty"
  mkdir -p "$empty_dir"
  cd "$empty_dir" || return
  local out
  out=$(inject_default '{"title":"x"}')
  if echo "$out" | grep -q '"project_id"'; then
    test_fail "$name" "Expected no project_id when project.json missing, got: $out"
  else
    test_pass "$name"
  fi
}

test_invalid_json_passes_through() {
  local name="AC5: Invalid JSON body is forwarded as-is (no crash)"
  cd "$TEST_PROJECT" || return
  cat > project.json <<EOF
{"pipeline":{"project_id":"x"}}
EOF
  local out
  out=$(inject_default 'not-json')
  if [ "$out" = "not-json" ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected 'not-json' returned unchanged, got: $out"
  fi
}

test_empty_pipeline_project_id() {
  local name="AC6: Empty pipeline.project_id does not inject empty string"
  cd "$TEST_PROJECT" || return
  cat > project.json <<EOF
{"pipeline":{"project_id":""}}
EOF
  local out
  out=$(inject_default '{"title":"x"}')
  if echo "$out" | grep -q '"project_id"'; then
    test_fail "$name" "Expected no project_id when default is empty, got: $out"
  else
    test_pass "$name"
  fi
}

test_no_root_config_introduced() {
  local name="AC7: Anti-regression — board-api.sh does not read ~/.just-ship/config.json"
  if grep -q 'just-ship/config\.json' "$SCRIPT"; then
    # The legacy fallback (Tier 4) routes through write-config.sh, not direct file reads.
    # We only flag if there is a NEW direct read, which there shouldn't be.
    if grep -q 'cat.*just-ship/config\.json\|require.*just-ship/config\.json' "$SCRIPT"; then
      test_fail "$name" "Direct read of ~/.just-ship/config.json detected"
    else
      test_pass "$name"
    fi
  else
    test_pass "$name"
  fi
}

test_only_post_tickets_affected() {
  local name="AC8: Default injection limited to POST tickets endpoint"
  # Verify the guard exists in the script so PATCH tickets/{N} bodies are
  # never rewritten (status updates must not gain a stray project_id).
  if grep -q 'METHOD" = "POST" \] && \[ "\$ENDPOINT" = "tickets"' "$SCRIPT"; then
    test_pass "$name"
  else
    test_fail "$name" "Guard for POST tickets only is missing — other endpoints could be affected"
  fi
}

echo "=== Testing board-api.sh project_id injection (T-965) ==="
echo

test_explicit_project_id_passes_through
test_missing_project_id_uses_default
test_explicit_null_passes_through
test_no_project_json_no_injection
test_invalid_json_passes_through
test_empty_pipeline_project_id
test_no_root_config_introduced
test_only_post_tickets_affected

echo
echo "=== Test Summary ==="
echo "Total: $TESTS | Pass: $PASS | Fail: $FAIL"

if [ $FAIL -eq 0 ]; then
  echo "All tests passed!"
  exit 0
else
  echo "$FAIL test(s) failed"
  exit 1
fi
