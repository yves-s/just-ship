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

# Execute CMD
exec "$@"
