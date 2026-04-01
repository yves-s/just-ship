#!/bin/bash
# shopify-env-check.sh — Validate Shopify development environment
# Usage:
#   bash .claude/scripts/shopify-env-check.sh
#
# Checks: Node.js, Shopify CLI, Git, Shopify auth, store config, GitHub CLI (optional)
# Caches result in .claude/.env-check-passed for 24h.
# Returns: 0 if all required checks pass, 1 if any required check fails.

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE_FILE="$PROJECT_ROOT/.claude/.env-check-passed"
PID_FILE="$PROJECT_ROOT/.claude/.shopify-dev-pid"
ERRORS=0

# ---------------------------------------------------------------------------
# Caching — skip if cache is less than 24h old
# ---------------------------------------------------------------------------
if [ -f "$CACHE_FILE" ]; then
  NOW=$(date +%s)
  # macOS stat -f %m, fallback to Linux stat -c %Y
  CACHE_MTIME=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo "0")
  AGE=$(( NOW - CACHE_MTIME ))
  if [ "$AGE" -lt 86400 ]; then
    echo "OK: Environment check cached ($(( AGE / 3600 ))h ago). Skipping."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Stale PID cleanup
# ---------------------------------------------------------------------------
if [ -f "$PID_FILE" ]; then
  STALE_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$STALE_PID" ] && kill -0 "$STALE_PID" 2>/dev/null; then
    echo "Cleaning up stale shopify dev process (PID $STALE_PID)..."
    kill "$STALE_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# ---------------------------------------------------------------------------
# Read store from project.json (once)
# ---------------------------------------------------------------------------
STORE=$(node -e "process.stdout.write(require('$PROJECT_ROOT/project.json').shopify?.store || '')" 2>/dev/null || echo "")

# ---------------------------------------------------------------------------
# Required checks
# ---------------------------------------------------------------------------

# 1. Node.js
if NODE_VERSION=$(node --version 2>/dev/null); then
  echo "OK: Node.js $NODE_VERSION"
else
  echo "ERROR: Node.js not found. Install via: https://nodejs.org/ or \`brew install node\`"
  ERRORS=$((ERRORS + 1))
fi

# 2. Shopify CLI
if SHOPIFY_VERSION=$(shopify version 2>/dev/null); then
  echo "OK: Shopify CLI $SHOPIFY_VERSION"
else
  echo "ERROR: Shopify CLI not found. Install via: \`npm install -g @shopify/cli\`"
  ERRORS=$((ERRORS + 1))
fi

# 3. Git
if GIT_VERSION=$(git --version 2>/dev/null); then
  echo "OK: $GIT_VERSION"
else
  echo "ERROR: Git not found. Install via: https://git-scm.com/ or \`brew install git\`"
  ERRORS=$((ERRORS + 1))
fi

# 4. shopify.store in project.json
if [ -z "$STORE" ]; then
  echo "ERROR: shopify.store not set in project.json. Add: { \"shopify\": { \"store\": \"your-store.myshopify.com\" } }"
  ERRORS=$((ERRORS + 1))
elif echo "$STORE" | grep -qE '\.myshopify\.com$'; then
  echo "OK: Store $STORE"
else
  echo "ERROR: shopify.store \"$STORE\" does not match *.myshopify.com pattern"
  ERRORS=$((ERRORS + 1))
fi

# 5. Shopify Auth
if [ -n "${SHOPIFY_CLI_THEME_TOKEN:-}" ]; then
  echo "OK: Shopify auth via SHOPIFY_CLI_THEME_TOKEN"
elif [ -n "$STORE" ]; then
  if shopify theme list --store="$STORE" >/dev/null 2>&1; then
    echo "OK: Shopify auth via CLI session"
  else
    echo "ERROR: Shopify not authenticated. Set SHOPIFY_CLI_THEME_TOKEN or run \`shopify auth login --store=$STORE\`"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "ERROR: Cannot check Shopify auth without shopify.store in project.json"
  ERRORS=$((ERRORS + 1))
fi

# ---------------------------------------------------------------------------
# Optional checks (warnings only)
# ---------------------------------------------------------------------------

if GH_VERSION=$(gh --version 2>/dev/null | head -1); then
  echo "OK: $GH_VERSION"
else
  echo "WARNING: GitHub CLI not found. Install via: https://cli.github.com/ or \`brew install gh\`"
fi

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "$ERRORS required check(s) failed. Fix the errors above and re-run."
  exit 1
fi

# Write cache file
mkdir -p "$(dirname "$CACHE_FILE")"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$CACHE_FILE"

echo ""
echo "All checks passed."
exit 0
