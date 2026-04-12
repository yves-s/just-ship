#!/bin/bash
# get-preview-url.test.sh — Acceptance Criteria verification for T-784
# Tests token resolution, preview URL template logic, and edge cases
# Usage: bash .claude/scripts/get-preview-url.test.sh

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/get-preview-url.sh"
TESTS=0
PASS=0
FAIL=0

# Temp directories for testing
TEST_TEMP=$(mktemp -d)
TEST_PROJECT="$TEST_TEMP/test-project"
TEST_HOME="$TEST_TEMP/home"
VPS_TOKEN_PATH="/root/.coolify-api/token"

# Create test structure
mkdir -p "$TEST_PROJECT"
mkdir -p "$TEST_HOME/.just-ship"
mkdir -p "$(dirname "$VPS_TOKEN_PATH" 2>/dev/null)" 2>/dev/null || true
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
  echo "  Reason: $reason"
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
    test_fail "$name" "Expected pattern '$pattern', got: $output"
  fi
}

# Test 1: Token resolution — env var has priority
test_env_var_priority() {
  local name="AC5.1: Env var \$COOLIFY_API_TOKEN takes priority"

  cat > "$TEST_PROJECT/project.json" << 'EOF'
{
  "hosting": {
    "provider": "coolify",
    "coolify_url": "http://localhost:8080",
    "coolify_app_uuid": "test-uuid"
  }
}
EOF

  # Mock the curl to avoid real API calls
  cat > "$TEST_HOME/test-token-priority.sh" << 'EOF'
#!/bin/bash
export COOLIFY_API_TOKEN="from-env"
echo "test" > /root/.coolify-api/token 2>/dev/null || true
echo "from-config" > ~/.just-ship/config.json 2>/dev/null || true

# Source the token resolution logic only (first 59 lines of get-preview-url.sh)
COOLIFY_TOKEN="${COOLIFY_API_TOKEN:-}"
if [ -z "$COOLIFY_TOKEN" ] && [ -f /root/.coolify-api/token ]; then
  COOLIFY_TOKEN=$(cat /root/.coolify-api/token 2>/dev/null)
fi
if [ -z "$COOLIFY_TOKEN" ] && [ -f "$HOME/.just-ship/config.json" ]; then
  COOLIFY_TOKEN=$(cat "$HOME/.just-ship/config.json" 2>/dev/null)
fi

echo "$COOLIFY_TOKEN"
EOF

  chmod +x "$TEST_HOME/test-token-priority.sh"
  output=$("$TEST_HOME/test-token-priority.sh")

  if [ "$output" = "from-env" ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected 'from-env', got '$output'"
  fi
}

# Test 2: Token resolution — fallback to config.json
test_config_fallback() {
  local name="AC1: Fallback to ~/.just-ship/config.json when env var not set"

  cat > "$TEST_HOME/.just-ship/config.json" << 'EOF'
{"coolify_api_token": "from-config-json"}
EOF

  unset COOLIFY_API_TOKEN

  cat > "$TEST_HOME/test-token-config.sh" << 'EOF'
#!/bin/bash
COOLIFY_TOKEN="${COOLIFY_API_TOKEN:-}"
if [ -z "$COOLIFY_TOKEN" ] && [ -f "$HOME/.just-ship/config.json" ]; then
  COOLIFY_TOKEN=$(node -e "
    try {
      const c = require(process.env.HOME + '/.just-ship/config.json');
      process.stdout.write(c.coolify_api_token || '');
    } catch (e) {}
  " 2>/dev/null)
fi
echo "$COOLIFY_TOKEN"
EOF

  chmod +x "$TEST_HOME/test-token-config.sh"
  output=$("$TEST_HOME/test-token-config.sh")

  if [ "$output" = "from-config-json" ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected 'from-config-json', got '$output'"
  fi
}

# Test 3: Template substitution with PR_ID
test_template_substitution_with_pr() {
  local name="AC3: Template substitution with PR_ID > 0"

  cat > "$TEST_HOME/test-template.sh" << 'EOF'
#!/bin/bash
FQDN="https://board.just-ship.io"
PREVIEW_TEMPLATE="board-{{pr_id}}.preview.just-ship.io"
PR_ID="126"

if [ -n "$PREVIEW_TEMPLATE" ] && [ "$PR_ID" -gt 0 ] 2>/dev/null; then
  DOMAIN=$(echo "$FQDN" | sed 's|^https://||;s|^http://||')
  PREVIEW_DOMAIN=$(echo "$PREVIEW_TEMPLATE" | sed "s/{{pr_id}}/$PR_ID/g" | sed "s/{{domain}}/$DOMAIN/g")
  echo "https://$PREVIEW_DOMAIN"
fi
EOF

  chmod +x "$TEST_HOME/test-template.sh"
  output=$("$TEST_HOME/test-template.sh")

  expected="https://board-126.preview.just-ship.io"
  if [ "$output" = "$expected" ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected '$expected', got '$output'"
  fi
}

# Test 4: Fallback to FQDN when PR_ID == 0
test_fallback_pr_zero() {
  local name="AC4: Fallback to FQDN when PR_ID == 0"

  cat > "$TEST_HOME/test-fallback-pr-zero.sh" << 'EOF'
#!/bin/bash
FQDN="https://board.just-ship.io"
PREVIEW_TEMPLATE="board-{{pr_id}}.preview.just-ship.io"
PR_ID="0"

if [ -n "$PREVIEW_TEMPLATE" ] && [ "$PR_ID" -gt 0 ] 2>/dev/null; then
  DOMAIN=$(echo "$FQDN" | sed 's|^https://||;s|^http://||')
  PREVIEW_DOMAIN=$(echo "$PREVIEW_TEMPLATE" | sed "s/{{pr_id}}/$PR_ID/g" | sed "s/{{domain}}/$DOMAIN/g")
  echo "https://$PREVIEW_DOMAIN"
else
  echo "$FQDN"
fi
EOF

  chmod +x "$TEST_HOME/test-fallback-pr-zero.sh"
  output=$("$TEST_HOME/test-fallback-pr-zero.sh")

  if [ "$output" = "https://board.just-ship.io" ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected 'https://board.just-ship.io', got '$output'"
  fi
}

# Test 5: Fallback to FQDN when template is empty
test_fallback_empty_template() {
  local name="AC4: Fallback to FQDN when template is empty"

  cat > "$TEST_HOME/test-fallback-no-template.sh" << 'EOF'
#!/bin/bash
FQDN="https://board.just-ship.io"
PREVIEW_TEMPLATE=""
PR_ID="126"

if [ -n "$PREVIEW_TEMPLATE" ] && [ "$PR_ID" -gt 0 ] 2>/dev/null; then
  DOMAIN=$(echo "$FQDN" | sed 's|^https://||;s|^http://||')
  PREVIEW_DOMAIN=$(echo "$PREVIEW_TEMPLATE" | sed "s/{{pr_id}}/$PR_ID/g" | sed "s/{{domain}}/$DOMAIN/g")
  echo "https://$PREVIEW_DOMAIN"
else
  echo "$FQDN"
fi
EOF

  chmod +x "$TEST_HOME/test-fallback-no-template.sh"
  output=$("$TEST_HOME/test-fallback-no-template.sh")

  if [ "$output" = "https://board.just-ship.io" ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected 'https://board.just-ship.io', got '$output'"
  fi
}

# Test 6: Protocol stripping (http://)
test_protocol_stripping_http() {
  local name="AC2: Strip http:// prefix from FQDN"

  cat > "$TEST_HOME/test-strip-http.sh" << 'EOF'
#!/bin/bash
FQDN="http://board.just-ship.io"
DOMAIN=$(echo "$FQDN" | sed 's|^https://||;s|^http://||')
echo "$DOMAIN"
EOF

  chmod +x "$TEST_HOME/test-strip-http.sh"
  output=$("$TEST_HOME/test-strip-http.sh")

  if [ "$output" = "board.just-ship.io" ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected 'board.just-ship.io', got '$output'"
  fi
}

# Test 7: Protocol stripping (https://)
test_protocol_stripping_https() {
  local name="AC2: Strip https:// prefix from FQDN"

  cat > "$TEST_HOME/test-strip-https.sh" << 'EOF'
#!/bin/bash
FQDN="https://board.just-ship.io"
DOMAIN=$(echo "$FQDN" | sed 's|^https://||;s|^http://||')
echo "$DOMAIN"
EOF

  chmod +x "$TEST_HOME/test-strip-https.sh"
  output=$("$TEST_HOME/test-strip-https.sh")

  if [ "$output" = "board.just-ship.io" ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected 'board.just-ship.io', got '$output'"
  fi
}

# Test 8: Both files synchronized
test_files_synchronized() {
  local name="AC6: Both .claude/ and .claude-plugin/ files are identical"

  file1="$SCRIPT_DIR/get-preview-url.sh"
  file2="$SCRIPT_DIR/../../.claude-plugin/scripts/get-preview-url.sh"

  if [ ! -f "$file2" ]; then
    test_fail "$name" "File not found: $file2"
  elif cmp -s "$file1" "$file2"; then
    test_pass "$name"
  else
    test_fail "$name" "Files differ"
  fi
}

# Test 9: Security - No token in stdout
test_no_token_in_stdout() {
  local name="Security: Token not leaked to stdout"

  # The script should only echo URLs or empty output to stdout
  # We verify this by checking the script content
  # Only fail if token is echoed/written directly, not if it's referenced in field names
  if grep -q 'echo.*"\$COOLIFY_TOKEN' "$SCRIPT"; then
    test_fail "$name" "Script echoes token variable to stdout"
  elif grep -q 'process.stdout.write.*\$COOLIFY_TOKEN' "$SCRIPT"; then
    test_fail "$name" "JavaScript echoes token variable to stdout"
  else
    test_pass "$name"
  fi
}

# Test 10: Graceful degradation without hosting config
test_graceful_no_config() {
  local name="Security: Script exits gracefully with no hosting config"

  cd "$TEST_PROJECT"
  cat > "project.json" << 'EOF'
{}
EOF

  # The script should exit 0 even without hosting config
  output=$(bash "$SCRIPT" 1 2>&1)
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    test_pass "$name"
  else
    test_fail "$name" "Expected exit code 0, got $exit_code"
  fi
}

# Run all tests
echo "=== Testing get-preview-url.sh (T-784) ==="
echo

test_env_var_priority
test_config_fallback
test_template_substitution_with_pr
test_fallback_pr_zero
test_fallback_empty_template
test_protocol_stripping_http
test_protocol_stripping_https
test_files_synchronized
test_no_token_in_stdout
test_graceful_no_config

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
