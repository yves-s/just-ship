#!/bin/bash
set -e

# Configure git identity
git config --global user.name "Claude Dev"
git config --global user.email "claude-dev@pipeline"
git config --global init.defaultBranch main

# Authenticate GitHub CLI with GH_TOKEN (from env)
if [ -n "$GH_TOKEN" ]; then
  echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null
  gh auth setup-git
fi

# Execute CMD
exec "$@"
