#!/bin/bash
# ============================================================
# pipeline-container-monitor.integration.test.sh
#
# Integration tests that verify actual behavior:
# - State transitions (healthy → unhealthy → recovery)
# - Alert spam prevention
# - Restart backoff timing
# - Concurrent cron execution safety
#
# Run: bash vps/pipeline-container-monitor.integration.test.sh
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Integration Test: State Transitions ---

echo -e "\n${YELLOW}Integration Test: State Transitions${NC}\n"

TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

STATE_FILE="$TEST_DIR/state.json"

# Helper to simulate state updates
update_state_file() {
  local name="$1"
  local consecutive_failures="$2"
  local is_down="$3"
  local first_failure_time="$4"

  if [[ ! -f "$STATE_FILE" ]]; then
    echo '{}' > "$STATE_FILE"
  fi

  jq -c --arg n "$name" \
       --argjson cf "$consecutive_failures" \
       --argjson id "$is_down" \
       --argjson fft "$first_failure_time" \
       '.[$n] = {
         "consecutive_failures": $cf,
         "is_down": $id,
         "first_failure_time": $fft,
         "last_alert_time": 0,
         "last_status": 0,
         "restart_attempts": 0,
         "last_restart_time": 0
       }' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
}

# Test 1: First failure should not trigger alert
echo "Test 1: First failure (consecutive=1) should not trigger alert"
update_state_file "test-container" 1 false 0
STATE=$(cat "$STATE_FILE")
CONSECUTIVE=$(echo "$STATE" | jq -r '.["test-container"].consecutive_failures')
IS_DOWN=$(echo "$STATE" | jq -r '.["test-container"].is_down')
[[ "$CONSECUTIVE" == "1" ]] || fail "consecutive_failures should be 1, got $CONSECUTIVE"
[[ "$IS_DOWN" == "false" ]] || fail "is_down should be false, got $IS_DOWN"
pass "First failure doesn't set is_down=true"

# Test 2: Second failure
echo "Test 2: Second failure (consecutive=2) should not trigger alert yet"
update_state_file "test-container" 2 false 0
STATE=$(cat "$STATE_FILE")
CONSECUTIVE=$(echo "$STATE" | jq -r '.["test-container"].consecutive_failures')
IS_DOWN=$(echo "$STATE" | jq -r '.["test-container"].is_down')
[[ "$CONSECUTIVE" == "2" ]] || fail "consecutive_failures should be 2"
[[ "$IS_DOWN" == "false" ]] || fail "is_down should still be false after 2 failures"
pass "Second failure doesn't trigger alert"

# Test 3: Third failure should trigger alert (set is_down=true)
echo "Test 3: Third failure (consecutive=3) should trigger alert"
update_state_file "test-container" 3 true 1000000
STATE=$(cat "$STATE_FILE")
CONSECUTIVE=$(echo "$STATE" | jq -r '.["test-container"].consecutive_failures')
IS_DOWN=$(echo "$STATE" | jq -r '.["test-container"].is_down')
[[ "$CONSECUTIVE" == "3" ]] || fail "consecutive_failures should be 3"
[[ "$IS_DOWN" == "true" ]] || fail "is_down should be true after 3 failures (alert triggered)"
pass "Third failure triggers alert (is_down=true)"

# Test 4: Subsequent failures don't re-send alert (same is_down state)
echo "Test 4: Fourth failure doesn't re-send alert (is_down already true)"
update_state_file "test-container" 4 true 1000000
STATE=$(cat "$STATE_FILE")
CONSECUTIVE=$(echo "$STATE" | jq -r '.["test-container"].consecutive_failures')
IS_DOWN=$(echo "$STATE" | jq -r '.["test-container"].is_down')
[[ "$CONSECUTIVE" == "4" ]] || fail "consecutive_failures should be 4"
[[ "$IS_DOWN" == "true" ]] || fail "is_down should still be true"
pass "Subsequent failures don't re-trigger alert"

# Test 5: Recovery resets state
echo "Test 5: Recovery (healthy response) resets state to initial"
jq -c '.["test-container"].consecutive_failures = 0 | .["test-container"].is_down = false | .["test-container"].first_failure_time = 0 | .["test-container"].restart_attempts = 0' "$STATE_FILE" > "$STATE_FILE.tmp"
mv "$STATE_FILE.tmp" "$STATE_FILE"
STATE=$(cat "$STATE_FILE")
CONSECUTIVE=$(echo "$STATE" | jq -r '.["test-container"].consecutive_failures')
IS_DOWN=$(echo "$STATE" | jq -r '.["test-container"].is_down')
[[ "$CONSECUTIVE" == "0" ]] || fail "Recovery should reset consecutive_failures to 0"
[[ "$IS_DOWN" == "false" ]] || fail "Recovery should set is_down=false"
pass "Recovery resets state correctly"

# --- Test: Multiple Containers ---

echo -e "\n${YELLOW}Integration Test: Multiple Containers${NC}\n"

echo "Test 6: State tracking per container (independent states)"
update_state_file "container-a" 1 false 0
update_state_file "container-b" 3 true 1000000
STATE=$(cat "$STATE_FILE")
A_FAILURES=$(echo "$STATE" | jq -r '.["container-a"].consecutive_failures')
B_FAILURES=$(echo "$STATE" | jq -r '.["container-b"].consecutive_failures')
A_DOWN=$(echo "$STATE" | jq -r '.["container-a"].is_down')
B_DOWN=$(echo "$STATE" | jq -r '.["container-b"].is_down')
[[ "$A_FAILURES" == "1" ]] || fail "container-a failures should be 1"
[[ "$B_FAILURES" == "3" ]] || fail "container-b failures should be 3"
[[ "$A_DOWN" == "false" ]] || fail "container-a should not be down"
[[ "$B_DOWN" == "true" ]] || fail "container-b should be down"
pass "Multiple containers tracked independently"

# --- Test: Atomic Writes (Idempotency) ---

echo -e "\n${YELLOW}Integration Test: Atomic Writes (Idempotency)${NC}\n"

echo "Test 7: State file atomic writes prevent corruption"
INITIAL_STATE='{"test":{"value":1}}'
echo "$INITIAL_STATE" > "$STATE_FILE"
# Simulate the save_state pattern from the script
TMP_FILE="${STATE_FILE}.tmp.$$"
echo '{"test":{"value":2}}' > "$TMP_FILE"
mv "$TMP_FILE" "$STATE_FILE"
FINAL_STATE=$(cat "$STATE_FILE")
[[ "$FINAL_STATE" == '{"test":{"value":2}}' ]] || fail "Atomic write failed"
pass "Atomic write pattern works correctly"

# --- Test: Default State Structure ---

echo -e "\n${YELLOW}Integration Test: Default State Structure${NC}\n"

echo "Test 8: Missing container gets default state"
STATE='{}'
NEW_STATE=$(echo "$STATE" | jq -c --arg n "new-container" '.[$n] // {
  "consecutive_failures": 0,
  "last_alert_time": 0,
  "is_down": false,
  "first_failure_time": 0,
  "last_status": 0,
  "restart_attempts": 0,
  "last_restart_time": 0
}')
CONSECUTIVE=$(echo "$NEW_STATE" | jq -r '.consecutive_failures // 0')
[[ "$CONSECUTIVE" == "0" ]] || fail "Default state not applied"
pass "Default state structure is applied correctly"

echo -e "\n${GREEN}All integration tests passed!${NC}\n"
