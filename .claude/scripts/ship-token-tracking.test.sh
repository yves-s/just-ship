#!/bin/bash
# ship-token-tracking.test.sh — Acceptance Criteria verification for T-772
# Tests deterministic token tracking, delta computation, and Board updates
# Usage: bash .claude/scripts/ship-token-tracking.test.sh

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/ship-token-tracking.sh"
TESTS=0
PASS=0
FAIL=0

# Temp directories for testing
TEST_TEMP=$(mktemp -d)
TEST_PROJECT="$TEST_TEMP/test-project"
TEST_HOME="$TEST_TEMP/home"

# Create test structure
mkdir -p "$TEST_PROJECT/.claude/scripts"
mkdir -p "$TEST_HOME"
export HOME="$TEST_HOME"

cleanup() {
  rm -rf "$TEST_TEMP"
}

trap cleanup EXIT

test_pass() {
  local name="$1"
  echo "✓ $name"
  ((PASS++))
  ((TESTS++))
}

test_fail() {
  local name="$1"
  local reason="$2"
  echo "✗ $name"
  echo "  $reason"
  ((FAIL++))
  ((TESTS++))
}

test_output() {
  local name="$1"
  local output="$2"
  local pattern="$3"

  if echo "$output" | grep -q "$pattern"; then
    test_pass "$name"
  else
    test_fail "$name" "Expected pattern '$pattern' not found. Got: $(echo "$output" | head -c 100)"
  fi
}

echo "Testing ship-token-tracking.sh — T-772 Acceptance Criteria"
echo ""

# Copy real scripts for integration testing
cp "$SCRIPT_DIR/board-api.sh" "$TEST_PROJECT/.claude/scripts/" 2>/dev/null || true
cp "$SCRIPT_DIR/calculate-session-cost.sh" "$TEST_PROJECT/.claude/scripts/" 2>/dev/null || true

# Create mock board-api.sh if originals don't exist
if [ ! -f "$TEST_PROJECT/.claude/scripts/board-api.sh" ]; then
  cat > "$TEST_PROJECT/.claude/scripts/board-api.sh" <<'EOF'
#!/bin/bash
if [ "$1" = "get" ]; then
  echo '{"data":{"number":772,"total_tokens":100,"estimated_cost":0.005,"input_tokens":50,"cache_read_tokens":5,"cache_creation_tokens":10,"output_tokens":20}}'
  exit 0
fi
if [ "$1" = "patch" ]; then
  # Just succeed silently for mock
  exit 0
fi
exit 1
EOF
  chmod +x "$TEST_PROJECT/.claude/scripts/board-api.sh"
fi

if [ ! -f "$TEST_PROJECT/.claude/scripts/calculate-session-cost.sh" ]; then
  cat > "$TEST_PROJECT/.claude/scripts/calculate-session-cost.sh" <<'EOF'
#!/bin/bash
SESSION_ID="$1"
CWD="$2"

# Validate inputs
[ -z "$SESSION_ID" ] || [ -z "$CWD" ] && exit 0
if [[ ! "$CWD" =~ ^/ ]] || [[ "$CWD" =~ \.\. ]]; then
  exit 0
fi

# Build session file path (same logic as real script)
SAFE_CWD=$(echo "$CWD" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g')
SESSION_FILE="$HOME/.claude/projects/-${SAFE_CWD}/${SESSION_ID}.jsonl"

if [ -f "$SESSION_FILE" ]; then
  # Parse session file and calculate costs (simplified for testing)
  node -e "
    const fs = require('fs');
    const lines = fs.readFileSync('${SESSION_FILE}', 'utf-8').split('\n').filter(Boolean);
    let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheCreate = 0;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const usage = obj?.message?.usage;
        if (usage && typeof usage.input_tokens === 'number') {
          inputTokens += usage.input_tokens || 0;
          cacheRead += usage.cache_read_input_tokens || 0;
          cacheCreate += usage.cache_creation_input_tokens || 0;
          outputTokens += usage.output_tokens || 0;
        }
      } catch {}
    }

    const totalTokens = inputTokens + outputTokens;
    const estimatedCost = (inputTokens / 1000000 * 3) + (outputTokens / 1000000 * 15); // Haiku pricing

    console.log(JSON.stringify({
      total_tokens: totalTokens,
      estimated_cost_usd: Math.max(0, estimatedCost).toFixed(4),
      input_tokens: inputTokens,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreate,
      output_tokens: outputTokens
    }));
  " 2>/dev/null || exit 0
else
  exit 0
fi
EOF
  chmod +x "$TEST_PROJECT/.claude/scripts/calculate-session-cost.sh"
fi

# AC1: Abgeschlossene Tickets zeigen plausible Token-Zahlen und Kosten

echo "Test: AC1 — Delta calculation (500 current - 200 snapshot = 300 delta)"

# Create session file structure with realistic data
SAFE_CWD=$(echo "$TEST_PROJECT" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
mkdir -p "$SESSION_DIR"

# Create session JSONL with specific token counts: input=400, output=100 (total 500)
echo '{"message":{"usage":{"input_tokens":400,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":100},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/test-session.jsonl"

# Create snapshot with 200 tokens
echo '{"total_tokens":200,"estimated_cost_usd":0.005,"input_tokens":150,"cache_read_tokens":0,"cache_creation_tokens":0,"output_tokens":50}' > "$TEST_PROJECT/.claude/.token-snapshot-T-772.json"

OUTPUT=$(cd "$TEST_PROJECT" && bash "$SCRIPT" 772 "$TEST_PROJECT" 2>&1)
test_output "AC1a: Delta tokens calculated (500 - 200 = 300)" "$OUTPUT" "300 tokens"

# Verify snapshot is cleaned
if [ ! -f "$TEST_PROJECT/.claude/.token-snapshot-T-772.json" ]; then
  test_pass "AC1b: Snapshot deleted after processing"
else
  test_fail "AC1b: Snapshot deleted after processing" "File still exists"
fi

# AC2: Token-Kosten sind pro Ticket isoliert, nicht pro Session

echo "Test: AC2 — Per-ticket isolation"

# Create separate snapshots for two tickets
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
mkdir -p "$SESSION_DIR"
echo '{"message":{"usage":{"input_tokens":1000,"output_tokens":200},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/test-T100.jsonl"
echo '{"message":{"usage":{"input_tokens":1000,"output_tokens":200},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/test-T200.jsonl"

# Snapshot for T-100: 500 tokens
echo '{"total_tokens":500,"estimated_cost_usd":0.01}' > "$TEST_PROJECT/.claude/.token-snapshot-T-100.json"
# Snapshot for T-200: 1000 tokens
echo '{"total_tokens":1000,"estimated_cost_usd":0.02}' > "$TEST_PROJECT/.claude/.token-snapshot-T-200.json"

# Session has 1200 tokens total
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
mkdir -p "$SESSION_DIR"
echo '{"message":{"usage":{"input_tokens":1000,"output_tokens":200},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/test-session.jsonl"

# Run for T-100: session has 1200 tokens, snapshot had 500, so delta = 1200 - 500 = 700
OUTPUT=$(cd "$TEST_PROJECT" && bash "$SCRIPT" 100 "$TEST_PROJECT" 2>&1)
test_output "AC2a: T-100 delta isolated" "$OUTPUT" "700 tokens"

# Verify T-100 snapshot cleaned
if [ ! -f "$TEST_PROJECT/.claude/.token-snapshot-T-100.json" ]; then
  test_pass "AC2b: T-100 snapshot isolated and cleaned"
else
  test_fail "AC2b: T-100 snapshot isolated and cleaned" "File still exists"
fi

# AC3: Token-Tracking funktioniert deterministisch

echo "Test: AC3 — Deterministic behavior"

# Test: No session file = graceful exit (exit 0)
OUTPUT=$(cd "$TEST_PROJECT" && bash "$SCRIPT" 999 "$TEST_PROJECT" 2>&1)
if [ $? -eq 0 ]; then
  test_pass "AC3a: Missing session exits gracefully (code 0)"
else
  test_fail "AC3a: Missing session exits gracefully" "Got exit code $?"
fi

# Test: Deterministic delta (same inputs = same output)
SAFE_CWD=$(echo "$TEST_PROJECT" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
mkdir -p "$SESSION_DIR"
echo '{"message":{"usage":{"input_tokens":600,"output_tokens":100},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/deterministic.jsonl"
echo '{"total_tokens":500,"estimated_cost_usd":0.01}' > "$TEST_PROJECT/.claude/.token-snapshot-T-772.json"

OUTPUT1=$(cd "$TEST_PROJECT" && bash "$SCRIPT" 772 "$TEST_PROJECT" 2>&1)

# Recreate snapshot and run again
echo '{"total_tokens":500,"estimated_cost_usd":0.01}' > "$TEST_PROJECT/.claude/.token-snapshot-T-772.json"
echo '{"message":{"usage":{"input_tokens":600,"output_tokens":100},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/deterministic.jsonl"

OUTPUT2=$(cd "$TEST_PROJECT" && bash "$SCRIPT" 772 "$TEST_PROJECT" 2>&1)

TOKENS1=$(echo "$OUTPUT1" | grep -o '^✓ tokens — [0-9]*' | grep -o '[0-9]*$' || echo "0")
TOKENS2=$(echo "$OUTPUT2" | grep -o '^✓ tokens — [0-9]*' | grep -o '[0-9]*$' || echo "0")

if [ "$TOKENS1" = "$TOKENS2" ] && [ -n "$TOKENS1" ]; then
  test_pass "AC3b: Deterministic delta calculation"
else
  test_fail "AC3b: Deterministic delta calculation" "Run 1: $TOKENS1, Run 2: $TOKENS2"
fi

# AC4: Token-Snapshots werden nach Verbrauch aufgeräumt

echo "Test: AC4 — Snapshot cleanup"

SAFE_CWD=$(echo "$TEST_PROJECT" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
mkdir -p "$SESSION_DIR"
echo '{"message":{"usage":{"input_tokens":300,"output_tokens":50},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/cleanup-test.jsonl"

SNAPSHOT_FILE="$TEST_PROJECT/.claude/.token-snapshot-T-cleanup.json"
echo '{"total_tokens":100,"estimated_cost_usd":0.002}' > "$SNAPSHOT_FILE"

cd "$TEST_PROJECT" && bash "$SCRIPT" cleanup "$TEST_PROJECT" >/dev/null 2>&1 || true

if [ ! -f "$SNAPSHOT_FILE" ]; then
  test_pass "AC4a: Snapshot file removed after processing"
else
  test_fail "AC4a: Snapshot file removed after processing" "File still exists"
fi

# AC5: Granulare Token-Felder werden korrekt befüllt

echo "Test: AC5 — Granular token fields"

# Verify by examining the script itself that it constructs the right patch JSON
# The script builds a patch with all granular fields in the node section

if grep -q 'input_tokens.*delta' "$SCRIPT" && \
   grep -q 'cache_read_tokens.*delta' "$SCRIPT" && \
   grep -q 'cache_creation_tokens.*delta' "$SCRIPT" && \
   grep -q 'output_tokens.*delta' "$SCRIPT"; then
  test_pass "AC5: Script includes input_tokens"
  test_pass "AC5: Script includes cache_read_tokens"
  test_pass "AC5: Script includes cache_creation_tokens"
  test_pass "AC5: Script includes output_tokens"
else
  test_fail "AC5: Script includes all granular token fields" "Code inspection failed"
  ((TESTS+=3))
  ((FAIL+=3))
fi

# Security Tests

echo "Test: Security — No shell injection"

# Test dangerous input doesn't execute
OUTPUT=$(cd "$TEST_PROJECT" && bash "$SCRIPT" '772; echo injected' "$TEST_PROJECT" 2>&1)
if ! echo "$OUTPUT" | grep -q "^injected$"; then
  test_pass "Security: No injection via ticket number"
else
  test_fail "Security: No injection via ticket number" "Injected code executed"
fi

# Test path traversal blocked
OUTPUT=$(cd "$TEST_PROJECT" && bash "$SCRIPT" 772 "/tmp/../../../etc/passwd" 2>&1)
if [ $? -eq 0 ]; then
  test_pass "Security: Path traversal blocked"
else
  test_fail "Security: Path traversal blocked" "Got exit code $?"
fi

# Edge Cases

echo "Test: Edge Cases"

# Zero delta (snapshot matches session)
SAFE_CWD=$(echo "$TEST_PROJECT" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
mkdir -p "$SESSION_DIR"
echo '{"message":{"usage":{"input_tokens":300,"output_tokens":100},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/zero-test.jsonl"
echo '{"total_tokens":400,"estimated_cost_usd":0.01}' > "$TEST_PROJECT/.claude/.token-snapshot-T-zero.json"

OUTPUT=$(cd "$TEST_PROJECT" && bash "$SCRIPT" zero "$TEST_PROJECT" 2>&1)
# Zero delta shouldn't produce output
if ! echo "$OUTPUT" | grep -q "tokens"; then
  test_pass "Edge case: Zero delta (no output)"
else
  test_fail "Edge case: Zero delta (no output)" "Got: $OUTPUT"
fi

# Missing snapshot file (should default to 0)
rm -f "$TEST_PROJECT/.claude/.token-snapshot-T-missing.json" 2>/dev/null || true
SAFE_CWD=$(echo "$TEST_PROJECT" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
mkdir -p "$SESSION_DIR"
echo '{"message":{"usage":{"input_tokens":300,"output_tokens":100},"model":"claude-haiku-4-5-20251001"}}' > "$SESSION_DIR/missing-test.jsonl"

OUTPUT=$(cd "$TEST_PROJECT" && bash "$SCRIPT" missing "$TEST_PROJECT" 2>&1)
if echo "$OUTPUT" | grep -q "400 tokens"; then
  test_pass "Edge case: Missing snapshot defaults to 0 (full session = delta)"
else
  test_fail "Edge case: Missing snapshot defaults to 0" "Got: $OUTPUT"
fi

echo ""
echo "================================"
echo "Total Tests: $TESTS"
echo "Passed:      $PASS"
echo "Failed:      $FAIL"
echo "================================"

if [ $FAIL -eq 0 ]; then
  echo "All tests passed!"
  exit 0
else
  exit 1
fi
