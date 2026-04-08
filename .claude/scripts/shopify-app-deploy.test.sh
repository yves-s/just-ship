#!/bin/bash
# shopify-app-deploy.test.sh — Integration tests for shopify-app-deploy.sh
#
# These tests verify script behavior by:
#   1. Creating isolated project directories
#   2. Running the script in those directories
#   3. Asserting output and exit codes
#
# Run: bash .claude/scripts/shopify-app-deploy.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Test counters
PASS=0
FAIL=0

# Cleanup tracking
declare -a TEMPS=()
cleanup_all() {
  if [ ${#TEMPS[@]} -gt 0 ]; then
    for TEMP in "${TEMPS[@]}"; do
      rm -rf "$TEMP" 2>/dev/null || true
    done
  fi
}
trap cleanup_all EXIT

test() {
  local name="$1"
  printf "[TEST] %-60s " "$name"
}

pass() {
  echo "PASS"
  PASS=$((PASS + 1))
}

fail() {
  local reason="${1:-}"
  echo "FAIL"
  if [ -n "$reason" ]; then
    echo "       Reason: $reason"
  fi
  FAIL=$((FAIL + 1))
}

# Helper: Create a minimal project with shopify-app-deploy in path
setup_test_project() {
  local variant="${1:-remix}"
  local has_toml="${2:-true}"

  local TEMP=$(mktemp -d)
  TEMPS+=("$TEMP")

  # Create project structure matching what shopify-app-deploy expects
  mkdir -p "$TEMP/.claude/scripts"

  # Copy the actual script
  cp "$SCRIPT_DIR/shopify-app-deploy.sh" "$TEMP/.claude/scripts/"

  # Create project.json
  cat > "$TEMP/project.json" <<EOF
{
  "stack": {
    "platform": "shopify",
    "variant": "$variant"
  }
}
EOF

  # Create shopify.app.toml if requested
  if [ "$has_toml" = "true" ]; then
    touch "$TEMP/shopify.app.toml"
  fi

  echo "$TEMP"
}

# ─── Test 1: Skip non-remix variant ───────────────────────────────────────
test "Skip non-remix variant (exits 0)"
(
  TEMP=$(setup_test_project "theme" "false")
  cd "$TEMP"
  bash .claude/scripts/shopify-app-deploy.sh >/dev/null 2>&1
  [ $? -eq 0 ]
) && pass || fail "Non-remix variant should exit 0"

# ─── Test 2: Skip when shopify.app.toml missing ───────────────────────────
test "Skip when shopify.app.toml missing (exits 0)"
(
  TEMP=$(setup_test_project "remix" "false")
  cd "$TEMP"
  bash .claude/scripts/shopify-app-deploy.sh >/dev/null 2>&1
  [ $? -eq 0 ]
) && pass || fail "Missing shopify.app.toml should exit 0"

# ─── Test 3: No shopify command available (graceful fallback) ──────────────
test "Graceful handling when shopify CLI not available"
(
  TEMP=$(setup_test_project "remix" "true")
  cd "$TEMP"

  # Create an empty directory to override shopify in PATH
  mkdir -p bin
  # Don't create a shopify binary, so it won't be found
  # Script should still exit 0 (non-blocking) even if command not found

  OUTPUT=$(PATH="$TEMP/bin:$PATH" bash .claude/scripts/shopify-app-deploy.sh 2>&1)
  [ $? -eq 0 ]
) && pass || fail "Script should not crash when shopify not in PATH"

# ─── Test 4: Output format validation ──────────────────────────────────────
test "Success output contains expected marker (✓ shopify)"
(
  TEMP=$(setup_test_project "remix" "true")
  cd "$TEMP"

  # Create a mock shopify command
  mkdir -p bin
  cat > bin/shopify <<'MOCK'
#!/bin/bash
exit 0
MOCK
  chmod +x bin/shopify

  OUTPUT=$(PATH="$TEMP/bin:$PATH" bash .claude/scripts/shopify-app-deploy.sh 2>&1)
  echo "$OUTPUT" | grep -q "✓ shopify"
) && pass || fail "Success output should contain '✓ shopify' marker"

# ─── Test 5: Error output format validation ────────────────────────────────
test "Failure output contains expected marker (⚠ shopify)"
(
  TEMP=$(setup_test_project "remix" "true")
  cd "$TEMP"

  # Create a mock shopify command that fails permanently
  mkdir -p bin
  cat > bin/shopify <<'MOCK'
#!/bin/bash
exit 42
MOCK
  chmod +x bin/shopify

  OUTPUT=$(PATH="$TEMP/bin:$PATH" bash .claude/scripts/shopify-app-deploy.sh 2>&1)
  # Even on failure, script exits 0 (non-blocking), but shows warning
  echo "$OUTPUT" | grep -q "⚠ shopify"
) && pass || fail "Failure output should contain '⚠ shopify' marker"

# ─── Test 6: Exit code always 0 (non-blocking) ────────────────────────────
test "Script always exits with code 0 (non-blocking design)"
(
  TEMP=$(setup_test_project "remix" "true")
  cd "$TEMP"

  # Create a mock shopify command that fails permanently
  mkdir -p bin
  cat > bin/shopify <<'MOCK'
#!/bin/bash
exit 99
MOCK
  chmod +x bin/shopify

  PATH="$TEMP/bin:$PATH" bash .claude/scripts/shopify-app-deploy.sh >/dev/null 2>&1
  [ $? -eq 0 ]
) && pass || fail "Script should always exit 0, even on deploy failure"

# ─── Test 7: .env parsing doesn't break script ────────────────────────────
test ".env file is sourced without breaking script"
(
  TEMP=$(setup_test_project "remix" "true")
  cd "$TEMP"

  # Create .env file
  cat > .env <<'ENV'
SHOPIFY_CLI_PARTNERS_TOKEN=test_token_123
SOME_OTHER_VAR=value456
ENV

  # Create a mock shopify command
  mkdir -p bin
  cat > bin/shopify <<'MOCK'
#!/bin/bash
exit 0
MOCK
  chmod +x bin/shopify

  OUTPUT=$(PATH="$TEMP/bin:$PATH" bash .claude/scripts/shopify-app-deploy.sh 2>&1)
  [ $? -eq 0 ]
) && pass || fail ".env file should be sourced without issues"

# ─── Test 8: Retry behavior on transient error ────────────────────────────
test "Transient error (exit 1) is retried"
(
  TEMP=$(setup_test_project "remix" "true")
  cd "$TEMP"

  # Create a mock shopify command that fails once, then succeeds
  mkdir -p bin
  COUNTER_FILE="$TEMP/.shopify_call_counter"
  cat > bin/shopify <<MOCK
#!/bin/bash
COUNTER=\$(cat $COUNTER_FILE 2>/dev/null || echo 0)
COUNTER=\$((COUNTER + 1))
echo \$COUNTER > $COUNTER_FILE
if [ \$COUNTER -eq 1 ]; then
  exit 1
fi
exit 0
MOCK
  chmod +x bin/shopify

  OUTPUT=$(PATH="$TEMP/bin:$PATH" bash .claude/scripts/shopify-app-deploy.sh 2>&1)
  EXIT_CODE=$?

  # Should succeed after retry
  COUNTER=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
  [ $EXIT_CODE -eq 0 ] && [ "$COUNTER" -eq 2 ]
) && pass || fail "Script should retry on exit code 1 and succeed eventually"

# ─── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "Test Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
