#!/bin/bash
# board-api.sh — Secure wrapper for Board API calls
#
# SECURITY: This script hides API credentials from Claude Code terminal output.
# Credentials are resolved internally and never printed to stdout/stderr.
# Only the API response body is returned.
#
# Usage:
#   board-api.sh get tickets/{N}
#   board-api.sh get "tickets?status=ready_to_develop&project={UUID}"
#   board-api.sh patch tickets/{N} '{"status": "in_progress"}'
#   board-api.sh post tickets '{"title": "...", "body": "..."}'
#
# Credential resolution (4-tier fallback):
#   Tier 1: PIPELINE_KEY + BOARD_API_URL from environment (Plugin-native)
#   Tier 2: .env.local in project directory (project-local credentials)
#   Tier 3: PIPELINE_KEY from env + board_url from project.json → pipeline.board_url
#   Tier 4: write-config.sh read-workspace (legacy ~/.just-ship/ fallback)
#
# Environment variables (auto-resolved if not set):
#   BOARD_API_URL                      — Board API base URL
#   PIPELINE_KEY                       — Auth key for Board API
#   CLAUDE_USER_CONFIG_BOARD_API_KEY   — Plugin userConfig alias for PIPELINE_KEY
#   CLAUDE_USER_CONFIG_BOARD_API_URL   — Plugin userConfig alias for BOARD_API_URL
#
# Exit codes:
#   0 — Success (response body on stdout)
#   1 — Configuration error (no workspace_id, missing credentials)
#   2 — API error (curl failed, non-2xx response)

set -euo pipefail

# Suppress all debug output — only API response goes to stdout
exec 3>&2  # Save original stderr
exec 2>/dev/null  # Suppress stderr during credential resolution

METHOD="${1:-}"
ENDPOINT="${2:-}"
BODY="${3:-}"

if [ -z "$METHOD" ] || [ -z "$ENDPOINT" ]; then
  exec 2>&3  # Restore stderr for error message
  echo "Usage: board-api.sh <get|post|patch|delete> <endpoint> [body]" >&2
  exit 1
fi

# Uppercase method
METHOD=$(echo "$METHOD" | tr '[:lower:]' '[:upper:]')

# --- Resolve credentials (silently) ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Tier 0: Map plugin userConfig env vars to expected names
: "${PIPELINE_KEY:=${CLAUDE_USER_CONFIG_BOARD_API_KEY:-}}"
: "${BOARD_API_URL:=${CLAUDE_USER_CONFIG_BOARD_API_URL:-}}"

# Tier 1: Both from environment — fully plugin-native, no file I/O
if [ -n "${PIPELINE_KEY:-}" ] && [ -n "${BOARD_API_URL:-}" ]; then
  : # Credentials resolved from environment
else
  # Tier 2: Read from .env.local (project-local credentials)
  if [ -z "${PIPELINE_KEY:-}" ] || [ -z "${BOARD_API_URL:-}" ]; then
    if [ -f ".env.local" ]; then
      local_key=$(grep '^JSP_BOARD_API_KEY=' .env.local 2>/dev/null | cut -d= -f2- || true)
      local_url=$(grep '^JSP_BOARD_API_URL=' .env.local 2>/dev/null | cut -d= -f2- || true)
      : "${PIPELINE_KEY:=${local_key:-}}"
      : "${BOARD_API_URL:=${local_url:-}}"
    fi
  fi

  # Tier 3: Key from env + board_url from project.json
  if [ -n "${PIPELINE_KEY:-}" ] && [ -z "${BOARD_API_URL:-}" ]; then
    BOARD_API_URL=$(node -e "
      try { const p = require('./project.json'); process.stdout.write(p.pipeline?.board_url || ''); }
      catch(e) { process.stdout.write(''); }
    " 2>/dev/null) || BOARD_API_URL=""
  fi

  # Tier 4: Legacy fallback via write-config.sh
  if [ -z "${PIPELINE_KEY:-}" ] || [ -z "${BOARD_API_URL:-}" ]; then
    WORKSPACE_ID=$(node -e "
      try { const p = require('./project.json'); process.stdout.write(p.pipeline?.workspace_id || ''); }
      catch(e) { process.stdout.write(''); }
    " 2>/dev/null) || WORKSPACE_ID=""

    if [ -z "$WORKSPACE_ID" ]; then
      exec 2>&3
      echo '{"error": "no_pipeline_config", "message": "pipeline.workspace_id not set in project.json"}' >&2
      exit 1
    fi

    WS_JSON=$("$SCRIPT_DIR/write-config.sh" read-workspace --id "$WORKSPACE_ID" 2>/dev/null) || WS_JSON=""

    if [ -z "$WS_JSON" ]; then
      exec 2>&3
      echo '{"error": "credentials_not_found", "message": "Could not resolve workspace credentials"}' >&2
      exit 1
    fi

    : "${BOARD_API_URL:=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url || '')" 2>/dev/null)}"
    : "${PIPELINE_KEY:=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key || '')" 2>/dev/null)}"
  fi

  if [ -z "${BOARD_API_URL:-}" ] || [ -z "${PIPELINE_KEY:-}" ]; then
    exec 2>&3
    echo '{"error": "incomplete_credentials", "message": "board_url or api_key missing — set PIPELINE_KEY + BOARD_API_URL env vars, add to .env.local, or configure ~/.just-ship/"}' >&2
    exit 1
  fi
fi

exec 2>&3  # Restore stderr for curl errors

# --- Make API call ---
# Build curl command (key is in variable, not visible in ps output when using --header)
CURL_ARGS=(
  -s
  --max-time 30
  -X "$METHOD"
  -H "X-Pipeline-Key: $PIPELINE_KEY"
  -H "Content-Type: application/json"
)

if [ -n "$BODY" ]; then
  CURL_ARGS+=(-d "$BODY")
fi

# Execute curl and capture both response and HTTP code
RESPONSE_FILE=$(mktemp)
HTTP_CODE=$(curl "${CURL_ARGS[@]}" -o "$RESPONSE_FILE" -w "%{http_code}" "${BOARD_API_URL}/api/${ENDPOINT}" 2>/dev/null) || HTTP_CODE="000"

RESPONSE=$(cat "$RESPONSE_FILE")
rm -f "$RESPONSE_FILE"

# Check HTTP status
if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  # Success — output response body only
  echo "$RESPONSE"
  exit 0
elif [ "$HTTP_CODE" = "000" ]; then
  echo '{"error": "connection_failed", "message": "Could not connect to Board API"}' >&2
  exit 2
else
  # API error — output error response to stderr, return non-zero
  echo "$RESPONSE" >&2
  exit 2
fi
