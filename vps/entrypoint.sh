#!/bin/bash
set -e

# Configure git identity
git config --global user.name "Claude Dev"
git config --global user.email "claude-dev@pipeline"
git config --global init.defaultBranch main
# Only mark known project directories as safe (avoid wildcard '*' which disables ownership checking globally)
for dir in /home/claude-dev/projects/*/; do
  [ -d "$dir/.git" ] && git config --global --add safe.directory "$dir"
done
git config --global --add safe.directory /app

# Authenticate GitHub CLI with GH_TOKEN (from env)
if [ -n "$GH_TOKEN" ]; then
  echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null || true
  gh auth setup-git 2>/dev/null || true
fi

# GitHub App mode (if configured — tokens are generated dynamically per pipeline run)
if [ -n "$GITHUB_APP_ID" ] && [ -n "$GITHUB_APP_PRIVATE_KEY_PATH" ]; then
  echo "[startup] GitHub App configured (App ID: $GITHUB_APP_ID)"
  echo "[startup] Installation tokens will be generated per pipeline run"
  # No static gh auth — tokens are generated dynamically by pipeline/lib/github-app.ts
elif [ -z "$GH_TOKEN" ]; then
  echo "[startup] WARNING: Neither GH_TOKEN nor GITHUB_APP_ID set — git operations will fail" >&2
fi

# Validate project configs at startup
echo "[startup] Validating project configs..."
VALIDATION_ERRORS=0
for project_dir in /home/claude-dev/projects/*/; do
  [ -d "$project_dir" ] || continue
  slug=$(basename "$project_dir")
  config_file="$project_dir/project.json"

  if [ ! -f "$config_file" ]; then
    echo "[startup] ERROR: $slug — project.json missing!" >&2
    VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
    continue
  fi

  # Check required pipeline fields
  missing_fields=""
  workspace_id=$(node -e "process.stdout.write(require('$config_file').pipeline?.workspace_id || '')" 2>/dev/null)
  project_id=$(node -e "process.stdout.write(require('$config_file').pipeline?.project_id || '')" 2>/dev/null)

  [ -z "$workspace_id" ] && missing_fields="${missing_fields} pipeline.workspace_id"
  [ -z "$project_id" ] && missing_fields="${missing_fields} pipeline.project_id"

  if [ -n "$missing_fields" ]; then
    echo "[startup] WARNING: $slug — missing fields:$missing_fields" >&2
    VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
  else
    # Log hosting config for observability
    hosting_provider=$(node -e "const h=require('$config_file').hosting; process.stdout.write(typeof h==='object'&&h?h.provider||'none':typeof h==='string'?h:'none')" 2>/dev/null)
    echo "[startup] OK: $slug (hosting: $hosting_provider)"
  fi
done

if [ "$VALIDATION_ERRORS" -gt 0 ]; then
  echo "[startup] WARNING: $VALIDATION_ERRORS project(s) have config issues — pipeline may not work correctly for them" >&2
fi

# Execute CMD
exec "$@"
