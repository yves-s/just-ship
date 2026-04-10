#!/bin/bash
# backfill-ticket-costs.sh — One-time backfill for historical ticket costs
# Fixes three pricing bugs: T-699, T-715, T-727
#
# Usage:
#   bash scripts/backfill-ticket-costs.sh [--dry-run|--apply]
#
# Default is --dry-run (safe). Use --apply to write changes.
#
# Bug history:
#   T-699 — VPS tickets used full input price instead of 95% cache-read price
#   T-715 — Local tickets accumulated session-cumulative tokens (unrecoverable)
#   T-727 — Cache-read pricing TTL fix (affected cost calculations)
#
# Correct pricing (Opus, 5min TTL, per 1K tokens):
#   input:       $0.015000
#   cacheRead:   $0.000300
#   cacheCreate: $0.018750
#   output:      $0.075000

set -euo pipefail

# --- Resolve paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BOARD_API="$REPO_ROOT/.claude/scripts/board-api.sh"

if [ ! -f "$BOARD_API" ]; then
  echo "ERROR: board-api.sh not found at $BOARD_API" >&2
  exit 1
fi

# --- Parse args ---
MODE="dry-run"
for arg in "$@"; do
  case "$arg" in
    --apply)    MODE="apply" ;;
    --dry-run)  MODE="dry-run" ;;
    *)
      echo "Usage: $0 [--dry-run|--apply]" >&2
      exit 1
      ;;
  esac
done

# --- Header ---
echo ""
echo "=== Backfill Ticket Costs ==="
if [ "$MODE" = "dry-run" ]; then
  echo "Mode: DRY RUN (use --apply to write changes)"
else
  echo "Mode: APPLY (writing changes to Board API)"
fi
echo ""

# --- Helpers ---

# Fetch ticket JSON from board API
fetch_ticket() {
  local ticket_num="$1"
  bash "$BOARD_API" get "tickets/$ticket_num" 2>/dev/null || echo '{}'
}

# Extract a numeric field from JSON (returns 0 if missing/null)
extract_number() {
  local json="$1"
  local field="$2"
  echo "$json" | node -e "
    const raw = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
    const d = raw.data || raw;
    const val = d['$field'];
    process.stdout.write(String(val == null ? '0' : val));
  " 2>/dev/null || echo "0"
}

# Calculate VPS recost using node for float math
# Formula:
#   inputTokens  = total * 0.75
#   outputTokens = total * 0.25
#   freshInput   = inputTokens * 0.05
#   cacheRead    = inputTokens * 0.95
#   cost = (freshInput/1000 * 0.015) + (cacheRead/1000 * 0.0003) + (outputTokens/1000 * 0.075)
calc_vps_cost() {
  local total_tokens="$1"
  node -e "
    const total = $total_tokens;
    const input = total * 0.75;
    const output = total * 0.25;
    const fresh = input * 0.05;
    const cached = input * 0.95;
    const cost = (fresh / 1000 * 0.015) + (cached / 1000 * 0.0003) + (output / 1000 * 0.075);
    process.stdout.write(cost.toFixed(4));
  "
}

# Absolute difference between two floats
abs_diff() {
  node -e "process.stdout.write(String(Math.abs($1 - $2).toFixed(6)));"
}

# Format cost as $X.XXXX
fmt_cost() {
  node -e "process.stdout.write('\$' + parseFloat('$1').toFixed(4));"
}

# --- Accumulators ---
TOTAL_OLD=0
TOTAL_NEW=0

# --- VPS Tickets ---
echo "--- VPS Tickets (recalculate with 95% cache-read) ---"

VPS_TICKETS=(586 610 616 618 625 647 648)

for ticket_num in "${VPS_TICKETS[@]}"; do
  json=$(fetch_ticket "$ticket_num")

  total_tokens=$(extract_number "$json" "total_tokens")
  old_cost=$(extract_number "$json" "estimated_cost")

  # Skip if no token data
  if [ "$total_tokens" = "0" ] || [ "$total_tokens" = "null" ]; then
    echo "T-$ticket_num:  [SKIP] total_tokens=0, no data"
    continue
  fi

  new_cost=$(calc_vps_cost "$total_tokens")
  diff=$(abs_diff "$old_cost" "$new_cost")

  # Idempotency check: skip if already corrected (within $0.0001)
  already_correct=$(node -e "process.stdout.write(String($diff < 0.0001));")
  if [ "$already_correct" = "true" ]; then
    echo "T-$ticket_num:  [SKIP] already correct ($(fmt_cost "$new_cost"))"
    continue
  fi

  savings=$(node -e "process.stdout.write(('\$' + ($old_cost - $new_cost).toFixed(4)));")
  echo "T-$ticket_num:  $(fmt_cost "$old_cost") → $(fmt_cost "$new_cost")  (saved $savings)"

  TOTAL_OLD=$(node -e "process.stdout.write(String($TOTAL_OLD + $old_cost));")
  TOTAL_NEW=$(node -e "process.stdout.write(String($TOTAL_NEW + $new_cost));")

  if [ "$MODE" = "apply" ]; then
    patch_result=$(bash "$BOARD_API" patch "tickets/$ticket_num" "{\"estimated_cost\": $new_cost}" 2>&1) || {
      echo "  ERROR: PATCH failed for T-$ticket_num" >&2
      exit 1
    }
    echo "  Applied."
  fi
done

echo ""

# --- Local Tickets (session-cumulative, data unrecoverable) ---
echo "--- Local Tickets (session-cumulative, zeroing out) ---"

LOCAL_TICKETS=(712 715 719)

for ticket_num in "${LOCAL_TICKETS[@]}"; do
  json=$(fetch_ticket "$ticket_num")

  total_tokens=$(extract_number "$json" "total_tokens")
  old_cost=$(extract_number "$json" "estimated_cost")

  # Idempotency: skip if already zeroed
  if [ "$total_tokens" = "0" ] && [ "$(node -e "process.stdout.write(String($old_cost < 0.0001));")" = "true" ]; then
    echo "T-$ticket_num:  [SKIP] already zeroed"
    continue
  fi

  echo "T-$ticket_num:  $(fmt_cost "$old_cost") → \$0.0000  (data unrecoverable, no JSONL)"

  TOTAL_OLD=$(node -e "process.stdout.write(String($TOTAL_OLD + $old_cost));")
  # TOTAL_NEW stays the same (adding 0)

  if [ "$MODE" = "apply" ]; then
    patch_result=$(bash "$BOARD_API" patch "tickets/$ticket_num" '{"total_tokens": 0, "estimated_cost": 0}' 2>&1) || {
      echo "  ERROR: PATCH failed for T-$ticket_num" >&2
      exit 1
    }
    echo "  Applied (total_tokens=0, estimated_cost=0)."
  fi
done

echo ""

# --- Summary ---
TOTAL_SAVED=$(node -e "process.stdout.write(('\$' + ($TOTAL_OLD - $TOTAL_NEW).toFixed(4)));")
echo "Total old:   $(fmt_cost "$TOTAL_OLD")"
echo "Total new:   $(fmt_cost "$TOTAL_NEW")"
echo "Total saved: $TOTAL_SAVED"
echo ""

if [ "$MODE" = "dry-run" ]; then
  echo "Run with --apply to write these changes."
fi

exit 0
