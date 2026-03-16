#!/bin/bash
# =============================================================================
# setup.sh – Install or update Just Ship in a project
#
# Usage:
#   cd /path/to/your/project
#
#   # Initial setup (interactive)
#   /path/to/just-ship/setup.sh
#
#   # Update framework files only (non-interactive)
#   /path/to/just-ship/setup.sh --update
#
#   # Preview what would change
#   /path/to/just-ship/setup.sh --update --dry-run
#
# Framework files (overwritten on update):
#   .claude/agents/*          Agent definitions
#   .claude/commands/*        Slash commands
#   .claude/skills/<name>.md  Pipeline-specific skills (8 skills)
#   .claude/scripts/*         Utility scripts (for skills)
#   .claude/hooks/*           Event streaming hooks (SessionStart, SubagentStart/Stop, SessionEnd)
#   .claude/settings.json     Permissions + hook configuration
#   .pipeline/*               Pipeline runner (TypeScript SDK)
#   .claude/.pipeline-version Version tracking
#   .claude/.template-hash    Template change detection
#
# External plugins (installed, not copied):
#   superpowers               TDD, debugging, code review, planning (via plugin)
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

# --- Helper: ensure a pattern is in .gitignore ---
ensure_gitignore() {
  local pattern="$1"
  local comment="$2"
  local gitignore="$PROJECT_DIR/.gitignore"
  if [ -f "$gitignore" ] && grep -qxF "$pattern" "$gitignore"; then
    return 0
  fi
  echo "" >> "$gitignore"
  echo "# $comment" >> "$gitignore"
  echo "$pattern" >> "$gitignore"
}

# --- Self-install guard ---
# The framework repo itself uses symlinks (.claude/commands → ../commands etc.)
# Running setup.sh on itself would try to copy files onto themselves.
if [ "$(cd "$FRAMEWORK_DIR" && pwd -P)" = "$(cd "$PROJECT_DIR" && pwd -P)" ]; then
  echo "Error: Cannot install framework into itself."
  echo "The framework repo uses symlinks — see .claude/commands, .claude/skills, .claude/agents."
  exit 1
fi

# --- Header ---
echo ""
echo "================================================"
if [ "$MODE" = "update" ]; then
  echo "  Just Ship — Update"
else
  echo "  Just Ship — Setup"
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
check_prereq "node" || MISSING=1

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
  diff_file "$FRAMEWORK_DIR/pipeline/run.ts" "$PROJECT_DIR/.pipeline/run.ts" ".pipeline/run.ts"
  diff_file "$FRAMEWORK_DIR/pipeline/worker.ts" "$PROJECT_DIR/.pipeline/worker.ts" ".pipeline/worker.ts"
  diff_file "$FRAMEWORK_DIR/pipeline/package.json" "$PROJECT_DIR/.pipeline/package.json" ".pipeline/package.json"
  for f in "$FRAMEWORK_DIR/pipeline/lib/"*.ts; do
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.pipeline/lib/$fname" ".pipeline/lib/$fname"
  done
  # Check for removed files
  if [ -f "$PROJECT_DIR/.pipeline/send-event.sh" ]; then
    echo "  - .pipeline/send-event.sh (replaced by SDK hooks)"
    CHANGES=$((CHANGES + 1))
  fi
  if [ -f "$PROJECT_DIR/.claude/scripts/devboard-hook.sh" ]; then
    echo "  - .claude/scripts/devboard-hook.sh (replaced by SDK hooks)"
    CHANGES=$((CHANGES + 1))
  fi
  if [ -f "$PROJECT_DIR/.pipeline/lib/mcp-tools.ts" ]; then
    echo "  - .pipeline/lib/mcp-tools.ts (removed — non-functional in SDK mode)"
    CHANGES=$((CHANGES + 1))
  fi

  # Skills (framework skills only — project-specific skills are never touched)
  for f in "$FRAMEWORK_DIR/skills/"*.md; do
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/skills/$fname" ".claude/skills/$fname"
  done

  # Check for removed skills (only framework-owned skills, not project-specific ones)
  REMOVED_SKILLS=(
    brainstorming.md dispatching-parallel-agents.md executing-plans.md
    finishing-a-development-branch.md receiving-code-review.md requesting-code-review.md
    subagent-driven-development.md systematic-debugging.md test-driven-development.md
    using-git-worktrees.md verification-before-completion.md writing-plans.md
  )
  for fname in "${REMOVED_SKILLS[@]}"; do
    if [ -f "$PROJECT_DIR/.claude/skills/$fname" ]; then
      echo "  - .claude/skills/$fname (replaced by superpowers plugin)"
      CHANGES=$((CHANGES + 1))
    fi
  done

  # Scripts
  for f in "$FRAMEWORK_DIR/.claude/scripts/"*; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/scripts/$fname" ".claude/scripts/$fname"
  done

  # Hooks
  for f in "$FRAMEWORK_DIR/.claude/hooks/"*.sh; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/hooks/$fname" ".claude/hooks/$fname"
  done

  # Settings
  diff_file "$FRAMEWORK_DIR/settings.json" "$PROJECT_DIR/.claude/settings.json" ".claude/settings.json"

  if [ "$CHANGES" -eq 0 ]; then
    echo "  Everything up to date."
    # Still update version marker so it stays in sync
    echo "$FRAMEWORK_VERSION" > "$VERSION_FILE"
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
  # Remove skills now provided by superpowers plugin
  for fname in "${REMOVED_SKILLS[@]}"; do
    if [ -f "$PROJECT_DIR/.claude/skills/$fname" ]; then
      rm "$PROJECT_DIR/.claude/skills/$fname"
      echo "  - $fname (replaced by superpowers plugin)"
    fi
  done
  cp "$FRAMEWORK_DIR/skills/"*.md "$PROJECT_DIR/.claude/skills/"
  echo "  ✓ $(ls "$FRAMEWORK_DIR/skills/"*.md | wc -l | tr -d ' ') framework skills (project-specific skills untouched)"

  # Install superpowers plugin if not already installed
  echo "Checking superpowers plugin..."
  if claude plugin list 2>/dev/null | grep -q "superpowers"; then
    echo "  ✓ superpowers plugin already installed"
  else
    echo "  Installing superpowers plugin..."
    claude plugin marketplace add obra/superpowers-marketplace 2>/dev/null || true
    if claude plugin install superpowers@superpowers-marketplace --scope user 2>/dev/null; then
      echo "  ✓ superpowers plugin installed (user scope)"
    else
      echo "  ⚠ superpowers plugin install failed — install manually:"
      echo "    claude plugin marketplace add obra/superpowers-marketplace"
      echo "    claude plugin install superpowers@superpowers-marketplace --scope user"
    fi
  fi

  echo "Updating scripts..."
  mkdir -p "$PROJECT_DIR/.claude/scripts"
  cp "$FRAMEWORK_DIR/.claude/scripts/"* "$PROJECT_DIR/.claude/scripts/" 2>/dev/null || true
  chmod +x "$PROJECT_DIR/.claude/scripts/"*.sh 2>/dev/null || true
  chmod +x "$PROJECT_DIR/.claude/scripts/"*.py 2>/dev/null || true
  echo "  ✓ scripts"

  # Copy write-config.sh from framework root scripts/
  if [ -f "$FRAMEWORK_DIR/scripts/write-config.sh" ]; then
    cp "$FRAMEWORK_DIR/scripts/write-config.sh" "$PROJECT_DIR/.claude/scripts/write-config.sh"
    chmod +x "$PROJECT_DIR/.claude/scripts/write-config.sh"
    echo "  ✓ write-config.sh (shared config script)"
  fi

  echo "Updating hooks..."
  mkdir -p "$PROJECT_DIR/.claude/hooks"
  cp "$FRAMEWORK_DIR/.claude/hooks/"*.sh "$PROJECT_DIR/.claude/hooks/" 2>/dev/null || true
  chmod +x "$PROJECT_DIR/.claude/hooks/"*.sh 2>/dev/null || true
  echo "  ✓ hooks (event streaming)"

  echo "Updating pipeline..."
  # Copy all pipeline files
  cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
  cp "$FRAMEWORK_DIR/pipeline/run.ts" "$PROJECT_DIR/.pipeline/run.ts"
  cp "$FRAMEWORK_DIR/pipeline/worker.ts" "$PROJECT_DIR/.pipeline/worker.ts"
  cp "$FRAMEWORK_DIR/pipeline/package.json" "$PROJECT_DIR/.pipeline/package.json"
  cp "$FRAMEWORK_DIR/pipeline/tsconfig.json" "$PROJECT_DIR/.pipeline/tsconfig.json"
  mkdir -p "$PROJECT_DIR/.pipeline/lib"
  cp "$FRAMEWORK_DIR/pipeline/lib/"*.ts "$PROJECT_DIR/.pipeline/lib/"
  chmod +x "$PROJECT_DIR/.pipeline/"*.sh 2>/dev/null || true
  # Cleanup removed files
  rm -f "$PROJECT_DIR/.pipeline/send-event.sh"
  rm -f "$PROJECT_DIR/.pipeline/lib/mcp-tools.ts"
  rm -f "$PROJECT_DIR/.claude/scripts/devboard-hook.sh"
  # Install dependencies
  if [ -f "$PROJECT_DIR/.pipeline/package.json" ]; then
    echo "  Installing pipeline dependencies..."
    (cd "$PROJECT_DIR/.pipeline" && npm install --production 2>/dev/null)
  fi
  echo "  ✓ .pipeline/ (SDK pipeline)"

  echo "Updating settings..."
  cp "$FRAMEWORK_DIR/settings.json" "$PROJECT_DIR/.claude/settings.json"
  echo "  ✓ .claude/settings.json"

  # Write version
  echo "$FRAMEWORK_VERSION" > "$VERSION_FILE"

  # --- Check for old project.json format ---
  if [ -f "$PROJECT_DIR/project.json" ]; then
    JS_PJ="$PROJECT_DIR/project.json"
    HAS_OLD_KEY=$(JS_PJ="$JS_PJ" node -e "
      const c=JSON.parse(require('fs').readFileSync(process.env.JS_PJ,'utf-8'));
      console.log(c.pipeline?.api_key ? 'yes' : 'no');
    " 2>/dev/null || echo "no")

    if [ "$HAS_OLD_KEY" = "yes" ]; then
      echo ""
      echo "  ⚠  project.json contains api_key (deprecated format)"
      echo "     Run /connect-board in Claude Code to migrate"
      echo "     to ~/.just-ship/config.json"
    fi
  fi

  # --- Check if templates changed (CLAUDE.md, project.json structure) ---
  TEMPLATE_HASH_FILE="$PROJECT_DIR/.claude/.template-hash"
  CURRENT_TEMPLATE_HASH=""
  if command -v md5 &>/dev/null; then
    CURRENT_TEMPLATE_HASH=$(md5 -q "$FRAMEWORK_DIR/templates/CLAUDE.md" 2>/dev/null || echo "")
  elif command -v md5sum &>/dev/null; then
    CURRENT_TEMPLATE_HASH=$(md5sum "$FRAMEWORK_DIR/templates/CLAUDE.md" 2>/dev/null | cut -d' ' -f1)
  fi

  TEMPLATES_CHANGED=false
  if [ -n "$CURRENT_TEMPLATE_HASH" ]; then
    if [ -f "$TEMPLATE_HASH_FILE" ]; then
      STORED_HASH=$(cat "$TEMPLATE_HASH_FILE")
      if [ "$STORED_HASH" != "$CURRENT_TEMPLATE_HASH" ]; then
        TEMPLATES_CHANGED=true
      fi
    else
      # No hash stored yet — assume templates may have changed
      TEMPLATES_CHANGED=true
    fi
  fi

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
  if [ "$TEMPLATES_CHANGED" = true ]; then
    echo "  ⚠  Templates haben sich geändert!"
    echo "     Führe /update-just-ship in Claude Code aus,"
    echo "     um CLAUDE.md und project.json abzugleichen."
  else
    echo "  → Führe /update-just-ship in Claude Code aus,"
    echo "    um neue Config-Felder zu übernehmen."
  fi

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
echo "How do you want to work?"
echo "  1) CLI-only — just agents & pipeline, no board"
echo "  2) Connect to a board"
echo ""
read -p "  Choice (1/2): " SETUP_MODE
SETUP_MODE=${SETUP_MODE:-1}

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
mkdir -p "$PROJECT_DIR/.pipeline/lib"
cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
cp "$FRAMEWORK_DIR/pipeline/run.ts" "$PROJECT_DIR/.pipeline/run.ts"
cp "$FRAMEWORK_DIR/pipeline/worker.ts" "$PROJECT_DIR/.pipeline/worker.ts"
cp "$FRAMEWORK_DIR/pipeline/package.json" "$PROJECT_DIR/.pipeline/package.json"
cp "$FRAMEWORK_DIR/pipeline/tsconfig.json" "$PROJECT_DIR/.pipeline/tsconfig.json"
cp "$FRAMEWORK_DIR/pipeline/lib/"*.ts "$PROJECT_DIR/.pipeline/lib/"
chmod +x "$PROJECT_DIR/.pipeline/"*.sh 2>/dev/null || true
echo "  Installing pipeline dependencies..."
(cd "$PROJECT_DIR/.pipeline" && npm install --production 2>/dev/null)
echo "  ✓ .pipeline/ (SDK pipeline)"

# --- Copy skills ---
echo "Installing skills..."
mkdir -p "$PROJECT_DIR/.claude/skills"
cp "$FRAMEWORK_DIR/skills/"*.md "$PROJECT_DIR/.claude/skills/"
echo "  ✓ $(ls "$FRAMEWORK_DIR/skills/"*.md | wc -l | tr -d ' ') pipeline skills"

# --- Install superpowers plugin ---
echo "Installing superpowers plugin..."
claude plugin marketplace add obra/superpowers-marketplace 2>/dev/null || true
if claude plugin install superpowers@superpowers-marketplace --scope user 2>/dev/null; then
  echo "  ✓ superpowers plugin (TDD, debugging, code review, planning)"
else
  echo "  ⚠ superpowers plugin install failed — install manually:"
  echo "    claude plugin marketplace add obra/superpowers-marketplace"
  echo "    claude plugin install superpowers@superpowers-marketplace --scope user"
fi

# --- Copy scripts ---
echo "Installing scripts..."
mkdir -p "$PROJECT_DIR/.claude/scripts"
cp "$FRAMEWORK_DIR/.claude/scripts/"* "$PROJECT_DIR/.claude/scripts/" 2>/dev/null || true
chmod +x "$PROJECT_DIR/.claude/scripts/"*.sh 2>/dev/null || true
chmod +x "$PROJECT_DIR/.claude/scripts/"*.py 2>/dev/null || true
echo "  ✓ scripts"

# --- Copy hooks ---
echo "Installing hooks..."
mkdir -p "$PROJECT_DIR/.claude/hooks"
cp "$FRAMEWORK_DIR/.claude/hooks/"*.sh "$PROJECT_DIR/.claude/hooks/" 2>/dev/null || true
chmod +x "$PROJECT_DIR/.claude/hooks/"*.sh 2>/dev/null || true
echo "  ✓ hooks (event streaming)"

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
    "workspace": "",
    "project_id": "",
    "project_name": null
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

# --- Copy write-config.sh ---
cp "$FRAMEWORK_DIR/scripts/write-config.sh" "$PROJECT_DIR/.claude/scripts/write-config.sh"
chmod +x "$PROJECT_DIR/.claude/scripts/write-config.sh"
echo "  ✓ write-config.sh (shared config script)"

# --- Board connection ---
if [ "$SETUP_MODE" = "2" ]; then
  echo ""
  echo "Board connection:"
  echo ""
  echo "  Paste the connect command from your board,"
  echo "  or press Enter for manual setup:"
  echo ""
  read -p "  > " CONNECT_CMD

  if [ -n "$CONNECT_CMD" ]; then
    # Parse paste-friendly command: /connect-board --board X --workspace Y --workspace-id Z --key K [--project P]
    BOARD_URL="" WS_SLUG="" WS_ID="" API_KEY="" PROJECT_ID=""
    # Strip leading /connect-board if present
    CONNECT_CMD="${CONNECT_CMD#/connect-board }"
    # Parse flags from the pasted string
    set -- $CONNECT_CMD
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --board) BOARD_URL="$2"; shift 2 ;;
        --workspace) WS_SLUG="$2"; shift 2 ;;
        --workspace-id) WS_ID="$2"; shift 2 ;;
        --key) API_KEY="$2"; shift 2 ;;
        --project) PROJECT_ID="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
  else
    # Manual entry
    read -p "  Board URL (default: https://board.just-ship.io): " BOARD_URL
    BOARD_URL=${BOARD_URL:-"https://board.just-ship.io"}
    read -p "  Workspace slug: " WS_SLUG
    read -p "  Workspace ID: " WS_ID
    read -p "  API Key: " API_KEY
    read -p "  Project ID (optional): " PROJECT_ID
  fi

  if [ -n "$BOARD_URL" ] && [ -n "$WS_SLUG" ] && [ -n "$WS_ID" ] && [ -n "$API_KEY" ]; then
    "$FRAMEWORK_DIR/scripts/write-config.sh" add-workspace \
      --slug "$WS_SLUG" --board "$BOARD_URL" --workspace-id "$WS_ID" --key "$API_KEY"

    if [ -n "$PROJECT_ID" ]; then
      "$FRAMEWORK_DIR/scripts/write-config.sh" set-project \
        --workspace "$WS_SLUG" --project-id "$PROJECT_ID" --project-name "$PROJECT_NAME" \
        --project-dir "$PROJECT_DIR"
    fi
  else
    echo "  ⚠ Incomplete board info — skipping. Run /connect-board later."
  fi
else
  echo ""
  echo "  ✓ CLI-only mode — run /connect-board anytime to add a board"
fi

# --- Write version + template hash ---
echo "$FRAMEWORK_VERSION" > "$VERSION_FILE"
if command -v md5 &>/dev/null; then
  md5 -q "$FRAMEWORK_DIR/templates/CLAUDE.md" > "$PROJECT_DIR/.claude/.template-hash" 2>/dev/null || true
elif command -v md5sum &>/dev/null; then
  md5sum "$FRAMEWORK_DIR/templates/CLAUDE.md" 2>/dev/null | cut -d' ' -f1 > "$PROJECT_DIR/.claude/.template-hash" || true
fi

echo ""
echo "================================================"
echo "  Setup complete → $FRAMEWORK_VERSION"
echo "================================================"
echo ""
echo "Next steps:"
echo "  1. Open a new Claude Code session"
echo "  2. Run /setup-just-ship (detects stack, fills project.json)"
if [ "$SETUP_MODE" = "2" ]; then
  echo "  ✓ Board already connected!"
else
  echo "  3. Run /connect-board to connect the Just Ship Board (optional)"
fi
echo ""
echo "Framework updaten:"
echo "  $(basename "$FRAMEWORK_DIR")/setup.sh --update"
echo ""
