#!/bin/bash
# Test script to verify plugin registration functionality
# This script tests the --register-plugin flag in setup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Plugin Registration Test Suite ==="
echo ""

# Test 1: Verify marketplace.json exists and is valid
echo "Test 1: Verify marketplace.json exists and is valid JSON"
if [ ! -f "$PROJECT_ROOT/.claude-plugin/marketplace.json" ]; then
  echo "  ✗ FAIL: marketplace.json not found"
  exit 1
fi

if ! node -e "JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/.claude-plugin/marketplace.json'))" 2>/dev/null; then
  echo "  ✗ FAIL: marketplace.json is not valid JSON"
  exit 1
fi
echo "  ✓ PASS: marketplace.json exists and is valid JSON"
echo ""

# Test 2: Verify plugin.json exists and is valid
echo "Test 2: Verify plugin.json exists and is valid JSON"
if [ ! -f "$PROJECT_ROOT/.claude-plugin/plugin.json" ]; then
  echo "  ✗ FAIL: plugin.json not found"
  exit 1
fi

if ! node -e "JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/.claude-plugin/plugin.json'))" 2>/dev/null; then
  echo "  ✗ FAIL: plugin.json is not valid JSON"
  exit 1
fi
echo "  ✓ PASS: plugin.json exists and is valid JSON"
echo ""

# Test 3: Verify required fields in marketplace.json
echo "Test 3: Verify required fields in marketplace.json"
MISSING_FIELDS=()
for field in "name" "owner" "metadata" "plugins"; do
  if ! node -e "const m = JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/.claude-plugin/marketplace.json')); if (!m.$field) throw new Error('Missing field: $field');" 2>/dev/null; then
    MISSING_FIELDS+=("$field")
  fi
done

if [ ${#MISSING_FIELDS[@]} -gt 0 ]; then
  echo "  ✗ FAIL: Missing fields: ${MISSING_FIELDS[*]}"
  exit 1
fi
echo "  ✓ PASS: All required fields present"
echo ""

# Test 4: Verify required fields in plugin.json
echo "Test 4: Verify required fields in plugin.json"
MISSING_FIELDS=()
for field in "name" "version" "description"; do
  if ! node -e "const p = JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/.claude-plugin/plugin.json')); if (!p.$field) throw new Error('Missing field: $field');" 2>/dev/null; then
    MISSING_FIELDS+=("$field")
  fi
done

if [ ${#MISSING_FIELDS[@]} -gt 0 ]; then
  echo "  ✗ FAIL: Missing fields: ${MISSING_FIELDS[*]}"
  exit 1
fi
echo "  ✓ PASS: All required fields present"
echo ""

# Test 5: Verify version consistency
echo "Test 5: Verify version consistency between plugin.json and marketplace.json"
PLUGIN_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/.claude-plugin/plugin.json')).version)")
MARKETPLACE_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/.claude-plugin/marketplace.json')).metadata.version)")

if [ "$PLUGIN_VERSION" != "$MARKETPLACE_VERSION" ]; then
  echo "  ✗ FAIL: Version mismatch - plugin.json: $PLUGIN_VERSION, marketplace.json: $MARKETPLACE_VERSION"
  exit 1
fi
echo "  ✓ PASS: Versions are consistent ($PLUGIN_VERSION)"
echo ""

# Test 6: Verify setup.sh syntax
echo "Test 6: Verify setup.sh syntax is valid"
if ! bash -n "$PROJECT_ROOT/setup.sh" 2>/dev/null; then
  echo "  ✗ FAIL: setup.sh has syntax errors"
  exit 1
fi
echo "  ✓ PASS: setup.sh syntax is valid"
echo ""

# Test 7: Verify --register-plugin flag is recognized
echo "Test 7: Verify --register-plugin flag is in help text"
HELP_OUTPUT=$(bash "$PROJECT_ROOT/setup.sh" --help 2>&1 || true)
if ! echo "$HELP_OUTPUT" | grep -q "register-plugin"; then
  echo "  ✗ FAIL: --register-plugin flag not found in help text"
  exit 1
fi
echo "  ✓ PASS: --register-plugin flag is documented"
echo ""

# Test 8: Verify no secrets in code
echo "Test 8: Verify no hardcoded secrets in plugin files"
SECRETS_FOUND=false
if grep -iE "(api[_-]?key|secret|password|token|credential)['\"]?\s*[:=]" "$PROJECT_ROOT/.claude-plugin/marketplace.json" "$PROJECT_ROOT/.claude-plugin/plugin.json" 2>/dev/null; then
  SECRETS_FOUND=true
fi

if [ "$SECRETS_FOUND" = true ]; then
  echo "  ✗ FAIL: Potential secrets found in plugin files"
  exit 1
fi
echo "  ✓ PASS: No hardcoded secrets detected"
echo ""

# Test 9: Verify no secrets in setup.sh --register-plugin section
echo "Test 9: Verify no hardcoded secrets in setup.sh --register-plugin section"
SECRETS_FOUND=false
if grep -A 100 "register-plugin" "$PROJECT_ROOT/setup.sh" | grep -iE "(api[_-]?key|secret|password|token|credential)['\"]?\s*[:=]" 2>/dev/null; then
  SECRETS_FOUND=true
fi

if [ "$SECRETS_FOUND" = true ]; then
  echo "  ✗ FAIL: Potential secrets found in setup.sh register-plugin section"
  exit 1
fi
echo "  ✓ PASS: No hardcoded secrets in register-plugin code"
echo ""

echo "=== All Tests Passed ==="
