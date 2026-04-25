#!/bin/bash
# ship-summary.test.sh — Snapshot tests for ship-summary.sh
# Validates the ship-complete template contract from skills/reporter/templates/ship-complete.md

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/ship-summary.sh"
TESTS=0
PASS=0
FAIL=0

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
    echo "  Got (first 10 lines):"
    echo "$output" | head -10 | sed 's/^/    /'
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

echo "Testing ship-summary.sh — ship-complete template snapshot"
echo ""

# --- Snapshot 1: minimal (no stale branches, no pipeline) ---
EXPECTED_MIN=$(cat <<'EOF'
✓ Shipped: chore(T-401): bump dependencies

PR        https://github.com/yves-s/just-ship/pull/258
Branch    chore/401-bump-deps → deleted
Worktree  .worktrees/T-401 → none
Board     —
EOF
)
ACTUAL_MIN=$(bash "$SCRIPT" "401" "chore(T-401): bump dependencies" \
  "https://github.com/yves-s/just-ship/pull/258" "chore/401-bump-deps" "none" "—" "")
assert_eq "Snapshot: minimal output (no stale, no pipeline)" "$ACTUAL_MIN" "$EXPECTED_MIN"

# --- Snapshot 2: full (with stale-branch hint) ---
STALE_INPUT=$'feature/283-old-intake — Remote gelöscht\nfeature/244-nav-refactor — 73 Commits hinter main'
EXPECTED_FULL=$(cat <<'EOF'
✓ Shipped: feat(T-351): add saved searches

PR        https://github.com/yves-s/just-ship/pull/257
Branch    feature/351-saved-searches → deleted
Worktree  .worktrees/T-351 → cleaned up
Board     done

Hinweis — folgende Branches könnten aufgeräumt werden:
  feature/283-old-intake — Remote gelöscht
  feature/244-nav-refactor — 73 Commits hinter main
EOF
)
ACTUAL_FULL=$(bash "$SCRIPT" "351" "feat(T-351): add saved searches" \
  "https://github.com/yves-s/just-ship/pull/257" "feature/351-saved-searches" "cleaned up" "done" "$STALE_INPUT")
assert_eq "Snapshot: full output (stale hint, board done)" "$ACTUAL_FULL" "$EXPECTED_FULL"

# --- Voice check: result-first first line ---
OUT=$(bash "$SCRIPT" "351" "feat(T-351): add saved searches" "https://example.com/pr/1" "feature/351-x" "cleaned up" "done" "")
assert_match "Voice rule 1: leads with ✓ Shipped:" "$OUT" "^✓ Shipped: feat\\(T-351\\)"

# --- Voice check: only allowed icon ---
assert_match "Voice rule 3: uses ✓ icon" "$OUT" "✓"
assert_not_match "Voice rule 3: no celebratory emoji" "$OUT" "✅|❌|🎉"

# --- Variable contract: T- prefix on ticket number ---
assert_match "Worktree row uses T-{ticket_number}" "$OUT" "Worktree  \\.worktrees/T-351"

# --- Variable contract: branch line ends with → deleted ---
assert_match "Branch row ends with → deleted" "$OUT" "Branch    feature/351-x → deleted"

# --- Variable contract: PR row contains URL ---
assert_match "PR row contains the URL" "$OUT" "PR        https://example.com/pr/1"

# --- Variable contract: Board row reflects passed status ---
assert_match "Board row shows 'done' when pipeline is configured" "$OUT" "Board     done"

# --- Optional-row rule: stale block elided when empty ---
OUT_NO_STALE=$(bash "$SCRIPT" "401" "chore(T-401): bump deps" "https://example.com/pr/2" "chore/401-x" "none" "—" "")
assert_not_match "Stale block elided when empty" "$OUT_NO_STALE" "Hinweis"

# --- Optional-row rule: stale block rendered when present ---
OUT_WITH_STALE=$(bash "$SCRIPT" "401" "chore(T-401): bump deps" "https://example.com/pr/2" "chore/401-x" "none" "—" \
  $'old/foo — Remote gelöscht')
assert_match "Stale block header rendered when present" "$OUT_WITH_STALE" "Hinweis — folgende Branches"
assert_match "Stale block lines indented two spaces" "$OUT_WITH_STALE" "^  old/foo — Remote gelöscht"

# --- Worktree status rendering ---
OUT_NO_WT=$(bash "$SCRIPT" "401" "subj" "https://example.com/p" "br" "none" "—" "")
assert_match "Worktree row 'none' renders" "$OUT_NO_WT" "Worktree  \\.worktrees/T-401 → none"

OUT_WT=$(bash "$SCRIPT" "401" "subj" "https://example.com/p" "br" "cleaned up" "done" "")
assert_match "Worktree row 'cleaned up' renders" "$OUT_WT" "Worktree  \\.worktrees/T-401 → cleaned up"

# --- Board status rendering ---
assert_match "Board row '—' renders when pipeline absent" "$OUT_NO_WT" "Board     —"

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

# --- Security: no shell injection via commit subject ---
((TESTS++))
INJ_OUT=$(bash "$SCRIPT" "1" 'subject $(echo PWNED)' "https://x.com/p" "br" "none" "—" "" 2>&1)
if ! echo "$INJ_OUT" | grep -q "PWNED$"; then
  echo "✓ Security: no injection via commit subject"
  ((PASS++))
else
  echo "✗ Security: injection via commit subject"
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
