#!/bin/bash
# =============================================================================
# setup.sh – Install or update Just Ship in a project
#
# Usage:
#   cd /path/to/your/project
#
#   # Initial setup (non-interactive, auto-detect)
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
#   .claude/skills/<name>.md  All framework skills (pipeline + superpowers)
#   .claude/scripts/*         Utility scripts (for skills)
#   .claude/hooks/*           Event streaming hooks (SessionStart, SubagentStart/Stop, SessionEnd)
#   .claude/settings.json     Permissions + hook configuration
#   .pipeline/*               Pipeline runner (TypeScript SDK)
#   .claude/.pipeline-version Version tracking
#   .claude/.template-hash    Template change detection
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
    --auto)    MODE="auto" ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: setup.sh [--update] [--auto] [--dry-run]"
      echo ""
      echo "  (no flags)   Non-interactive setup (default)"
      echo "  --auto       Alias for default (backward compat)"
      echo "  --update     Update framework files only"
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

# --- Helper: print Just Ship ASCII banner in blue ---
print_banner() {
  local blue='\033[1;34m'
  local reset='\033[0m'
  echo ""
  printf "${blue}     _ _   _ ____ _____   ____ _   _ ___ ____  ${reset}\n"
  printf "${blue}    | | | | / ___|_   _| / ___| | | |_ _|  _ \\ ${reset}\n"
  printf "${blue} _  | | | | \\___ \\ | |   \\___ \\ |_| || || |_) |${reset}\n"
  printf "${blue}| |_| | |_| |___) || |    ___) |  _  || ||  __/ ${reset}\n"
  printf "${blue} \\___/ \\___/|____/ |_|   |____/|_| |_|___|_|   ${reset}\n"
  echo ""
}

# --- Helper: print changelog between two commits ---
print_changelog() {
  local from_hash="$1"
  local to_hash="$2"

  if [ -z "$from_hash" ] || [ "$from_hash" = "unknown" ] || [ "$from_hash" = "local" ]; then
    return
  fi

  cd "$FRAMEWORK_DIR"

  # Verify from_hash exists in git history
  if ! git rev-parse "${from_hash}" &>/dev/null; then
    cd "$PROJECT_DIR"
    return
  fi

  # Collect feat: and fix: commits, strip conventional commit prefix
  # e.g. "feat(T-521): add foo" → "add foo" | "fix: bar" → "bar"
  local feats fixes
  feats=$(git log "${from_hash}..${to_hash}" --grep="^feat" --format="%h %s" 2>/dev/null \
    | sed 's/^\([a-f0-9]*\) feat\([^:]*\): /\1  /' \
    | sed 's/^/  - /' || true)
  fixes=$(git log "${from_hash}..${to_hash}" --grep="^fix" --format="%h %s" 2>/dev/null \
    | sed 's/^\([a-f0-9]*\) fix\([^:]*\): /\1  /' \
    | sed 's/^/  - /' || true)

  cd "$PROJECT_DIR"

  if [ -z "$feats" ] && [ -z "$fixes" ]; then
    return
  fi

  echo ""
  if [ -n "$feats" ]; then
    echo "Features:"
    echo "$feats"
    echo ""
  fi
  if [ -n "$fixes" ]; then
    echo "Fixes:"
    echo "$fixes"
    echo ""
  fi
}

# --- Helper: background spinner for long-running commands ---
spin() {
  local msg="$1"
  shift
  local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0

  # Print initial message
  printf "  %s %s" "${chars:0:1}" "$msg"

  # Start spinner in background
  (
    while true; do
      printf "\r  %s %s" "${chars:$i:1}" "$msg"
      i=$(( (i + 1) % ${#chars} ))
      sleep 0.1
    done
  ) &
  local spinner_pid=$!

  # Run the actual command, capture exit code
  "$@" > /dev/null 2>&1
  local exit_code=$?

  # Stop spinner and clear line
  kill "$spinner_pid" 2>/dev/null
  wait "$spinner_pid" 2>/dev/null
  printf "\r\033[K"

  return $exit_code
}

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

# --- Helper: enable Agent Teams feature flag in global Claude settings ---
enable_agent_teams() {
  local global_settings="$HOME/.claude/settings.json"

  mkdir -p "$HOME/.claude"

  local result
  result=$(SETTINGS_PATH="$global_settings" node -e "
    const fs = require('fs');
    const path = process.env.SETTINGS_PATH;
    let s = {};
    try { s = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch(e) {}
    if (s.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1') {
      console.log('exists');
    } else {
      if (!s.env) s.env = {};
      s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
      fs.writeFileSync(path, JSON.stringify(s, null, 2) + '\n');
      console.log('added');
    }
  " 2>/dev/null || echo "error")

  case "$result" in
    exists) echo "  ✓ Agent Teams already enabled" ;;
    added)  echo "  ✓ Agent Teams enabled (~/.claude/settings.json)" ;;
    *)      echo "  ⚠ Could not enable Agent Teams — add manually:"
            echo "    Set env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = \"1\" in ~/.claude/settings.json" ;;
  esac
}

# --- Helper: add Shopify AI Toolkit MCP server to a settings.json file ---
# Usage: add_shopify_mcp_server <settings_file_path>
add_shopify_mcp_server() {
  local settings_file="$1"
  local result
  result=$(SETTINGS_PATH="$settings_file" node -e "
    const fs = require('fs');
    const settingsPath = process.env.SETTINGS_PATH;
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch(e) {}
    if (!settings.mcpServers) settings.mcpServers = {};
    if (!settings.mcpServers['shopify-dev-mcp']) {
      settings.mcpServers['shopify-dev-mcp'] = {
        command: 'npx',
        args: ['-y', '@shopify/dev-mcp@latest']
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      console.log('added');
    } else {
      console.log('exists');
    }
  " 2>/dev/null || echo "error")

  case "$result" in
    added)  echo "  ✓ Shopify AI Toolkit MCP server added (.claude/settings.json)" ;;
    exists) echo "  ✓ Shopify AI Toolkit MCP server already configured" ;;
    *)      echo "  ⚠ Could not configure Shopify AI Toolkit MCP server — add manually:"
            echo "    Set mcpServers['shopify-dev-mcp'] in .claude/settings.json" ;;
  esac
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

# Shopify CLI check (optional — for any Shopify project)
if [ -f "$PROJECT_DIR/shopify.app.toml" ] || { [ -d "$PROJECT_DIR/sections" ] && [ -f "$PROJECT_DIR/layout/theme.liquid" ]; } || [ -f "$PROJECT_DIR/hydrogen.config.ts" ] || (grep -q '"@shopify/hydrogen"' "$PROJECT_DIR/package.json" 2>/dev/null); then
  echo ""
  echo "Shopify project detected:"
  check_prereq "shopify" || {
    echo "  ⚠ Shopify CLI recommended for Shopify development"
    echo "  Install: npm install -g @shopify/cli"
  }
fi

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
  INSTALLED_VERSION=""
  if [ -f "$VERSION_FILE" ]; then
    INSTALLED_VERSION=$(cat "$VERSION_FILE")
    echo "Installed: $INSTALLED_VERSION"
  else
    echo "Installed: unknown (no version file)"
  fi
  echo "Available: $FRAMEWORK_VERSION"

  # --- Changelog ---
  INSTALLED_HASH=$(echo "$INSTALLED_VERSION" | cut -d' ' -f1 2>/dev/null || echo "")
  AVAILABLE_HASH=$(echo "$FRAMEWORK_VERSION" | cut -d' ' -f1 2>/dev/null || echo "")
  print_changelog "$INSTALLED_HASH" "$AVAILABLE_HASH"

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
  # Skills are stored as skills/<name>/SKILL.md (plugin format) but copied as flat .md files
  for d in "$FRAMEWORK_DIR/skills/"*/; do
    [ -f "$d/SKILL.md" ] || continue
    dname=$(basename "$d")
    diff_file "$d/SKILL.md" "$PROJECT_DIR/.claude/skills/$dname.md" ".claude/skills/$dname.md"
  done

  # Rules
  for f in "$FRAMEWORK_DIR/.claude/rules/"*.md; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    diff_file "$f" "$PROJECT_DIR/.claude/rules/$fname" ".claude/rules/$fname"
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
  # Remove deprecated Shopify skills (replaced by Shopify AI Toolkit MCP server)
  for old_skill in shopify-admin-api shopify-apps shopify-app-scaffold shopify-checkout shopify-hydrogen shopify-liquid shopify-metafields shopify-storefront-api shopify-theme; do
    if [ -f "$PROJECT_DIR/.claude/skills/${old_skill}.md" ]; then
      rm "$PROJECT_DIR/.claude/skills/${old_skill}.md"
      echo "  - ${old_skill}.md removed (replaced by Shopify AI Toolkit)"
    fi
  done
  # Copy skills from subdirectory format (skills/<name>/SKILL.md) to flat format (<name>.md)
  skill_count=0
  for d in "$FRAMEWORK_DIR/skills/"*/; do
    [ -f "$d/SKILL.md" ] || continue
    dname=$(basename "$d")
    cp "$d/SKILL.md" "$PROJECT_DIR/.claude/skills/$dname.md"
    skill_count=$((skill_count + 1))
  done
  echo "  ✓ $skill_count framework skills (project-specific skills untouched)"

  echo "Updating rules..."
  mkdir -p "$PROJECT_DIR/.claude/rules"
  if [ -d "$PROJECT_DIR/.claude/rules" ]; then
    for f in "$PROJECT_DIR/.claude/rules/"*.md; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      if [ ! -f "$FRAMEWORK_DIR/.claude/rules/$fname" ]; then
        rm "$f"
        echo "  - $fname removed"
      fi
    done
  fi
  cp "$FRAMEWORK_DIR/.claude/rules/"*.md "$PROJECT_DIR/.claude/rules/" 2>/dev/null || true
  echo "  ✓ rules"

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
  mkdir -p "$PROJECT_DIR/.pipeline"
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
  ensure_gitignore ".pipeline/node_modules" "Pipeline dependencies (auto-installed)"
  echo "  ✓ .pipeline/ (SDK pipeline)"

  echo "Updating settings..."
  cp "$FRAMEWORK_DIR/settings.json" "$PROJECT_DIR/.claude/settings.json"
  echo "  ✓ .claude/settings.json"

  echo "Enabling Agent Teams..."
  enable_agent_teams

  # --- Add Shopify AI Toolkit MCP server for Shopify projects ---
  IS_SHOPIFY=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$PROJECT_DIR/project.json', 'utf-8'));
      console.log(c.stack?.platform === 'shopify' ? 'yes' : 'no');
    } catch(e) { console.log('no'); }
  " 2>/dev/null || echo "no")

  if [ "$IS_SHOPIFY" = "yes" ]; then
    # Remove deprecated Shopify skill references from project.json
    node -e "
      const fs = require('fs');
      const pjPath = '$PROJECT_DIR/project.json';
      try {
        const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
        const deprecated = ['shopify-admin-api', 'shopify-apps', 'shopify-app-scaffold', 'shopify-checkout', 'shopify-hydrogen', 'shopify-liquid', 'shopify-metafields', 'shopify-storefront-api', 'shopify-theme'];
        if (pj.skills?.domain?.length) {
          const cleaned = pj.skills.domain.filter(s => !deprecated.includes(s));
          if (cleaned.length !== pj.skills.domain.length) {
            pj.skills.domain = cleaned;
            fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n');
            console.log('cleaned');
          }
        }
      } catch(e) {}
    " 2>/dev/null

    add_shopify_mcp_server "$PROJECT_DIR/.claude/settings.json"
  fi

  # Write version
  echo "$FRAMEWORK_VERSION" > "$VERSION_FILE"

  # Sync plugin.json + marketplace.json versions from framework source
  if [ -f "$FRAMEWORK_DIR/.claude-plugin/plugin.json" ]; then
    PLUGIN_VERSION=$(JS_PLUGIN_SRC="$FRAMEWORK_DIR/.claude-plugin/plugin.json" node -e "
      try { process.stdout.write(JSON.parse(require('fs').readFileSync(process.env.JS_PLUGIN_SRC,'utf-8')).version || '1.0.0'); }
      catch(e) { process.stdout.write('1.0.0'); }
    " 2>/dev/null || echo "1.0.0")
    SYNCED=0
    for pf in "$PROJECT_DIR/.claude-plugin/plugin.json" "$PROJECT_DIR/.claude-plugin/marketplace.json"; do
      if [ -f "$pf" ]; then
        JS_PF="$pf" JS_VER="$PLUGIN_VERSION" node -e "
          const fs = require('fs');
          const c = JSON.parse(fs.readFileSync(process.env.JS_PF, 'utf-8'));
          const v = process.env.JS_VER;
          if (c.version !== undefined) c.version = v;
          if (c.metadata !== undefined) c.metadata.version = v;
          if (c.plugins && c.plugins[0]) c.plugins[0].version = v;
          fs.writeFileSync(process.env.JS_PF, JSON.stringify(c, null, 2) + '\n');
        " 2>/dev/null && SYNCED=$((SYNCED + 1))
      fi
    done
    if [ "$SYNCED" -gt 0 ]; then
      echo "  ✓ Plugin version synced ($PLUGIN_VERSION)"
    fi
  fi

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
      echo "     Führe 'just-ship connect' im Terminal aus um zu migrieren"
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
    if spin "Templates geändert — gleiche CLAUDE.md/project.json ab..." claude -p "/just-ship-update"; then
      echo "  ✓ CLAUDE.md/project.json abgeglichen"
    else
      echo "  ⚠ Template-Abgleich fehlgeschlagen"
    fi
  else
    echo "  Alles aktuell."
  fi

  # --- Auto-commit + push if git remote is configured ---
  if git -C "$PROJECT_DIR" rev-parse --git-dir &>/dev/null 2>&1; then
    REMOTE=$(git -C "$PROJECT_DIR" remote get-url origin 2>/dev/null || echo "")
    if [ -n "$REMOTE" ]; then
      echo ""
      echo "Committing update..."

      # Stage only framework-managed paths
      git -C "$PROJECT_DIR" add \
        ".claude/agents/" \
        ".claude/commands/" \
        ".claude/skills/" \
        ".claude/rules/" \
        ".claude/scripts/" \
        ".claude/hooks/" \
        ".claude/settings.json" \
        ".claude/.pipeline-version" \
        ".pipeline/" \
        2>/dev/null || true

      # Only commit if there's something staged
      if git -C "$PROJECT_DIR" diff --cached --quiet 2>/dev/null; then
        echo "  ~ Nothing to commit (already up to date)"
      else
        git -C "$PROJECT_DIR" commit -m "chore: update just-ship to $FRAMEWORK_VERSION" \
          2>/dev/null && echo "  ✓ Committed"

        echo "Pushing..."
        BRANCH=$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
        git -C "$PROJECT_DIR" push origin "$BRANCH" 2>/dev/null \
          && echo "  ✓ Pushed to origin/$BRANCH" \
          || echo "  ⚠ Push failed — run 'git push' manually"
      fi
    fi
  fi

  print_banner
  exit 0
fi

# =============================================================================
# SETUP MODE — Non-interactive, auto-detect everything
# =============================================================================

# --- Derive project name from directory ---
PROJECT_NAME=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-\|-$//g')
PROJECT_NAME=${PROJECT_NAME:-myproject}
PROJECT_DESC=""
OVERWRITE_CONFIG="N"

if [ "$MODE" = "auto" ]; then
  echo "Auto mode — project name: $PROJECT_NAME"
  echo ""
fi

if [ -f "project.json" ] && [ "$MODE" != "auto" ]; then
  echo "project.json already exists."
  read -p "Overwrite project.json? (y/N): " OVERWRITE_CONFIG
  OVERWRITE_CONFIG=${OVERWRITE_CONFIG:-N}
fi

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
ensure_gitignore ".pipeline/node_modules" "Pipeline dependencies (auto-installed)"
echo "  ✓ .pipeline/ (SDK pipeline)"

# --- Copy skills ---
echo "Installing skills..."
mkdir -p "$PROJECT_DIR/.claude/skills"
skill_count=0
for d in "$FRAMEWORK_DIR/skills/"*/; do
  [ -f "$d/SKILL.md" ] || continue
  dname=$(basename "$d")
  cp "$d/SKILL.md" "$PROJECT_DIR/.claude/skills/$dname.md"
  skill_count=$((skill_count + 1))
done
echo "  ✓ $skill_count pipeline skills"


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
    "web": "",
    "test": ""
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
  # project.json already exists — migrate missing fields from template
  MIGRATED=$(PJ_PATH="$PROJECT_DIR/project.json" TPL_PATH="$FRAMEWORK_DIR/templates/project.json" node -e "
    const fs = require('fs');
    const existing = JSON.parse(fs.readFileSync(process.env.PJ_PATH, 'utf-8'));
    const template = JSON.parse(fs.readFileSync(process.env.TPL_PATH, 'utf-8'));
    let changed = false;
    for (const [key, val] of Object.entries(template)) {
      if (!(key in existing)) {
        existing[key] = val;
        changed = true;
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val) && typeof existing[key] === 'object') {
        for (const [subKey, subVal] of Object.entries(val)) {
          if (!(subKey in existing[key])) {
            existing[key][subKey] = subVal;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      fs.writeFileSync(process.env.PJ_PATH, JSON.stringify(existing, null, 2) + '\n');
      process.stdout.write('yes');
    } else {
      process.stdout.write('no');
    }
  " 2>/dev/null || echo "no")
  if [ "$MIGRATED" = "yes" ]; then
    echo "  ✓ project.json migrated (missing fields added)"
  else
    echo "  ~ project.json (skipped)"
  fi
fi

# --- Generate settings.json ---
if [ ! -f "$PROJECT_DIR/.claude/settings.json" ]; then
  echo "Generating .claude/settings.json..."
  cp "$FRAMEWORK_DIR/settings.json" "$PROJECT_DIR/.claude/settings.json"
  echo "  ✓ .claude/settings.json"
else
  echo "  ~ .claude/settings.json (exists, skipped)"
fi

# --- Enable Agent Teams feature flag ---
echo "Enabling Agent Teams..."
enable_agent_teams

# --- Generate CLAUDE.md ---
if [ ! -f "$PROJECT_DIR/CLAUDE.md" ]; then
  echo "Generating CLAUDE.md..."
  sed "s/{{PROJECT_NAME}}/${PROJECT_NAME}/g" "$FRAMEWORK_DIR/templates/CLAUDE.md" > "$PROJECT_DIR/CLAUDE.md"
  echo "  ✓ CLAUDE.md (edit with your project specifics)"
else
  # Check if existing CLAUDE.md is incomplete (broken first install or very old version)
  CLAUDE_LINES=$(wc -l < "$PROJECT_DIR/CLAUDE.md" | tr -d ' ')
  HAS_KEY_SECTIONS=true
  grep -q "## Identity" "$PROJECT_DIR/CLAUDE.md" 2>/dev/null || HAS_KEY_SECTIONS=false
  grep -q "## Decision Authority" "$PROJECT_DIR/CLAUDE.md" 2>/dev/null || HAS_KEY_SECTIONS=false
  grep -q "## Organisation" "$PROJECT_DIR/CLAUDE.md" 2>/dev/null || HAS_KEY_SECTIONS=false

  if [ "$CLAUDE_LINES" -lt 50 ] || [ "$HAS_KEY_SECTIONS" = false ]; then
    echo "  Migrating CLAUDE.md ($CLAUDE_LINES lines → incomplete, regenerating from template)..."
    # Backup existing
    cp "$PROJECT_DIR/CLAUDE.md" "$PROJECT_DIR/CLAUDE.md.bak"
    # Generate fresh from template
    sed "s/{{PROJECT_NAME}}/${PROJECT_NAME}/g" "$FRAMEWORK_DIR/templates/CLAUDE.md" > "$PROJECT_DIR/CLAUDE.md"
    echo "  ✓ CLAUDE.md migrated (backup: CLAUDE.md.bak)"
  else
    echo "  ~ CLAUDE.md ($CLAUDE_LINES lines, all sections present)"
  fi
fi

# --- Copy write-config.sh ---
cp "$FRAMEWORK_DIR/scripts/write-config.sh" "$PROJECT_DIR/.claude/scripts/write-config.sh"
chmod +x "$PROJECT_DIR/.claude/scripts/write-config.sh"
echo "  ✓ write-config.sh (shared config script)"

# --- Write version + template hash ---
echo "$FRAMEWORK_VERSION" > "$VERSION_FILE"
if command -v md5 &>/dev/null; then
  md5 -q "$FRAMEWORK_DIR/templates/CLAUDE.md" > "$PROJECT_DIR/.claude/.template-hash" 2>/dev/null || true
elif command -v md5sum &>/dev/null; then
  md5sum "$FRAMEWORK_DIR/templates/CLAUDE.md" 2>/dev/null | cut -d' ' -f1 > "$PROJECT_DIR/.claude/.template-hash" || true
fi

# --- Shopify project detection ---
echo "Detecting project type..."
DETECT_RESULT=$("$FRAMEWORK_DIR/scripts/detect-shopify.sh" 2>/dev/null || echo '{"detected":false}')
SHOPIFY_DETECTED=$(echo "$DETECT_RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).detected))" 2>/dev/null || echo "false")

if [ "$SHOPIFY_DETECTED" = "true" ]; then
  SHOPIFY_VARIANT=$(echo "$DETECT_RESULT" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).variant)" 2>/dev/null)
  echo "  ✓ Shopify project detected: $SHOPIFY_VARIANT"

  # Merge detected values into project.json (only fill empty fields)
  node -e "
    const fs = require('fs');
    const pjPath = process.env.PJ_PATH;
    const detected = JSON.parse(process.env.DETECT_JSON);

    let pj = {};
    try { pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8')); } catch(e) {}

    // Only fill empty values
    if (!pj.stack) pj.stack = {};
    if (!pj.stack.platform) pj.stack.platform = 'shopify';
    if (!pj.stack.variant) pj.stack.variant = detected.variant;

    if (!pj.build) pj.build = {};
    if (!pj.build.dev) pj.build.dev = detected.build.dev || '';
    if (!pj.build.web) pj.build.web = detected.build.web || '';
    if (!pj.build.install) pj.build.install = detected.build.install || '';
    if (!pj.build.test) pj.build.test = detected.build.test || '';

    if (!pj.shopify) pj.shopify = {};
    if (!pj.shopify.store && detected.store) pj.shopify.store = detected.store;

    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n');
  " PJ_PATH="$PROJECT_DIR/project.json" DETECT_JSON="$DETECT_RESULT"
  echo "  ✓ project.json updated with Shopify config"

  # Add Shopify AI Toolkit MCP server to .claude/settings.json
  add_shopify_mcp_server "$PROJECT_DIR/.claude/settings.json"
else
  echo "  ~ No Shopify project detected"
fi

echo ""
echo "================================================"
echo "  Setup complete → $FRAMEWORK_VERSION"
echo "================================================"
echo ""

if [ "$SHOPIFY_DETECTED" = "true" ]; then
  VARIANT_LABEL=""
  case "$SHOPIFY_VARIANT" in
    remix)    VARIANT_LABEL="Shopify App (Remix)" ;;
    liquid)   VARIANT_LABEL="Shopify Theme" ;;
    hydrogen) VARIANT_LABEL="Hydrogen Storefront" ;;
  esac

  echo "Detected: $VARIANT_LABEL"
  echo "Platform config written to project.json."
  echo ""
  echo "Next steps:"

  case "$SHOPIFY_VARIANT" in
    remix)
      echo "  1. Verify shopify.store in project.json"
      echo "     (source: shopify.app.toml)"
      echo "  2. Run: npm install"
      echo "  3. Connect board: /add-project"
      echo "  4. Start: /develop [ticket-id]"
      [ ! -f "$PROJECT_DIR/.env" ] && echo "" && echo "  Note: Create .env with your Shopify app credentials before first run."
      ;;
    liquid)
      echo "  1. Verify shopify.store in project.json"
      echo "     (source: shopify.theme.toml)"
      echo "  2. Connect board: /add-project"
      echo "  3. Start: /develop [ticket-id]"
      ;;
    hydrogen)
      echo "  1. Set Shopify Storefront API credentials in .env"
      echo "  2. Run: npm install"
      echo "  3. Connect board: /add-project"
      echo "  4. Start: /develop [ticket-id]"
      ;;
  esac

  echo ""
  echo "Need help? Run: bash .claude/scripts/shopify-env-check.sh"
else
  echo "Nächster Schritt:"
  echo "  Öffne Claude Code und führe /init aus"
  echo "  (erkennt Stack, füllt project.json, generiert CLAUDE.md)"
  echo "  Danach optional: /connect-board (Board verbinden)"
fi
print_banner
