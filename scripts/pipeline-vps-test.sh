#!/usr/bin/env bash
# pipeline-vps-test.sh — VPS Integration Test
#
# Creates a real smoke-test ticket, waits for the VPS pipeline to process it,
# and verifies: agents ran, PR was created, ticket reached in_review.
#
# Runs LOCALLY, connects to VPS via SSH for log verification.
#
# Usage:
#   bash scripts/pipeline-vps-test.sh --host <vps-host> --launch-url <url> --pipeline-key <key> [--project <slug>] [--timeout <min>]
#
# Options:
#   --host <host>          VPS hostname or IP (required — for log verification via SSH)
#   --launch-url <url>     Full POST /api/launch URL (required — e.g. https://pipeline.my.domain/api/launch)
#   --pipeline-key <key>   Pipeline server auth key (required — X-Pipeline-Key header value)
#                           Env fallback: PIPELINE_SERVER_KEY
#   --project <slug>       Project slug on VPS (default: auto-detect from project.json name)
#   --timeout <min>        Max wait time in minutes (default: 15)
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
LAUNCH_URL=""
PIPELINE_KEY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --host)          VPS_HOST="$2"; shift 2 ;;
    --project)       PROJECT_SLUG="$2"; shift 2 ;;
    --timeout)       TIMEOUT_MIN="$2"; shift 2 ;;
    --launch-url)    LAUNCH_URL="$2"; shift 2 ;;
    --pipeline-key)  PIPELINE_KEY="$2"; shift 2 ;;
    -h|--help)
      echo ""
      echo "Usage: bash scripts/pipeline-vps-test.sh --host <vps-host> --launch-url <url> --pipeline-key <key> [--project <slug>] [--timeout <min>]"
      echo ""
      echo "Options:"
      echo "  --host <host>          VPS hostname or IP (required — for log verification via SSH)"
      echo "  --launch-url <url>     Full POST /api/launch URL (required — e.g. https://pipeline.my.domain/api/launch)"
      echo "  --pipeline-key <key>   Pipeline server auth key (required — X-Pipeline-Key header value)"
      echo "                          Env fallback: PIPELINE_SERVER_KEY"
      echo "  --project <slug>       Project slug on VPS (default: from project.json name)"
      echo "  --timeout <min>        Max wait time in minutes (default: 15)"
      echo ""
      echo "Verifies Board-triggered pipeline flow: creates a ticket, checks that it is NOT"
      echo "auto-picked up (no polling), explicitly launches it via /api/launch, waits for"
      echo "the pipeline to complete, and verifies status + PR + logs."
      echo ""
      exit 0
      ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
done

# Env fallback for the pipeline key so CI can keep the secret out of argv
if [ -z "$PIPELINE_KEY" ] && [ -n "${PIPELINE_SERVER_KEY:-}" ]; then
  PIPELINE_KEY="$PIPELINE_SERVER_KEY"
fi

# ─── Helpers ──────────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
TOTAL=7
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

if [ -z "$LAUNCH_URL" ]; then
  echo -e "${RED}ERROR:${NC} --launch-url is required. The pipeline is Board-triggered — tests must explicitly POST /api/launch." >&2
  echo "Run: bash scripts/pipeline-vps-test.sh --help" >&2
  exit 2
fi

if ! [[ "$LAUNCH_URL" =~ ^https?:// ]]; then
  echo -e "${RED}ERROR:${NC} --launch-url must be an http(s) URL (got: $LAUNCH_URL)" >&2
  exit 2
fi

if [ -z "$PIPELINE_KEY" ]; then
  echo -e "${RED}ERROR:${NC} --pipeline-key (or PIPELINE_SERVER_KEY env) is required for /api/launch auth." >&2
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
  echo "  Start it: cd /home/claude-dev/just-ship-ops && docker compose -f vps/docker-compose.yml up -d" >&2
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

# ─── No-polling check ─────────────────────────────────────────────────────────
# The Engine does nothing unbidden. A ticket in ready_to_develop must stay
# untouched until /api/launch fires. Wait 45s and confirm pipeline_status is
# still null. Short enough to keep the test responsive, long enough that a
# polling worker (old behavior: 60s default) would have claimed the ticket.
echo -e "${YELLOW}Verifying no auto-pickup without /api/launch trigger...${NC}"
QUIET_WAIT_SECS=45
sleep "$QUIET_WAIT_SECS"

QUIET_RESPONSE=$(bash "$BOARD_API" get "tickets/$TICKET_NUM" 2>/dev/null) || QUIET_RESPONSE=""
QUIET_STATUS=$(extract_ticket_field "$QUIET_RESPONSE" "status")
QUIET_PIPELINE=$(extract_ticket_field "$QUIET_RESPONSE" "pipeline_status")
echo "  After ${QUIET_WAIT_SECS}s: status=$QUIET_STATUS pipeline_status=${QUIET_PIPELINE:-null}"
echo ""

# ─── Trigger: POST /api/launch ────────────────────────────────────────────────
echo -e "${YELLOW}Triggering pipeline via POST /api/launch...${NC}"

# Write the auth header to a mode-600 temp file so the key does not appear in
# argv / ps-aux. curl --header @<file> reads headers at runtime — the secret
# never reaches the process argument list.
_LAUNCH_HDR_FILE=$(mktemp /tmp/vps-test-hdr-XXXXXX)
chmod 600 "$_LAUNCH_HDR_FILE"
printf 'X-Pipeline-Key: %s\n' "$PIPELINE_KEY" > "$_LAUNCH_HDR_FILE"

LAUNCH_HTTP_CODE=$(curl -sS -o /tmp/vps-test-launch-$$.json -w "%{http_code}" \
  -X POST "$LAUNCH_URL" \
  -H "Content-Type: application/json" \
  --header "@${_LAUNCH_HDR_FILE}" \
  --max-time 30 \
  --data "{\"ticket_number\":$TICKET_NUM,\"project_id\":\"$PROJECT_ID\"}" \
  2>/dev/null) || LAUNCH_HTTP_CODE="000"

LAUNCH_BODY=$(cat /tmp/vps-test-launch-$$.json 2>/dev/null || true)
rm -f /tmp/vps-test-launch-$$.json "$_LAUNCH_HDR_FILE"

echo "  /api/launch → HTTP $LAUNCH_HTTP_CODE"
echo ""

LAUNCH_OK=false
if [[ "$LAUNCH_HTTP_CODE" =~ ^(200|202)$ ]]; then
  LAUNCH_OK=true
else
  echo -e "${RED}ERROR:${NC} /api/launch returned HTTP $LAUNCH_HTTP_CODE — pipeline will not start." >&2
  echo "       body: $LAUNCH_BODY" >&2
fi

# ─── Wait for pipeline processing ─────────────────────────────────────────────
FINAL_STATUS=""
PIPELINE_STATUS=""

if $LAUNCH_OK; then
  TIMEOUT_SECS=$(( TIMEOUT_MIN * 60 ))
  POLL_INTERVAL=30
  WAIT_START=$(date +%s)

  echo -e "${YELLOW}Waiting for pipeline to process T-$TICKET_NUM (max ${TIMEOUT_MIN}m)...${NC}"
  echo ""

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
else
  echo -e "${YELLOW}Skipping wait — launch was rejected, pipeline not started.${NC}"
fi

echo ""

# ─── Verification checks ──────────────────────────────────────────────────────
TOTAL_SECS=$(elapsed_seconds)

# Check 1: No auto-pickup before /api/launch
# The ticket should have been untouched after the quiet wait — no polling worker,
# no pipeline_status, still ready_to_develop.
print_step 1 "No auto-pickup before launch"
if [ "$QUIET_STATUS" = "ready_to_develop" ] && { [ -z "$QUIET_PIPELINE" ] || [ "$QUIET_PIPELINE" = "None" ] || [ "$QUIET_PIPELINE" = "null" ]; }; then
  pass "ticket idle after ${QUIET_WAIT_SECS}s"
else
  fail "ticket was picked up without /api/launch (status: $QUIET_STATUS, pipeline_status: ${QUIET_PIPELINE:-null})"
fi

# Check 2: /api/launch accepted the trigger
print_step 2 "Launch accepted"
if [[ "$LAUNCH_HTTP_CODE" =~ ^(200|202)$ ]]; then
  pass "HTTP $LAUNCH_HTTP_CODE"
else
  fail "/api/launch returned HTTP $LAUNCH_HTTP_CODE"
fi

# Check 3: Pipeline completed
print_step 3 "Pipeline completed"
if [[ "$FINAL_STATUS" == "in_review" || "$FINAL_STATUS" == "done" ]]; then
  pass "status: $FINAL_STATUS, $(format_duration "$TOTAL_SECS")"
else
  fail "ticket did not reach in_review (status: ${FINAL_STATUS:-timeout}, pipeline: ${PIPELINE_STATUS:-unknown})"
fi

# Check 4: Agents ran
print_step 4 "Agents executed"
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

# Check 5: PR exists
print_step 5 "PR created"
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

# Check 6: Ticket status is in_review
print_step 6 "Ticket status: in_review"
VERIFY_RESPONSE=$(bash "$BOARD_API" get "tickets/$TICKET_NUM" 2>/dev/null) || VERIFY_RESPONSE=""
VERIFY_STATUS=$(extract_ticket_field "$VERIFY_RESPONSE" "status")
if [ "$VERIFY_STATUS" = "in_review" ]; then
  pass
else
  fail "expected in_review, got: ${VERIFY_STATUS:-empty}"
fi

# Check 7: No fatal errors in pipeline logs for this ticket
print_step 7 "No pipeline errors"
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
