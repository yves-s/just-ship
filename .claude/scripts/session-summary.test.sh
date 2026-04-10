#!/bin/bash
# session-summary.test.sh — Test cases for session-summary.sh
# Validates all AC requirements for T-723

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/session-summary.sh"
TESTS=0
PASS=0
FAIL=0

test_ac() {
  local name="$1"
  local cmd="$2"
  local expected="$3"
  ((TESTS++))

  result=$(eval "$cmd" 2>&1)
  if echo "$result" | grep -q "$expected"; then
    echo "✓ $name"
    ((PASS++))
  else
    echo "✗ $name"
    echo "  Command: $cmd"
    echo "  Expected pattern: $expected"
    echo "  Got (first 5 lines):"
    echo "$result" | head -5 | sed 's/^/    /'
    ((FAIL++))
  fi
}

test_not_contains() {
  local name="$1"
  local cmd="$2"
  local not_expected="$3"
  ((TESTS++))

  result=$(eval "$cmd" 2>&1)
  if ! echo "$result" | grep -q "$not_expected"; then
    echo "✓ $name"
    ((PASS++))
  else
    echo "✗ $name"
    echo "  Expected NOT to find: $not_expected"
    ((FAIL++))
  fi
}

echo "Testing session-summary.sh — T-723 Acceptance Criteria"
echo ""

# AC1: Formatted summary output
test_ac "AC1: Header present" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "^┌─"

# AC2: Ticket number and title in header
test_ac "AC2: Ticket number in header" \
  "bash '$SCRIPT' '723' 'Test Ticket' 'Summary' 'passed' '' ''" \
  "T-723"

test_ac "AC2: Title in header" \
  "bash '$SCRIPT' '723' 'Test Ticket' 'Summary' 'passed' '' ''" \
  "Test Ticket"

# AC3: Summary text
test_ac "AC3: Summary displayed" \
  "bash '$SCRIPT' '723' 'Test' 'My summary' 'passed' '' ''" \
  "My summary"

# AC4: Changes block
test_ac "AC4: Changes block" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Changes"

test_ac "AC4: Files count" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Files:.*changed"

test_ac "AC4: Lines diff" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Lines:.*/"

test_ac "AC4: Commits" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Commits:"

test_ac "AC4: Branch" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Branch:"

# AC5: Tokens block (when available)
test_ac "AC5: Tokens block" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "├─ Tokens"

test_ac "AC5: Input tokens" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Input:"

test_ac "AC5: Output tokens" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Output:"

test_ac "AC5: Cache Read" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Cache Read:"

test_ac "AC5: Cache Write" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Cache Write:"

test_ac "AC5: Total tokens" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Total:"

# AC6: Cost block
test_ac "AC6: Cost block" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "├─ Cost"

test_ac "AC6: Model name" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Model:"

test_ac "AC6: Cost estimate" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Estimate: \\$"

# AC7: Links block
test_ac "AC7: Links block" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "├─ Links"

test_ac "AC7: QA result" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "QA:"

test_ac "AC7: PR URL when present" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' 'https://github.com/pr' ''" \
  "PR:.*https://"

test_ac "AC7: Preview URL when present" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' 'https://example.vercel.app'" \
  "Preview:.*https://"

# AC9: Omit preview when empty
test_not_contains "AC9: No preview line when empty" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' 'https://github.com/pr' ''" \
  "Preview: $"

# AC11: Visual formatting
test_ac "AC11: Top border" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "^┌─"

test_ac "AC11: Section dividers" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "├─"

test_ac "AC11: Bottom border" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "└─"

test_ac "AC11: Clear closing" \
  "bash '$SCRIPT' '723' 'Test' 'Summary' 'passed' '' ''" \
  "Done. Ready to ship"

# Security: Shell injection (verify params are passed safely)
# Direct invocation to avoid eval issues
INJECTION_OUTPUT=$(bash "$SCRIPT" "123" "Title \$(echo injected)" "Summary" "passed" "" "" 2>&1)
if ! echo "$INJECTION_OUTPUT" | grep -q "injected$"; then
  echo "✓ Security: No injection via title"
  ((PASS++))
else
  echo "✗ Security: No injection via title"
  ((FAIL++))
fi
((TESTS++))

# Edge case: Long summary wrapping — verify fold splits the text so more than one │ prefix line appears
WRAP_OUTPUT=$(bash "$SCRIPT" '723' 'Test' 'This is a very long summary text that should wrap across multiple lines in the terminal output' 'passed' '' '' 2>&1)
WRAP_LINE_COUNT=$(echo "$WRAP_OUTPUT" | grep -c '^│  ' || true)
((TESTS++))
if [ "$WRAP_LINE_COUNT" -ge 2 ]; then
  echo "✓ Edge case: Long summary wraps (${WRAP_LINE_COUNT} │  lines)"
  ((PASS++))
else
  echo "✗ Edge case: Long summary wraps — expected ≥2 wrapped lines, got ${WRAP_LINE_COUNT}"
  ((FAIL++))
fi

# Edge case: Error handling
test_ac "Error: Missing params shows usage" \
  "bash '$SCRIPT' 2>&1" \
  "Usage:"

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
