#!/bin/bash
# coolify-api.sh — Secure wrapper for Coolify API calls
#
# SECURITY: This script hides API credentials from Claude Code terminal output.
# The API token is resolved internally and never printed to stdout/stderr.
# Only the API response body is returned.
#
# Usage:
#   # Generic CRUD (like board-api.sh)
#   coolify-api.sh get applications
#   coolify-api.sh get applications/{uuid}
#   coolify-api.sh patch applications/{uuid} '{"build_pack": "dockerfile"}'
#   coolify-api.sh post applications/public '{"project_uuid": "...", ...}'
#   coolify-api.sh delete applications/{uuid}
#
#   # Convenience commands
#   coolify-api.sh apps                           List all applications
#   coolify-api.sh deploy <app-uuid> [--force]    Trigger deployment
#   coolify-api.sh status <deployment-uuid>       Check deployment status
#   coolify-api.sh logs <app-uuid> [lines]        Get application logs
#
# Configuration:
#   Token:  ~/.just-ship/config.json → coolify_api_token
#   URL:    project.json → hosting.coolify_url
#
# Exit codes:
#   0 — Success (response body on stdout)
#   1 — Configuration error (missing token, missing URL)
#   2 — API error (curl failed, non-2xx response)

set -euo pipefail

# Suppress all debug output — only API response goes to stdout
exec 3>&2  # Save original stderr
exec 2>/dev/null  # Suppress stderr during credential resolution

COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  exec 2>&3  # Restore stderr for error message
  cat <<'USAGE' >&2
Usage: coolify-api.sh <command> [args]

CRUD operations:
  get <endpoint>                   GET request
  patch <endpoint> <json-body>     PATCH request
  post <endpoint> <json-body>      POST request
  delete <endpoint>                DELETE request

Convenience commands:
  apps                             List all applications
  deploy <app-uuid> [--force]      Trigger deployment
  status <deployment-uuid>         Check deployment status
  logs <app-uuid> [lines]          Get application logs (default: 50 lines)
USAGE
  exit 1
fi

# --- Resolve credentials (silently) ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${HOME}/.just-ship/config.json"

# Resolve Coolify API token from config
if [ -f "$CONFIG_FILE" ]; then
  COOLIFY_TOKEN=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf-8'));
      process.stdout.write(c.coolify_api_token || '');
    } catch(e) { process.stdout.write(''); }
  " 2>/dev/null) || COOLIFY_TOKEN=""
else
  COOLIFY_TOKEN=""
fi

if [ -z "$COOLIFY_TOKEN" ]; then
  exec 2>&3  # Restore stderr
  echo '{"error": "no_coolify_token", "message": "coolify_api_token not set in ~/.just-ship/config.json"}' >&2
  exit 1
fi

# Resolve Coolify URL from project.json
COOLIFY_URL=$(node -e "
  try {
    const p = require('./project.json');
    const h = p.hosting || {};
    process.stdout.write(h.coolify_url || '');
  } catch(e) { process.stdout.write(''); }
" 2>/dev/null) || COOLIFY_URL=""

if [ -z "$COOLIFY_URL" ]; then
  exec 2>&3  # Restore stderr
  echo '{"error": "no_coolify_url", "message": "hosting.coolify_url not set in project.json"}' >&2
  exit 1
fi

# Remove trailing slash from URL
COOLIFY_URL="${COOLIFY_URL%/}"

exec 2>&3  # Restore stderr for curl errors

# --- Helper: make API call ---
coolify_request() {
  local method="$1"
  local endpoint="$2"
  local body="${3:-}"

  local CURL_ARGS=(
    -s
    --max-time 30
    -X "$method"
    -H "Authorization: Bearer $COOLIFY_TOKEN"
    -H "Content-Type: application/json"
  )

  if [ -n "$body" ]; then
    CURL_ARGS+=(-d "$body")
  fi

  local RESPONSE_FILE
  RESPONSE_FILE=$(mktemp)
  local HTTP_CODE
  HTTP_CODE=$(curl "${CURL_ARGS[@]}" -o "$RESPONSE_FILE" -w "%{http_code}" "${COOLIFY_URL}/api/v1/${endpoint}" 2>/dev/null) || HTTP_CODE="000"

  local RESPONSE
  RESPONSE=$(cat "$RESPONSE_FILE")
  rm -f "$RESPONSE_FILE"

  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "$RESPONSE"
    return 0
  elif [ "$HTTP_CODE" = "000" ]; then
    echo '{"error": "connection_failed", "message": "Could not connect to Coolify API"}' >&2
    return 2
  else
    echo "$RESPONSE" >&2
    return 2
  fi
}

# --- Route command ---
case "$COMMAND" in
  # Generic CRUD operations
  get|GET)
    ENDPOINT="${2:-}"
    [ -z "$ENDPOINT" ] && { echo "Usage: coolify-api.sh get <endpoint>" >&2; exit 1; }
    coolify_request GET "$ENDPOINT"
    ;;
  patch|PATCH)
    ENDPOINT="${2:-}"
    BODY="${3:-}"
    [ -z "$ENDPOINT" ] || [ -z "$BODY" ] && { echo "Usage: coolify-api.sh patch <endpoint> <json-body>" >&2; exit 1; }
    coolify_request PATCH "$ENDPOINT" "$BODY"
    ;;
  post|POST)
    ENDPOINT="${2:-}"
    BODY="${3:-}"
    [ -z "$ENDPOINT" ] || [ -z "$BODY" ] && { echo "Usage: coolify-api.sh post <endpoint> <json-body>" >&2; exit 1; }
    coolify_request POST "$ENDPOINT" "$BODY"
    ;;
  delete|DELETE)
    ENDPOINT="${2:-}"
    [ -z "$ENDPOINT" ] && { echo "Usage: coolify-api.sh delete <endpoint>" >&2; exit 1; }
    coolify_request DELETE "$ENDPOINT"
    ;;

  # Convenience: list all applications
  apps)
    coolify_request GET "applications" | node -e "
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
      const apps = Array.isArray(data) ? data : (data.data || []);
      apps.forEach(a => {
        console.log([a.uuid, a.build_pack || '-', a.status || '-', a.fqdn || '-', a.name].join('\t'));
      });
    " 2>/dev/null || coolify_request GET "applications"
    ;;

  # Convenience: trigger deployment
  deploy)
    APP_UUID="${2:-}"
    [ -z "$APP_UUID" ] && { echo "Usage: coolify-api.sh deploy <app-uuid> [--force]" >&2; exit 1; }
    FORCE=""
    if [ "${3:-}" = "--force" ]; then
      FORCE="&force=true"
    fi
    coolify_request GET "deploy?uuid=${APP_UUID}${FORCE}"
    ;;

  # Convenience: check deployment status
  status)
    DEPLOY_UUID="${2:-}"
    [ -z "$DEPLOY_UUID" ] && { echo "Usage: coolify-api.sh status <deployment-uuid>" >&2; exit 1; }
    coolify_request GET "deployments/${DEPLOY_UUID}" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
      console.log(JSON.stringify({
        status: d.status,
        commit: d.commit,
        created_at: d.created_at,
        deployment_uuid: d.deployment_uuid
      }, null, 2));
    " 2>/dev/null || coolify_request GET "deployments/${DEPLOY_UUID}"
    ;;

  # Convenience: get application logs
  logs)
    APP_UUID="${2:-}"
    [ -z "$APP_UUID" ] && { echo "Usage: coolify-api.sh logs <app-uuid> [lines]" >&2; exit 1; }
    LINES="${3:-50}"
    coolify_request GET "applications/${APP_UUID}/logs?lines=${LINES}" | node -e "
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
      if (typeof data.logs === 'string') {
        console.log(data.logs);
      } else if (Array.isArray(data)) {
        data.forEach(e => console.log(e.output || ''));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    " 2>/dev/null || coolify_request GET "applications/${APP_UUID}/logs?lines=${LINES}"
    ;;

  *)
    echo "Unknown command: $COMMAND" >&2
    echo "Run 'coolify-api.sh' without arguments for usage." >&2
    exit 1
    ;;
esac
