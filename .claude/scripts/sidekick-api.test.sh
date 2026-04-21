#!/bin/bash
# sidekick-api.test.sh — Contract tests for sidekick-api.sh (T-926)
# Verifies:
#   - Usage output on no args
#   - Credential resolution pipeline (env > .env.local > project.json)
#   - chat arg validation
#   - thread-* arg validation
#   - attach arg validation
#
# No live HTTP — we point the script at a non-routable address so any
# accidental network call fails fast, and only inspect exit codes + error
# output for arg-validation paths.

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/sidekick-api.sh"
TESTS=0
PASS=0
FAIL=0

TEST_TEMP=$(mktemp -d)
trap 'rm -rf "$TEST_TEMP"' EXIT

pass() { echo "✓ $1"; PASS=$((PASS+1)); TESTS=$((TESTS+1)); }
fail() { echo "✗ $1"; echo "  $2"; FAIL=$((FAIL+1)); TESTS=$((TESTS+1)); }

# Helper: run the script from a sterile CWD so real project.json / .env.local
# in the tree above don't leak credentials into the test.
run_in_empty_dir() {
  (cd "$TEST_TEMP" && env -i PATH="$PATH" HOME="$HOME" "$SCRIPT" "$@")
}

# -- 1. No args → usage to stderr, exit 1
out=$(run_in_empty_dir 2>&1 >/dev/null)
ec=$?
if [ "$ec" = "1" ] && echo "$out" | grep -q "Usage:"; then
  pass "no args prints usage to stderr and exits 1"
else
  fail "no args prints usage" "exit=$ec output=$out"
fi

# -- 2. Missing credentials → incomplete_credentials error, exit 1
out=$(run_in_empty_dir chat --project-id 11111111-1111-4111-8111-111111111111 --text "hi" 2>&1 >/dev/null)
ec=$?
if [ "$ec" = "1" ] && echo "$out" | grep -q "incomplete_credentials"; then
  pass "missing credentials triggers incomplete_credentials error"
else
  fail "missing credentials error" "exit=$ec output=$out"
fi

# -- 3. chat without --text → exits 1, stderr complains
out=$(cd "$TEST_TEMP" && env -i PATH="$PATH" HOME="$HOME" PIPELINE_KEY=k ENGINE_API_URL=https://127.0.0.2 "$SCRIPT" chat --project-id 11111111-1111-4111-8111-111111111111 2>&1 >/dev/null)
ec=$?
if [ "$ec" = "1" ] && echo "$out" | grep -q "required"; then
  pass "chat requires --text"
else
  fail "chat requires --text" "exit=$ec output=$out"
fi

# -- 4. thread-get without <id> → exits 1
out=$(cd "$TEST_TEMP" && env -i PATH="$PATH" HOME="$HOME" PIPELINE_KEY=k ENGINE_API_URL=https://127.0.0.2 "$SCRIPT" thread-get 2>&1 >/dev/null)
ec=$?
if [ "$ec" = "1" ] && echo "$out" | grep -q "required"; then
  pass "thread-get requires id"
else
  fail "thread-get requires id" "exit=$ec output=$out"
fi

# -- 5. thread-patch without body → exits 1
out=$(cd "$TEST_TEMP" && env -i PATH="$PATH" HOME="$HOME" PIPELINE_KEY=k ENGINE_API_URL=https://127.0.0.2 "$SCRIPT" thread-patch 44444444-4444-4444-8444-444444444444 2>&1 >/dev/null)
ec=$?
if [ "$ec" = "1" ] && echo "$out" | grep -qE "required|JSON"; then
  pass "thread-patch requires body"
else
  fail "thread-patch requires body" "exit=$ec output=$out"
fi

# -- 6. attach on non-existent file → exits 1
out=$(cd "$TEST_TEMP" && env -i PATH="$PATH" HOME="$HOME" PIPELINE_KEY=k ENGINE_API_URL=https://127.0.0.2 "$SCRIPT" attach /does/not/exist.png 2>&1 >/dev/null)
ec=$?
if [ "$ec" = "1" ] && echo "$out" | grep -q "not found"; then
  pass "attach rejects non-existent file"
else
  fail "attach rejects non-existent file" "exit=$ec output=$out"
fi

# -- 7. Unknown command → exits 1
out=$(cd "$TEST_TEMP" && env -i PATH="$PATH" HOME="$HOME" PIPELINE_KEY=k ENGINE_API_URL=https://127.0.0.2 "$SCRIPT" bogus-command 2>&1 >/dev/null)
ec=$?
if [ "$ec" = "1" ] && echo "$out" | grep -q "Unknown command"; then
  pass "unknown command rejected"
else
  fail "unknown command rejected" "exit=$ec output=$out"
fi

# -- 8. project.json → engine_url resolution (reads pipeline.engine_url)
mkdir -p "$TEST_TEMP/pjson" && cat > "$TEST_TEMP/pjson/project.json" <<'JSON'
{"pipeline": {"engine_url": "https://127.0.0.2", "board_url": "https://127.0.0.3"}}
JSON
# With PIPELINE_KEY set in env and engine_url in project.json, the script
# should accept the credential setup but fail with a connection error, not
# incomplete_credentials.
out=$(cd "$TEST_TEMP/pjson" && env -i PATH="$PATH" HOME="$HOME" PIPELINE_KEY=k "$SCRIPT" thread-get 44444444-4444-4444-8444-444444444444 2>&1 >/dev/null)
ec=$?
# Exit 2 is "API error" (we expected the connection to fail since 127.0.0.2
# isn't listening). Exit 1 with incomplete_credentials would be the bug.
if echo "$out" | grep -q "incomplete_credentials"; then
  fail "project.json engine_url is read" "still saw incomplete_credentials; output=$out"
else
  pass "project.json engine_url is read"
fi

# -- 9. .env.local trumps project.json for PIPELINE_KEY / BOARD_API_URL
mkdir -p "$TEST_TEMP/envlocal" && cat > "$TEST_TEMP/envlocal/project.json" <<'JSON'
{"pipeline": {"board_url": "https://wrong.example"}}
JSON
cat > "$TEST_TEMP/envlocal/.env.local" <<'EOF'
JSP_BOARD_API_KEY=envlocal-key
JSP_BOARD_API_URL=https://127.0.0.4
EOF
# Without PIPELINE_KEY in env, the script must read .env.local.
out=$(cd "$TEST_TEMP/envlocal" && env -i PATH="$PATH" HOME="$HOME" "$SCRIPT" thread-get 44444444-4444-4444-8444-444444444444 2>&1 >/dev/null)
ec=$?
if echo "$out" | grep -q "incomplete_credentials"; then
  fail ".env.local is read" "output=$out"
else
  pass ".env.local is read"
fi

# -- 10. sidekick-api.sh does not leak credentials on stdout
# Even when we fail, the credential string must never hit stdout. The
# response body (going to stdout on success OR stderr on failure) should
# NOT echo PIPELINE_KEY regardless. This is the same security property
# that board-api.sh enforces.
out_stdout=$(cd "$TEST_TEMP/envlocal" && env -i PATH="$PATH" HOME="$HOME" PIPELINE_KEY=super-secret-key-do-not-leak ENGINE_API_URL=https://127.0.0.2 "$SCRIPT" thread-get 44444444-4444-4444-8444-444444444444 2>/dev/null)
if echo "$out_stdout" | grep -q "super-secret-key-do-not-leak"; then
  fail "PIPELINE_KEY does not leak to stdout" "output=$out_stdout"
else
  pass "PIPELINE_KEY does not leak to stdout"
fi

echo
echo "Tests: $TESTS, Passed: $PASS, Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
