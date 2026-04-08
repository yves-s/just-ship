#!/bin/bash
# shopify-app-deploy.sh — Deploy Shopify App extensions and config after merge
# Usage:
#   bash .claude/scripts/shopify-app-deploy.sh
#
# Runs `shopify app deploy --force` to push extensions (Theme App Extensions,
# Checkout UI, Functions) and app config (shopify.app.toml) to Shopify.
#
# Auth:
#   - Local: existing CLI session (shopify auth login)
#   - VPS/CI: SHOPIFY_CLI_PARTNERS_TOKEN env var (Partner API Token)
#
# Retry: Exit code 1 (transient/network) → 1 retry after 5s.
#         Exit code >1 (auth/validation) → immediate abort.
#
# Returns: 0 always (never blocks the pipeline). Errors go to stderr.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env if present (for SHOPIFY_CLI_PARTNERS_TOKEN etc.)
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

# ---------------------------------------------------------------------------
# Variant check — only run for remix apps
# ---------------------------------------------------------------------------
VARIANT=$(node -e "process.stdout.write(require('$PROJECT_ROOT/project.json').stack?.variant || '')" 2>/dev/null || echo "")

if [ "$VARIANT" != "remix" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Verify shopify.app.toml exists
# ---------------------------------------------------------------------------
if [ ! -f "$PROJECT_ROOT/shopify.app.toml" ]; then
  echo "shopify-app-deploy: shopify.app.toml not found — skipping deploy" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Deploy with retry
# ---------------------------------------------------------------------------
deploy() {
  cd "$PROJECT_ROOT"
  shopify app deploy --force 2>&1
  return $?
}

OUTPUT=$(deploy)
EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✓ shopify — Extensions und App-Config deployed"
  exit 0
fi

if [ "$EXIT_CODE" -eq 1 ]; then
  # Transient error — retry once after 5s
  echo "shopify-app-deploy: Deploy failed (exit $EXIT_CODE), retrying in 5s..." >&2
  sleep 5
  OUTPUT=$(deploy)
  EXIT_CODE=$?

  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "✓ shopify — Extensions und App-Config deployed"
    exit 0
  fi
fi

# Deploy failed — non-blocking warning
echo "⚠ shopify — App Deploy fehlgeschlagen, manuell deployen" >&2
if [ -n "$OUTPUT" ]; then
  echo "" >&2
  echo "Details:" >&2
  echo "$OUTPUT" >&2
fi

exit 0
