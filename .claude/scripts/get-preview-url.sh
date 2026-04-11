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

  # Token resolution: env var → VPS file → ~/.just-ship/config.json
  COOLIFY_TOKEN="${COOLIFY_API_TOKEN:-}"
  if [ -z "$COOLIFY_TOKEN" ] && [ -f /root/.coolify-api/token ]; then
    COOLIFY_TOKEN=$(cat /root/.coolify-api/token 2>/dev/null)
  fi
  if [ -z "$COOLIFY_TOKEN" ] && [ -f "$HOME/.just-ship/config.json" ]; then
    COOLIFY_TOKEN=$(node -e "
      try {
        const c = require(process.env.HOME + '/.just-ship/config.json');
        process.stdout.write(c.coolify_api_token || '');
      } catch (e) {}
    " 2>/dev/null)
  fi

  [ -z "$COOLIFY_URL" ] || [ -z "$COOLIFY_APP_UUID" ] || [ -z "$COOLIFY_TOKEN" ] && exit 0

  # Step 1: Get app details (FQDN, name, preview_url_template) — Coolify v4
  APP_RESPONSE=$(curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
    "${COOLIFY_URL}/api/v1/applications/${COOLIFY_APP_UUID}" 2>/dev/null)

  APP_FIELDS=$(echo "$APP_RESPONSE" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try {
        const app = JSON.parse(d);
        const fqdn = app.fqdn || '';
        const name = app.name || '';
        const tmpl = app.preview_url_template || '';
        process.stdout.write(fqdn + '\n' + name + '\n' + tmpl);
      } catch(e) {}
    });
  " 2>/dev/null)
  FQDN=$(echo "$APP_FIELDS" | sed -n '1p')
  APP_NAME=$(echo "$APP_FIELDS" | sed -n '2p')
  PREVIEW_TEMPLATE=$(echo "$APP_FIELDS" | sed -n '3p')

  if [ -z "$FQDN" ] || [ "$FQDN" = "null" ]; then
    echo "[coolify-preview] No FQDN in app response -- skipping" >&2
    exit 0
  fi

  # Step 2: Try deployments API briefly (may return empty on some Coolify versions)
  # Cap at 10s or MAX_WAIT, whichever is smaller
  DEPLOY_POLL_MAX=$(( MAX_WAIT < 10 ? MAX_WAIT : 10 ))
  ELAPSED=0
  INTERVAL=5

  while [ "$ELAPSED" -lt "$DEPLOY_POLL_MAX" ] && [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
    if [ -n "$APP_NAME" ]; then
      DEPLOY_DATA=$(curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
        "${COOLIFY_URL}/api/v1/deployments" 2>/dev/null \
        | APP_NAME="$APP_NAME" node -e "
          let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
            try {
              const deps = JSON.parse(d);
              const appName = process.env.APP_NAME;
              const matching = deps.filter(d => d.application_name === appName);
              const latest = matching[0];
              if (latest) {
                process.stdout.write(latest.status + ' ' + (latest.pull_request_id || 0));
              }
            } catch(e) {}
          });
        " 2>/dev/null)

      DEPLOY_STATUS=$(echo "$DEPLOY_DATA" | cut -d' ' -f1)
      PR_ID=$(echo "$DEPLOY_DATA" | cut -d' ' -f2)

      if [ "$DEPLOY_STATUS" = "finished" ]; then
        if [ -n "$PREVIEW_TEMPLATE" ] && [ "$PR_ID" -gt 0 ] 2>/dev/null; then
          DOMAIN=$(echo "$FQDN" | sed 's|^https://||;s|^http://||')
          PREVIEW_DOMAIN=$(echo "$PREVIEW_TEMPLATE" | sed "s/{{pr_id}}/$PR_ID/g" | sed "s/{{domain}}/$DOMAIN/g")
          echo "https://$PREVIEW_DOMAIN"
        else
          echo "$FQDN"
        fi
        exit 0
      elif [ -n "$DEPLOY_STATUS" ]; then
        echo "[coolify-preview] Deployment status: $DEPLOY_STATUS (${ELAPSED}s elapsed) -- polling" >&2
      else
        echo "[coolify-preview] No deployments found for \"$APP_NAME\" (${ELAPSED}s elapsed) -- polling" >&2
      fi
    fi

    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
  done

  # Step 3: Deployments API returned nothing — construct URL from template + PR number
  # This handles Coolify v4 betas where /api/v1/deployments returns empty arrays
  if [ -n "$PREVIEW_TEMPLATE" ]; then
    PR_NUMBER=$(gh pr view --json number -q .number 2>/dev/null || echo "")
    if [ -n "$PR_NUMBER" ] && [ "$PR_NUMBER" -gt 0 ] 2>/dev/null; then
      DOMAIN=$(echo "$FQDN" | sed 's|^https://||;s|^http://||')
      PREVIEW_DOMAIN=$(echo "$PREVIEW_TEMPLATE" | sed "s/{{pr_id}}/$PR_NUMBER/g" | sed "s/{{domain}}/$DOMAIN/g")
      echo "https://$PREVIEW_DOMAIN"
      exit 0
    fi
  fi

  # No PR found or no template — return production FQDN
  echo "$FQDN"
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
