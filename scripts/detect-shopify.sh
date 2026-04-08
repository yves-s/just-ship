#!/usr/bin/env bash
# detect-shopify.sh — Detects Shopify project type from filesystem signals.
# Outputs JSON to stdout. Run from the project root directory.
# Usage: bash scripts/detect-shopify.sh
# Requires: node (just-ship prerequisite)

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

has_file()   { [ -f "$1" ]; }
has_dir()    { [ -d "$1" ]; }
pkg_has()    { grep -q "\"$1\"" "package.json" 2>/dev/null; }

# Extract a *.myshopify.com domain from a file via regex.
# Returns empty string on failure — never errors.
extract_store_domain() {
  local file="$1"
  if ! has_file "$file"; then
    echo ""
    return
  fi
  grep -oE '[a-zA-Z0-9_-]+\.myshopify\.com' "$file" 2>/dev/null | head -1 || echo ""
}

# Extract PUBLIC_STORE_DOMAIN or SHOPIFY_STORE_DOMAIN from .env / .env.local
extract_store_from_env() {
  local domain=""
  for env_file in ".env" ".env.local"; do
    if has_file "$env_file"; then
      domain=$(grep -E '^(PUBLIC_STORE_DOMAIN|SHOPIFY_STORE_DOMAIN)=' "$env_file" 2>/dev/null \
        | head -1 \
        | sed 's/^[^=]*=//' \
        | tr -d '"'"'" \
        | grep -oE '[a-zA-Z0-9_-]+\.myshopify\.com' 2>/dev/null \
        || echo "")
      if [ -n "$domain" ]; then
        echo "$domain"
        return
      fi
    fi
  done
  echo ""
}

# ---------------------------------------------------------------------------
# Detection — first match wins
# ---------------------------------------------------------------------------

VARIANT=""
STORE=""

# 1. Remix app: shopify.app.toml
if has_file "shopify.app.toml"; then
  VARIANT="remix"
  STORE=$(extract_store_domain "shopify.app.toml")

# 2. Hydrogen: hydrogen.config.ts OR @shopify/hydrogen in package.json
elif has_file "hydrogen.config.ts" || pkg_has "@shopify/hydrogen"; then
  VARIANT="hydrogen"
  STORE=$(extract_store_from_env)

# 3. Liquid theme: sections/ dir AND layout/theme.liquid
elif has_dir "sections" && has_file "layout/theme.liquid"; then
  VARIANT="liquid"
  STORE=$(extract_store_domain "shopify.theme.toml")

fi

# ---------------------------------------------------------------------------
# Build output via node for proper JSON serialisation
# ---------------------------------------------------------------------------

if [ -z "$VARIANT" ]; then
  node -e "process.stdout.write(JSON.stringify({detected:false,variant:'',store:'',build:{},skills:[]},null,2)+'\n')"
  exit 0
fi

SHOPIFY_VARIANT="$VARIANT" SHOPIFY_STORE="$STORE" node -e "
const variant = process.env.SHOPIFY_VARIANT;
const store   = process.env.SHOPIFY_STORE;

const builds = {
  remix:    { dev: 'shopify app dev',  web: 'npm run build', install: 'npm install', test: '' },
  liquid:   { dev: 'shopify theme dev', web: 'shopify theme check', install: '', test: '' },
  hydrogen: { dev: 'npm run dev',      web: 'npm run build', install: 'npm install', test: '' },
};

const skills = {
  remix:    ['shopify-apps', 'shopify-admin-api'],
  liquid:   ['shopify-liquid', 'shopify-theme'],
  hydrogen: ['shopify-hydrogen', 'shopify-storefront-api'],
};

const result = {
  detected: true,
  variant,
  store,
  build: builds[variant] || {},
  skills: skills[variant] || [],
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
"
