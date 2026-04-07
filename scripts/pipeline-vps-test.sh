#!/usr/bin/env bash
# pipeline-vps-test.sh — VPS Integration Test
#
# Creates a real smoke-test ticket, waits for the VPS pipeline to process it,
# and verifies: agents ran, PR was created, ticket reached in_review.
#
# Runs LOCALLY, connects to VPS via SSH for log verification.
#
# Usage:
#   bash scripts/pipeline-vps-test.sh --host <vps-host> [--project <slug>] [--timeout <min>]
#
# Options:
#   --host <host>       VPS hostname or IP (required)
#   --project <slug>    Project slug on VPS (default: auto-detect from project.json name)
#   --timeout <min>     Max wait time in minutes (default: 15)
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks failed
#   2 — Setup/configuration error

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

# ─── Locate repo root ──────────────────────────────────────────────────────────
REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: Not inside a git repository. Run this script from within the repo." >&2
  exit 2
}

BOARD_API="$REPO_ROOT/.claude/scripts/board-api.sh"

# ─── Argument parsing ─────────────────────────────────────────────────────────
VPS_HOST=""
PROJECT_SLUG=""
TIMEOUT_MIN=15

while [[ $# -gt 0 ]]; do
  case $1 in
    --host)     VPS_HOST="$2"; shift 2 ;;
    --project)  PROJECT_SLUG="$2"; shift 2 ;;
    --timeout)  TIMEOUT_MIN="$2"; shift 2 ;;
    -h|--help)
      echo ""
      echo "Usage: bash scripts/pipeline-vps-test.sh --host <vps-host> [--project <slug>] [--timeout <min>]"
      echo ""
      echo "Options:"
      echo "  --host <host>       VPS hostname or IP (required)"
      echo "  --project <slug>    Project slug on VPS (default: from project.json name)"
      echo "  --timeout <min>     Max wait time in minutes (default: 15)"
      echo ""
      exit 0
      ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
TOTAL=5
TICKET_NUM=""
PR_URL=""
START_TS=$(date +%s)

print_header() {
  echo ""
  echo "═══════════════════════════════════════"
  echo " VPS Pipeline Integration Test"
  echo "═══════════════════════════════════════"
  echo ""
}

print_step() {
  local step="$1"
  local label="$2"
  printf "[%s/%s] %-38s" "$step" "$TOTAL" "$label"
}

pass() {
  local detail="${1:-}"
  if [ -n "$detail" ]; then
    echo -e "${GREEN}PASS${NC} ($detail)"
  else
    echo -e "${GREEN}PASS${NC}"
  fi
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  local detail="${1:-}"
  echo -e "${RED}FAIL${NC}"
  if [ -n "$detail" ]; then
    echo "      $detail"
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

elapsed_seconds() {
  echo $(( $(date +%s) - START_TS ))
}

format_duration() {
  local secs="$1"
  local m=$(( secs / 60 ))
  local s=$(( secs % 60 ))
  printf "%dm %02ds" "$m" "$s"
}

print_result() {
  local secs
  secs=$(elapsed_seconds)
  echo ""
  echo "═══════════════════════════════════════"
  if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e " ${GREEN}RESULT: PASS — All $TOTAL checks passed${NC}"
  else
    echo -e " ${RED}RESULT: FAIL — $FAIL_COUNT of $TOTAL checks failed${NC}"
  fi
  if [ -n "$TICKET_NUM" ]; then
    echo " Ticket: T-$TICKET_NUM (cleaned up)"
  fi
  echo " Duration: $(format_duration "$secs")"
  echo "═══════════════════════════════════════"
  echo ""
}

extract_ticket_field() {
  local json="$1"
  local field="$2"
  echo "$json" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    ticket = d.get('data') or d.get('ticket') or d
    val = ticket.get('$field', '')
    if val is None:
        val = ''
    print(str(val))
except Exception:
    print('')
" 2>/dev/null
}

# ─── Cleanup (trap) ───────────────────────────────────────────────────────────
cleanup() {
  if [ -n "$TICKET_NUM" ]; then
    bash "$BOARD_API" patch "tickets/$TICKET_NUM" '{"status":"done"}' >/dev/null 2>&1 || true
  fi
  if [ -n "$PR_URL" ]; then
    # Extract PR number from URL and close it
    local pr_num
    pr_num=$(echo "$PR_URL" | grep -oE '[0-9]+$' || true)
    if [ -n "$pr_num" ]; then
      gh pr close "$pr_num" --delete-branch >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup EXIT

# ─── Main ─────────────────────────────────────────────────────────────────────
print_header

# ─── Input validation ─────────────────────────────────────────────────────────
if [ -z "$VPS_HOST" ]; then
  echo -e "${RED}ERROR:${NC} --host is required." >&2
  echo "Run: bash scripts/pipeline-vps-test.sh --help" >&2
  exit 2
fi

if ! [[ "$VPS_HOST" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo -e "${RED}ERROR:${NC} --host must be a valid hostname or IP (got: $VPS_HOST)" >&2
  exit 2
fi

if ! [[ "$TIMEOUT_MIN" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_MIN" -lt 1 ]]; then
  echo -e "${RED}ERROR:${NC} --timeout must be a positive integer (got: $TIMEOUT_MIN)" >&2
  exit 2
fi

# ─── board-api.sh check ───────────────────────────────────────────────────────
if [ ! -f "$BOARD_API" ]; then
  echo -e "${RED}ERROR:${NC} board-api.sh not found at $BOARD_API" >&2
  exit 2
fi

# ─── Read config from project.json ────────────────────────────────────────────
PROJECT_ID=$(python3 -c "
import json, sys
try:
    with open('$REPO_ROOT/project.json') as f:
        d = json.load(f)
    print(d['pipeline']['project_id'])
except Exception:
    print('', end='')
" 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}ERROR:${NC} pipeline.project_id not set in project.json" >&2
  exit 2
fi

# Default project slug from project.json name
if [ -z "$PROJECT_SLUG" ]; then
  PROJECT_SLUG=$(python3 -c "
import json, sys
try:
    with open('$REPO_ROOT/project.json') as f:
        d = json.load(f)
    print(d.get('name', ''))
except Exception:
    print('', end='')
" 2>/dev/null)
fi

echo "  VPS:     $VPS_HOST"
echo "  Project: ${PROJECT_SLUG:-<unknown>} ($PROJECT_ID)"
echo "  Timeout: ${TIMEOUT_MIN}m"
echo ""

# ─── Pre-flight checks ────────────────────────────────────────────────────────
echo -e "${YELLOW}Pre-flight checks${NC}"
echo ""

# SSH access
printf "  SSH access to root@%s ... " "$VPS_HOST"
if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "root@$VPS_HOST" "echo ok" >/dev/null 2>&1; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "  Cannot reach root@$VPS_HOST via SSH." >&2
  echo "  Run: ssh-copy-id root@$VPS_HOST" >&2
  exit 2
fi

# Docker pipeline container
printf "  Pipeline container running ... "
CONTAINER_ID=$(ssh "root@$VPS_HOST" "docker ps --filter name=pipeline -q 2>/dev/null | head -1" 2>/dev/null || true)
if [ -n "$CONTAINER_ID" ]; then
  echo -e "${GREEN}OK${NC} ($CONTAINER_ID)"
else
  echo -e "${RED}FAIL${NC}"
  echo "  No running pipeline container on VPS." >&2
  echo "  Start it: docker compose -f vps/docker-compose.yml up -d" >&2
  exit 2
fi

echo ""

# ─── Create test ticket ───────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TICKET_TITLE="[VPS-TEST] Pipeline Integration Verification — $TIMESTAMP"
TICKET_BODY="Automated VPS integration test. Verifies end-to-end pipeline flow: ticket pickup → orchestrator → agents → commit → PR. Auto-cleaned after test."

echo -e "${YELLOW}Creating test ticket...${NC}"

CREATE_RESPONSE=$(bash "$BOARD_API" post tickets \
  "{\"title\":\"$TICKET_TITLE\",\"body\":\"$TICKET_BODY\",\"status\":\"ready_to_develop\",\"priority\":\"low\",\"tags\":[\"vps-test\",\"smoke-test\"],\"project_id\":\"$PROJECT_ID\",\"complexity\":\"XS\"}" \
  2>/dev/null) || CREATE_RESPONSE=""

TICKET_NUM=$(extract_ticket_field "$CREATE_RESPONSE" "number")

if [ -z "$TICKET_NUM" ]; then
  echo -e "${RED}ERROR:${NC} Failed to create test ticket. Board API response:" >&2
  echo "$CREATE_RESPONSE" >&2
  exit 2
fi

echo -e "  Created T-$TICKET_NUM"
echo ""

# ─── Wait for pipeline processing ─────────────────────────────────────────────
TIMEOUT_SECS=$(( TIMEOUT_MIN * 60 ))
POLL_INTERVAL=30
WAIT_START=$(date +%s)

echo -e "${YELLOW}Waiting for pipeline to process T-$TICKET_NUM (max ${TIMEOUT_MIN}m)...${NC}"
echo ""

FINAL_STATUS=""
PIPELINE_STATUS=""

while true; do
  NOW=$(date +%s)
  ELAPSED=$(( NOW - WAIT_START ))

  if [ "$ELAPSED" -ge "$TIMEOUT_SECS" ]; then
    echo ""
    echo -e "${RED}  Timeout after ${TIMEOUT_MIN}m — pipeline did not complete.${NC}"
    break
  fi

  # Format progress
  ELAPSED_M=$(( ELAPSED / 60 ))
  ELAPSED_S=$(( ELAPSED % 60 ))
  ELAPSED_FMT=$(printf "%d:%02d" "$ELAPSED_M" "$ELAPSED_S")
  REMAIN_SECS=$(( TIMEOUT_SECS - ELAPSED ))
  REMAIN_M=$(( REMAIN_SECS / 60 ))
  REMAIN_S=$(( REMAIN_SECS % 60 ))
  REMAIN_FMT=$(printf "%d:%02d" "$REMAIN_M" "$REMAIN_S")

  GET_RESPONSE=$(bash "$BOARD_API" get "tickets/$TICKET_NUM" 2>/dev/null) || GET_RESPONSE=""
  CURRENT_STATUS=$(extract_ticket_field "$GET_RESPONSE" "status")
  CURRENT_PIPELINE=$(extract_ticket_field "$GET_RESPONSE" "pipeline_status")

  printf "\r  [%s/%sm] Status: %-12s Pipeline: %-12s" \
    "$ELAPSED_FMT" "$TIMEOUT_MIN" "${CURRENT_STATUS:-unknown}" "${CURRENT_PIPELINE:-null}"

  # Terminal states
  if [[ "$CURRENT_STATUS" == "in_review" || "$CURRENT_STATUS" == "done" ]]; then
    echo ""
    FINAL_STATUS="$CURRENT_STATUS"
    PIPELINE_STATUS="$CURRENT_PIPELINE"
    break
  fi

  # Pipeline failed
  if [[ "$CURRENT_PIPELINE" == "failed" ]]; then
    echo ""
    FINAL_STATUS="$CURRENT_STATUS"
    PIPELINE_STATUS="failed"
    break
  fi

  sleep "$POLL_INTERVAL"
done

echo ""

# ─── Verification checks ──────────────────────────────────────────────────────
TOTAL_SECS=$(elapsed_seconds)

# Check 1: Pipeline completed
print_step 1 "Pipeline completed"
if [[ "$FINAL_STATUS" == "in_review" || "$FINAL_STATUS" == "done" ]]; then
  pass "status: $FINAL_STATUS, $(format_duration "$TOTAL_SECS")"
else
  fail "ticket did not reach in_review (status: ${FINAL_STATUS:-timeout}, pipeline: ${PIPELINE_STATUS:-unknown})"
fi

# Check 2: Agents ran
print_step 2 "Agents executed"
AGENT_LOGS=$(ssh "root@$VPS_HOST" \
  "docker logs \$(docker ps -q --filter name=pipeline) 2>&1 | grep 'T-$TICKET_NUM' | grep -iE 'agent|orchestrat' | tail -5" \
  2>/dev/null || true)
if [ -n "$AGENT_LOGS" ]; then
  # Extract agent names for display
  AGENT_NAMES=$(echo "$AGENT_LOGS" | grep -oiE 'orchestrat[a-z]*|backend|frontend|qa|triage' | sort -u | tr '\n' ',' | sed 's/,$//')
  pass "${AGENT_NAMES:-agents invoked}"
else
  fail "no agent invocation found in Docker logs for T-$TICKET_NUM"
fi

# Check 3: PR exists
print_step 3 "PR created"
# Try board API first for pr_url field
TICKET_RESPONSE=$(bash "$BOARD_API" get "tickets/$TICKET_NUM" 2>/dev/null) || TICKET_RESPONSE=""
PR_URL=$(extract_ticket_field "$TICKET_RESPONSE" "pr_url")

if [ -z "$PR_URL" ] || [ "$PR_URL" = "None" ]; then
  # Fallback: search via gh CLI
  PR_JSON=$(gh pr list --search "[VPS-TEST]" --json number,title,url --limit 1 2>/dev/null || echo "")
  if [ -n "$PR_JSON" ]; then
    PR_URL=$(echo "$PR_JSON" | python3 -c "
import json, sys
try:
    items = json.loads(sys.stdin.read())
    if items:
        print(items[0].get('url', ''))
except Exception:
    print('')
" 2>/dev/null || true)
  fi
fi

if [ -n "$PR_URL" ] && [ "$PR_URL" != "None" ] && [ "$PR_URL" != "" ]; then
  pass "$PR_URL"
else
  fail "no PR found for T-$TICKET_NUM (checked pr_url field and gh pr list)"
fi

# Check 4: Ticket status is in_review
print_step 4 "Ticket status: in_review"
VERIFY_RESPONSE=$(bash "$BOARD_API" get "tickets/$TICKET_NUM" 2>/dev/null) || VERIFY_RESPONSE=""
VERIFY_STATUS=$(extract_ticket_field "$VERIFY_RESPONSE" "status")
if [ "$VERIFY_STATUS" = "in_review" ]; then
  pass
else
  fail "expected in_review, got: ${VERIFY_STATUS:-empty}"
fi

# Check 5: No fatal errors in pipeline logs for this ticket
print_step 5 "No pipeline errors"
ERROR_LOGS=$(ssh "root@$VPS_HOST" \
  "docker logs \$(docker ps -q --filter name=pipeline) 2>&1 | grep 'T-$TICKET_NUM' | grep -iE 'FATAL|unhandled' | tail -5" \
  2>/dev/null || true)
if [ -z "$ERROR_LOGS" ]; then
  pass
else
  fail "FATAL/unhandled errors found for T-$TICKET_NUM: $(echo "$ERROR_LOGS" | head -1)"
fi

# ─── Result ───────────────────────────────────────────────────────────────────
print_result

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
