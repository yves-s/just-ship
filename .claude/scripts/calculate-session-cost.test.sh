#!/bin/bash
# Tests für calculate-session-cost.sh path transformation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Hilfsfunktion: Dieselbe Transformation wie im Script
transform_cwd() {
  local cwd="$1"
  echo "$cwd" | sed 's|^/||' | sed 's|/|-|g' | sed 's| |-|g' | sed 's|\.|-|g'
}

# Test 1: Pfad ohne Leerzeichen und ohne Dots
test_basic_path() {
  local result=$(transform_cwd "/Users/yschleich/Developer/just-ship")
  local expected="Users-yschleich-Developer-just-ship"
  if [ "$result" = "$expected" ]; then
    echo "✓ Test 1 passed: Basic path transformation"
  else
    echo "✗ Test 1 failed: Expected '$expected', got '$result'"
    return 1
  fi
}

# Test 2: Pfad mit Leerzeichen (THE BUG)
test_path_with_spaces() {
  local result=$(transform_cwd "/Users/John Doe/Developer/just-ship")
  local expected="Users-John-Doe-Developer-just-ship"
  if [ "$result" = "$expected" ]; then
    echo "✓ Test 2 passed: Path with spaces"
  else
    echo "✗ Test 2 failed: Expected '$expected', got '$result'"
    return 1
  fi
}

# Test 3: Pfad mit Dots (aus .worktrees/.claude etc)
test_path_with_dots() {
  local result=$(transform_cwd "/Users/yschleich/Developer/just-ship/.worktrees/T-755")
  local expected="Users-yschleich-Developer-just-ship--worktrees-T-755"
  if [ "$result" = "$expected" ]; then
    echo "✓ Test 3 passed: Path with dots (.worktrees)"
    return 0
  else
    echo "✗ Test 3 failed: Expected '$expected', got '$result'"
    return 1
  fi
}

# Test 4: Pfad mit sowohl Leerzeichen als auch Dots
test_path_with_spaces_and_dots() {
  local result=$(transform_cwd "/Users/John Doe/Developer/my.project/.claude/scripts")
  local expected="Users-John-Doe-Developer-my-project--claude-scripts"
  if [ "$result" = "$expected" ]; then
    echo "✓ Test 4 passed: Path with spaces and dots"
    return 0
  else
    echo "✗ Test 4 failed: Expected '$expected', got '$result'"
    return 1
  fi
}

# Test 5: Edge case - Multiple consecutive spaces
test_multiple_spaces() {
  local result=$(transform_cwd "/Users/John  Doe/path")
  local expected="Users-John--Doe-path"
  if [ "$result" = "$expected" ]; then
    echo "✓ Test 5 passed: Multiple consecutive spaces"
    return 0
  else
    echo "✗ Test 5 failed: Expected '$expected', got '$result'"
    return 1
  fi
}

# Test 6: Edge case - Multiple consecutive dots
test_multiple_dots() {
  local result=$(transform_cwd "/Users/yschleich/folder..name/path")
  local expected="Users-yschleich-folder--name-path"
  if [ "$result" = "$expected" ]; then
    echo "✓ Test 6 passed: Multiple consecutive dots"
    return 0
  else
    echo "✗ Test 6 failed: Expected '$expected', got '$result'"
    return 1
  fi
}

# Run all tests
echo "Running path transformation tests..."
echo

all_passed=true
for test_func in test_basic_path test_path_with_spaces test_path_with_dots test_path_with_spaces_and_dots test_multiple_spaces test_multiple_dots; do
  if ! $test_func; then
    all_passed=false
  fi
done

echo
if [ "$all_passed" = true ]; then
  echo "All tests passed!"
  exit 0
else
  echo "Some tests failed!"
  exit 1
fi
