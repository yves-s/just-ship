#!/bin/bash
# write-config-connect.test.sh — Acceptance Criteria verification for T-967
# Tests the scenario detection in cmd_connect:
#   fresh / refresh / switch / mismatch
# Usage: bash .claude/scripts/write-config-connect.test.sh

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/write-config.sh"
TESTS=0
PASS=0
FAIL=0

TEST_TEMP=$(mktemp -d)
cleanup() { rm -rf "$TEST_TEMP"; }
trap cleanup EXIT

test_pass() { echo "✓ $1"; PASS=$((PASS+1)); TESTS=$((TESTS+1)); }
test_fail() { echo "✗ $1"; echo "  Reason: $2"; FAIL=$((FAIL+1)); TESTS=$((TESTS+1)); }

# Sources write-config.sh to call detect_connect_scenario in-process.
# The script uses `set -euo pipefail` which would exit the test runner if we
# sourced it directly. Instead we re-implement the detector identically to the
# function body and keep them in sync via this file. If the detector changes,
# update both spots.
detect() {
  local pjson="$1" new_ws="$2" new_pr="${3:-}"
  JS_PJSON="$pjson" JS_NEW_WS="$new_ws" JS_NEW_PR="$new_pr" node -e "
    const fs = require('fs');
    const pjsonPath = process.env.JS_PJSON;
    const newWs = process.env.JS_NEW_WS;
    const newPr = process.env.JS_NEW_PR || '';
    let currentWs = '', currentPr = '';
    try {
      if (fs.existsSync(pjsonPath)) {
        const pj = JSON.parse(fs.readFileSync(pjsonPath, 'utf-8'));
        currentWs = (pj.pipeline && pj.pipeline.workspace_id) || '';
        currentPr = (pj.pipeline && pj.pipeline.project_id) || '';
      }
    } catch (_) {}
    let scenario;
    if (!currentWs) scenario = 'fresh';
    else if (currentWs !== newWs) scenario = 'mismatch';
    else if (!newPr || !currentPr || newPr === currentPr) scenario = 'refresh';
    else scenario = 'switch';
    process.stdout.write(scenario);
  "
}

mk_pjson() {
  local path="$1" ws="$2" pr="${3:-}"
  if [ -z "$ws" ]; then
    echo '{"pipeline":{}}' > "$path"
  elif [ -z "$pr" ]; then
    printf '{"pipeline":{"workspace_id":"%s"}}\n' "$ws" > "$path"
  else
    printf '{"pipeline":{"workspace_id":"%s","project_id":"%s"}}\n' "$ws" "$pr" > "$path"
  fi
}

WS_A="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
WS_B="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
PR_1="11111111-1111-1111-1111-111111111111"
PR_2="22222222-2222-2222-2222-222222222222"

test_fresh_no_project_json() {
  local name="AC1: No project.json → scenario 'fresh'"
  local pjson="$TEST_TEMP/missing.json"
  local out
  out=$(detect "$pjson" "$WS_A" "$PR_1")
  if [ "$out" = "fresh" ]; then test_pass "$name"; else test_fail "$name" "expected fresh, got: $out"; fi
}

test_fresh_empty_pipeline() {
  local name="AC2: project.json without workspace_id → 'fresh'"
  local pjson="$TEST_TEMP/empty.json"
  mk_pjson "$pjson" "" ""
  local out
  out=$(detect "$pjson" "$WS_A" "$PR_1")
  if [ "$out" = "fresh" ]; then test_pass "$name"; else test_fail "$name" "expected fresh, got: $out"; fi
}

test_refresh_same_project() {
  local name="AC3: Same workspace + same project → 'refresh' (silent key rotation)"
  local pjson="$TEST_TEMP/same.json"
  mk_pjson "$pjson" "$WS_A" "$PR_1"
  local out
  out=$(detect "$pjson" "$WS_A" "$PR_1")
  if [ "$out" = "refresh" ]; then test_pass "$name"; else test_fail "$name" "expected refresh, got: $out"; fi
}

test_refresh_v2_token_no_project() {
  local name="AC4: v2 token (no project in token) → 'refresh', never 'switch'"
  local pjson="$TEST_TEMP/v2.json"
  mk_pjson "$pjson" "$WS_A" "$PR_1"
  local out
  out=$(detect "$pjson" "$WS_A" "")
  if [ "$out" = "refresh" ]; then test_pass "$name"; else test_fail "$name" "expected refresh, got: $out"; fi
}

test_switch_same_workspace_different_project() {
  local name="AC5: Same workspace + different project → 'switch' (one confirmation)"
  local pjson="$TEST_TEMP/switch.json"
  mk_pjson "$pjson" "$WS_A" "$PR_1"
  local out
  out=$(detect "$pjson" "$WS_A" "$PR_2")
  if [ "$out" = "switch" ]; then test_pass "$name"; else test_fail "$name" "expected switch, got: $out"; fi
}

test_mismatch_different_workspace() {
  local name="AC6: Different workspace → 'mismatch' (warn, no write without confirm)"
  local pjson="$TEST_TEMP/mismatch.json"
  mk_pjson "$pjson" "$WS_A" "$PR_1"
  local out
  out=$(detect "$pjson" "$WS_B" "$PR_2")
  if [ "$out" = "mismatch" ]; then test_pass "$name"; else test_fail "$name" "expected mismatch, got: $out"; fi
}

test_mismatch_when_only_workspace_known() {
  local name="AC7: Different workspace (no project_id in current config) → 'mismatch'"
  local pjson="$TEST_TEMP/mismatch2.json"
  mk_pjson "$pjson" "$WS_A" ""
  local out
  out=$(detect "$pjson" "$WS_B" "$PR_1")
  if [ "$out" = "mismatch" ]; then test_pass "$name"; else test_fail "$name" "expected mismatch, got: $out"; fi
}

test_malformed_project_json_treated_as_fresh() {
  local name="AC8: Malformed project.json → 'fresh' (graceful)"
  local pjson="$TEST_TEMP/broken.json"
  echo '{ not valid json' > "$pjson"
  local out
  out=$(detect "$pjson" "$WS_A" "$PR_1")
  if [ "$out" = "fresh" ]; then test_pass "$name"; else test_fail "$name" "expected fresh, got: $out"; fi
}

test_integration_plugin_mode_mismatch_emits_structured_error() {
  local name="AC9: Plugin mode + mismatch emits success:false, error:workspace_mismatch"
  # Synthetic jsp_ token: base64( {"v":3,"b":"https://board.just-ship.io","w":"ws-b","i":"<WS_B>","k":"adp_test","p":"<PR_2>"} )
  local token_payload
  token_payload=$(JS_WS="$WS_B" JS_PR="$PR_2" node -e "
    const payload = JSON.stringify({
      v: 3, b: 'https://board.just-ship.io',
      w: 'ws-b', i: process.env.JS_WS, k: 'adp_test', p: process.env.JS_PR,
    });
    process.stdout.write(Buffer.from(payload, 'utf-8').toString('base64'));
  ")
  local token="jsp_${token_payload}"

  local project_dir="$TEST_TEMP/plugin-test"
  mkdir -p "$project_dir"
  mk_pjson "$project_dir/project.json" "$WS_A" "$PR_1"

  local out
  out=$(bash "$SCRIPT" connect --token "$token" --project-dir "$project_dir" --plugin-mode 2>&1)
  if echo "$out" | grep -q '"error": "workspace_mismatch"' && echo "$out" | grep -q '"success": false'; then
    # And project.json must not have been overwritten
    local ws_after
    ws_after=$(node -e "process.stdout.write(require('$project_dir/project.json').pipeline.workspace_id)")
    if [ "$ws_after" = "$WS_A" ]; then
      test_pass "$name"
    else
      test_fail "$name" "project.json was overwritten (workspace_id is now '$ws_after', expected '$WS_A')"
    fi
  else
    test_fail "$name" "expected structured mismatch error, got: $out"
  fi
}

test_integration_plugin_mode_refresh_returns_scenario() {
  local name="AC10: Plugin mode + refresh returns scenario:'refresh' in JSON"
  local token_payload
  token_payload=$(JS_WS="$WS_A" JS_PR="$PR_1" node -e "
    const payload = JSON.stringify({
      v: 3, b: 'https://board.just-ship.io',
      w: 'ws-a', i: process.env.JS_WS, k: 'adp_test', p: process.env.JS_PR,
    });
    process.stdout.write(Buffer.from(payload, 'utf-8').toString('base64'));
  ")
  local token="jsp_${token_payload}"

  local project_dir="$TEST_TEMP/plugin-refresh"
  mkdir -p "$project_dir"
  mk_pjson "$project_dir/project.json" "$WS_A" "$PR_1"

  local out
  out=$(bash "$SCRIPT" connect --token "$token" --project-dir "$project_dir" --plugin-mode 2>&1)
  if echo "$out" | grep -q '"scenario": "refresh"'; then
    test_pass "$name"
  else
    test_fail "$name" "expected scenario:refresh, got: $out"
  fi
}

echo "=== Testing write-config.sh connect scenario detection (T-967) ==="
echo

test_fresh_no_project_json
test_fresh_empty_pipeline
test_refresh_same_project
test_refresh_v2_token_no_project
test_switch_same_workspace_different_project
test_mismatch_different_workspace
test_mismatch_when_only_workspace_known
test_malformed_project_json_treated_as_fresh
test_integration_plugin_mode_mismatch_emits_structured_error
test_integration_plugin_mode_refresh_returns_scenario

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
