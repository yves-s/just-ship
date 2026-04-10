#!/bin/bash
# get-preview-url.sh — Get preview URL for current branch
# Usage: bash .claude/scripts/get-preview-url.sh [max_wait_seconds]
#
# Supports multiple hosting providers:
#   - vercel:  Polls GitHub Deployments API for Vercel preview URL
#   - coolify: Polls Coolify v4 Deployments API for deployment URL
#   - other:   Exits silently (graceful no-op)
#
# Prints the URL to stdout if found, exits silently otherwise.
# Designed for graceful failure — never blocks the pipeline.
#
# Returns: 0 always (never fails, silent on timeout or no deployment)

# Read hosting config from project.json
HOSTING_PROVIDER=$(node -e "
  try {
    const c = require('./project.json');
    const h = c.hosting;
    if (typeof h === 'object' && h !== null) {
      process.stdout.write(h.provider || '');
    } else if (typeof h === 'string') {
      process.stdout.write(h);
    }
  } catch (e) {}
" 2>/dev/null)

MAX_WAIT="${1:-30}"

# ── Coolify ──────────────────────────────────────────────────────────────────

if [ "$HOSTING_PROVIDER" = "coolify" ]; then
  COOLIFY_URL=$(node -e "
    try {
      const c = require('./project.json');
      process.stdout.write(c.hosting?.coolify_url || '');
    } catch (e) {}
  " 2>/dev/null)

  COOLIFY_APP_UUID=$(node -e "
    try {
      const c = require('./project.json');
      process.stdout.write(c.hosting?.coolify_app_uuid || '');
    } catch (e) {}
  " 2>/dev/null)

  # Token: env var first, then file on VPS
  COOLIFY_TOKEN="${COOLIFY_API_TOKEN:-}"
  if [ -z "$COOLIFY_TOKEN" ] && [ -f /root/.coolify-api/token ]; then
    COOLIFY_TOKEN=$(cat /root/.coolify-api/token 2>/dev/null)
  fi

  [ -z "$COOLIFY_URL" ] || [ -z "$COOLIFY_APP_UUID" ] || [ -z "$COOLIFY_TOKEN" ] && exit 0

  ELAPSED=0
  INTERVAL=5

  while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
    # Step 1: Get app details (FQDN + name) — this endpoint works in Coolify v4
    APP_RESPONSE=$(curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
      "${COOLIFY_URL}/api/v1/applications/${COOLIFY_APP_UUID}" 2>/dev/null)

    FQDN=$(echo "$APP_RESPONSE" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        try { process.stdout.write(JSON.parse(d).fqdn || ''); } catch(e) {}
      });
    " 2>/dev/null)

    APP_NAME=$(echo "$APP_RESPONSE" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        try { process.stdout.write(JSON.parse(d).name || ''); } catch(e) {}
      });
    " 2>/dev/null)

    if [ -n "$FQDN" ] && [ "$FQDN" != "null" ] && [ -n "$APP_NAME" ]; then
      # Step 2: Fetch all deployments and filter by application_name
      # Coolify v4 does NOT support /applications/{uuid}/deployments
      DEPLOY_STATUS=$(curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
        "${COOLIFY_URL}/api/v1/deployments" 2>/dev/null \
        | node -e "
          let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
            try {
              const deps = JSON.parse(d);
              const appName = '${APP_NAME}';
              const matching = deps.filter(d => d.application_name === appName);
              process.stdout.write(matching[0]?.status || '');
            } catch(e) {}
          });
        " 2>/dev/null)

      if [ "$DEPLOY_STATUS" = "finished" ]; then
        echo "$FQDN"
        exit 0
      fi
    fi

    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
  done

  exit 0
fi

# ── Vercel ───────────────────────────────────────────────────────────────────

if [ "$HOSTING_PROVIDER" = "vercel" ]; then
  SHA=$(git rev-parse HEAD 2>/dev/null)
  [ -z "$SHA" ] && exit 0

  REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null)
  [ -z "$REPO" ] && exit 0

  ELAPSED=0
  INTERVAL=5

  while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
    DEPLOY_ID=$(gh api "repos/${REPO}/deployments?sha=${SHA}&per_page=10" \
      --jq '[.[] | select(.environment | test("Preview"))] | .[0].id' 2>/dev/null)

    if [ -n "$DEPLOY_ID" ] && [ "$DEPLOY_ID" != "null" ]; then
      PREVIEW_URL=$(gh api "repos/${REPO}/deployments/${DEPLOY_ID}/statuses" \
        --jq '[.[] | select(.state == "success")] | .[0].environment_url // empty' 2>/dev/null)

      if [ -n "$PREVIEW_URL" ] && [ "$PREVIEW_URL" != "null" ]; then
        echo "$PREVIEW_URL"
        exit 0
      fi
    fi

    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
  done

  exit 0
fi

# ── No provider configured — exit silently ───────────────────────────────────
exit 0
