#!/bin/bash
# coolify-deploy.sh — Create and deploy a project on Coolify via API
# Usage: bash .claude/scripts/coolify-deploy.sh <repo> <branch> <domain> [env-file]
#
# Example:
#   bash .claude/scripts/coolify-deploy.sh yves-s/just-ship-board main board.just-ship.io .env.local
#
# Prerequisites:
#   - COOLIFY_API_TOKEN env var or /root/.coolify-api/token file
#   - COOLIFY_URL env var or defaults to https://coolify.just-ship.io
#   - GitHub App "just-ship-hosting" configured in Coolify
#
# Returns: JSON with project_uuid, app_uuid, and deployment status

set -euo pipefail

REPO="${1:?Usage: coolify-deploy.sh <repo> <branch> <domain> [env-file]}"
BRANCH="${2:?Usage: coolify-deploy.sh <repo> <branch> <domain> [env-file]}"
DOMAIN="${3:?Usage: coolify-deploy.sh <repo> <branch> <domain> [env-file]}"
ENV_FILE="${4:-}"

# ── Token resolution ─────────────────────────────────────────────────────────

COOLIFY_TOKEN="${COOLIFY_API_TOKEN:-}"
if [ -z "$COOLIFY_TOKEN" ] && [ -f /root/.coolify-api/token ]; then
  COOLIFY_TOKEN=$(cat /root/.coolify-api/token 2>/dev/null)
fi
if [ -z "$COOLIFY_TOKEN" ]; then
  echo "ERROR: No Coolify API token. Set COOLIFY_API_TOKEN or create /root/.coolify-api/token" >&2
  exit 1
fi

COOLIFY_URL="${COOLIFY_URL:-https://coolify.just-ship.io}"

# ── Constants ────────────────────────────────────────────────────────────────

# These are specific to the just-ship Coolify instance
SERVER_UUID="qf02xm170a67g7n7jemgjj66"
GITHUB_APP_UUID="toxipo10ilecq76v0jbjssdw"

# Derive project name from repo (e.g., "yves-s/just-ship-board" → "just-ship-board")
PROJECT_NAME="${REPO##*/}"

api() {
  local method="$1" endpoint="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -s -X "$method" \
      -H "Authorization: Bearer $COOLIFY_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "${COOLIFY_URL}/api/v1${endpoint}"
  else
    curl -s -X "$method" \
      -H "Authorization: Bearer $COOLIFY_TOKEN" \
      "${COOLIFY_URL}/api/v1${endpoint}"
  fi
}

# ── 1. Create project ────────────────────────────────────────────────────────

echo "Creating project: $PROJECT_NAME..." >&2
PROJECT_RESULT=$(api POST /projects "{\"name\": \"$PROJECT_NAME\"}")
PROJECT_UUID=$(echo "$PROJECT_RESULT" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try { process.stdout.write(JSON.parse(d).uuid || ''); } catch(e) { process.stdout.write(''); }
  });
")

if [ -z "$PROJECT_UUID" ]; then
  echo "ERROR: Failed to create project: $PROJECT_RESULT" >&2
  exit 1
fi
echo "  Project UUID: $PROJECT_UUID" >&2

# ── 2. Create application ────────────────────────────────────────────────────

echo "Creating application from $REPO ($BRANCH)..." >&2
APP_RESULT=$(api POST /applications/private-github-app "{
  \"project_uuid\": \"$PROJECT_UUID\",
  \"server_uuid\": \"$SERVER_UUID\",
  \"environment_name\": \"production\",
  \"github_app_uuid\": \"$GITHUB_APP_UUID\",
  \"git_repository\": \"$REPO\",
  \"git_branch\": \"$BRANCH\",
  \"name\": \"$PROJECT_NAME\",
  \"build_pack\": \"nixpacks\",
  \"ports_exposes\": \"3000\",
  \"is_auto_deploy_enabled\": true
}")

APP_UUID=$(echo "$APP_RESULT" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try { process.stdout.write(JSON.parse(d).uuid || ''); } catch(e) { process.stdout.write(''); }
  });
")

if [ -z "$APP_UUID" ]; then
  echo "ERROR: Failed to create application: $APP_RESULT" >&2
  exit 1
fi
echo "  App UUID: $APP_UUID" >&2

# ── 3. Set domain ────────────────────────────────────────────────────────────

echo "Setting domain: https://$DOMAIN..." >&2
api PATCH "/applications/$APP_UUID" "{\"domains\": \"https://$DOMAIN\"}" >/dev/null

# ── 4. Set environment variables (from file) ─────────────────────────────────

if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  echo "Setting environment variables from $ENV_FILE..." >&2
  ENV_COUNT=0
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    # Remove leading/trailing whitespace
    key=$(echo "$key" | xargs)
    # Value is everything after the first =
    api POST "/applications/$APP_UUID/envs" "{\"key\": \"$key\", \"value\": \"$value\", \"is_preview\": false}" >/dev/null
    ENV_COUNT=$((ENV_COUNT + 1))
  done < "$ENV_FILE"
  echo "  $ENV_COUNT env vars set" >&2
fi

# ── 5. Trigger deployment ────────────────────────────────────────────────────

echo "Triggering deployment..." >&2
DEPLOY_RESULT=$(api POST "/applications/$APP_UUID/start")
echo "  Deploy: $(echo "$DEPLOY_RESULT" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try { process.stdout.write(JSON.parse(d).message || 'triggered'); } catch(e) { process.stdout.write('triggered'); }
  });
")" >&2

# ── Output ───────────────────────────────────────────────────────────────────

cat <<EOF
{
  "project_uuid": "$PROJECT_UUID",
  "app_uuid": "$APP_UUID",
  "domain": "https://$DOMAIN",
  "repo": "$REPO",
  "branch": "$BRANCH",
  "auto_deploy": true
}
EOF
