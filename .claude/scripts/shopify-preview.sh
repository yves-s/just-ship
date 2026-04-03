#!/bin/bash
# shopify-preview.sh — Push Shopify theme for ticket preview + cleanup
# Usage:
#   bash .claude/scripts/shopify-preview.sh push "T-42" "Hero section redesign"
#   bash .claude/scripts/shopify-preview.sh cleanup
#
# push:  Creates/updates an unpublished Shopify theme, prints preview URL to stdout
# cleanup: Deletes the theme created by push
#
# Returns: 0 always (never fails, silent on error). Errors go to stderr.
# Designed for graceful failure — never blocks the pipeline.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env if present (for SHOPIFY_CLI_THEME_TOKEN etc.)
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

SUBCOMMAND="${1:-}"
[ -z "$SUBCOMMAND" ] && { echo "Usage: shopify-preview.sh <push|cleanup>" >&2; exit 0; }
shift

# --- Resolve store URL from project.json ---
STORE=$(node -e "
  try {
    const c = require('./project.json');
    process.stdout.write(c.shopify?.store || '');
  } catch(e) { process.stdout.write(''); }
" 2>/dev/null)

if [ -z "$STORE" ]; then
  echo "shopify-preview: No shopify.store in project.json" >&2
  exit 0
fi

# --- Resolve credentials ---
# Priority: 1) SHOPIFY_CLI_THEME_TOKEN env, 2) config.json shopify_password, 3) CLI session
PASSWORD_FLAG=""

if [ -n "${SHOPIFY_CLI_THEME_TOKEN:-}" ]; then
  PASSWORD_FLAG="--password ${SHOPIFY_CLI_THEME_TOKEN}"
else
  # Try to read from ~/.just-ship/config.json via workspace
  WS_ID=$(node -e "process.stdout.write(require('./project.json').pipeline?.workspace_id || '')" 2>/dev/null || echo "")
  if [ -n "$WS_ID" ]; then
    SHOPIFY_PW=$(bash .claude/scripts/write-config.sh read-workspace --id "$WS_ID" 2>/dev/null | \
      node -e "
        try {
          const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
          process.stdout.write(d.shopify_password || '');
        } catch(e) { process.stdout.write(''); }
      " 2>/dev/null || echo "")
    if [ -n "$SHOPIFY_PW" ]; then
      PASSWORD_FLAG="--password ${SHOPIFY_PW}"
    fi
  fi
fi

# --- Theme ID file ---
THEME_ID_FILE="${SHOPIFY_THEME_ID_FILE:-.claude/.shopify-theme-id}"

# ===========================================================================
# PUSH
# ===========================================================================
if [ "$SUBCOMMAND" = "push" ]; then
  TICKET="${1:-}"
  TITLE="${2:-}"

  if [ -z "$TICKET" ]; then
    echo "shopify-preview push: Missing ticket number" >&2
    exit 0
  fi

  THEME_NAME="${TICKET}: ${TITLE}"

  # Check if we already have a theme ID (subsequent push)
  EXISTING_THEME_ID=""
  if [ -f "$THEME_ID_FILE" ]; then
    EXISTING_THEME_ID=$(grep '^THEME_ID=' "$THEME_ID_FILE" 2>/dev/null | cut -d= -f2)
  fi

  if [ -n "$EXISTING_THEME_ID" ]; then
    # Subsequent push — update existing theme by ID
    OUTPUT=$(shopify theme push \
      --theme "$EXISTING_THEME_ID" \
      --store "$STORE" \
      --ignore "config/settings_data.json" \
      --json \
      $PASSWORD_FLAG 2>/dev/null) || { echo "shopify-preview push: shopify theme push failed" >&2; exit 0; }

    THEME_ID="$EXISTING_THEME_ID"
  else
    # First push — create new unpublished theme
    OUTPUT=$(shopify theme push \
      --unpublished \
      --theme "$THEME_NAME" \
      --store "$STORE" \
      --ignore "config/settings_data.json" \
      --json \
      $PASSWORD_FLAG 2>/dev/null) || { echo "shopify-preview push: shopify theme push failed" >&2; exit 0; }

    # Extract theme ID from JSON output
    THEME_ID=$(echo "$OUTPUT" | node -e "
      try {
        const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
        process.stdout.write(String(d.theme?.id || ''));
      } catch(e) { process.stdout.write(''); }
    " 2>/dev/null || echo "")

    # Fallback: list themes and find by name
    if [ -z "$THEME_ID" ]; then
      THEME_ID=$(shopify theme list --store "$STORE" --json $PASSWORD_FLAG 2>/dev/null | \
        node -e "
          try {
            const themes = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
            const match = themes.find(t => t.name === '${THEME_NAME}');
            process.stdout.write(String(match?.id || ''));
          } catch(e) { process.stdout.write(''); }
        " 2>/dev/null || echo "")
    fi
  fi

  if [ -z "$THEME_ID" ]; then
    echo "shopify-preview push: Could not extract theme ID" >&2
    exit 0
  fi

  # Save theme ID for subsequent pushes and cleanup
  mkdir -p "$(dirname "$THEME_ID_FILE")"
  cat > "$THEME_ID_FILE" <<EOF
THEME_ID=${THEME_ID}
THEME_NAME=${THEME_NAME}
EOF

  # Build and output preview URL
  PREVIEW_URL="https://${STORE}/?preview_theme_id=${THEME_ID}"
  echo "$PREVIEW_URL"
  exit 0
fi

# ===========================================================================
# CLEANUP
# ===========================================================================
if [ "$SUBCOMMAND" = "cleanup" ]; then
  if [ ! -f "$THEME_ID_FILE" ]; then
    exit 0
  fi

  THEME_ID=$(grep '^THEME_ID=' "$THEME_ID_FILE" 2>/dev/null | cut -d= -f2)
  THEME_NAME=$(grep '^THEME_NAME=' "$THEME_ID_FILE" 2>/dev/null | cut -d= -f2-)

  if [ -n "$THEME_ID" ]; then
    shopify theme delete \
      --theme "$THEME_ID" \
      --store "$STORE" \
      --force \
      $PASSWORD_FLAG 2>/dev/null || echo "shopify-preview cleanup: delete failed (theme may already be removed)" >&2
  fi

  rm -f "$THEME_ID_FILE"
  exit 0
fi

echo "shopify-preview: Unknown subcommand '$SUBCOMMAND'" >&2
exit 0
