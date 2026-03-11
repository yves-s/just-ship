#!/bin/bash
# =============================================================================
# setup.sh – Install or update Agentic Dev Pipeline in a project
#
# Usage:
#   cd /path/to/your/project
#
#   # Initial setup (interactive)
#   /path/to/agentic-dev-pipeline/setup.sh
#
#   # Update framework files only (non-interactive)
#   /path/to/agentic-dev-pipeline/setup.sh --update
#
#   # Preview what would change
#   /path/to/agentic-dev-pipeline/setup.sh --update --dry-run
#
# Framework files (overwritten on update):
#   .claude/agents/*          Agent definitions
#   .claude/commands/*        Slash commands
#   .claude/skills/<name>.md  Framework skills (only framework-owned files)
#   .claude/scripts/*         Utility scripts (for skills)
#   .claude/settings.json     Permissions
#   .pipeline/run.sh          Pipeline runner
#   .claude/.pipeline-version Version tracking
#
# Project files (NEVER overwritten):
#   CLAUDE.md                 Project-specific instructions
#   project.json              Project configuration
#   .claude/skills/<custom>   Any skill not in the framework skills/ directory
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
  echo "  Agentic Dev Pipeline — Update"
else
  echo "  Agentic Dev Pipeline — Setup"
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

  # Pipeline
  diff_file "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh" ".pipeline/run.sh"
  diff_file "$FRAMEWORK_DIR/pipeline/send-event.sh" "$PROJECT_DIR/.pipeline/send-event.sh" ".pipeline/send-event.sh"

  # Skills (framework skills only — project-specific skills are never touched)
  for f in "$FRAMEWORK_DIR/skills/"*.md; do
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/skills/$fname" ".claude/skills/$fname"
  done

  # Scripts
  for f in "$FRAMEWORK_DIR/.claude/scripts/"*; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/scripts/$fname" ".claude/scripts/$fname"
  done

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
  mkdir -p "$PROJECT_DIR/.claude/skills"
  cp "$FRAMEWORK_DIR/skills/"*.md "$PROJECT_DIR/.claude/skills/"
  echo "  ✓ $(ls "$FRAMEWORK_DIR/skills/"*.md | wc -l | tr -d ' ') framework skills (project-specific skills untouched)"

  echo "Updating scripts..."
  mkdir -p "$PROJECT_DIR/.claude/scripts"
  cp "$FRAMEWORK_DIR/.claude/scripts/"* "$PROJECT_DIR/.claude/scripts/" 2>/dev/null || true
  chmod +x "$PROJECT_DIR/.claude/scripts/"*.sh 2>/dev/null || true
  chmod +x "$PROJECT_DIR/.claude/scripts/"*.py 2>/dev/null || true
  echo "  ✓ scripts"

  echo "Updating pipeline..."
  cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
  cp "$FRAMEWORK_DIR/pipeline/send-event.sh" "$PROJECT_DIR/.pipeline/send-event.sh"
  chmod +x "$PROJECT_DIR/.pipeline/"*.sh
  echo "  ✓ .pipeline/run.sh"
  echo "  ✓ .pipeline/send-event.sh"

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

read -p "  Project name (kebab-case, e.g. my-app): " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-myproject}

read -p "  Description (optional): " PROJECT_DESC
PROJECT_DESC=${PROJECT_DESC:-""}

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
echo "Installing pipeline..."
mkdir -p "$PROJECT_DIR/.pipeline"
cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
cp "$FRAMEWORK_DIR/pipeline/send-event.sh" "$PROJECT_DIR/.pipeline/send-event.sh"
chmod +x "$PROJECT_DIR/.pipeline/"*.sh
echo "  ✓ .pipeline/run.sh"
echo "  ✓ .pipeline/send-event.sh"

# --- Copy skills ---
echo "Installing skills..."
mkdir -p "$PROJECT_DIR/.claude/skills"
cp "$FRAMEWORK_DIR/skills/"*.md "$PROJECT_DIR/.claude/skills/"
echo "  ✓ $(ls "$FRAMEWORK_DIR/skills/"*.md | wc -l | tr -d ' ') skills"

# --- Copy scripts ---
echo "Installing scripts..."
mkdir -p "$PROJECT_DIR/.claude/scripts"
cp "$FRAMEWORK_DIR/.claude/scripts/"* "$PROJECT_DIR/.claude/scripts/" 2>/dev/null || true
chmod +x "$PROJECT_DIR/.claude/scripts/"*.sh 2>/dev/null || true
chmod +x "$PROJECT_DIR/.claude/scripts/"*.py 2>/dev/null || true
echo "  ✓ scripts"

# --- Generate project.json ---
if [ "$OVERWRITE_CONFIG" != "N" ]; then
  echo "Generating project.json..."

  cat > "$PROJECT_DIR/project.json" <<CONFIG_EOF
{
  "name": "${PROJECT_NAME}",
  "description": "${PROJECT_DESC}",
  "stack": {},
  "build": {
    "web": "pnpm run build",
    "test": "npx vitest run"
  },
  "paths": {},
  "supabase": {
    "project_id": ""
  },
  "pipeline": {
    "project_id": "",
    "project_name": null,
    "workspace_id": ""
  },
  "conventions": {
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
echo "  1. Edit CLAUDE.md        — Architektur, Konventionen, Domain-Wissen"
echo "  2. Edit project.json     — Stack, Build-Commands, Pfade anpassen"
echo "  3. Run /setup-pipeline   — In Claude Code öffnen und /setup-pipeline ausführen"
echo "                             (Stack erkennen, Config befüllen, Dev Board verbinden)"
echo "  4. .claude/skills/       — Eigene Skills hinzufügen (optional)"
echo ""
echo "Framework updaten:"
echo "  $(basename "$FRAMEWORK_DIR")/setup.sh --update"
echo ""
echo "Pipeline (VPS/CI):"
echo "  .pipeline/run.sh <TICKET_ID> <TICKET_TITLE> [DESCRIPTION]"
echo ""
