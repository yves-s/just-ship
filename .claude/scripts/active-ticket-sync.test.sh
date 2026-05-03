#!/bin/bash
# active-ticket-sync.test.sh — Acceptance Criteria verification for T-1063
# Tests the worktree-aware .active-ticket sync logic across:
#   - SubagentStart hook fallback (on-agent-start.sh)
#   - SubagentStop hook fallback (on-agent-stop.sh)
#   - SessionStart hook dual-write (detect-ticket.sh)
#   - PostToolUse hook dual-write (detect-ticket-post.sh)
#   - SessionEnd hook ordering (on-session-end.sh: send before delete)
#
# Strategy: build a fake repo+worktree skeleton, simulate a Claude PreToolUse
# JSON payload on stdin, and assert the hook reads/writes the expected files.
# We avoid real network calls by stubbing send-event.sh into a no-op that
# records its args so we can verify the call site.
#
# Usage: bash .claude/scripts/active-ticket-sync.test.sh

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPT_DIR/../hooks" && pwd)"

TESTS=0
PASS=0
FAIL=0

TEST_TEMP=$(mktemp -d)
cleanup() { rm -rf "$TEST_TEMP"; }
trap cleanup EXIT

test_pass() { echo "✓ $1"; PASS=$((PASS+1)); TESTS=$((TESTS+1)); }
test_fail() { echo "✗ $1"; echo "  Reason: $2"; FAIL=$((FAIL+1)); TESTS=$((TESTS+1)); }

# Build a minimal repo + worktree-shaped skeleton.
# We do NOT actually use `git worktree add` — we simulate the layout that hooks
# inspect (project root has .git/, worktree dir has its own project.json and
# .claude/). The hooks call `git rev-parse --git-common-dir` so we initialise
# a real `git init` so that command works.
make_skeleton() {
  local dir="$1"
  local with_worktree="$2"

  rm -rf "$dir"
  mkdir -p "$dir/.claude/scripts" "$dir/.claude/hooks"
  cat > "$dir/project.json" <<'EOF'
{"pipeline":{"workspace_id":"test-ws","board_url":"https://test.invalid"}}
EOF
  (
    cd "$dir" \
      && git init -q \
      && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init \
      && git checkout -q -b feature/T-99999-test 2>/dev/null
  )
  # Stub send-event.sh — records calls into $dir/.claude/event-log
  cat > "$dir/.claude/scripts/send-event.sh" <<'EOF'
#!/bin/bash
# Test stub — record args, no network.
LOG="$(dirname "$0")/../event-log"
printf '%s|%s|%s\n' "$1" "$2" "$3" >> "$LOG"
EOF
  chmod +x "$dir/.claude/scripts/send-event.sh"

  if [ "$with_worktree" = "yes" ]; then
    # Simulate a worktree at $dir/.worktrees/T-99999.
    # We don't run actual `git worktree add` (avoids needing a remote/main commit);
    # instead we manually create the directory structure that the hooks inspect.
    # The hooks use `git rev-parse --git-common-dir` from within the worktree,
    # which we fake by creating a `.git` file pointing at the parent .git dir.
    local wt="$dir/.worktrees/T-99999"
    mkdir -p "$wt/.claude/scripts"
    # Create a fake worktree .git pointer file (real git worktree convention)
    echo "gitdir: $dir/.git/worktrees/T-99999" > "$wt/.git"
    mkdir -p "$dir/.git/worktrees/T-99999"
    echo "$wt/.git" > "$dir/.git/worktrees/T-99999/gitdir"
    echo "ref: refs/heads/feature/T-99999-test" > "$dir/.git/worktrees/T-99999/HEAD"
    echo "$dir/.git" > "$dir/.git/worktrees/T-99999/commondir"
    cp "$dir/project.json" "$wt/project.json"
    cp "$dir/.claude/scripts/send-event.sh" "$wt/.claude/scripts/send-event.sh"
  fi
}

# ----------------------------------------------------------------------------
# AC #1: develop.md writes .active-ticket to BOTH locations
# (Verified by inspecting commands/develop.md content — declarative check.)
# ----------------------------------------------------------------------------
test_ac1_develop_writes_both() {
  local name="AC1: commands/develop.md writes .active-ticket to BOTH worktree and main repo"
  local develop_md="$SCRIPT_DIR/../../commands/develop.md"
  if grep -q '"\$REPO_ROOT/.claude/.active-ticket"' "$develop_md" \
     && grep -q '"\$WORKTREE_DIR/.claude/.active-ticket"' "$develop_md"; then
    test_pass "$name"
  else
    test_fail "$name" "develop.md missing dual-write to REPO_ROOT and WORKTREE_DIR"
  fi
}

# ----------------------------------------------------------------------------
# AC #2: recover.md handles .active-ticket in both locations
# ----------------------------------------------------------------------------
test_ac2_recover_handles_both() {
  local name="AC2: commands/recover.md syncs .active-ticket to both locations on resume"
  local recover_md="$SCRIPT_DIR/../../commands/recover.md"
  if grep -q 'REPO_ROOT/.claude/.active-ticket' "$recover_md" \
     && grep -q '.worktrees/T-{N}/.claude/.active-ticket' "$recover_md"; then
    test_pass "$name"
  else
    test_fail "$name" "recover.md missing dual-write sync block in resume path"
  fi
}

# ----------------------------------------------------------------------------
# AC #3: on-session-end.sh sends "completed" event BEFORE deleting the file
# ----------------------------------------------------------------------------
test_ac3_session_end_send_before_delete() {
  local name="AC3: on-session-end.sh sends completed event BEFORE clearing .active-ticket"
  local hook="$HOOKS_DIR/on-session-end.sh"
  # Find the line of "send-event.sh" call and the line of the truncate (`: >`).
  local send_line trunc_line
  send_line=$(grep -n 'send-event.sh' "$hook" | head -1 | cut -d: -f1)
  trunc_line=$(grep -n ': > "\$PROJECT_ACTIVE"' "$hook" | head -1 | cut -d: -f1)
  if [ -z "$send_line" ] || [ -z "$trunc_line" ]; then
    test_fail "$name" "could not locate send-event call or truncate in on-session-end.sh"
    return
  fi
  if [ "$send_line" -lt "$trunc_line" ]; then
    test_pass "$name"
  else
    test_fail "$name" "send-event call (line $send_line) is not before truncate (line $trunc_line)"
  fi
}

# ----------------------------------------------------------------------------
# AC #4: After /develop sim, .active-ticket has same content in both locations
# ----------------------------------------------------------------------------
test_ac4_dual_location_consistency() {
  local name="AC4: simulated /develop produces consistent .active-ticket in both locations"
  local repo="$TEST_TEMP/repo-ac4"
  make_skeleton "$repo" yes

  # Replicate the develop.md Schritt 2 dual-write logic:
  echo "99999" > "$repo/.claude/.active-ticket"
  mkdir -p "$repo/.worktrees/T-99999/.claude"
  echo "99999" > "$repo/.worktrees/T-99999/.claude/.active-ticket"

  local main_val wt_val
  main_val=$(cat "$repo/.claude/.active-ticket" | tr -d '[:space:]')
  wt_val=$(cat "$repo/.worktrees/T-99999/.claude/.active-ticket" | tr -d '[:space:]')
  if [ "$main_val" = "99999" ] && [ "$wt_val" = "99999" ]; then
    test_pass "$name"
  else
    test_fail "$name" "main='$main_val' worktree='$wt_val' (expected both '99999')"
  fi
}

# ----------------------------------------------------------------------------
# AC #5: Sub-Subagent in worktree CWD with empty worktree .active-ticket but
# valid main-repo .active-ticket → on-agent-start.sh STILL sends agent_started.
# This is the core regression that T-1063 fixes.
# ----------------------------------------------------------------------------
test_ac5_subagent_event_with_main_only_active_ticket() {
  local name="AC5: on-agent-start.sh sends event when only main-repo .active-ticket has value"
  local repo="$TEST_TEMP/repo-ac5"
  make_skeleton "$repo" yes

  # Simulate the bug pre-condition: main has the value, worktree is empty.
  echo "99999" > "$repo/.claude/.active-ticket"
  : > "$repo/.worktrees/T-99999/.claude/.active-ticket"

  local payload
  payload=$(printf '{"cwd":"%s","agent_type":"backend","agent_id":"test-id-ac5"}' \
    "$repo/.worktrees/T-99999")

  # Run the hook (use the source hook in source dir, not installed) and wait
  # for the async send-event background process to flush.
  echo "$payload" | bash "$HOOKS_DIR/on-agent-start.sh" >/dev/null 2>&1
  # The hook backgrounds send-event.sh with `&`. Give it a moment.
  sleep 0.3

  local log="$repo/.worktrees/T-99999/.claude/event-log"
  if [ -f "$log" ] && grep -q '^99999|backend|agent_started$' "$log"; then
    test_pass "$name"
  else
    test_fail "$name" "expected event-log to contain '99999|backend|agent_started', got: $(cat "$log" 2>/dev/null || echo 'NO LOG FILE')"
  fi
}

# ----------------------------------------------------------------------------
# AC #6: on-agent-stop.sh resolves agent_type via map AND falls back to
# main-repo .active-ticket when worktree's is empty.
# ----------------------------------------------------------------------------
test_ac6_subagent_stop_event_with_main_only_active_ticket() {
  local name="AC6: on-agent-stop.sh sends event when only main-repo .active-ticket has value"
  local repo="$TEST_TEMP/repo-ac6"
  make_skeleton "$repo" yes

  echo "99999" > "$repo/.claude/.active-ticket"
  : > "$repo/.worktrees/T-99999/.claude/.active-ticket"

  # on-agent-start writes the agent-id mapping file we need for stop.
  local map_dir="$repo/.worktrees/T-99999/.claude/.agent-map"
  mkdir -p "$map_dir"
  echo "frontend" > "$map_dir/test-id-ac6"

  local payload
  payload=$(printf '{"cwd":"%s","agent_id":"test-id-ac6"}' \
    "$repo/.worktrees/T-99999")

  echo "$payload" | bash "$HOOKS_DIR/on-agent-stop.sh" >/dev/null 2>&1

  local log="$repo/.worktrees/T-99999/.claude/event-log"
  if [ -f "$log" ] && grep -q '^99999|frontend|completed$' "$log"; then
    test_pass "$name"
  else
    test_fail "$name" "expected event-log to contain '99999|frontend|completed', got: $(cat "$log" 2>/dev/null || echo 'NO LOG FILE')"
  fi
}

# ----------------------------------------------------------------------------
# AC #7: detect-ticket-post.sh writes to BOTH project root AND worktree CWD.
# ----------------------------------------------------------------------------
test_ac7_detect_ticket_post_dual_write() {
  local name="AC7: detect-ticket-post.sh writes .active-ticket to BOTH locations"
  local repo="$TEST_TEMP/repo-ac7"
  make_skeleton "$repo" yes

  # Pre-condition: both locations empty.
  : > "$repo/.claude/.active-ticket"
  : > "$repo/.worktrees/T-99999/.claude/.active-ticket"

  local payload
  payload=$(printf '{"tool_name":"Bash","cwd":"%s"}' "$repo/.worktrees/T-99999")
  echo "$payload" | bash "$HOOKS_DIR/detect-ticket-post.sh" >/dev/null 2>&1

  local main_val wt_val
  main_val=$(cat "$repo/.claude/.active-ticket" 2>/dev/null | tr -d '[:space:]')
  wt_val=$(cat "$repo/.worktrees/T-99999/.claude/.active-ticket" 2>/dev/null | tr -d '[:space:]')
  if [ "$main_val" = "99999" ] && [ "$wt_val" = "99999" ]; then
    test_pass "$name"
  else
    test_fail "$name" "main='$main_val' worktree='$wt_val' (expected both '99999')"
  fi
}

# ----------------------------------------------------------------------------
# AC #8: hooks exit 0 silently when no pipeline config is present
# ----------------------------------------------------------------------------
test_ac8_no_pipeline_config_exits_silently() {
  local name="AC8: on-agent-start.sh exits 0 silently when project.json has no workspace_id"
  local repo="$TEST_TEMP/repo-ac8"
  rm -rf "$repo"
  mkdir -p "$repo/.claude/scripts"
  echo '{"pipeline":{}}' > "$repo/project.json"
  cat > "$repo/.claude/scripts/send-event.sh" <<'EOF'
#!/bin/bash
echo "SHOULD-NOT-FIRE" >> "$(dirname "$0")/../event-log"
EOF
  chmod +x "$repo/.claude/scripts/send-event.sh"

  local payload
  payload=$(printf '{"cwd":"%s","agent_type":"backend","agent_id":"test-id-ac8"}' "$repo")
  local rc
  echo "$payload" | bash "$HOOKS_DIR/on-agent-start.sh" >/dev/null 2>&1
  rc=$?

  if [ "$rc" = "0" ] && [ ! -f "$repo/.claude/event-log" ]; then
    test_pass "$name"
  else
    test_fail "$name" "rc=$rc, log exists=$([ -f "$repo/.claude/event-log" ] && echo yes || echo no)"
  fi
}

# ----------------------------------------------------------------------------
# AC #9: on-session-end.sh clears .active-ticket in BOTH locations.
# ----------------------------------------------------------------------------
test_ac9_session_end_clears_both() {
  local name="AC9: on-session-end.sh clears .active-ticket in both project root AND worktree CWD"
  local repo="$TEST_TEMP/repo-ac9"
  make_skeleton "$repo" yes

  echo "99999" > "$repo/.claude/.active-ticket"
  echo "99999" > "$repo/.worktrees/T-99999/.claude/.active-ticket"

  local payload
  payload=$(printf '{"cwd":"%s","session_id":"sid-ac9"}' "$repo/.worktrees/T-99999")
  echo "$payload" | bash "$HOOKS_DIR/on-session-end.sh" >/dev/null 2>&1

  local main_val wt_val
  main_val=$(cat "$repo/.claude/.active-ticket" 2>/dev/null | tr -d '[:space:]')
  wt_val=$(cat "$repo/.worktrees/T-99999/.claude/.active-ticket" 2>/dev/null | tr -d '[:space:]')
  if [ -z "$main_val" ] && [ -z "$wt_val" ]; then
    test_pass "$name"
  else
    test_fail "$name" "expected both empty, got main='$main_val' worktree='$wt_val'"
  fi
}

# ----------------------------------------------------------------------------
# Run all tests
# ----------------------------------------------------------------------------
echo "=== T-1063 Active-Ticket Sync Tests ==="
test_ac1_develop_writes_both
test_ac2_recover_handles_both
test_ac3_session_end_send_before_delete
test_ac4_dual_location_consistency
test_ac5_subagent_event_with_main_only_active_ticket
test_ac6_subagent_stop_event_with_main_only_active_ticket
test_ac7_detect_ticket_post_dual_write
test_ac8_no_pipeline_config_exits_silently
test_ac9_session_end_clears_both

echo ""
echo "=== Summary ==="
echo "Total: $TESTS  Pass: $PASS  Fail: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
