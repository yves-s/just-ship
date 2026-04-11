#!/bin/bash
# quality-gate.test.sh — Test Suite for quality-gate.sh Hook
# Tests: lint blocking, format auto-fix, project config, tool detection

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/quality-gate.sh"

# Temporary test directory
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

cd "$TEST_DIR"

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

test_case() {
  local name="$1"
  TESTS_RUN=$((TESTS_RUN + 1))
  echo "TEST $TESTS_RUN: $name"
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  if [ "$actual" -eq "$expected" ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  ✓ PASS"
  else
    echo "  ✗ FAIL: expected exit code $expected, got $actual"
  fi
}

assert_contains() {
  local needle="$1"
  local haystack="$2"
  if echo "$haystack" | grep -q "$needle"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  ✓ PASS: contains '$needle'"
  else
    echo "  ✗ FAIL: expected to contain '$needle', got: $haystack"
  fi
}

# ─────────────────────────────────────────────
# AC1: Hook skips when project.json missing
# ─────────────────────────────────────────────
test_case "AC1a: skip when no project.json"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "test.js"
  },
  "cwd": "$TEST_DIR"
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC2: Hook skips non-existent files
# ─────────────────────────────────────────────
test_case "AC2a: skip non-existent file"
mkdir -p "$TEST_DIR/project"
cd "$TEST_DIR/project"
echo '{}' > project.json
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/nonexistent/file.js"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC3: Hook skips binary/generated files
# ─────────────────────────────────────────────
test_case "AC3a: skip *.min.js"
touch "$TEST_DIR/project/app.min.js"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "app.min.js"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

test_case "AC3b: skip *.png"
touch "$TEST_DIR/project/logo.png"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "logo.png"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

test_case "AC3c: skip node_modules"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "node_modules/package/index.js"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC4: quality_gates.enabled=false disables hook
# ─────────────────────────────────────────────
test_case "AC4a: respects quality_gates.enabled=false"
cat > "$TEST_DIR/project/project.json" <<'PROJJSON'
{
  "quality_gates": {
    "enabled": false
  }
}
PROJJSON
touch "$TEST_DIR/project/test.ts"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "test.ts"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC5: ignore_patterns config
# ─────────────────────────────────────────────
test_case "AC5a: respects ignore_patterns regex"
cat > "$TEST_DIR/project/project.json" <<'PROJJSON'
{
  "quality_gates": {
    "enabled": true,
    "ignore_patterns": [".*\\.test\\.ts$", "build/.*"]
  }
}
PROJJSON
touch "$TEST_DIR/project/helpers.test.ts"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "helpers.test.ts"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC6: format=false disables formatting
# ─────────────────────────────────────────────
test_case "AC6a: respects format=false config"
cat > "$TEST_DIR/project/project.json" <<'PROJJSON'
{
  "quality_gates": {
    "format": false
  }
}
PROJJSON
touch "$TEST_DIR/project/messy.ts"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "messy.ts"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC7: File path extraction from JSON
# ─────────────────────────────────────────────
test_case "AC7a: extracts file_path from tool_input"
cat > "$TEST_DIR/project/project.json" <<'PROJJSON'
{
  "quality_gates": {}
}
PROJJSON
touch "$TEST_DIR/project/sample.js"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "sample.js",
    "other_field": "value"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC8: Handles empty cwd gracefully
# ─────────────────────────────────────────────
test_case "AC8a: skips when cwd empty"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "test.js"
  },
  "cwd": ""
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC9: Only processes known file types
# ─────────────────────────────────────────────
test_case "AC9a: skip unknown file extension"
cd "$TEST_DIR/project"
touch "data.unknown"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "data.unknown"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

test_case "AC9b: process .ts files"
touch "code.ts"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || EXIT_CODE=$?
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "code.ts"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
assert_exit_code 0 $EXIT_CODE

# ─────────────────────────────────────────────
# AC10: Tool detection caching
# ─────────────────────────────────────────────
test_case "AC10a: cache file created"
cat > "$TEST_DIR/project/project.json" <<'PROJJSON'
{
  "quality_gates": {}
}
PROJJSON
mkdir -p "$TEST_DIR/project/.claude"
touch "$TEST_DIR/project/script.sh"
bash "$HOOK_SCRIPT" <<EOF 2>/dev/null || true
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "script.sh"
  },
  "cwd": "$TEST_DIR/project"
}
EOF
if [ -f "$TEST_DIR/project/.claude/.quality-gate-cache" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  ✓ PASS: cache file created"
else
  echo "  ✗ FAIL: cache file not found"
fi

# ─────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────
echo ""
echo "============================================"
echo "Test Results: $TESTS_PASSED/$TESTS_RUN passed"
echo "============================================"

if [ "$TESTS_PASSED" -ne "$TESTS_RUN" ]; then
  exit 1
fi

exit 0
