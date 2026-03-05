#!/bin/bash
# =============================================================================
# setup.sh – Install or update Claude Pipeline Framework in a project
#
# Usage:
#   cd /path/to/your/project
#
#   # Initial setup (interactive)
#   /path/to/claude-pipeline/setup.sh
#
#   # Update framework files only (non-interactive)
#   /path/to/claude-pipeline/setup.sh --update
#
#   # Preview what would change
#   /path/to/claude-pipeline/setup.sh --update --dry-run
#
# Framework files (overwritten on update):
#   .claude/agents/*          Agent definitions
#   .claude/commands/*        Slash commands
#   .claude/settings.json     Permissions
#   .pipeline/run.sh          Pipeline runner
#   .claude/.pipeline-version Version tracking
#
# Project files (NEVER overwritten):
#   CLAUDE.md                 Project-specific instructions
#   project.json              Project configuration
#   .claude/skills/*          Project-specific skills
# =============================================================================

set -euo pipefail

FRAMEWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(pwd)"
VERSION_FILE="$PROJECT_DIR/.claude/.pipeline-version"

# --- Parse flags ---
MODE="setup"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --update)  MODE="update" ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: setup.sh [--update] [--dry-run]"
      echo ""
      echo "  (no flags)   Interactive first-time setup"
      echo "  --update     Update framework files only (non-interactive)"
      echo "  --dry-run    Preview changes without applying them"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg (use --help)"
      exit 1
      ;;
  esac
done

# --- Get framework version (git short hash + date) ---
get_framework_version() {
  if [ -d "$FRAMEWORK_DIR/.git" ]; then
    cd "$FRAMEWORK_DIR"
    local hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    local date=$(git log -1 --format=%cs 2>/dev/null || date +%Y-%m-%d)
    cd "$PROJECT_DIR"
    echo "${hash} (${date})"
  else
    echo "local ($(date +%Y-%m-%d))"
  fi
}

FRAMEWORK_VERSION=$(get_framework_version)

# --- Header ---
echo ""
echo "================================================"
if [ "$MODE" = "update" ]; then
  echo "  Claude Pipeline Framework — Update"
else
  echo "  Claude Pipeline Framework — Setup"
fi
echo "  Version: $FRAMEWORK_VERSION"
echo "================================================"
echo ""
echo "Project:   $PROJECT_DIR"
echo "Framework: $FRAMEWORK_DIR"
echo ""

# --- Prerequisites ---
check_prereq() {
  if command -v "$1" &>/dev/null; then
    echo "  ✓ $1"
    return 0
  else
    echo "  ✗ $1 NOT FOUND"
    return 1
  fi
}

echo "Prerequisites:"
MISSING=0
check_prereq "claude" || MISSING=1
check_prereq "git" || MISSING=1
check_prereq "gh" || MISSING=1
check_prereq "python3" || echo "  ~ python3 optional (config parsing in run.sh)"

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "Missing prerequisites. Please install and try again."
  exit 1
fi
echo ""

# =============================================================================
# UPDATE MODE — Non-interactive, framework files only
# =============================================================================

if [ "$MODE" = "update" ]; then

  # Check if project was initialized
  if [ ! -d "$PROJECT_DIR/.claude/agents" ]; then
    echo "Error: No pipeline installation found in $PROJECT_DIR"
    echo "Run setup.sh without --update first."
    exit 1
  fi

  # Show current vs new version
  if [ -f "$VERSION_FILE" ]; then
    echo "Installed: $(cat "$VERSION_FILE")"
  else
    echo "Installed: unknown (no version file)"
  fi
  echo "Available: $FRAMEWORK_VERSION"
  echo ""

  # --- Diff preview ---
  CHANGES=0

  diff_file() {
    local src="$1"
    local dst="$2"
    local label="$3"

    if [ ! -f "$dst" ]; then
      echo "  + $label (new)"
      CHANGES=$((CHANGES + 1))
    elif ! diff -q "$src" "$dst" &>/dev/null; then
      echo "  ~ $label (changed)"
      CHANGES=$((CHANGES + 1))
    fi
  }

  echo "Checking for changes..."

  # Agents
  for f in "$FRAMEWORK_DIR/agents/"*.md; do
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/agents/$fname" ".claude/agents/$fname"
  done

  # Check for removed agents
  if [ -d "$PROJECT_DIR/.claude/agents" ]; then
    for f in "$PROJECT_DIR/.claude/agents/"*.md; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      if [ ! -f "$FRAMEWORK_DIR/agents/$fname" ]; then
        echo "  - .claude/agents/$fname (removed from framework)"
        CHANGES=$((CHANGES + 1))
      fi
    done
  fi

  # Commands
  for f in "$FRAMEWORK_DIR/commands/"*.md; do
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/commands/$fname" ".claude/commands/$fname"
  done

  # Check for removed commands
  if [ -d "$PROJECT_DIR/.claude/commands" ]; then
    for f in "$PROJECT_DIR/.claude/commands/"*.md; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      if [ ! -f "$FRAMEWORK_DIR/commands/$fname" ]; then
        echo "  - .claude/commands/$fname (removed from framework)"
        CHANGES=$((CHANGES + 1))
      fi
    done
  fi

  # Pipeline runner
  diff_file "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh" ".pipeline/run.sh"

  # Skills
  for f in "$FRAMEWORK_DIR/skills/"*.md; do
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/skills/$fname" ".claude/skills/$fname"
  done

  # Check for removed skills
  if [ -d "$PROJECT_DIR/.claude/skills" ]; then
    for f in "$PROJECT_DIR/.claude/skills/"*.md; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      if [ ! -f "$FRAMEWORK_DIR/skills/$fname" ]; then
        echo "  - .claude/skills/$fname (removed from framework)"
        CHANGES=$((CHANGES + 1))
      fi
    done
  fi

  # Settings
  diff_file "$FRAMEWORK_DIR/settings.json" "$PROJECT_DIR/.claude/settings.json" ".claude/settings.json"

  if [ "$CHANGES" -eq 0 ]; then
    echo "  Everything up to date."
    echo ""
    exit 0
  fi

  echo ""
  echo "$CHANGES file(s) to update."

  # Dry run stops here
  if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "(dry run — no changes applied)"
    exit 0
  fi

  echo ""

  # --- Apply updates ---
  echo "Updating agents..."
  if [ -d "$PROJECT_DIR/.claude/agents" ]; then
    for f in "$PROJECT_DIR/.claude/agents/"*.md; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      if [ ! -f "$FRAMEWORK_DIR/agents/$fname" ]; then
        rm "$f"
        echo "  - $fname removed"
      fi
    done
  fi
  cp "$FRAMEWORK_DIR/agents/"*.md "$PROJECT_DIR/.claude/agents/"
  echo "  ✓ $(ls "$FRAMEWORK_DIR/agents/"*.md | wc -l | tr -d ' ') agents"

  echo "Updating commands..."
  if [ -d "$PROJECT_DIR/.claude/commands" ]; then
    for f in "$PROJECT_DIR/.claude/commands/"*.md; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      if [ ! -f "$FRAMEWORK_DIR/commands/$fname" ]; then
        rm "$f"
        echo "  - $fname removed"
      fi
    done
  fi
  cp "$FRAMEWORK_DIR/commands/"*.md "$PROJECT_DIR/.claude/commands/"
  echo "  ✓ $(ls "$FRAMEWORK_DIR/commands/"*.md | wc -l | tr -d ' ') commands"

  echo "Updating skills..."
  if [ -d "$PROJECT_DIR/.claude/skills" ]; then
    for f in "$PROJECT_DIR/.claude/skills/"*.md; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      if [ ! -f "$FRAMEWORK_DIR/skills/$fname" ]; then
        rm "$f"
        echo "  - $fname removed"
      fi
    done
  fi
  mkdir -p "$PROJECT_DIR/.claude/skills"
  cp "$FRAMEWORK_DIR/skills/"*.md "$PROJECT_DIR/.claude/skills/"
  echo "  ✓ $(ls "$FRAMEWORK_DIR/skills/"*.md | wc -l | tr -d ' ') skills"

  echo "Updating pipeline runner..."
  cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
  chmod +x "$PROJECT_DIR/.pipeline/run.sh"
  echo "  ✓ .pipeline/run.sh"

  echo "Updating settings..."
  cp "$FRAMEWORK_DIR/settings.json" "$PROJECT_DIR/.claude/settings.json"
  echo "  ✓ .claude/settings.json"

  # Write version
  echo "$FRAMEWORK_VERSION" > "$VERSION_FILE"

  echo ""
  echo "================================================"
  echo "  Update complete → $FRAMEWORK_VERSION"
  echo "================================================"
  echo ""
  echo "Untouched:"
  echo "  ~ CLAUDE.md"
  echo "  ~ project.json"
  echo "  ~ .claude/skills/*"
  echo ""
  exit 0
fi

# =============================================================================
# SETUP MODE — Interactive first-time installation
# =============================================================================

OVERWRITE_CONFIG="Y"
if [ -f "project.json" ]; then
  echo "project.json already exists."
  read -p "Overwrite project.json? (y/N): " OVERWRITE_CONFIG
  OVERWRITE_CONFIG=${OVERWRITE_CONFIG:-N}
fi

echo "Project configuration:"
echo ""

read -p "  Project name (kebab-case, e.g. lb-website): " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-myproject}

read -p "  Description: " PROJECT_DESC
PROJECT_DESC=${PROJECT_DESC:-""}

read -p "  Package manager (pnpm/npm/yarn/bun) [pnpm]: " PKG_MANAGER
PKG_MANAGER=${PKG_MANAGER:-pnpm}

read -p "  Build command (web) [${PKG_MANAGER} run build]: " BUILD_WEB
BUILD_WEB=${BUILD_WEB:-"${PKG_MANAGER} run build"}

read -p "  Test command [npx vitest run]: " BUILD_TEST
BUILD_TEST=${BUILD_TEST:-"npx vitest run"}

read -p "  Branch prefix [feature/]: " BRANCH_PREFIX
BRANCH_PREFIX=${BRANCH_PREFIX:-"feature/"}

echo ""
echo "Notion integration (leave empty to skip):"
echo "  Open your Tasks DB as full page and copy the URL."
echo ""
read -p "  Tasks DB URL: " NOTION_TASKS_URL
read -p "  Project ID (Nummer aus P--11 → 11): " NOTION_PROJECT_ID

# Extract DB ID from URL: last path segment before query params
NOTION_DB_ID=""
if [ -n "$NOTION_TASKS_URL" ]; then
  # Extract the 32-char hex ID from the URL
  NOTION_DB_ID=$(echo "$NOTION_TASKS_URL" | grep -oE '[0-9a-f]{32}' | head -1)
  if [ -z "$NOTION_DB_ID" ]; then
    echo ""
    echo "  ⚠ Could not extract DB ID from URL. Please enter manually:"
    read -p "  Tasks DB ID (32 hex chars): " NOTION_DB_ID
  else
    echo "  ✓ Extracted DB ID: $NOTION_DB_ID"
  fi
fi

echo ""

# --- Copy agents ---
echo "Installing agents..."
mkdir -p "$PROJECT_DIR/.claude/agents"
cp "$FRAMEWORK_DIR/agents/"*.md "$PROJECT_DIR/.claude/agents/"
echo "  ✓ $(ls "$FRAMEWORK_DIR/agents/"*.md | wc -l | tr -d ' ') agents"

# --- Copy commands ---
echo "Installing commands..."
mkdir -p "$PROJECT_DIR/.claude/commands"
cp "$FRAMEWORK_DIR/commands/"*.md "$PROJECT_DIR/.claude/commands/"
echo "  ✓ $(ls "$FRAMEWORK_DIR/commands/"*.md | wc -l | tr -d ' ') commands"

# --- Copy pipeline runner ---
echo "Installing pipeline runner..."
mkdir -p "$PROJECT_DIR/.pipeline"
cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
chmod +x "$PROJECT_DIR/.pipeline/run.sh"
echo "  ✓ .pipeline/run.sh"

# --- Copy skills ---
echo "Installing skills..."
mkdir -p "$PROJECT_DIR/.claude/skills"
cp "$FRAMEWORK_DIR/skills/"*.md "$PROJECT_DIR/.claude/skills/"
echo "  ✓ $(ls "$FRAMEWORK_DIR/skills/"*.md | wc -l | tr -d ' ') skills"

# --- Generate project.json ---
if [ "$OVERWRITE_CONFIG" != "N" ]; then
  echo "Generating project.json..."

  NOTION_BLOCK=""
  if [ -n "$NOTION_DB_ID" ]; then
    NOTION_BLOCK=$(cat <<NOTION_EOF
  "notion": {
    "tasks_db": "${NOTION_DB_ID}",
    "project_id": ${NOTION_PROJECT_ID:-null}
  },
NOTION_EOF
)
  fi

  cat > "$PROJECT_DIR/project.json" <<CONFIG_EOF
{
  "name": "${PROJECT_NAME}",
  "description": "${PROJECT_DESC}",
  "stack": {},
  "build": {
    "web": "${BUILD_WEB}",
    "test": "${BUILD_TEST}"
  },
  "paths": {},
  ${NOTION_BLOCK}
  "conventions": {
    "branch_prefix": "${BRANCH_PREFIX}",
    "commit_format": "conventional",
    "language": "de"
  }
}
CONFIG_EOF
  echo "  ✓ project.json"
else
  echo "  ~ project.json (skipped)"
fi

# --- Generate settings.json ---
if [ ! -f "$PROJECT_DIR/.claude/settings.json" ]; then
  echo "Generating .claude/settings.json..."
  cp "$FRAMEWORK_DIR/settings.json" "$PROJECT_DIR/.claude/settings.json"
  echo "  ✓ .claude/settings.json"
else
  echo "  ~ .claude/settings.json (exists, skipped)"
fi

# --- Generate CLAUDE.md ---
if [ ! -f "$PROJECT_DIR/CLAUDE.md" ]; then
  echo "Generating CLAUDE.md..."
  sed "s/{{PROJECT_NAME}}/${PROJECT_NAME}/g" "$FRAMEWORK_DIR/templates/CLAUDE.md" > "$PROJECT_DIR/CLAUDE.md"
  echo "  ✓ CLAUDE.md (edit with your project specifics)"
else
  echo "  ~ CLAUDE.md (exists, skipped)"
fi

# --- Write version ---
echo "$FRAMEWORK_VERSION" > "$VERSION_FILE"

echo ""
echo "================================================"
echo "  Setup complete → $FRAMEWORK_VERSION"
echo "================================================"
echo ""
echo "Next steps:"
echo "  1. Edit CLAUDE.md — architecture, conventions, domain knowledge"
echo "  2. Edit project.json — stack, paths"
echo "  3. Add skills in .claude/skills/ (optional)"
echo "  4. Test: claude → /status"
echo ""
echo "Update framework later:"
echo "  $(basename "$FRAMEWORK_DIR")/setup.sh --update"
echo ""
echo "Pipeline (VPS/CI):"
echo "  .pipeline/run.sh <TICKET_ID> <TICKET_TITLE> [DESCRIPTION]"
echo ""
