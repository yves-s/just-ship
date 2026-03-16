# Setup Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate workspace-level config (API key) from project-level config (project ID) with a global `~/.just-ship/config.json`, contextual Board UI, and CLI commands for mode switching.

**Architecture:** A shared bash script (`scripts/write-config.sh`) handles all config I/O. The pipeline runtime resolves keys at startup from global config → project.json fallback chain. The Board UI uses a query param (`?setup=workspace`) to distinguish workspace setup from project connection dialogs.

**Tech Stack:** Bash (setup.sh, write-config.sh), TypeScript (pipeline runtime), React/Next.js (Board UI)

**Spec:** `docs/superpowers/specs/2026-03-15-setup-flow-redesign.md`

---

## Chunk 1: Shared Config Script + Pipeline Runtime

This chunk creates the foundation — the shared config script and updated pipeline runtime that reads from `~/.just-ship/config.json`.

### Task 1: Create `scripts/write-config.sh`

**Files:**
- Create: `scripts/write-config.sh`

This is the shared script that both `setup.sh` and Claude Code slash commands use to write/read `~/.just-ship/config.json` and update `project.json`.

**Important:** After installation, this script lives at `$PROJECT_DIR/.claude/scripts/write-config.sh`. All slash commands should locate it via the project's `.claude/scripts/` directory, NOT via `$FRAMEWORK_DIR`.

**Security:** All `node -e` invocations pass values via environment variables to avoid shell injection (no bare interpolation of user input into JS strings).

- [ ] **Step 1: Create the script with config read/write functions**

```bash
#!/bin/bash
# scripts/write-config.sh — Shared config I/O for Just Ship
#
# Usage:
#   write-config.sh add-workspace \
#     --slug <slug> --board <url> --workspace-id <id> --key <api_key>
#
#   write-config.sh set-project \
#     --workspace <slug> --project-id <id> [--project-name <name>]
#
#   write-config.sh read-workspace --slug <slug>
#
#   write-config.sh remove-board --slug <slug>
#
#   write-config.sh migrate --project-dir <dir> --slug <slug>

set -euo pipefail

CONFIG_DIR="${HOME}/.just-ship"
CONFIG_FILE="${CONFIG_DIR}/config.json"

ensure_config_dir() {
  if [ ! -d "$CONFIG_DIR" ]; then
    mkdir -p "$CONFIG_DIR"
    chmod 700 "$CONFIG_DIR"
  fi
}

ensure_config_file() {
  ensure_config_dir
  if [ ! -f "$CONFIG_FILE" ]; then
    echo '{"workspaces":{},"default_workspace":null}' > "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
  fi
}

# Add or update a workspace entry in config.json
cmd_add_workspace() {
  local slug="" board="" workspace_id="" key=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slug) slug="$2"; shift 2 ;;
      --board) board="$2"; shift 2 ;;
      --workspace-id) workspace_id="$2"; shift 2 ;;
      --key) key="$2"; shift 2 ;;
      *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
  done

  if [ -z "$slug" ] || [ -z "$board" ] || [ -z "$workspace_id" ] || [ -z "$key" ]; then
    echo "Error: --slug, --board, --workspace-id, and --key are required" >&2
    exit 1
  fi

  ensure_config_file

  # Check for slug collision (same slug, different board)
  local existing_board
  existing_board=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'));
    const ws = c.workspaces?.['$slug'];
    if (ws && ws.board_url) console.log(ws.board_url);
  " 2>/dev/null || echo "")

  if [ -n "$existing_board" ] && [ "$existing_board" != "$board" ]; then
    echo "WARNING: Workspace '$slug' already exists for a different board ($existing_board)." >&2
    echo "Choose a different local name, e.g. '${slug}-2'" >&2
    exit 1
  fi

  # Write workspace entry
  node -e "
    const fs = require('fs');
    const c = JSON.parse(fs.readFileSync('$CONFIG_FILE','utf-8'));
    c.workspaces = c.workspaces || {};
    c.workspaces['$slug'] = {
      board_url: '$board',
      workspace_id: '$workspace_id',
      api_key: '$key'
    };
    // Auto-set default if first workspace
    const wsCount = Object.keys(c.workspaces).length;
    if (wsCount === 1 || !c.default_workspace) {
      c.default_workspace = '$slug';
    }
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(c, null, 2) + '\n');
  "
  chmod 600 "$CONFIG_FILE"

  echo "✓ Workspace '$slug' added to $CONFIG_FILE"
}

# Set project reference in project.json
cmd_set_project() {
  local workspace="" project_id="" project_name="" project_dir="."
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace) workspace="$2"; shift 2 ;;
      --project-id) project_id="$2"; shift 2 ;;
      --project-name) project_name="$2"; shift 2 ;;
      --project-dir) project_dir="$2"; shift 2 ;;
      *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
  done

  if [ -z "$workspace" ] || [ -z "$project_id" ]; then
    echo "Error: --workspace and --project-id are required" >&2
    exit 1
  fi

  local pj="$project_dir/project.json"
  if [ ! -f "$pj" ]; then
    echo "Error: $pj not found" >&2
    exit 1
  fi

  node -e "
    const fs = require('fs');
    const c = JSON.parse(fs.readFileSync('$pj','utf-8'));
    c.pipeline = c.pipeline || {};
    c.pipeline.workspace = '$workspace';
    c.pipeline.project_id = '$project_id';
    if ('$project_name') c.pipeline.project_name = '$project_name';
    // Remove old fields if present
    delete c.pipeline.api_key;
    delete c.pipeline.api_url;
    delete c.pipeline.workspace_id;
    fs.writeFileSync('$pj', JSON.stringify(c, null, 2) + '\n');
  "

  echo "✓ project.json updated (workspace: '$workspace', project_id: '$project_id')"
}

# Read workspace config (returns JSON to stdout)
cmd_read_workspace() {
  local slug=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slug) slug="$2"; shift 2 ;;
      *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
  done

  if [ ! -f "$CONFIG_FILE" ]; then
    echo "{}"
    return
  fi

  node -e "
    const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'));
    const ws = c.workspaces?.['$slug'] || {};
    console.log(JSON.stringify(ws));
  "
}

# Remove board connection (keep workspace slug)
cmd_remove_board() {
  local slug=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slug) slug="$2"; shift 2 ;;
      *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
  done

  if [ ! -f "$CONFIG_FILE" ]; then
    echo "No config file found." >&2
    return
  fi

  node -e "
    const fs = require('fs');
    const c = JSON.parse(fs.readFileSync('$CONFIG_FILE','utf-8'));
    if (c.workspaces?.['$slug']) {
      delete c.workspaces['$slug'].board_url;
      delete c.workspaces['$slug'].api_key;
    }
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(c, null, 2) + '\n');
  "
  chmod 600 "$CONFIG_FILE"

  echo "✓ Board connection removed for '$slug'"
}

# Migrate old project.json format to global config
cmd_migrate() {
  local project_dir="." slug=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project-dir) project_dir="$2"; shift 2 ;;
      --slug) slug="$2"; shift 2 ;;
      *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
  done

  local pj="$project_dir/project.json"
  if [ ! -f "$pj" ]; then
    echo "Error: $pj not found" >&2
    exit 1
  fi

  # Extract old values
  local api_key api_url workspace_id project_id project_name
  api_key=$(node -e "const c=JSON.parse(require('fs').readFileSync('$pj','utf-8'));console.log(c.pipeline?.api_key||'')" 2>/dev/null)
  api_url=$(node -e "const c=JSON.parse(require('fs').readFileSync('$pj','utf-8'));console.log(c.pipeline?.api_url||'')" 2>/dev/null)
  workspace_id=$(node -e "const c=JSON.parse(require('fs').readFileSync('$pj','utf-8'));console.log(c.pipeline?.workspace_id||'')" 2>/dev/null)
  project_id=$(node -e "const c=JSON.parse(require('fs').readFileSync('$pj','utf-8'));console.log(c.pipeline?.project_id||'')" 2>/dev/null)
  project_name=$(node -e "const c=JSON.parse(require('fs').readFileSync('$pj','utf-8'));console.log(c.pipeline?.project_name||'')" 2>/dev/null)

  if [ -z "$api_key" ]; then
    echo "No api_key found in project.json — nothing to migrate." >&2
    return
  fi

  if [ -z "$slug" ]; then
    # Suggest slug from project_name
    if [ -n "$project_name" ]; then
      slug=$(echo "$project_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-\|-$//g')
    else
      slug="workspace"
    fi
    echo "Suggested workspace slug: $slug"
  fi

  # Write to global config
  cmd_add_workspace --slug "$slug" --board "${api_url}" --workspace-id "${workspace_id}" --key "${api_key}"

  # Update project.json to new format
  cmd_set_project --workspace "$slug" --project-id "${project_id}" --project-name "${project_name}" --project-dir "$project_dir"

  echo "✓ Migration complete"
}

# --- Main dispatcher ---
COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  add-workspace) cmd_add_workspace "$@" ;;
  set-project)   cmd_set_project "$@" ;;
  read-workspace) cmd_read_workspace "$@" ;;
  remove-board)  cmd_remove_board "$@" ;;
  migrate)       cmd_migrate "$@" ;;
  *)
    echo "Usage: write-config.sh <command> [flags]" >&2
    echo "Commands: add-workspace, set-project, read-workspace, remove-board, migrate" >&2
    exit 1
    ;;
esac
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x scripts/write-config.sh`

- [ ] **Step 3: Verify the script runs without errors**

Run: `bash scripts/write-config.sh --help 2>&1 || true`
Expected: Usage message (exits with 1)

- [ ] **Step 4: Commit**

```bash
git add scripts/write-config.sh
git commit -m "feat: add shared config script for ~/.just-ship/config.json"
```

---

### Task 2: Update pipeline config resolution (`pipeline/lib/config.ts`)

**Files:**
- Modify: `pipeline/lib/config.ts`

Add the global config resolution logic with backwards compatibility.

- [ ] **Step 1: Add global config types and reader**

Add these types and the `loadGlobalConfig` function at the top of `config.ts`, after the existing imports:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

// --- Global config (~/.just-ship/config.json) ---
interface WorkspaceEntry {
  board_url?: string;
  workspace_id?: string;
  api_key?: string;
}

interface GlobalConfig {
  workspaces: Record<string, WorkspaceEntry>;
  default_workspace: string | null;
}

function loadGlobalConfig(): GlobalConfig | null {
  const configPath = join(homedir(), ".just-ship", "config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update `loadProjectConfig` to resolve from global config**

Replace the existing `loadProjectConfig` function body with the new resolution chain:

```typescript
export function loadProjectConfig(projectDir: string): ProjectConfig {
  const configPath = resolve(projectDir, "project.json");
  if (!existsSync(configPath)) {
    return {
      name: "project",
      description: "",
      conventions: { branch_prefix: "feature/" },
      pipeline: { projectId: "", projectName: "", workspaceId: "", apiUrl: "", apiKey: "" },
    };
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));

  // --- Pipeline config resolution ---
  let pipeline: PipelineConfig;
  const rawPipeline = raw.pipeline ?? {};

  // Check for old format (api_key directly in project.json)
  if (rawPipeline.api_key) {
    // Backwards compatibility: old format still works
    console.warn(
      "⚠ api_key in project.json is deprecated.\n" +
      "  Run /connect-board to migrate to ~/.just-ship/config.json"
    );

    // Try global config first (takes priority)
    const globalConfig = loadGlobalConfig();
    const workspaceSlug = rawPipeline.workspace;
    if (globalConfig && workspaceSlug && globalConfig.workspaces[workspaceSlug]) {
      const ws = globalConfig.workspaces[workspaceSlug];
      pipeline = {
        projectId: rawPipeline.project_id ?? "",
        projectName: rawPipeline.project_name ?? "",
        workspaceId: ws.workspace_id ?? rawPipeline.workspace_id ?? "",
        apiUrl: ws.board_url ?? rawPipeline.api_url ?? "",
        apiKey: ws.api_key ?? rawPipeline.api_key ?? "",
      };
    } else {
      // Fall back to old format
      pipeline = {
        projectId: rawPipeline.project_id ?? "",
        projectName: rawPipeline.project_name ?? "",
        workspaceId: rawPipeline.workspace_id ?? "",
        apiUrl: rawPipeline.api_url ?? "",
        apiKey: rawPipeline.api_key ?? "",
      };
    }
  } else if (rawPipeline.workspace) {
    // New format: resolve from global config
    const globalConfig = loadGlobalConfig();
    const slug = rawPipeline.workspace;

    if (!globalConfig) {
      // No global config = CLI-only mode
      pipeline = {
        projectId: rawPipeline.project_id ?? "",
        projectName: rawPipeline.project_name ?? "",
        workspaceId: "",
        apiUrl: "",
        apiKey: "",
      };
    } else {
      const ws = globalConfig.workspaces[slug];
      if (!ws) {
        // Explicit workspace slug not found — error, don't silently fall back
        console.error(
          `Workspace '${slug}' not found in ~/.just-ship/config.json.\n` +
          `Run /connect-board to set it up.`
        );
        pipeline = {
          projectId: rawPipeline.project_id ?? "",
          projectName: rawPipeline.project_name ?? "",
          workspaceId: "",
          apiUrl: "",
          apiKey: "",
        };
      } else {
        pipeline = {
          projectId: rawPipeline.project_id ?? "",
          projectName: rawPipeline.project_name ?? "",
          workspaceId: ws.workspace_id ?? "",
          apiUrl: ws.board_url ?? "",
          apiKey: ws.api_key ?? "",
        };
      }
    }
  } else {
    // No pipeline config at all — check for default workspace
    const globalConfig = loadGlobalConfig();
    const defaultSlug = globalConfig?.default_workspace;
    const defaultWs = defaultSlug ? globalConfig?.workspaces[defaultSlug] : undefined;

    pipeline = {
      projectId: rawPipeline.project_id ?? "",
      projectName: rawPipeline.project_name ?? "",
      workspaceId: defaultWs?.workspace_id ?? "",
      apiUrl: defaultWs?.board_url ?? "",
      apiKey: defaultWs?.api_key ?? "",
    };
  }

  return {
    name: raw.name ?? "project",
    description: raw.description ?? "",
    conventions: { branch_prefix: raw.conventions?.branch_prefix ?? "feature/" },
    pipeline,
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/agentic-dev-pipeline/pipeline && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/config.ts
git commit -m "feat: resolve pipeline config from ~/.just-ship/config.json with fallback"
```

---

## Chunk 2: CLI Commands + setup.sh Changes

### Task 3: Create `/connect-board` command

**Files:**
- Create: `commands/connect-board.md`

- [ ] **Step 1: Write the command definition**

```markdown
---
name: connect-board
description: Board-Verbindung hinzufügen oder ändern — Workspace + API Key in globale Config schreiben
---

# /connect-board — Board verbinden

Verbindet einen Workspace mit dem Just Ship Board. Schreibt Workspace-Daten in `~/.just-ship/config.json`.

## Argumente

| Flag | Beschreibung | Pflicht |
|---|---|---|
| `--board` | Board URL (z.B. `https://board.just-ship.io`) | Ja |
| `--workspace` | Workspace Slug | Ja |
| `--workspace-id` | Workspace UUID | Ja |
| `--key` | API Key (`adp_...`) | Ja |
| `--project` | Projekt UUID (optional — setzt direkt auch das Projekt) | Nein |

## Ausführung

### Modus 1: Alle Flags vorhanden

Wenn alle Pflicht-Flags übergeben wurden:

1. Schreibe Workspace-Eintrag via `scripts/write-config.sh`:
   ```bash
   ".claude/scripts/write-config.sh" add-workspace \
     --slug <workspace> --board <board> --workspace-id <workspace-id> --key <key>
   ```
   The script is located at `.claude/scripts/write-config.sh` relative to the project root.

2. Falls `--project` übergeben:
   ```bash
   ".claude/scripts/write-config.sh" set-project \
     --workspace <workspace> --project-id <project>
   ```

3. Bestätigung ausgeben:
   ```
   ✓ Workspace '<workspace>' connected to <board>
   ✓ Config written to ~/.just-ship/config.json
   ```

### Modus 2: Interaktiv (keine oder unvollständige Flags)

Frage nacheinander:
1. Board URL (Default: `https://board.just-ship.io`)
2. Workspace Slug
3. Workspace ID
4. API Key

Dann wie Modus 1 ausführen.

### Migration erkennen

Falls `project.json` noch ein `api_key` Feld hat:
```
Bestehender api_key in project.json gefunden.
In globale Config migrieren? (J/n)
```

Falls ja, rufe auf:
```bash
".claude/scripts/write-config.sh" migrate \
  --project-dir . --slug <workspace-slug>
```

### Validierung

Nach dem Schreiben: Prüfe die Verbindung via curl:
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Pipeline-Key: <key>" "<board>/api/projects"
```
- 200: `✓ Board connection verified`
- 401: `⚠ API Key rejected — check the key in Board Settings`
- Andere: `⚠ Board not reachable — check the URL`
```

- [ ] **Step 2: Commit**

```bash
git add commands/connect-board.md
git commit -m "feat: add /connect-board command for board connection management"
```

---

### Task 4: Create `/add-project` command

**Files:**
- Create: `commands/add-project.md`

- [ ] **Step 1: Write the command definition**

```markdown
---
name: add-project
description: Neues Projekt im aktuellen Workspace verknüpfen — nur Projekt-ID in project.json schreiben
---

# /add-project — Projekt verknüpfen

Verknüpft ein neues Board-Projekt mit dem lokalen Projekt. Schreibt nur `workspace` + `project_id` in `project.json`. Kein API Key nötig — der Workspace muss bereits verbunden sein.

## Argumente

| Flag | Beschreibung | Pflicht |
|---|---|---|
| `--project` | Projekt UUID vom Board | Ja |
| `--name` | Projektname (optional, für Lesbarkeit) | Nein |

## Ausführung

1. Prüfe ob ein Workspace konfiguriert ist:
   - Lies `project.json` → `pipeline.workspace`
   - Falls nicht vorhanden: Lies `~/.just-ship/config.json` → `default_workspace`
   - Falls beides fehlt: Fehler: "Kein Workspace konfiguriert. Führe zuerst /connect-board aus."

2. Schreibe Projekt-Referenz:
   ```bash
   ".claude/scripts/write-config.sh" set-project \
     --workspace <workspace> --project-id <project> [--project-name <name>]
   ```

3. Bestätigung:
   ```
   ✓ Projekt '<project-id>' verknüpft mit Workspace '<workspace>'
   ✓ project.json aktualisiert
   ```
```

- [ ] **Step 2: Commit**

```bash
git add commands/add-project.md
git commit -m "feat: add /add-project command for project connection"
```

---

### Task 5: Create `/disconnect-board` command

**Files:**
- Create: `commands/disconnect-board.md`

- [ ] **Step 1: Write the command definition**

```markdown
---
name: disconnect-board
description: Board-Verbindung entfernen — zurück zu CLI-only
---

# /disconnect-board — Board-Verbindung entfernen

Entfernt die Board-Anbindung für den aktuellen Workspace. Die Pipeline läuft danach im CLI-only Modus (keine Events, keine Status-Updates).

## Ausführung

1. Lese aktuellen Workspace aus `project.json` → `pipeline.workspace`
2. Falls nicht gesetzt: Fehler: "Kein Workspace konfiguriert."
3. Entferne Board-Verbindung:
   ```bash
   ".claude/scripts/write-config.sh" remove-board --slug <workspace>
   ```
4. Bestätigung:
   ```
   ✓ Board-Verbindung für '<workspace>' entfernt
   ✓ Pipeline läuft jetzt im CLI-only Modus
   ```

**Hinweis:** `project.json` wird nicht verändert — der `workspace` Verweis bleibt bestehen, damit ein erneutes `/connect-board` den Workspace wiederherstellen kann.
```

- [ ] **Step 2: Commit**

```bash
git add commands/disconnect-board.md
git commit -m "feat: add /disconnect-board command"
```

---

### Task 6: Simplify `/setup-just-ship` command

**Files:**
- Modify: `commands/setup-just-ship.md`

- [ ] **Step 1: Remove board connection logic from setup-just-ship**

Remove the entire "### 4. Dev Board verbinden (optional)" section (lines 125-224 in the current file). This includes:
- Modus 1: Direct Connect
- Modus 2: Interaktiv
- Pipeline-Config in project.json schreiben
- Sicherheitscheck

Replace with a simple note:

```markdown
### 4. Board verbinden (Hinweis)

Falls `pipeline.workspace` in `project.json` nicht gesetzt ist:
```
Board noch nicht verbunden.
Führe /connect-board aus um das Just Ship Board zu verknüpfen.
```
```

Also update the `project.json` schema in section "### 2. project.json befüllen" to use the new format:

```json
"pipeline": {
  "workspace": "<workspace-slug oder leer>",
  "project_id": "<projekt-id oder leer>",
  "project_name": "<projektname>"
}
```

Remove `api_key`, `api_url`, and `workspace_id` from the schema.

- [ ] **Step 2: Commit**

```bash
git add commands/setup-just-ship.md
git commit -m "refactor: simplify /setup-just-ship — remove board connection (now in /connect-board)"
```

---

### Task 7: Update `setup.sh`

**Files:**
- Modify: `setup.sh`

- [ ] **Step 1: Update setup mode — add mode selection and paste-friendly connect**

In the SETUP MODE section (starting at line 452), add mode selection after the project name/description prompts. Replace the current flow with:

After line 471 (`PROJECT_DESC=${PROJECT_DESC:-""}`), add:

```bash
echo ""
echo "How do you want to work?"
echo "  1) CLI-only — just agents & pipeline, no board"
echo "  2) Connect to a board"
echo ""
read -p "  Choice (1/2): " SETUP_MODE
SETUP_MODE=${SETUP_MODE:-1}
```

- [ ] **Step 2: Add board connection flow after file installation**

After the settings.json and CLAUDE.md generation (around line 590), add the board connection flow:

```bash
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
    while [[ $# -gt 0 || -n "$CONNECT_CMD" ]]; do
      # Parse flags from the pasted string
      set -- $CONNECT_CMD
      CONNECT_CMD=""
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
      break
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
```

- [ ] **Step 3: Remove project.json from .gitignore**

Replace the gitignore section (lines 565-572) that adds `project.json` to `.gitignore` with nothing — remove the `ensure_gitignore "project.json" "Pipeline config (contains API keys — do not commit)"` call entirely from both setup and update modes. Remove lines 420-426 (update mode) and 565-572 (setup mode).

- [ ] **Step 4: Update project.json template**

Replace the project.json generation (lines 536-558) with the new format:

```bash
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
```

- [ ] **Step 5: Update next steps output**

Replace the "Next steps" section (lines 605-614) with:

```bash
echo "Next steps:"
echo "  1. Open a new Claude Code session"
echo "  2. Run /setup-just-ship (detects stack, fills project.json)"
if [ "$SETUP_MODE" = "2" ]; then
  echo "  ✓ Board already connected!"
else
  echo "  3. Run /connect-board to connect the Just Ship Board (optional)"
fi
```

- [ ] **Step 6: Commit**

```bash
git add setup.sh
git commit -m "feat: add mode selection and board connect to setup.sh"
```

---

## Chunk 3: Board UI Changes

These changes are in the **board project** at `/Users/yschleich/Developer/agentic-dev-board`.

### Task 8: Add `?setup=workspace` to workspace creation redirect

**Files:**
- Modify: `/Users/yschleich/Developer/agentic-dev-board/src/app/new-workspace/page.tsx:97`

- [ ] **Step 1: Update the redirect URL**

Change line 97 from:
```typescript
router.push(`/${workspace.slug}/board`);
```
to:
```typescript
router.push(`/${workspace.slug}/board?setup=workspace`);
```

- [ ] **Step 2: Commit (in board repo)**

```bash
cd /Users/yschleich/Developer/agentic-dev-board
git add src/app/new-workspace/page.tsx
git commit -m "feat: add ?setup=workspace query param to workspace creation redirect"
```

---

### Task 9: Split `ProjectSetupDialog` into two dialogs

**Files:**
- Modify: `/Users/yschleich/Developer/agentic-dev-board/src/components/board/project-setup-dialog.tsx`

- [ ] **Step 1: Add a `variant` prop to control which dialog to show**

Add a `variant` prop and make `project` optional for workspace-setup variant:

```typescript
interface ProjectSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;  // CHANGED: optional for workspace-setup variant
  workspaceId: string;
  workspaceSlug: string;  // NEW
  boardUrl: string;
  apiKey: ApiKey | null;
  plaintextKey: string | null;
  apiKeyError: string | null;
  onRetryApiKey: () => Promise<void>;
  onRegenerateKey: () => Promise<string | null>;
  variant: "workspace-setup" | "project-connect";  // NEW
}
```

For `workspace-setup` variant, `project` is not needed (the dialog shows workspace-level info only). For `project-connect` variant, `project` is required (the dialog shows the project-specific command).

- [ ] **Step 2: Implement workspace-setup variant (Situation A)**

When `variant === "workspace-setup"`, show:
- Dialog title: "Connect your workspace"
- Full `/connect-board` command with all flags (board URL, workspace slug, workspace ID, API key)
- API key in plaintext + copy button
- Warning: "Save your API key — you won't see it again."
- Collapsible "First time?" section (existing)

The connect command format:
```typescript
const connectCommand = `/connect-board \\
  --board ${boardUrl} \\
  --workspace ${workspaceSlug} \\
  --workspace-id ${workspaceId} \\
  --key ${displayKey || "<loading...>"}`;
```

- [ ] **Step 3: Implement project-connect variant (Situation B)**

When `variant === "project-connect"`, show:
- Dialog title: `Connect "${project.name}"`
- Single `/add-project` command:
  ```typescript
  const addProjectCommand = `/add-project --project ${project.id}`;
  ```
- Project ID separately copyable
- No API key, no workspace info
- No "First time?" section, no manual JSON section

- [ ] **Step 4: Commit (in board repo)**

```bash
cd /Users/yschleich/Developer/agentic-dev-board
git add src/components/board/project-setup-dialog.tsx
git commit -m "feat: split setup dialog into workspace-setup and project-connect variants"
```

---

### Task 10: Update Board component to pass correct variant

**Files:**
- Modify: `/Users/yschleich/Developer/agentic-dev-board/src/components/board/board.tsx`

- [ ] **Step 1: Read `?setup=workspace` query param**

At the top of the Board component, add:

```typescript
import { useSearchParams, useRouter } from "next/navigation";

// Inside the component:
const searchParams = useSearchParams();
const router = useRouter();
const [setupVariant, setSetupVariant] = useState<"workspace-setup" | "project-connect">(
  searchParams.get("setup") === "workspace" ? "workspace-setup" : "project-connect"
);

// Clear the query param after reading it
useEffect(() => {
  if (searchParams.get("setup") === "workspace") {
    const url = new URL(window.location.href);
    url.searchParams.delete("setup");
    router.replace(url.pathname, { scroll: false });
  }
}, [searchParams, router]);
```

- [ ] **Step 2: Auto-open workspace setup dialog when param is present**

If `setupVariant === "workspace-setup"`, automatically open the setup dialog on mount (after API key is generated):

```typescript
useEffect(() => {
  if (setupVariant === "workspace-setup" && !setupProject) {
    // Create a placeholder project or open workspace setup without a project
    // The workspace setup dialog doesn't need a specific project
    setShowWorkspaceSetup(true);
  }
}, [setupVariant]);
```

- [ ] **Step 3: Pass variant and workspaceSlug to ProjectSetupDialog**

Update the `ProjectSetupDialog` usage to include the new props:
```typescript
<ProjectSetupDialog
  // ...existing props
  variant={setupVariant}
  workspaceSlug={workspaceSlug}  // from the URL path or workspace data
/>
```

After a project is created (not from workspace setup), always use `"project-connect"` variant.

- [ ] **Step 4: Commit (in board repo)**

```bash
cd /Users/yschleich/Developer/agentic-dev-board
git add src/components/board/board.tsx
git commit -m "feat: auto-detect workspace setup via query param and pass variant to dialog"
```

---

### Task 11: Update API key dialogs to reference `/connect-board`

**Files:**
- Modify: `/Users/yschleich/Developer/agentic-dev-board/src/components/board/project-setup-dialog.tsx` (regeneration dialog text)
- Modify: `/Users/yschleich/Developer/agentic-dev-board/src/components/settings/create-api-key-dialog.tsx`

- [ ] **Step 1: Update regeneration dialog text**

In `project-setup-dialog.tsx`, update the regeneration confirmation dialog (lines 294-306) to reference `/connect-board`:

Change:
```
Run /setup-just-ship --board ... --key <new-key> in each project
```
To:
```
Run /connect-board --key <new-key> in each project
```

- [ ] **Step 2: Update create-api-key-dialog**

In `create-api-key-dialog.tsx`, update any references to `/setup-just-ship` to use `/connect-board` instead.

- [ ] **Step 3: Commit (in board repo)**

```bash
cd /Users/yschleich/Developer/agentic-dev-board
git add src/components/board/project-setup-dialog.tsx src/components/settings/create-api-key-dialog.tsx
git commit -m "refactor: update API key dialogs to reference /connect-board"
```

---

### Task 12: Update projects settings view

**Files:**
- Modify: `/Users/yschleich/Developer/agentic-dev-board/src/components/settings/projects-settings-view.tsx`

- [ ] **Step 1: Pass variant="project-connect" when opening setup from settings**

When the "Connect" button is clicked in project settings, always use `"project-connect"` variant (not workspace setup). Ensure `workspaceSlug` is also passed.

- [ ] **Step 2: Commit (in board repo)**

```bash
cd /Users/yschleich/Developer/agentic-dev-board
git add src/components/settings/projects-settings-view.tsx
git commit -m "feat: pass project-connect variant to setup dialog from settings"
```

---

## Chunk 4: setup.sh Update Mode + Cleanup

### Task 13: Update `setup.sh` update mode for migration

**Files:**
- Modify: `setup.sh` (update mode section)

- [ ] **Step 1: Remove gitignore enforcement for project.json in update mode**

Remove lines 420-426 (the `ensure_gitignore` call and surrounding code in the update section).

- [ ] **Step 2: Add migration check to update mode**

After the "Checking .gitignore..." section in update mode, add:

```bash
# --- Check for old project.json format ---
if [ -f "$PROJECT_DIR/project.json" ]; then
  HAS_OLD_KEY=$(node -e "
    const c=JSON.parse(require('fs').readFileSync('$PROJECT_DIR/project.json','utf-8'));
    console.log(c.pipeline?.api_key ? 'yes' : 'no');
  " 2>/dev/null || echo "no")

  if [ "$HAS_OLD_KEY" = "yes" ]; then
    echo ""
    echo "  ⚠  project.json contains api_key (deprecated format)"
    echo "     Run /connect-board in Claude Code to migrate"
    echo "     to ~/.just-ship/config.json"
  fi
fi
```

- [ ] **Step 3: Copy write-config.sh during updates**

In the update section, add copying of `scripts/write-config.sh` alongside other file copies. Add after the scripts section:

```bash
# Copy write-config.sh
if [ -f "$FRAMEWORK_DIR/scripts/write-config.sh" ]; then
  mkdir -p "$PROJECT_DIR/.claude/scripts"
  cp "$FRAMEWORK_DIR/scripts/write-config.sh" "$PROJECT_DIR/.claude/scripts/write-config.sh"
  chmod +x "$PROJECT_DIR/.claude/scripts/write-config.sh"
fi
```

- [ ] **Step 4: Commit**

```bash
git add setup.sh
git commit -m "chore: update mode migration check and remove project.json gitignore"
```

---

### Task 14: Ensure `scripts/write-config.sh` is copied during setup

**Files:**
- Modify: `setup.sh` (setup mode section)

- [ ] **Step 1: Add copy of write-config.sh to setup mode**

In the "Installing scripts..." section (around line 517), the existing `cp "$FRAMEWORK_DIR/.claude/scripts/"*` should already pick up scripts from `.claude/scripts/`. But `write-config.sh` lives in `scripts/` (root level). Add explicit copy:

```bash
# Copy shared config script
cp "$FRAMEWORK_DIR/scripts/write-config.sh" "$PROJECT_DIR/.claude/scripts/write-config.sh"
chmod +x "$PROJECT_DIR/.claude/scripts/write-config.sh"
echo "  ✓ write-config.sh (shared config script)"
```

- [ ] **Step 2: Commit**

```bash
git add setup.sh
git commit -m "chore: copy write-config.sh during initial setup"
```

---

### Task 15: Verify pipeline runtime needs no changes (`run.ts`, `worker.ts`)

**Files:**
- Verify: `pipeline/run.ts`
- Verify: `pipeline/worker.ts`

The spec lists these as affected, but since `loadProjectConfig()` in `config.ts` now handles all resolution, these files should work without changes.

- [ ] **Step 1: Verify `run.ts` event hook logic still works**

In `run.ts:50`, the check `config.pipeline.apiUrl && config.pipeline.apiKey` determines whether to send events. This still works because `loadProjectConfig` now returns empty strings for CLI-only mode (no events sent) and resolved values for Board mode (events sent). No changes needed.

- [ ] **Step 2: Verify `worker.ts` uses config indirectly**

`worker.ts` calls `executePipeline()` from `run.ts`, which calls `loadProjectConfig()`. The worker doesn't directly read `project.json`, so no changes needed.

- [ ] **Step 3: Add note to both files (optional)**

If desired, add a brief comment noting the config resolution flow. Not required.

---

### Task 16: Update VPS setup documentation

**Files:**
- Modify: `vps/setup-vps.sh` or `vps/README.md`

- [ ] **Step 1: Add config.json setup instructions**

Add a section to `vps/README.md` (or inline comments in `vps/setup-vps.sh`) documenting:

```markdown
## Global Config for Pipeline Worker

The pipeline worker resolves API keys from `~/.just-ship/config.json`.
Create this file for the service user:

```bash
sudo -u justship mkdir -p /home/justship/.just-ship
sudo -u justship tee /home/justship/.just-ship/config.json > /dev/null <<'EOF'
{
  "workspaces": {
    "my-workspace": {
      "board_url": "https://board.just-ship.io",
      "workspace_id": "<workspace-uuid>",
      "api_key": "<api-key>"
    }
  },
  "default_workspace": "my-workspace"
}
EOF
chmod 600 /home/justship/.just-ship/config.json
```

**Backwards compatibility:** Existing VPS setups with `api_key` in `project.json`
continue to work. Migration is optional but recommended.
```

- [ ] **Step 2: Commit**

```bash
git add vps/
git commit -m "docs: add ~/.just-ship/config.json setup instructions for VPS"
```
