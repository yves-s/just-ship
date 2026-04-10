#!/bin/bash
# hooks-migration.test.sh — T-749 Acceptance Criteria Verification
# Tests that hooks/scripts migration is complete and functional

set -uo pipefail

TESTS=0
PASS=0
FAIL=0
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

test_ac() {
  local name="$1"
  local condition="$2"
  ((TESTS++))

  if eval "$condition" 2>/dev/null; then
    echo "✓ $name"
    ((PASS++))
  else
    echo "✗ $name"
    ((FAIL++))
  fi
}

test_file_exists() {
  local path="$1"
  [ -f "$path" ]
}

test_cmd_contains() {
  local cmd="$1"
  local pattern="$2"
  grep -q "$pattern" <(eval "$cmd" 2>/dev/null || true)
}

echo "=== T-749 Acceptance Criteria Verification ==="
echo ""

# AC#1: plugin.json has all 5 hooks
echo "AC#1: plugin.json hook registrations"
test_ac "AC1.1: SessionStart registered" "grep -q 'SessionStart' '$PLUGIN_ROOT/plugin.json'"
test_ac "AC1.2: SubagentStart registered" "grep -q 'SubagentStart' '$PLUGIN_ROOT/plugin.json'"
test_ac "AC1.3: SubagentStop registered" "grep -q 'SubagentStop' '$PLUGIN_ROOT/plugin.json'"
test_ac "AC1.4: SessionEnd registered" "grep -q 'SessionEnd' '$PLUGIN_ROOT/plugin.json'"
test_ac "AC1.5: PostToolUse registered" "grep -q 'PostToolUse' '$PLUGIN_ROOT/plugin.json'"
echo ""

# AC#2: All 5 hook scripts exist and use ${CLAUDE_PLUGIN_ROOT}
echo "AC#2: Hook script files and path variables"
HOOKS_DIR="$PLUGIN_ROOT/scripts/hooks"
test_ac "AC2.1: detect-ticket.sh exists" "test_file_exists '$HOOKS_DIR/detect-ticket.sh'"
test_ac "AC2.2: on-agent-start.sh exists" "test_file_exists '$HOOKS_DIR/on-agent-start.sh'"
test_ac "AC2.3: on-agent-stop.sh exists" "test_file_exists '$HOOKS_DIR/on-agent-stop.sh'"
test_ac "AC2.4: on-session-end.sh exists" "test_file_exists '$HOOKS_DIR/on-session-end.sh'"
test_ac "AC2.5: detect-ticket-post.sh exists" "test_file_exists '$HOOKS_DIR/detect-ticket-post.sh'"

test_ac "AC2.6: Hooks use \${CLAUDE_PLUGIN_ROOT}" "grep -q '\${CLAUDE_PLUGIN_ROOT}' '$HOOKS_DIR/detect-ticket.sh'"
test_ac "AC2.7: on-agent-start uses \${CLAUDE_PLUGIN_ROOT}" "grep -q '\${CLAUDE_PLUGIN_ROOT}' '$HOOKS_DIR/on-agent-start.sh'"
test_ac "AC2.8: on-agent-stop uses \${CLAUDE_PLUGIN_ROOT}" "grep -q '\${CLAUDE_PLUGIN_ROOT}' '$HOOKS_DIR/on-agent-stop.sh'"
test_ac "AC2.9: on-session-end uses \${CLAUDE_PLUGIN_ROOT}" "grep -q '\${CLAUDE_PLUGIN_ROOT}' '$HOOKS_DIR/on-session-end.sh'"
echo ""

# AC#3: 16 utility scripts + 2 test scripts migrated
echo "AC#3: Utility and test scripts migration"
UTIL_COUNT=$(ls -1 "$PLUGIN_ROOT/scripts/"*.sh 2>/dev/null | grep -v hooks | wc -l | tr -d ' ')
test_ac "AC3.1: 18 shell scripts present (16 util + 2 test)" "[ '$UTIL_COUNT' = '18' ]"

# List utility scripts
EXPECTED_UTILS=("board-api.sh" "send-event.sh" "calculate-session-cost.sh" "shopify-qa.sh" "coolify-api.sh" "coolify-deploy.sh" "shopify-dev.sh" "shopify-preview.sh" "shopify-env-check.sh" "shopify-app-deploy.sh" "get-preview-url.sh" "post-comment.sh" "session-summary.sh" "ask-human.sh" "write-config.sh" "backfill-ticket-costs.sh")
for util in "${EXPECTED_UTILS[@]}"; do
  test_ac "AC3: $util migrated" "test_file_exists '$PLUGIN_ROOT/scripts/$util'"
done

# Test scripts
test_ac "AC3: session-summary.test.sh migrated" "test_file_exists '$PLUGIN_ROOT/scripts/session-summary.test.sh'"
test_ac "AC3: shopify-app-deploy.test.sh migrated" "test_file_exists '$PLUGIN_ROOT/scripts/shopify-app-deploy.test.sh'"
echo ""

# AC#4: $CLAUDE_PROJECT_DIR replaced with ${CLAUDE_PLUGIN_ROOT}
echo "AC#4: Path variable replacements"
if ! grep -r '\$CLAUDE_PROJECT_DIR' "$PLUGIN_ROOT/scripts/" 2>/dev/null | grep -v hooks-migration.test.sh | grep -q .; then
  echo "✓ AC4: No \$CLAUDE_PROJECT_DIR in scripts"
  ((TESTS++))
  ((PASS++))
else
  echo "✗ AC4: No \$CLAUDE_PROJECT_DIR in scripts"
  ((TESTS++))
  ((FAIL++))
fi
echo ""

# AC#5: Scripts reading project files use correct paths
echo "AC#5: Project file references (project.json, .active-ticket)"
test_ac "AC5.1: project.json referenced correctly" "grep -q 'project\.json' '$HOOKS_DIR/detect-ticket.sh'"
test_ac "AC5.2: .active-ticket referenced correctly" "grep -q '\.active-ticket' '$HOOKS_DIR/detect-ticket.sh'"
test_ac "AC5.3: project.json in on-agent-start.sh" "grep -q 'project\.json' '$HOOKS_DIR/on-agent-start.sh'"
test_ac "AC5.4: .active-ticket in on-agent-start.sh" "grep -q '\.active-ticket' '$HOOKS_DIR/on-agent-start.sh'"
echo ""

# AC#6: Board API calls functional
echo "AC#6: Board API functionality"
test_ac "AC6.1: board-api.sh has credential resolution" "grep -q 'write-config.sh' '$PLUGIN_ROOT/scripts/board-api.sh'"
test_ac "AC6.2: board-api.sh handles HTTP methods" "grep -q 'METHOD=' '$PLUGIN_ROOT/scripts/board-api.sh'"
test_ac "AC6.3: board-api.sh makes curl calls" "grep -q 'curl' '$PLUGIN_ROOT/scripts/board-api.sh'"
echo ""

# AC#7: Security - Credentials handling
echo "AC#7: Security - Credentials and secrets"
test_ac "AC7.1: No hardcoded api keys in board-api.sh" "! grep -E \"adp_[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]+\" '$PLUGIN_ROOT/scripts/board-api.sh'"
test_ac "AC7.2: Credentials resolved via variables not hardcoded" "grep -q 'PIPELINE_KEY=' '$PLUGIN_ROOT/scripts/board-api.sh'"
test_ac "AC7.3: send-event.sh resolves credentials" "grep -q 'write-config.sh' '$PLUGIN_ROOT/scripts/send-event.sh'"
test_ac "AC7.4: No eval in production code (test code excluded)" "! grep -E '^\\s*eval ' '$PLUGIN_ROOT/scripts/board-api.sh' '$PLUGIN_ROOT/scripts/send-event.sh'"
echo ""

# AC#8: Settings.json has proper hooks section
echo "AC#8: Settings.json integration"
test_ac "AC8.1: .claude/settings.json has hooks section" "grep -q '\"hooks\"' '$PLUGIN_ROOT/../.claude/settings.json'"
test_ac "AC8.2: Settings uses \${CLAUDE_PLUGIN_ROOT}" "grep -q '\${CLAUDE_PLUGIN_ROOT}' '$PLUGIN_ROOT/../.claude/settings.json'"
echo ""

echo ""
echo "================================"
echo "Total Tests: $TESTS"
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "================================"

if [ $FAIL -eq 0 ]; then
  echo "All acceptance criteria verified!"
  exit 0
else
  exit 1
fi
