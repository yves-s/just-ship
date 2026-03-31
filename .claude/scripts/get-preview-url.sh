#!/bin/bash
# get-preview-url.sh — Get Vercel preview URL for current branch via GitHub deployments API
# Usage: bash .claude/scripts/get-preview-url.sh [max_wait_seconds]
#
# Checks GitHub deployments for a Vercel preview URL on the current branch.
# Retries with backoff up to max_wait_seconds (default: 30).
# Prints the URL to stdout if found, exits silently otherwise.
# Designed for graceful failure — never blocks the pipeline.
#
# IMPORTANT: Only runs if hosting.provider is set to "vercel" in project.json.
# Without this, exits immediately (no API calls, no waiting).
#
# Returns: 0 always (never fails, silent on timeout or no Vercel deployment)

# Check hosting provider from project.json — exit early if not vercel
HOSTING_PROVIDER=$(node -e "
  try {
    const c = require('./project.json');
    const h = c.hosting;
    // Support both object format {provider: 'vercel'} and legacy string format 'vercel'
    if (typeof h === 'object' && h !== null) {
      process.stdout.write(h.provider || '');
    } else if (typeof h === 'string') {
      process.stdout.write(h);
    }
  } catch (e) {}
" 2>/dev/null)

# If hosting provider is not vercel, exit silently (graceful no-op)
if [ "$HOSTING_PROVIDER" != "vercel" ]; then
  exit 0
fi

MAX_WAIT="${1:-30}"
SHA=$(git rev-parse HEAD 2>/dev/null)
[ -z "$SHA" ] && exit 0

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null)
[ -z "$REPO" ] && exit 0

ELAPSED=0
INTERVAL=5

while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  # Query by commit SHA — Vercel sets deployment ref to the SHA, not the branch name
  # Filter for Preview environments (Vercel names them "Preview – {project}")
  DEPLOY_ID=$(gh api "repos/${REPO}/deployments?sha=${SHA}&per_page=10" \
    --jq '[.[] | select(.environment | test("Preview"))] | .[0].id' 2>/dev/null)

  if [ -n "$DEPLOY_ID" ] && [ "$DEPLOY_ID" != "null" ]; then
    # Get the environment URL from successful deployment status
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
