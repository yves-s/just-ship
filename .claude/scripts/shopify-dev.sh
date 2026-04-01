#!/usr/bin/env bash
# shopify-dev.sh — Hybrid Shopify theme dev/push script
# Usage:
#   bash .claude/scripts/shopify-dev.sh start T-42 "Hero section redesign" [--mode=dev|push]
#   bash .claude/scripts/shopify-dev.sh stop
#   bash .claude/scripts/shopify-dev.sh url
#
# Subcommands:
#   start:  Start dev server (local) or push unpublished theme (VPS/remote)
#   stop:   Kill dev server or delete unpublished theme
#   url:    Print current preview URL
#
# Mode detection (priority order):
#   1. --mode=dev or --mode=push flag
#   2. JUST_SHIP_MODE=pipeline env var -> push mode
#   3. TTY present -> dev mode, no TTY -> push mode
#
# Returns: 0 always (never fails, silent on error). Errors go to stderr.
# Designed for graceful failure — never blocks the pipeline.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUBCOMMAND="${1:-}"
[ -z "$SUBCOMMAND" ] && { echo "Usage: shopify-dev.sh <start|stop|url>" >&2; exit 0; }
shift

# --- State files ---
THEME_ID_FILE="${SHOPIFY_THEME_ID_FILE:-.claude/.shopify-theme-id}"
DEV_PID_FILE=".claude/.shopify-dev-pid"
DEV_URL_FILE=".claude/.dev-preview-url"

# ===========================================================================
# URL — print current preview URL
# ===========================================================================
if [ "$SUBCOMMAND" = "url" ]; then
  [ -f "$DEV_URL_FILE" ] && cat "$DEV_URL_FILE"
  exit 0
fi

# --- Resolve store URL from project.json ---
STORE=$(node -e "
  try {
    const c = require('./project.json');
    process.stdout.write(c.shopify?.store || '');
  } catch(e) { process.stdout.write(''); }
" 2>/dev/null)

if [ -z "$STORE" ]; then
  echo "shopify-dev: No shopify.store in project.json" >&2
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
    SHOPIFY_PW=$(bash "$SCRIPT_DIR/write-config.sh" read-workspace --id "$WS_ID" 2>/dev/null | \
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

# ===========================================================================
# STOP — kill dev server or delete unpublished theme
# ===========================================================================
if [ "$SUBCOMMAND" = "stop" ]; then
  # Dev mode: kill process
  if [ -f "$DEV_PID_FILE" ]; then
    DEV_PID=$(cat "$DEV_PID_FILE" 2>/dev/null)
    if [ -n "$DEV_PID" ]; then
      kill "$DEV_PID" 2>/dev/null || true
      # Also kill child processes (shopify CLI spawns subprocesses)
      pkill -P "$DEV_PID" 2>/dev/null || true
    fi
    rm -f "$DEV_PID_FILE"
  fi

  # Push mode: delete unpublished theme
  if [ -f "$THEME_ID_FILE" ]; then
    THEME_ID=$(grep '^THEME_ID=' "$THEME_ID_FILE" 2>/dev/null | cut -d= -f2)
    if [ -n "$THEME_ID" ]; then
      shopify theme delete \
        --theme "$THEME_ID" \
        --store "$STORE" \
        --force \
        $PASSWORD_FLAG 2>/dev/null || echo "shopify-dev stop: delete failed (theme may already be removed)" >&2
    fi
    rm -f "$THEME_ID_FILE"
  fi

  rm -f "$DEV_URL_FILE"
  exit 0
fi

# ===========================================================================
# START — dev server or push
# ===========================================================================
if [ "$SUBCOMMAND" = "start" ]; then
  # Parse arguments: TICKET TITLE [--mode=dev|push]
  TICKET=""
  TITLE=""
  MODE_FLAG=""
  POSITIONAL=()

  for arg in "$@"; do
    case "$arg" in
      --mode=*)
        MODE_FLAG="${arg#--mode=}"
        ;;
      *)
        POSITIONAL+=("$arg")
        ;;
    esac
  done

  TICKET="${POSITIONAL[0]:-}"
  TITLE="${POSITIONAL[1]:-}"

  if [ -z "$TICKET" ]; then
    echo "shopify-dev start: Missing ticket number" >&2
    exit 0
  fi

  # --- Mode detection ---
  MODE=""
  if [ -n "$MODE_FLAG" ]; then
    # 1. Explicit flag
    MODE="$MODE_FLAG"
  elif [ "${JUST_SHIP_MODE:-}" = "pipeline" ]; then
    # 2. Pipeline env var
    MODE="push"
  elif [ -t 0 ] && [ -t 1 ]; then
    # 3. TTY present -> dev
    MODE="dev"
  else
    # 3. No TTY -> push
    MODE="push"
  fi

  # Extract ticket number (strip T- prefix if present)
  TICKET_NUM="${TICKET#T-}"

  # -----------------------------------------------------------------------
  # DEV MODE (local)
  # -----------------------------------------------------------------------
  if [ "$MODE" = "dev" ]; then
    # Find free port starting at 9292
    PORT=9292
    while lsof -i :"$PORT" >/dev/null 2>&1; do
      PORT=$((PORT + 1))
      if [ "$PORT" -gt 9392 ]; then
        echo "shopify-dev start: No free port found (9292-9392)" >&2
        # Fallback to push mode
        MODE="push"
        break
      fi
    done
  fi

  if [ "$MODE" = "dev" ]; then
    # Create a temp file for capturing output
    DEV_LOG=$(mktemp /tmp/shopify-dev-XXXXXX.log)

    # Start shopify theme dev in background
    shopify theme dev \
      --store "$STORE" \
      --port "$PORT" \
      $PASSWORD_FLAG \
      > "$DEV_LOG" 2>&1 &
    DEV_PID=$!

    # Save PID
    mkdir -p "$(dirname "$DEV_PID_FILE")"
    echo "$DEV_PID" > "$DEV_PID_FILE"

    # Wait for preview URL (timeout 30s)
    PREVIEW_URL=""
    ELAPSED=0
    while [ "$ELAPSED" -lt 30 ]; do
      if ! kill -0 "$DEV_PID" 2>/dev/null; then
        echo "shopify-dev start: Dev server exited unexpectedly" >&2
        cat "$DEV_LOG" >&2 2>/dev/null || true
        rm -f "$DEV_LOG" "$DEV_PID_FILE"
        # Fallback to push mode
        MODE="push"
        break
      fi

      # Look for URL pattern in output (shopify theme dev prints the local URL)
      PREVIEW_URL=$(grep -oE 'https?://[0-9.:]+' "$DEV_LOG" 2>/dev/null | head -1 || true)
      if [ -n "$PREVIEW_URL" ]; then
        break
      fi

      sleep 1
      ELAPSED=$((ELAPSED + 1))
    done

    rm -f "$DEV_LOG"

    if [ "$MODE" = "dev" ] && [ -z "$PREVIEW_URL" ]; then
      echo "shopify-dev start: Timeout waiting for dev server URL" >&2
      # Kill the process and fallback
      kill "$DEV_PID" 2>/dev/null || true
      pkill -P "$DEV_PID" 2>/dev/null || true
      rm -f "$DEV_PID_FILE"
      MODE="push"
    fi

    if [ "$MODE" = "dev" ] && [ -n "$PREVIEW_URL" ]; then
      # Write URL to state file
      mkdir -p "$(dirname "$DEV_URL_FILE")"
      echo "$PREVIEW_URL" > "$DEV_URL_FILE"

      # Post as Board comment
      bash "$SCRIPT_DIR/post-comment.sh" "$TICKET_NUM" "Preview: $PREVIEW_URL" "preview" 2>/dev/null || true

      echo "$PREVIEW_URL"
      exit 0
    fi

    # If we get here, MODE was changed to "push" as fallback
  fi

  # -----------------------------------------------------------------------
  # PUSH MODE (VPS/remote)
  # -----------------------------------------------------------------------
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
      $PASSWORD_FLAG 2>/dev/null) || { echo "shopify-dev push: shopify theme push failed" >&2; exit 0; }

    THEME_ID="$EXISTING_THEME_ID"
  else
    # First push — create new unpublished theme
    OUTPUT=$(shopify theme push \
      --unpublished \
      --theme "$THEME_NAME" \
      --store "$STORE" \
      --ignore "config/settings_data.json" \
      --json \
      $PASSWORD_FLAG 2>/dev/null) || { echo "shopify-dev push: shopify theme push failed" >&2; exit 0; }

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
    echo "shopify-dev push: Could not extract theme ID" >&2
    exit 0
  fi

  # Save theme ID for subsequent pushes and cleanup
  mkdir -p "$(dirname "$THEME_ID_FILE")"
  cat > "$THEME_ID_FILE" <<EOF
THEME_ID=${THEME_ID}
THEME_NAME=${THEME_NAME}
EOF

  # Build preview URL
  PREVIEW_URL="https://${STORE}/?preview_theme_id=${THEME_ID}"

  # Write URL to state file
  mkdir -p "$(dirname "$DEV_URL_FILE")"
  echo "$PREVIEW_URL" > "$DEV_URL_FILE"

  # Post as Board comment
  bash "$SCRIPT_DIR/post-comment.sh" "$TICKET_NUM" "Preview: $PREVIEW_URL" "preview" 2>/dev/null || true

  echo "$PREVIEW_URL"
  exit 0
fi

echo "shopify-dev: Unknown subcommand '$SUBCOMMAND'" >&2
exit 0
