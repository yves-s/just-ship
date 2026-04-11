#!/bin/bash
# quality-gate.sh — PostToolUse Hook (Edit, Write)
# Runs lint + format checks on the single file that was just edited.
# FORMAT is auto-fix (non-blocking). LINT is blocking on errors.
#
# Fired by: settings.json → hooks.PostToolUse (matcher: Edit | Write)
# Input: JSON on stdin with { tool_name, tool_input.file_path, cwd, ... }
# Performance: ~5s max (lint/format tools need Node startup time)

set -euo pipefail

EVENT_JSON=$(cat)

# Extract fields with sed — no python/node dependency for parsing.
# file_path: anchored to tool_input context to avoid matching file_path keys
# in tool_output or other JSON fields that may appear before tool_input.
# Strategy: extract everything after "tool_input" first, then pull file_path from that.
TOOL_INPUT_JSON=$(echo "$EVENT_JSON" | /usr/bin/sed -n 's/.*"tool_input" *: *{\(.*\)}/{\1}/p' | head -1)
if [ -n "$TOOL_INPUT_JSON" ]; then
  FILE_PATH=$(echo "$TOOL_INPUT_JSON" | /usr/bin/sed -n 's/.*"file_path" *: *"\([^"]*\)".*/\1/p' | head -1)
else
  # Fallback: extract file_path from anywhere (for hook event formats without tool_input wrapper)
  FILE_PATH=$(echo "$EVENT_JSON" | /usr/bin/sed -n 's/.*"file_path" *: *"\([^"]*\)".*/\1/p' | head -1)
fi
CWD=$(echo "$EVENT_JSON" | /usr/bin/sed -n 's/.*"cwd" *: *"\([^"]*\)".*/\1/p' | head -1)

[ -z "$FILE_PATH" ] && exit 0
[ -z "$CWD" ] && exit 0

cd "$CWD" || exit 0

# Only run in projects with project.json
[ ! -f "project.json" ] && exit 0

# Skip non-existent files (deleted by Write with empty content, etc.)
[ ! -f "$FILE_PATH" ] && exit 0

# Skip binary files, lock files, generated files, node_modules, .git
case "$FILE_PATH" in
  */node_modules/*|*/.git/*) exit 0 ;;
  *.lock|*-lock.json|*.lockb) exit 0 ;;
  *.min.js|*.min.css|*.generated.*|*.d.ts) exit 0 ;;
  *.png|*.jpg|*.jpeg|*.gif|*.svg|*.ico|*.woff|*.woff2|*.ttf|*.eot) exit 0 ;;
  *.zip|*.tar|*.gz|*.tgz|*.dmg|*.exe|*.bin) exit 0 ;;
esac

# Determine file extension
EXT="${FILE_PATH##*.}"

# Only process known text/code file types
case "$EXT" in
  ts|tsx|js|jsx|mjs|cjs|json|css|scss|sass|less|html|vue|svelte|py|sh|bash) ;;
  *) exit 0 ;;
esac

# ─────────────────────────────────────────────
# Check quality_gates config in project.json
# ─────────────────────────────────────────────
NODE_AVAILABLE=false
command -v node &>/dev/null && NODE_AVAILABLE=true

QG_ENABLED="true"
SHOULD_IGNORE="false"

if [ "$NODE_AVAILABLE" = "true" ]; then
  QG_ENABLED=$(node -e "
    try {
      const cfg = JSON.parse(require('fs').readFileSync('project.json','utf8'));
      const qg = cfg.quality_gates;
      if (qg && qg.enabled === false) { process.stdout.write('false'); }
      else { process.stdout.write('true'); }
    } catch(e) { process.stdout.write('true'); }
  " 2>/dev/null) || QG_ENABLED="true"

  [ "$QG_ENABLED" = "false" ] && exit 0

  # Check ignore_patterns from project.json
  SHOULD_IGNORE=$(node -e "
    try {
      const cfg = JSON.parse(require('fs').readFileSync('project.json','utf8'));
      const patterns = (cfg.quality_gates && cfg.quality_gates.ignore_patterns) || [];
      const file = process.argv[1];
      const ignore = patterns.some(p => {
        const rx = new RegExp(p.replace(/\./g,'\\\\.').replace(/\*/g,'.*'));
        return rx.test(file);
      });
      process.stdout.write(ignore ? 'true' : 'false');
    } catch(e) { process.stdout.write('false'); }
  " "$FILE_PATH" 2>/dev/null) || SHOULD_IGNORE="false"
fi

[ "$QG_ENABLED" = "false" ] && exit 0
[ "$SHOULD_IGNORE" = "true" ] && exit 0

# ─────────────────────────────────────────────
# Tool detection with caching
# ─────────────────────────────────────────────
CACHE_FILE=".claude/.quality-gate-cache"
PROJECT_JSON_MTIME=$(stat -f "%m" project.json 2>/dev/null || stat -c "%Y" project.json 2>/dev/null || echo "0")

USE_CACHE=false
if [ -f "$CACHE_FILE" ]; then
  CACHED_MTIME=$(head -1 "$CACHE_FILE" 2>/dev/null || echo "")
  if [ "$CACHED_MTIME" = "$PROJECT_JSON_MTIME" ]; then
    USE_CACHE=true
  fi
fi

if [ "$USE_CACHE" = "true" ]; then
  HAS_ESLINT=$(sed -n '2p' "$CACHE_FILE" 2>/dev/null || echo "false")
  HAS_PRETTIER=$(sed -n '3p' "$CACHE_FILE" 2>/dev/null || echo "false")
  HAS_BIOME=$(sed -n '4p' "$CACHE_FILE" 2>/dev/null || echo "false")
  HAS_RUFF=$(sed -n '5p' "$CACHE_FILE" 2>/dev/null || echo "false")
else
  # Auto-detect tools
  HAS_ESLINT="false"
  HAS_PRETTIER="false"
  HAS_BIOME="false"
  HAS_RUFF="false"

  # Check for eslint
  if [ -f ".eslintrc" ] || [ -f ".eslintrc.js" ] || [ -f ".eslintrc.cjs" ] || \
     [ -f ".eslintrc.json" ] || [ -f ".eslintrc.yml" ] || [ -f ".eslintrc.yaml" ] || \
     [ -f "eslint.config.js" ] || [ -f "eslint.config.mjs" ] || [ -f "eslint.config.ts" ]; then
    HAS_ESLINT="true"
  elif [ -f "package.json" ] && node -e "
    const p = JSON.parse(require('fs').readFileSync('package.json','utf8'));
    const deps = {...(p.dependencies||{}), ...(p.devDependencies||{})};
    process.exit(deps['eslint'] ? 0 : 1);
  " 2>/dev/null; then
    HAS_ESLINT="true"
  fi

  # Check for prettier
  if [ -f ".prettierrc" ] || [ -f ".prettierrc.js" ] || [ -f ".prettierrc.cjs" ] || \
     [ -f ".prettierrc.json" ] || [ -f ".prettierrc.yml" ] || [ -f ".prettierrc.yaml" ] || \
     [ -f "prettier.config.js" ] || [ -f "prettier.config.cjs" ] || [ -f "prettier.config.mjs" ]; then
    HAS_PRETTIER="true"
  elif [ -f "package.json" ] && node -e "
    const p = JSON.parse(require('fs').readFileSync('package.json','utf8'));
    const deps = {...(p.dependencies||{}), ...(p.devDependencies||{})};
    process.exit(deps['prettier'] ? 0 : 1);
  " 2>/dev/null; then
    HAS_PRETTIER="true"
  fi

  # Check for biome
  if [ -f "biome.json" ] || [ -f "biome.jsonc" ]; then
    HAS_BIOME="true"
  fi

  # Check for ruff (Python)
  if [ -f "ruff.toml" ]; then
    HAS_RUFF="true"
  elif [ -f "pyproject.toml" ] && grep -q '\[tool\.ruff\]' pyproject.toml 2>/dev/null; then
    HAS_RUFF="true"
  fi

  # Write cache (skip if .claude dir doesn't exist)
  if [ -d ".claude" ]; then
    {
      echo "$PROJECT_JSON_MTIME"
      echo "$HAS_ESLINT"
      echo "$HAS_PRETTIER"
      echo "$HAS_BIOME"
      echo "$HAS_RUFF"
    } > "$CACHE_FILE" 2>/dev/null || true
  fi
fi

# ─────────────────────────────────────────────
# Read lint/format flags from project.json config
# ─────────────────────────────────────────────
RUN_FORMAT="true"
RUN_LINT="true"

if [ "$NODE_AVAILABLE" = "true" ]; then
  RUN_FORMAT=$(node -e "
    try {
      const cfg = JSON.parse(require('fs').readFileSync('project.json','utf8'));
      const qg = cfg.quality_gates;
      process.stdout.write((qg && qg.format === false) ? 'false' : 'true');
    } catch(e) { process.stdout.write('true'); }
  " 2>/dev/null) || RUN_FORMAT="true"

  RUN_LINT=$(node -e "
    try {
      const cfg = JSON.parse(require('fs').readFileSync('project.json','utf8'));
      const qg = cfg.quality_gates;
      process.stdout.write((qg && qg.lint === false) ? 'false' : 'true');
    } catch(e) { process.stdout.write('true'); }
  " 2>/dev/null) || RUN_LINT="true"
fi

# ─────────────────────────────────────────────
# FORMAT (auto-fix, non-blocking)
# ─────────────────────────────────────────────
FORMAT_APPLIED=false

if [ "$RUN_FORMAT" = "true" ]; then
  # Biome format (takes precedence over prettier if biome.json present)
  if [ "$HAS_BIOME" = "true" ] && command -v npx &>/dev/null; then
    case "$EXT" in
      ts|tsx|js|jsx|mjs|cjs|json|css)
        if npx --no-install biome format --write -- "$FILE_PATH" 2>/dev/null; then
          FORMAT_APPLIED=true
        fi
        ;;
    esac
  elif [ "$HAS_PRETTIER" = "true" ] && command -v npx &>/dev/null; then
    case "$EXT" in
      ts|tsx|js|jsx|mjs|cjs|json|css|scss|sass|less|html|vue|svelte)
        if npx --no-install prettier --write -- "$FILE_PATH" 2>/dev/null; then
          FORMAT_APPLIED=true
        fi
        ;;
    esac
  fi

  # Ruff format for Python
  if [ "$HAS_RUFF" = "true" ] && [ "$EXT" = "py" ] && command -v ruff &>/dev/null; then
    if ruff format -- "$FILE_PATH" 2>/dev/null; then
      FORMAT_APPLIED=true
    fi
  fi
fi

if [ "$FORMAT_APPLIED" = "true" ]; then
  echo "quality-gate: formatting applied to $(basename "$FILE_PATH")" >&2
fi

# ─────────────────────────────────────────────
# LINT (blocking on errors)
# ─────────────────────────────────────────────
LINT_ERRORS=""

if [ "$RUN_LINT" = "true" ]; then
  # Biome lint (takes precedence over eslint if biome.json present)
  if [ "$HAS_BIOME" = "true" ] && command -v npx &>/dev/null; then
    case "$EXT" in
      ts|tsx|js|jsx|mjs|cjs)
        BIOME_OUT=$(npx --no-install biome lint -- "$FILE_PATH" 2>&1) || {
          LINT_ERRORS="$BIOME_OUT"
        }
        ;;
    esac
  elif [ "$HAS_ESLINT" = "true" ] && command -v npx &>/dev/null; then
    case "$EXT" in
      ts|tsx|js|jsx|mjs|cjs)
        ESLINT_OUT=$(npx --no-install eslint --no-color --format compact -- "$FILE_PATH" 2>&1) || {
          LINT_ERRORS="$ESLINT_OUT"
        }
        ;;
    esac
  fi

  # Ruff check for Python
  if [ "$HAS_RUFF" = "true" ] && [ "$EXT" = "py" ] && command -v ruff &>/dev/null; then
    RUFF_OUT=$(ruff check -- "$FILE_PATH" 2>&1) || {
      LINT_ERRORS="${LINT_ERRORS}${RUFF_OUT}"
    }
  fi
fi

# ─────────────────────────────────────────────
# Report and exit
# ─────────────────────────────────────────────
if [ -n "$LINT_ERRORS" ]; then
  echo "" >&2
  echo "⚠ quality-gate: lint errors in $(basename "$FILE_PATH")" >&2
  echo "$LINT_ERRORS" >&2
  echo "" >&2
  echo "Fix these errors before continuing." >&2
  exit 1
fi

exit 0
