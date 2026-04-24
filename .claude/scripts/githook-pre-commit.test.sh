#!/usr/bin/env bash
# Smoke tests for .githooks/pre-commit — the installed-copy edit blocker.
#
# Creates isolated temporary git repos to exercise each branch of the hook:
#   1. Self-install repo + blocked path           → commit rejected
#   2. Self-install repo + allowed path           → commit accepted
#   3. Customer project (only .pipeline/ exists)  → hook no-op, commit accepted
#   4. Framework-only repo (only pipeline/)       → hook no-op, commit accepted
#   5. Self-install repo + override env var       → commit accepted
#   6. Self-install repo + delete-only diff       → commit accepted (deletions OK)
#
# Run: bash .claude/scripts/githook-pre-commit.test.sh
# Exits 0 on all-green, non-zero on first failure.

set -u

# Locate the framework repo root (two levels up from this script).
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
FRAMEWORK_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
HOOK_SRC="$FRAMEWORK_ROOT/.githooks/pre-commit"

if [ ! -f "$HOOK_SRC" ]; then
  echo "FAIL: hook source not found at $HOOK_SRC"
  exit 1
fi

PASSED=0
FAILED=0
TESTS_RUN=0

pass() {
  PASSED=$((PASSED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
  echo "  ✓ $1"
}

fail() {
  FAILED=$((FAILED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
  echo "  ✗ $1"
}

# Create a minimal git repo with the given topology.
#   $1 = scenario: "self-install" | "customer" | "framework-only"
#   $2 = target dir
setup_repo() {
  local scenario=$1
  local dir=$2

  mkdir -p "$dir"
  (cd "$dir" && git init -q && git config user.email "test@test" && git config user.name "test")

  # Install the hook in the same way setup.sh would.
  mkdir -p "$dir/.githooks"
  cp "$HOOK_SRC" "$dir/.githooks/pre-commit"
  chmod +x "$dir/.githooks/pre-commit"
  (cd "$dir" && git config core.hooksPath .githooks)

  case "$scenario" in
    self-install)
      mkdir -p "$dir/pipeline" "$dir/.pipeline/lib" "$dir/.claude"
      echo '{"name":"src"}'        > "$dir/pipeline/package.json"
      echo '{"name":"installed"}'  > "$dir/.pipeline/package.json"
      echo 'export const x = 1;'   > "$dir/pipeline/run.ts"
      echo 'export const x = 1;'   > "$dir/.pipeline/run.ts"
      echo 'export const y = 1;'   > "$dir/.pipeline/lib/load-skills.ts"
      echo 'abc123 (2026-01-01)'   > "$dir/.claude/.pipeline-version"
      echo 'hash_value'            > "$dir/.claude/.template-hash"
      ;;
    customer)
      # Only .pipeline/ — no pipeline/ source. This is a customer project.
      mkdir -p "$dir/.pipeline/lib" "$dir/.claude"
      echo '{"name":"installed"}'  > "$dir/.pipeline/package.json"
      echo 'export const x = 1;'   > "$dir/.pipeline/run.ts"
      echo 'abc123 (2026-01-01)'   > "$dir/.claude/.pipeline-version"
      ;;
    framework-only)
      # Only pipeline/ — fresh clone before `setup.sh` has run yet.
      mkdir -p "$dir/pipeline"
      echo '{"name":"src"}' > "$dir/pipeline/package.json"
      echo 'export const x = 1;' > "$dir/pipeline/run.ts"
      ;;
  esac

  # Seed an initial commit so subsequent commits have a parent.
  (cd "$dir" && git add -A && GIT_ALLOW_INSTALLED_EDIT=1 git commit -q -m "initial" 2>/dev/null)
}

# Run a test scenario and report pass/fail based on expected exit code.
#   $1 = human label
#   $2 = repo dir
#   $3 = file to modify (relative to repo root)
#   $4 = "block" | "allow"  — expected outcome
#   $5 = (optional) env var assignments to prefix the commit with
run_commit_test() {
  local label=$1
  local dir=$2
  local file=$3
  local expected=$4
  local env_prefix=${5:-}

  # Make a change.
  echo "change $(date +%s%N)" >> "$dir/$file"
  (cd "$dir" && git add "$file")

  local rc
  if [ -n "$env_prefix" ]; then
    # `env_prefix` is a string like "GIT_ALLOW_INSTALLED_EDIT=1". Pass it via
    # `env` so the variable reaches the git process inside the subshell —
    # `(cd … && $env_prefix git …)` would interpret the prefix as a command
    # only when bash word-splits it before subshell entry, which is fragile.
    # `env <ASSIGNMENT> command` is the portable way.
    # shellcheck disable=SC2086
    (cd "$dir" && env $env_prefix git commit -q -m "test commit" >/dev/null 2>&1)
    rc=$?
  else
    (cd "$dir" && git commit -q -m "test commit" >/dev/null 2>&1)
    rc=$?
  fi

  case "$expected" in
    block)
      if [ $rc -ne 0 ]; then pass "$label"; else fail "$label (expected block, got pass)"; fi
      # Clean up the staged change so subsequent tests start clean.
      (cd "$dir" && git checkout -q -- "$file" 2>/dev/null; git reset -q HEAD "$file" 2>/dev/null || true)
      ;;
    allow)
      if [ $rc -eq 0 ]; then pass "$label"; else fail "$label (expected pass, got block)"; fi
      ;;
  esac
}

# Test deletion of an installed-copy file — a deletion of an installed-copy
# file is a special case: `git rm .pipeline/foo.ts` is allowed because
# `diff-filter=ACMR` excludes `D`. This lets us remove obsolete installed
# files before a setup.sh run regenerates them.
run_delete_test() {
  local dir=$1
  local file=$2

  (cd "$dir" && git rm -q "$file")
  (cd "$dir" && git commit -q -m "delete test" >/dev/null 2>&1)
  local rc=$?
  if [ $rc -eq 0 ]; then pass "delete of $file is allowed"; else fail "delete of $file rejected (should have passed)"; fi
}

# ---------- Execute scenarios ----------

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo ""
echo "Scenario 1: self-install repo (pipeline/ + .pipeline/)"
setup_repo self-install "$TMP/self"
run_commit_test "blocks .pipeline/run.ts edit"           "$TMP/self" ".pipeline/run.ts"          block
run_commit_test "blocks .pipeline/lib/load-skills.ts"    "$TMP/self" ".pipeline/lib/load-skills.ts" block
run_commit_test "blocks .claude/.pipeline-version"       "$TMP/self" ".claude/.pipeline-version" block
run_commit_test "blocks .claude/.template-hash"          "$TMP/self" ".claude/.template-hash"    block
run_commit_test "allows pipeline/run.ts (source edit)"   "$TMP/self" "pipeline/run.ts"           allow

# Override env var
setup_repo self-install "$TMP/self2"
run_commit_test "GIT_ALLOW_INSTALLED_EDIT=1 bypasses block" "$TMP/self2" ".pipeline/run.ts" allow "GIT_ALLOW_INSTALLED_EDIT=1"

# Deletion of installed-copy file
setup_repo self-install "$TMP/self3"
run_delete_test "$TMP/self3" ".pipeline/lib/load-skills.ts"

echo ""
echo "Scenario 2: customer project (only .pipeline/, no pipeline/)"
setup_repo customer "$TMP/customer"
run_commit_test ".pipeline/run.ts edit is allowed (no self-install signature)" "$TMP/customer" ".pipeline/run.ts" allow

echo ""
echo "Scenario 3: framework-only repo (only pipeline/, no .pipeline/ yet)"
setup_repo framework-only "$TMP/fresh"
# In a fresh framework clone (before setup.sh has run here), .pipeline/ does
# not exist yet, so the self-install signature doesn't match — hook no-ops.
run_commit_test "pipeline/run.ts edit is allowed (no installed copy yet)" "$TMP/fresh" "pipeline/run.ts" allow

echo ""
echo "Summary: $PASSED/$TESTS_RUN passed"
if [ $FAILED -ne 0 ]; then
  echo "FAILED: $FAILED test(s)"
  exit 1
fi
echo "All green."
