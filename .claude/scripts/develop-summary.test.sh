#!/bin/bash
# develop-summary.test.sh — Snapshot tests for develop-summary.sh
# Validates the develop-complete template contract from
# skills/reporter/templates/develop-complete.md.
#
# Tests run in /tmp work-dirs so git stats are deterministic (0 files / 0 / 0 / 0).
# Token rows elide because there's no Claude session in /tmp.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/develop-summary.sh"
TESTS=0
PASS=0
FAIL=0

# --- Test fixtures: isolated /tmp dirs (no git, no session) ---
FIXTURE_EMPTY=$(mktemp -d -t develop-summary-empty-XXXXXX)
trap 'rm -rf "$FIXTURE_EMPTY" "$FIXTURE_TEAM"' EXIT

FIXTURE_TEAM=$(mktemp -d -t develop-summary-team-XXXXXX)
mkdir -p "$FIXTURE_TEAM/.claude"
cat > "$FIXTURE_TEAM/.claude/.reporter-team-roster.json" <<'EOF'
{
  "team": [
    {"icon": "✓", "role": "planner", "tokens": 12300},
    {"icon": "✓", "role": "backend", "tokens": 41200},
    {"icon": "✓", "role": "qa", "tokens": 8700},
    {"icon": "✓", "role": "docs", "tokens": 2100}
  ]
}
EOF

assert_match() {
  local name="$1"
  local output="$2"
  local pattern="$3"
  ((TESTS++))
  if echo "$output" | grep -qE "$pattern"; then
    echo "✓ $name"
    ((PASS++))
  else
    echo "✗ $name"
    echo "  Expected pattern: $pattern"
    echo "  Got (first 15 lines):"
    echo "$output" | head -15 | sed 's/^/    /'
    ((FAIL++))
  fi
}

assert_not_match() {
  local name="$1"
  local output="$2"
  local pattern="$3"
  ((TESTS++))
  if ! echo "$output" | grep -qE "$pattern"; then
    echo "✓ $name"
    ((PASS++))
  else
    echo "✗ $name"
    echo "  Expected NOT to find: $pattern"
    ((FAIL++))
  fi
}

assert_eq() {
  local name="$1"
  local actual="$2"
  local expected="$3"
  ((TESTS++))
  if [ "$actual" = "$expected" ]; then
    echo "✓ $name"
    ((PASS++))
  else
    echo "✗ $name"
    echo "  Expected:"
    echo "$expected" | sed 's/^/    /'
    echo "  Actual:"
    echo "$actual" | sed 's/^/    /'
    ((FAIL++))
  fi
}

run_in() {
  local fixture="$1"
  shift
  ( cd "$fixture" && bash "$SCRIPT" "$@" )
}

echo "Testing develop-summary.sh — develop-complete template snapshot"
echo ""

# --- Snapshot 1: minimal (no team, no PR, no preview) ---
EXPECTED_MIN=$(cat <<'EOF'
✓ T-401 · chore: bump dependencies

Routine dependency bump.

Build   ✓ passed
Tests   ✓ 4/4
QA      — skipped
Diff    0 files · +0 / −0 · 0 commits
Branch  unknown
EOF
)
ACTUAL_MIN=$(run_in "$FIXTURE_EMPTY" "401" "chore: bump dependencies" "Routine dependency bump." "passed" "4" "4" "skipped" "" "")
assert_eq "Snapshot: minimal output (no team, no PR, no preview)" "$ACTUAL_MIN" "$EXPECTED_MIN"

# --- Snapshot 2: full (team roster + PR + preview) ---
EXPECTED_FULL=$(cat <<'EOF'
✓ T-998 · Reporter-Skill + 5 Core-Templates

Introduces skills/reporter/ with voice rules and 5 core templates.

Team
────
✓ planner · 12.3k tokens
✓ backend · 41.2k tokens
✓ qa      · 8.7k tokens
✓ docs    · 2.1k tokens

Build   ✓ passed
Tests   ✓ 12/12
QA      ✓ passed
Diff    0 files · +0 / −0 · 0 commits
Branch  unknown
PR      https://github.com/yves-s/just-ship/pull/260
Preview https://just-ship-git-feature-998-reporter-skill.vercel.app
EOF
)
ACTUAL_FULL=$(run_in "$FIXTURE_TEAM" \
  "998" \
  "Reporter-Skill + 5 Core-Templates" \
  "Introduces skills/reporter/ with voice rules and 5 core templates." \
  "passed" "12" "12" "passed" \
  "https://github.com/yves-s/just-ship/pull/260" \
  "https://just-ship-git-feature-998-reporter-skill.vercel.app")
assert_eq "Snapshot: full output (team roster + PR + preview)" "$ACTUAL_FULL" "$EXPECTED_FULL"

# --- Voice rule 1: Result-first (first line leads with ✓ T-N · title) ---
OUT=$(run_in "$FIXTURE_EMPTY" "351" "add saved searches" "Adds saved searches feature." "passed" "12" "12" "passed" "https://example.com/pr/1" "")
assert_match "Voice rule 1: leads with ✓ T-{N} · title" "$OUT" "^✓ T-351 · add saved searches"

# --- Voice rule 3: only allowed icons ---
assert_match "Voice rule 3: uses ✓ icon" "$OUT" "✓"
assert_not_match "Voice rule 3: no celebratory emoji" "$OUT" "✅|❌|🎉"

# --- Variable contract: T- prefix on ticket number ---
assert_match "First line uses T-{ticket_number} prefix" "$OUT" "^✓ T-351 ·"

# --- Variable contract: QA icon mapping ---
OUT_PASSED=$(run_in "$FIXTURE_EMPTY" "1" "t" "s" "passed" "1" "1" "passed" "" "")
assert_match "QA passed → ✓" "$OUT_PASSED" "^QA      ✓ passed"

OUT_NEEDS=$(run_in "$FIXTURE_EMPTY" "1" "t" "s" "passed" "1" "1" "needs-review" "" "")
assert_match "QA needs-review → ⚠" "$OUT_NEEDS" "^QA      ⚠ needs-review"

OUT_SKIPPED=$(run_in "$FIXTURE_EMPTY" "1" "t" "s" "passed" "1" "1" "skipped" "" "")
assert_match "QA skipped → —" "$OUT_SKIPPED" "^QA      — skipped"

# --- Variable contract: Build icon mapping ---
OUT_BUILD_FAIL=$(run_in "$FIXTURE_EMPTY" "1" "t" "s" "failed" "1" "1" "passed" "" "")
assert_match "Build failed → ✗" "$OUT_BUILD_FAIL" "^Build   ✗ failed"

# --- Variable contract: Tests row uses passed/total format ---
OUT_TESTS=$(run_in "$FIXTURE_EMPTY" "1" "t" "s" "passed" "12" "15" "passed" "" "")
assert_match "Tests row uses {passed}/{total} format" "$OUT_TESTS" "^Tests   ✓ 12/15"

# --- Optional-row rule: PR line elided when empty ---
OUT_NO_PR=$(run_in "$FIXTURE_EMPTY" "1" "t" "s" "passed" "1" "1" "passed" "" "https://example.com/preview")
assert_not_match "PR line elided when empty" "$OUT_NO_PR" "^PR "
assert_match "Preview line still rendered" "$OUT_NO_PR" "^Preview https://example.com/preview"

# --- Optional-row rule: Preview line elided when empty ---
OUT_NO_PREVIEW=$(run_in "$FIXTURE_EMPTY" "1" "t" "s" "passed" "1" "1" "passed" "https://example.com/pr/1" "")
assert_not_match "Preview line elided when empty" "$OUT_NO_PREVIEW" "^Preview "
assert_match "PR line still rendered" "$OUT_NO_PREVIEW" "^PR      https://example.com/pr/1"

# --- Optional-row rule: Team block elided when no roster file ---
assert_not_match "Team block elided without roster" "$OUT_NO_PR" "^Team$"

# --- Variable contract: Team block rendered with roster file ---
OUT_TEAM=$(run_in "$FIXTURE_TEAM" "1" "t" "s" "passed" "1" "1" "passed" "" "")
assert_match "Team block header rendered with roster" "$OUT_TEAM" "^Team$"
assert_match "Team rule line rendered" "$OUT_TEAM" "^────$"
assert_match "Team row formats role · tokens with humanization" "$OUT_TEAM" "^✓ planner · 12\\.3k tokens"

# --- Variable contract: Diff row aggregates files / +ins / -del / commits ---
assert_match "Diff row uses files · +ins / −del · commits" "$OUT" "^Diff    0 files · \\+0 / −0 · 0 commits"

# --- Team-icon override: develop-complete always renders ✓, even if roster has ▸ ---
# (Pre-Develop writes ▸ as a placeholder; the renderer must override since by the
#  time develop-complete fires, all agents are done.)
FIXTURE_RUNNING_ICON=$(mktemp -d -t develop-summary-running-XXXXXX)
mkdir -p "$FIXTURE_RUNNING_ICON/.claude"
cat > "$FIXTURE_RUNNING_ICON/.claude/.reporter-team-roster.json" <<'EOF'
{
  "team": [
    {"icon": "▸", "role": "planner", "tokens": 12300},
    {"icon": "▸", "role": "qa",      "tokens": 8700}
  ]
}
EOF
OUT_RUNNING=$(run_in "$FIXTURE_RUNNING_ICON" "1" "t" "s" "passed" "1" "1" "passed" "" "")
assert_match "Team-icon override: planner row uses ✓ even when roster has ▸" "$OUT_RUNNING" "^✓ planner · 12\\.3k tokens"
assert_not_match "Team-icon override: no ▸ icon leaks into Team block" "$OUT_RUNNING" "^▸ "
rm -rf "$FIXTURE_RUNNING_ICON"

# --- Error handling: missing required args ---
((TESTS++))
ERR_OUT=$(bash "$SCRIPT" 2>&1 || true)
if echo "$ERR_OUT" | grep -q "Usage:"; then
  echo "✓ Error: missing args shows usage"
  ((PASS++))
else
  echo "✗ Error: missing args shows usage"
  echo "  Got: $ERR_OUT"
  ((FAIL++))
fi

# --- Security: no shell injection via summary text or title ---
((TESTS++))
INJ_OUT=$(run_in "$FIXTURE_EMPTY" "1" 'title $(echo PWNED-TITLE)' 'summary $(echo PWNED-SUMMARY)' "passed" "1" "1" "passed" "" "" 2>&1)
if ! echo "$INJ_OUT" | grep -qE "PWNED-TITLE$|PWNED-SUMMARY$"; then
  echo "✓ Security: no injection via title/summary"
  ((PASS++))
else
  echo "✗ Security: injection via title or summary"
  echo "  Got:"
  echo "$INJ_OUT" | sed 's/^/    /'
  ((FAIL++))
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
