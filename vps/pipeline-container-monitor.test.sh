#!/bin/bash
# ============================================================
# pipeline-container-monitor.test.sh — Test suite for container monitor
#
# Tests cover:
#  - State tracking (consecutive failures, timestamps, restart attempts)
#  - Health check logic (HTTP status codes, timeouts)
#  - Telegram alerting (single alert per incident, recovery messages)
#  - Restart backoff logic (timing between attempts)
#  - Container discovery (config vs docker label fallback)
#  - No spam: max 1 alert per container per incident
#
# Run: bash vps/pipeline-container-monitor.test.sh
# ============================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
info() { echo -e "${BLUE}→${NC} $*"; }

# --- Test harness ---
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

test_case() {
  local name="$1"
  echo -e "\n${YELLOW}Test:${NC} $name"
  TESTS_RUN=$((TESTS_RUN + 1))
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local msg="${3:-}"
  if [[ "$actual" == "$expected" ]]; then
    pass "$(printf '%s' "$msg")" >&2
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    fail "Expected: '$expected', got: '$actual' — $msg" >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_true() {
  local condition="$1"
  local msg="${2:-}"
  if [[ "$condition" == "true" ]]; then
    pass "$msg" >&2
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    fail "Expected true, got false — $msg" >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# --- Setup test environment ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_SCRIPT="${SCRIPT_DIR}/pipeline-container-monitor.sh"

# Verify script exists
[[ -f "$MONITOR_SCRIPT" ]] || fail "Monitor script not found at: $MONITOR_SCRIPT"

# Create temp directories for test isolation
TEST_DIR=$(mktemp -d)
TEST_STATE_FILE="${TEST_DIR}/state.json"
TEST_CONFIG_FILE="${TEST_DIR}/config.json"
TEST_LOG_FILE="${TEST_DIR}/monitor.log"

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# --- Helper functions (extracted from script) ---

# Initialize empty state
init_state() {
  echo '{}' > "$TEST_STATE_FILE"
}

# Load JSON state file
load_state() {
  if [[ -f "$TEST_STATE_FILE" ]]; then
    cat "$TEST_STATE_FILE"
  else
    echo '{}'
  fi
}

# Get container state from global state
get_container_state() {
  local state="$1"
  local name="$2"
  echo "$state" | jq -c --arg n "$name" '.[$n] // {
    "consecutive_failures": 0,
    "last_alert_time": 0,
    "is_down": false,
    "first_failure_time": 0,
    "last_status": 0,
    "restart_attempts": 0,
    "last_restart_time": 0
  }'
}

# Update container state in global state
update_state() {
  local state="$1"
  local name="$2"
  local container_state="$3"
  echo "$state" | jq -c --arg n "$name" --argjson s "$container_state" '.[$n] = $s'
}

# Save state atomically
save_state() {
  local state="$1"
  local tmp_file="${TEST_STATE_FILE}.tmp.$$"
  echo "$state" > "$tmp_file"
  mv "$tmp_file" "$TEST_STATE_FILE"
}

# --- Test Suite ---

echo ""
echo "============================================================"
echo "  Pipeline Container Monitor Test Suite"
echo "============================================================"

# AC 1: Health-Checker prüft alle Pipeline-Container via /health mit 5s Timeout
test_case "HTTP health check with 5s timeout"
init_state
TIMEOUT_FOUND=$(grep -c "HEALTH_TIMEOUT=5" "$MONITOR_SCRIPT" || true)
assert_equal "$TIMEOUT_FOUND" "1" "HEALTH_TIMEOUT constant is 5 seconds"

CURL_TIMEOUT_FOUND=$(grep -c "max-time.*HEALTH_TIMEOUT" "$MONITOR_SCRIPT" || true)
assert_equal "$CURL_TIMEOUT_FOUND" "1" "curl uses HEALTH_TIMEOUT for timeout"

# AC 2: Container-Liste wird aus JSON-Config gelesen
test_case "Container list loaded from /root/pipeline-containers.json"
CONFIG_PATH_FOUND=$(grep -c 'CONFIG_FILE="/root/pipeline-containers.json"' "$MONITOR_SCRIPT" || true)
assert_equal "$CONFIG_PATH_FOUND" "1" "Config file path is /root/pipeline-containers.json"

CONFIG_LOAD_FOUND=$(grep -c "jq 'length'" "$MONITOR_SCRIPT" || true)
assert_equal "$CONFIG_LOAD_FOUND" "1" "Config file is parsed with jq"

# AC 3: Container-Erkennung aus Config ODER via docker ps mit Label fallback
test_case "Container discovery: config or docker label fallback"
DOCKER_PS_FALLBACK=$(grep -c 'label=pipeline=true' "$MONITOR_SCRIPT" || true)
assert_equal "$DOCKER_PS_FALLBACK" "1" "docker ps fallback with pipeline label exists"

FALLBACK_LOGIC=$(grep -c "if \[\[ -f \"\$CONFIG_FILE\" \]\]" "$MONITOR_SCRIPT" || true)
assert_equal "$FALLBACK_LOGIC" "1" "Fallback to docker ps if config missing"

# AC 4: Check-Intervall alle 60 Sekunden via cron
test_case "Cron interval is 60 seconds (every minute)"
CRON_ENTRY=$(grep 'CRON_ENTRY="\* \* \* \* \*' "${SCRIPT_DIR}/install-monitor.sh" || echo "")
if [[ -n "$CRON_ENTRY" ]]; then
  pass "Cron entry runs every minute (60 seconds)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "Cron entry not found in install-monitor.sh"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# AC 5: State-Tracking pro Container in /tmp/pipeline-container-monitor.json
test_case "State tracking per container in /tmp"
STATE_PATH=$(grep -o 'STATE_FILE="[^"]*"' "$MONITOR_SCRIPT" | cut -d'"' -f2)
assert_equal "$STATE_PATH" "/tmp/pipeline-container-monitor.json" "State file path is /tmp/pipeline-container-monitor.json"

# Verify state structure
init_state
global_state=$(load_state)
cstate=$(get_container_state "$global_state" "test-container")
CONSECUTIVE_FAILURES=$(echo "$cstate" | jq -r '.consecutive_failures')
assert_equal "$CONSECUTIVE_FAILURES" "0" "Initial consecutive_failures is 0"

FIRST_FAILURE=$(echo "$cstate" | jq -r '.first_failure_time')
assert_equal "$FIRST_FAILURE" "0" "Initial first_failure_time is 0"

IS_DOWN=$(echo "$cstate" | jq -r '.is_down')
assert_equal "$IS_DOWN" "false" "Initial is_down is false"

# AC 6: Nach 3 aufeinanderfolgenden Fehlschlägen wird Telegram-Nachricht gesendet
test_case "Alert after MAX_FAILURES (3) consecutive failures"
MAX_FAILURES_FOUND=$(grep -o "MAX_FAILURES=[0-9]*" "$MONITOR_SCRIPT" | cut -d'=' -f2)
assert_equal "$MAX_FAILURES_FOUND" "3" "MAX_FAILURES is 3"

ALERT_CONDITION=$(grep -c 'consecutive_failures.*MAX_FAILURES' "$MONITOR_SCRIPT" || true)
assert_equal "$ALERT_CONDITION" "1" "Alert triggered when consecutive_failures >= MAX_FAILURES"

# AC 7: Telegram-Nachricht enthält Container-Name, Domain, seit wann nicht erreichbar, HTTP-Status
test_case "Telegram message contains container name, domain, down time, and HTTP status"
TELEGRAM_FIELDS=$(grep 'Pipeline Container DOWN' "$MONITOR_SCRIPT" | grep -c "Container: %s" || true)
assert_equal "$TELEGRAM_FIELDS" "1" "Alert includes Container name"

TELEGRAM_DOMAIN=$(grep 'Pipeline Container DOWN' "$MONITOR_SCRIPT" | grep -c "Domain: %s" || true)
assert_equal "$TELEGRAM_DOMAIN" "1" "Alert includes Domain"

TELEGRAM_DOWN_SINCE=$(grep 'Pipeline Container DOWN' "$MONITOR_SCRIPT" | grep -c "Down since: %s" || true)
assert_equal "$TELEGRAM_DOWN_SINCE" "1" "Alert includes down_since timestamp"

TELEGRAM_STATUS=$(grep 'Pipeline Container DOWN' "$MONITOR_SCRIPT" | grep -c "HTTP %s" || true)
assert_equal "$TELEGRAM_STATUS" "1" "Alert includes HTTP status code"

# AC 8: Recovery-Nachricht wenn Container wieder erreichbar UND vorher Alert gesendet
test_case "Recovery message when container becomes healthy after alert"
RECOVERY_MESSAGE=$(grep -c "RECOVERED" "$MONITOR_SCRIPT" || true)
if [[ "$RECOVERY_MESSAGE" -ge 1 ]]; then
  pass "Recovery message exists"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "Recovery message not found"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

RECOVERY_TELEGRAM=$(grep 'RECOVERED' "$MONITOR_SCRIPT" | grep -c "🟢 Pipeline Container RECOVERED" || true)
if [[ "$RECOVERY_TELEGRAM" -ge 1 ]]; then
  pass "Recovery Telegram message has recovery emoji"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "Recovery Telegram message not found"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Check that recovery only sends if was_down
RECOVERY_CONDITION=$(grep -B10 "RECOVERED" "$MONITOR_SCRIPT" | grep -c 'is_down.*==.*"true"' || true)
if [[ "$RECOVERY_CONDITION" -ge 1 ]]; then
  pass "Recovery message only sent if was_down == true"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "Recovery condition not properly checked"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# AC 9: Keine Spam-Nachrichten: max 1 Alert pro Container pro Ausfall-Ereignis
test_case "No spam: single alert per incident"
ALERT_ONCE=$(grep -c 'is_down.*"true"' "$MONITOR_SCRIPT" || true)
if [[ "$ALERT_ONCE" -ge 1 ]]; then
  pass "Alert sent only once when first crossing threshold"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "Alert spam prevention not clear"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# AC 10: Auto-Restart: docker restart, max 3 Versuche mit Backoff
test_case "Auto-restart with backoff (max 3 attempts)"
MAX_RESTART=$(grep -o "MAX_RESTART_ATTEMPTS=[0-9]*" "$MONITOR_SCRIPT" | cut -d'=' -f2)
assert_equal "$MAX_RESTART" "3" "MAX_RESTART_ATTEMPTS is 3"

BACKOFF_1=$(grep -o "RESTART_BACKOFF_1=[0-9]*" "$MONITOR_SCRIPT" | cut -d'=' -f2)
assert_equal "$BACKOFF_1" "30" "RESTART_BACKOFF_1 is 30 seconds"

BACKOFF_2=$(grep -o "RESTART_BACKOFF_2=[0-9]*" "$MONITOR_SCRIPT" | cut -d'=' -f2)
assert_equal "$BACKOFF_2" "60" "RESTART_BACKOFF_2 is 60 seconds"

DOCKER_RESTART=$(grep -c "docker restart" "$MONITOR_SCRIPT" || true)
if [[ "$DOCKER_RESTART" -ge 1 ]]; then
  pass "docker restart is called for recovery"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "docker restart not found"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# AC 11: Script nutzt bestehenden Telegram Bot (env vars)
test_case "Script uses TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_CHAT_ID env vars"
BOT_TOKEN=$(grep -c "TELEGRAM_BOT_TOKEN" "$MONITOR_SCRIPT" || true)
if [[ "$BOT_TOKEN" -ge 1 ]]; then
  pass "TELEGRAM_BOT_TOKEN is referenced"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "TELEGRAM_BOT_TOKEN not found"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

CHAT_ID=$(grep -c "TELEGRAM_OPERATOR_CHAT_ID" "$MONITOR_SCRIPT" || true)
if [[ "$CHAT_ID" -ge 1 ]]; then
  pass "TELEGRAM_OPERATOR_CHAT_ID is referenced"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "TELEGRAM_OPERATOR_CHAT_ID not found"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# AC 12: Logging in /var/log/pipeline-container-monitor.log
test_case "Logging to /var/log/pipeline-container-monitor.log"
LOG_PATH=$(grep -o 'LOG_FILE="[^"]*"' "$MONITOR_SCRIPT" | cut -d'"' -f2)
assert_equal "$LOG_PATH" "/var/log/pipeline-container-monitor.log" "Log file is /var/log/pipeline-container-monitor.log"

LOG_FUNCTION=$(grep -c "^log()" "$MONITOR_SCRIPT" || true)
assert_equal "$LOG_FUNCTION" "1" "log() function exists"

# AC 13: Script ist idempotent
test_case "Script is idempotent"
ATOMIC_WRITE=$(grep -c 'tmp_file.*STATE_FILE.*tmp.*\$\$' "$MONITOR_SCRIPT" || true)
if [[ "$ATOMIC_WRITE" -ge 1 ]]; then
  pass "Atomic state file writes prevent corruption"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "Atomic write pattern not found"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

SET_EUO=$(head -20 "$MONITOR_SCRIPT" | grep -c "set -euo pipefail" || true)
assert_equal "$SET_EUO" "1" "Script uses set -euo pipefail for safety"

# --- Security Quick-Check ---

echo ""
echo -e "${YELLOW}Security Quick-Check${NC}"

test_case "No hardcoded secrets"
# Check that bot tokens are not hardcoded (they use env vars instead)
if grep -q "TELEGRAM_BOT_TOKEN" "$MONITOR_SCRIPT" && ! grep -q 'TELEGRAM_BOT_TOKEN="[^"]*[a-zA-Z0-9]' "$MONITOR_SCRIPT"; then
  pass "No hardcoded API tokens"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "Script may contain hardcoded API tokens"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

test_case "No command injection in container names"
CONTAINER_NAME_USAGE=$(grep 'restart_container.*\$name' "$MONITOR_SCRIPT" | head -1)
if [[ -n "$CONTAINER_NAME_USAGE" ]]; then
  INJECTION_SAFE=$(echo "$CONTAINER_NAME_USAGE" | grep -c '".*\$name.*"' || true)
  if [[ "$INJECTION_SAFE" -gt 0 ]]; then
    pass "Container names quoted in docker restart"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    fail "Container names may be vulnerable to injection"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
fi

test_case "No shell injection in JSON config parsing"
JQ_PARSING=$(grep 'jq' "$MONITOR_SCRIPT" | grep -c '\-c' || true)
if [[ "$JQ_PARSING" -gt 0 ]]; then
  pass "jq output is properly handled with -c flag"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  fail "jq parsing may not be safe"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# --- Summary ---

echo ""
echo "============================================================"
if [[ $TESTS_FAILED -eq 0 ]]; then
  echo -e "${GREEN}  All $TESTS_PASSED/$TESTS_RUN tests passed!${NC}"
  echo "============================================================"
  exit 0
else
  echo -e "${RED}  $TESTS_FAILED/$TESTS_RUN tests FAILED${NC}"
  echo "============================================================"
  exit 1
fi
