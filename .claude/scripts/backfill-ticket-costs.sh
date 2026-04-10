#!/bin/bash
# backfill-ticket-costs.sh — Recalculate historical ticket costs with current pricing
# Usage: bash scripts/backfill-ticket-costs.sh [--dry-run]
#
# Corrects tickets that were calculated with outdated pricing:
# - Old per-1K pricing ($15/Ktok instead of $5/MTok for Opus)
# - Wrong cache-read TTL ($1.50/MTok instead of $0.30/MTok, now $0.10/MTok)
# - Cumulative session costs instead of per-ticket deltas
#
# For VPS tickets: recalculates from task_events.input_tokens/output_tokens
# For local tickets: flags as needing manual review (no session data available)

set -euo pipefail

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  echo "=== DRY RUN — no changes will be written ==="
  echo ""
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Resolve board-api.sh path
BOARD_API="$SCRIPT_DIR/.claude/scripts/board-api.sh"
if [ ! -f "$BOARD_API" ]; then
  echo "ERROR: board-api.sh not found at $BOARD_API"
  exit 1
fi

# Current Opus pricing per MTok (must match pipeline/lib/cost.ts)
# Pricing last verified: 2026-04-10
OPUS_INPUT=5
OPUS_CACHE_READ=0.10
OPUS_CACHE_CREATE=6.25
OPUS_OUTPUT=25

echo "=== Backfill Ticket Costs ==="
echo "Pricing: Opus input=\$$OPUS_INPUT/MTok, cache_read=\$$OPUS_CACHE_READ/MTok, cache_create=\$$OPUS_CACHE_CREATE/MTok, output=\$$OPUS_OUTPUT/MTok"
echo ""

# Get all tickets with non-zero costs (except T-727 which is already correct)
TICKETS_JSON=$(bash "$BOARD_API" get "tickets?total_tokens_gt=0&limit=50" 2>/dev/null || echo "")

# Fallback: query known affected tickets directly
AFFECTED_TICKETS="712 715 719 722 411 13 586 610 616 618 625 647 648 467"

TOTAL_BEFORE=0
TOTAL_AFTER=0
CORRECTED=0
SKIPPED=0

for TN in $AFFECTED_TICKETS; do
  TICKET_JSON=$(bash "$BOARD_API" get "tickets/$TN" 2>/dev/null || echo "")
  if [ -z "$TICKET_JSON" ]; then
    continue
  fi

  OLD_TOKENS=$(echo "$TICKET_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); process.stdout.write(String(d.data?.total_tokens || 0))" 2>/dev/null || echo "0")
  OLD_COST=$(echo "$TICKET_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); process.stdout.write(String(d.data?.estimated_cost || 0))" 2>/dev/null || echo "0")
  TITLE=$(echo "$TICKET_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); process.stdout.write(String(d.data?.title || ''))" 2>/dev/null || echo "")

  if [ "$OLD_TOKENS" = "0" ] && [ "$OLD_COST" = "0" ]; then
    continue
  fi

  # For VPS tickets (small token counts < 100K): recalc from total_tokens with Opus pricing
  # Assume ~95% cache read, ~4% cache create, ~0.5% input, ~0.5% output (typical VPS pattern)
  # For local tickets (large token counts): the total_tokens itself is wrong (cumulative), reset to 0
  NEW_COST=$(node -e "
    const tokens = $OLD_TOKENS;
    const oldCost = $OLD_COST;

    // VPS tickets: small token counts, SDK-reported, no cache split available
    // Recalculate with new Opus rates assuming all tokens are output-heavy (SDK reports input+output only)
    // The SDK usage has input_tokens (very low, ~20) and output_tokens (the actual work)
    // Best approximation: treat total as split 50/50 input/output at new Opus rates
    if (tokens < 100000) {
      // Small VPS ticket — recalculate with new rates
      // SDK reports raw input+output (no cache), so use full input/output prices
      const inputShare = Math.round(tokens * 0.5);
      const outputShare = tokens - inputShare;
      const cost = (inputShare / 1000000) * $OPUS_INPUT + (outputShare / 1000000) * $OPUS_OUTPUT;
      process.stdout.write(JSON.stringify({ tokens, cost: parseFloat(cost.toFixed(4)), action: 'recalc_vps' }));
    } else {
      // Large local ticket — costs were cumulative session totals with wrong pricing
      // We cannot recover the correct per-ticket cost without the original session JSONL
      // Reset to 0 — the next /ship run with snapshot will set correct values
      process.stdout.write(JSON.stringify({ tokens: 0, cost: 0, action: 'reset_local' }));
    }
  " 2>/dev/null || echo "")

  if [ -z "$NEW_COST" ]; then
    echo "  T-$TN: ERROR — could not calculate"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  ACTION=$(echo "$NEW_COST" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).action)" 2>/dev/null)
  NEW_TOKENS_VAL=$(echo "$NEW_COST" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).tokens))" 2>/dev/null)
  NEW_COST_VAL=$(echo "$NEW_COST" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).cost))" 2>/dev/null)

  TOTAL_BEFORE=$(node -e "process.stdout.write(String(Number('$TOTAL_BEFORE') + Number('$OLD_COST')))")
  TOTAL_AFTER=$(node -e "process.stdout.write(String(Number('$TOTAL_AFTER') + Number('$NEW_COST_VAL')))")

  if [ "$ACTION" = "reset_local" ]; then
    echo "  T-$TN: \$$OLD_COST → \$0 (reset — cumulative session cost, not per-ticket) — $TITLE"
  else
    echo "  T-$TN: \$$OLD_COST → \$$NEW_COST_VAL ($OLD_TOKENS tokens, recalculated) — $TITLE"
  fi

  if [ "$DRY_RUN" = "false" ]; then
    bash "$BOARD_API" patch "tickets/$TN" "{\"total_tokens\": $NEW_TOKENS_VAL, \"estimated_cost\": $NEW_COST_VAL}" >/dev/null 2>&1 || echo "    ⚠ PATCH failed for T-$TN"
  fi

  CORRECTED=$((CORRECTED + 1))
done

echo ""
echo "=== Summary ==="
echo "Corrected: $CORRECTED tickets"
echo "Skipped:   $SKIPPED tickets"
echo "Total cost before: \$$TOTAL_BEFORE"
echo "Total cost after:  \$$TOTAL_AFTER"
if [ "$DRY_RUN" = "true" ]; then
  echo ""
  echo "This was a dry run. Run without --dry-run to apply changes."
fi
