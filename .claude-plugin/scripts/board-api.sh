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
# Environment variables (optional, auto-resolved from project.json if not set):
#   BOARD_API_URL  — Board API base URL
#   PIPELINE_KEY   — Auth key for Board API
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

# Use environment variables if set (pipeline mode), otherwise resolve from project.json
if [ -z "${BOARD_API_URL:-}" ] || [ -z "${PIPELINE_KEY:-}" ]; then
  # Read workspace_id from project.json
  WORKSPACE_ID=$(node -e "
    try { const p = require('./project.json'); process.stdout.write(p.pipeline?.workspace_id || ''); }
    catch(e) { process.stdout.write(''); }
  " 2>/dev/null) || WORKSPACE_ID=""

  if [ -z "$WORKSPACE_ID" ]; then
    exec 2>&3  # Restore stderr
    echo '{"error": "no_pipeline_config", "message": "pipeline.workspace_id not set in project.json"}' >&2
    exit 1
  fi

  # Resolve credentials via write-config.sh (output goes to variable, not terminal)
  WS_JSON=$("$SCRIPT_DIR/write-config.sh" read-workspace --id "$WORKSPACE_ID" 2>/dev/null) || WS_JSON=""

  if [ -z "$WS_JSON" ]; then
    exec 2>&3  # Restore stderr
    echo '{"error": "credentials_not_found", "message": "Could not resolve workspace credentials"}' >&2
    exit 1
  fi

  # Extract board_url and api_key from JSON (silently)
  BOARD_API_URL=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url || '')" 2>/dev/null) || BOARD_API_URL=""
  PIPELINE_KEY=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key || '')" 2>/dev/null) || PIPELINE_KEY=""

  if [ -z "$BOARD_API_URL" ] || [ -z "$PIPELINE_KEY" ]; then
    exec 2>&3  # Restore stderr
    echo '{"error": "incomplete_credentials", "message": "board_url or api_key missing in workspace config"}' >&2
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
