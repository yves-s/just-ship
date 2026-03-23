# Pipeline Config Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundancy from pipeline configuration — two UUIDs per project, one global board URL, secrets only in global config.

**Architecture:** `project.json` stores `workspace_id` + `project_id` (both UUIDs). Global `~/.just-ship/config.json` stores `board_url` once at top level, workspaces keyed by UUID with `slug` (metadata) and `api_key` (secret). All credential resolution goes through `write-config.sh read-workspace --id <uuid>`.

**Tech Stack:** Bash (write-config.sh, send-event.sh), TypeScript (pipeline/lib/config.ts), Markdown (commands, skills)

**Spec:** `docs/superpowers/specs/2026-03-23-pipeline-config-simplification-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `.claude/scripts/write-config.sh` | Modify | All commands: UUID keys, global board_url, new params |
| `scripts/write-config.sh` | Modify | Keep identical copy in sync |
| `.claude/scripts/send-event.sh` | Modify | Read workspace_id, lookup by UUID, board_url from top-level |
| `pipeline/lib/config.ts` | Modify | WorkspaceEntry interface, config resolution via UUID |
| `commands/develop.md` | Modify | Credential resolution section |
| `commands/ship.md` | Modify | Credential resolution section + API call placeholders |
| `commands/setup-just-ship.md` | Modify | Connect flow, set-project params |
| `commands/connect-board.md` | Modify | Check workspace_id, set-project params |
| `commands/disconnect-board.md` | Modify | remove-board --id, read workspace_id |
| `commands/add-project.md` | Modify | set-project --workspace-id, no --project-name |
| `skills/ticket-writer.md` | Modify | Credential resolution section |
| `project.json` | Modify | Migrate to new format |
| `templates/project.json` | Modify | New template shape |
| `templates/CLAUDE.md` | Modify | Board API instead of SQL |
| `CLAUDE.md` | Modify | Board API instead of SQL |
| `vps/README.md` | Modify | Config example |

---

## Task 1: write-config.sh — Core Script Rewrite

**Files:**
- Modify: `.claude/scripts/write-config.sh`
- Modify: `scripts/write-config.sh` (sync copy after)

This is the foundation — all other tasks depend on the new command signatures.

- [ ] **Step 1: Rewrite `add-workspace` command**

New signature: `--workspace-id (required), --key (required), --slug (optional), --board (optional)`

Replace the `cmd_add_workspace` function. Key changes:
- `--workspace-id` is the key in `config.workspaces` (not `--slug`)
- `--board` sets `config.board_url` at top level if not already set
- No slug collision check needed (UUID keys can't collide)
- `default_workspace` stores UUID

```bash
cmd_add_workspace() {
  local workspace_id="" key="" slug="" board=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace-id) workspace_id="$2"; shift 2 ;;
      --key)          key="$2"; shift 2 ;;
      --slug)         slug="$2"; shift 2 ;;
      --board)        board="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for add-workspace"; exit 1 ;;
    esac
  done

  if [ -z "$workspace_id" ] || [ -z "$key" ]; then
    echo "Error: add-workspace requires --workspace-id and --key"
    exit 1
  fi

  ensure_config_file

  JS_CONFIG_FILE="$CONFIG_FILE" \
  JS_WORKSPACE_ID="$workspace_id" \
  JS_KEY="$key" \
  JS_SLUG="${slug:-}" \
  JS_BOARD="${board:-}" \
  node -e "
    const fs = require('fs');
    const configFile = process.env.JS_CONFIG_FILE;
    const workspaceId = process.env.JS_WORKSPACE_ID;
    const key = process.env.JS_KEY;
    const slug = process.env.JS_SLUG || null;
    const board = process.env.JS_BOARD || null;

    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

    // Set global board_url if provided and not already set
    if (board && !config.board_url) {
      config.board_url = board;
    }

    // Add/update workspace entry keyed by UUID
    const existing = config.workspaces[workspaceId] || {};
    config.workspaces[workspaceId] = {
      ...existing,
      api_key: key,
    };
    if (slug) {
      config.workspaces[workspaceId].slug = slug;
    }

    // Auto-set default_workspace if this is the first workspace
    const wsCount = Object.keys(config.workspaces).length;
    if (wsCount === 1 || !config.default_workspace) {
      config.default_workspace = workspaceId;
    }

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  "

  chmod 600 "$CONFIG_FILE"
  echo "Workspace '${slug:-$workspace_id}' saved to ${CONFIG_FILE}"
}
```

- [ ] **Step 2: Rewrite `set-project` command**

New signature: `--workspace-id (required), --project-id (required)`

Replace the `cmd_set_project` function:

```bash
cmd_set_project() {
  local workspace_id="" project_id="" project_dir="."

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace-id) workspace_id="$2"; shift 2 ;;
      --project-id)   project_id="$2"; shift 2 ;;
      --project-dir)  project_dir="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for set-project"; exit 1 ;;
    esac
  done

  if [ -z "$workspace_id" ] || [ -z "$project_id" ]; then
    echo "Error: set-project requires --workspace-id and --project-id"
    exit 1
  fi

  local pjson="${project_dir}/project.json"
  if [ ! -f "$pjson" ]; then
    echo "Error: project.json not found at ${pjson}"
    exit 1
  fi

  JS_PJSON="$pjson" \
  JS_WORKSPACE_ID="$workspace_id" \
  JS_PROJECT_ID="$project_id" \
  node -e "
    const fs = require('fs');
    const pjsonPath = process.env.JS_PJSON;
    const workspaceId = process.env.JS_WORKSPACE_ID;
    const projectId = process.env.JS_PROJECT_ID;

    const pj = JSON.parse(fs.readFileSync(pjsonPath, 'utf-8'));

    // Remove old fields
    if (pj.pipeline) {
      delete pj.pipeline.api_key;
      delete pj.pipeline.api_url;
      delete pj.pipeline.workspace;
      delete pj.pipeline.workspace_slug;
      delete pj.pipeline.project_name;
    }

    // Ensure pipeline section exists
    if (!pj.pipeline) {
      pj.pipeline = {};
    }

    // Write new format
    pj.pipeline.workspace_id = workspaceId;
    pj.pipeline.project_id = projectId;

    fs.writeFileSync(pjsonPath, JSON.stringify(pj, null, 2) + '\n');
  "

  echo "project.json updated: workspace_id='${workspace_id}', project_id='${project_id}'"
}
```

- [ ] **Step 3: Rewrite `read-workspace` command**

New signature: `--id (primary), --slug (fallback — iterates entries)`

Output includes `board_url` from global config top-level.

```bash
cmd_read_workspace() {
  local id="" slug=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id)   id="$2"; shift 2 ;;
      --slug) slug="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for read-workspace"; exit 1 ;;
    esac
  done

  if [ -z "$id" ] && [ -z "$slug" ]; then
    echo "Error: read-workspace requires --id or --slug"
    exit 1
  fi

  if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Config file not found at ${CONFIG_FILE}"
    echo "Run 'just-ship connect' first."
    exit 1
  fi

  JS_CONFIG_FILE="$CONFIG_FILE" \
  JS_ID="${id:-}" \
  JS_SLUG="${slug:-}" \
  node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync(process.env.JS_CONFIG_FILE, 'utf-8'));
    const id = process.env.JS_ID;
    const slug = process.env.JS_SLUG;
    const boardUrl = config.board_url || '';

    let wsId, ws;

    if (id) {
      // Direct lookup by UUID
      ws = config.workspaces[id];
      wsId = id;
    } else {
      // Fallback: search by slug
      for (const [key, entry] of Object.entries(config.workspaces)) {
        if (entry.slug === slug) {
          ws = entry;
          wsId = key;
          break;
        }
      }
    }

    if (!ws) {
      const lookup = id || slug;
      console.error('Error: Workspace \"' + lookup + '\" not found in config.');
      console.error('Available workspaces: ' + Object.entries(config.workspaces).map(([k, v]) => v.slug || k).join(', '));
      process.exit(1);
    }

    console.log(JSON.stringify({
      workspace_id: wsId,
      slug: ws.slug || null,
      api_key: ws.api_key || '',
      board_url: boardUrl,
    }, null, 2));
  "
}
```

- [ ] **Step 4: Rewrite `remove-board` command**

Change param from `--slug` to `--id`. Only removes `api_key` (no per-workspace `board_url` anymore):

```bash
cmd_remove_board() {
  local id=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for remove-board"; exit 1 ;;
    esac
  done

  if [ -z "$id" ]; then
    echo "Error: remove-board requires --id"
    exit 1
  fi

  if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Config file not found at ${CONFIG_FILE}"
    exit 1
  fi

  JS_CONFIG_FILE="$CONFIG_FILE" \
  JS_ID="$id" \
  node -e "
    const fs = require('fs');
    const configFile = process.env.JS_CONFIG_FILE;
    const id = process.env.JS_ID;
    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

    if (!config.workspaces[id]) {
      console.error('Error: Workspace \"' + id + '\" not found in config.');
      process.exit(1);
    }

    delete config.workspaces[id].api_key;

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  "

  chmod 600 "$CONFIG_FILE"
  echo "Removed api_key from workspace '${id}'"
}
```

- [ ] **Step 5: Rewrite `migrate` command**

Must handle two paths:
- **Path A:** Old format (api_key/api_url/workspace_id in project.json)
- **Path B:** Intermediate format (workspace slug in project.json, slug-keyed global config)

```bash
cmd_migrate() {
  local project_dir="."

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project-dir) project_dir="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for migrate"; exit 1 ;;
    esac
  done

  ensure_config_file

  local pjson="${project_dir}/project.json"

  # Step 1: Migrate global config (re-key slug -> UUID)
  JS_CONFIG_FILE="$CONFIG_FILE" \
  node -e "
    const fs = require('fs');
    const configFile = process.env.JS_CONFIG_FILE;
    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const newWorkspaces = {};
    let globalBoardUrl = config.board_url || '';
    let slugToUuid = {};

    for (const [key, entry] of Object.entries(config.workspaces || {})) {
      if (uuidRegex.test(key)) {
        // Already UUID-keyed — extract board_url before cleaning
        if (!globalBoardUrl && entry.board_url) {
          globalBoardUrl = entry.board_url;
        }
        const clean = { api_key: entry.api_key };
        if (entry.slug) clean.slug = entry.slug;
        newWorkspaces[key] = clean;
        if (entry.slug) slugToUuid[entry.slug] = key;
      } else {
        // Slug-keyed — re-key to UUID
        const wsId = entry.workspace_id;
        if (!wsId) {
          console.error('Warning: Workspace \"' + key + '\" has no workspace_id — skipping');
          continue;
        }
        if (!globalBoardUrl && entry.board_url) {
          globalBoardUrl = entry.board_url;
        }
        newWorkspaces[wsId] = {
          slug: key,
          api_key: entry.api_key,
        };
        slugToUuid[key] = wsId;
      }
    }

    // Translate default_workspace from slug to UUID
    if (config.default_workspace && !uuidRegex.test(config.default_workspace)) {
      config.default_workspace = slugToUuid[config.default_workspace] || config.default_workspace;
    }

    config.board_url = globalBoardUrl;
    config.workspaces = newWorkspaces;

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
    console.error('Global config migrated: ' + Object.keys(newWorkspaces).length + ' workspaces');
  "

  chmod 600 "$CONFIG_FILE"

  # Step 2: Migrate project.json if it exists
  if [ -f "$pjson" ]; then
    JS_PJSON="$pjson" \
    JS_CONFIG_FILE="$CONFIG_FILE" \
    node -e "
      const fs = require('fs');
      const pjsonPath = process.env.JS_PJSON;
      const configFile = process.env.JS_CONFIG_FILE;

      const pj = JSON.parse(fs.readFileSync(pjsonPath, 'utf-8'));
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      const pipeline = pj.pipeline || {};

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // Already migrated?
      if (pipeline.workspace_id && uuidRegex.test(pipeline.workspace_id) && !pipeline.api_key && !pipeline.workspace) {
        console.error('project.json already in new format — skipping');
        process.exit(0);
      }

      let workspaceId = '';

      // Path A: Old format (api_key in project.json)
      if (pipeline.api_key) {
        workspaceId = pipeline.workspace_id || '';
        if (workspaceId && !config.workspaces[workspaceId]) {
          // Add to global config from old project.json values
          config.workspaces[workspaceId] = {
            api_key: pipeline.api_key,
          };
          if (!config.board_url && pipeline.api_url) {
            config.board_url = pipeline.api_url;
          }
          fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
        }
      }
      // Path B: Intermediate format (workspace slug)
      else if (pipeline.workspace && !uuidRegex.test(pipeline.workspace)) {
        const slug = pipeline.workspace;
        // Find UUID by iterating config entries
        for (const [key, entry] of Object.entries(config.workspaces)) {
          if (entry.slug === slug) {
            workspaceId = key;
            break;
          }
        }
        if (!workspaceId) {
          console.error('Warning: Could not resolve slug \"' + slug + '\" to UUID — check global config');
        }
      }

      // Clean up project.json
      delete pipeline.api_key;
      delete pipeline.api_url;
      delete pipeline.workspace;
      delete pipeline.workspace_slug;
      delete pipeline.project_name;

      if (workspaceId) {
        pipeline.workspace_id = workspaceId;
      }
      // Keep project_id as-is

      pj.pipeline = pipeline;
      fs.writeFileSync(pjsonPath, JSON.stringify(pj, null, 2) + '\n');
      console.error('project.json migrated' + (workspaceId ? ': workspace_id=' + workspaceId : ''));
    "
  fi
}
```

- [ ] **Step 6: Rewrite `connect` command**

Token parsing stays the same. Changes after token extraction:

Replace `cmd_add_workspace` call:
```bash
cmd_add_workspace --workspace-id "$workspace_id" --key "$key" --slug "$workspace" --board "$board" >/dev/null
```

Replace project.json update block:
```bash
  if [ -f "$pjson" ]; then
    JS_PJSON="$pjson" \
    JS_WORKSPACE_ID="$workspace_id" \
    node -e "
      const fs = require('fs');
      const pj = JSON.parse(fs.readFileSync(process.env.JS_PJSON, 'utf-8'));
      if (!pj.pipeline) pj.pipeline = {};
      pj.pipeline.workspace_id = process.env.JS_WORKSPACE_ID;
      delete pj.pipeline.api_key;
      delete pj.pipeline.api_url;
      delete pj.pipeline.workspace;
      delete pj.pipeline.workspace_slug;
      delete pj.pipeline.project_name;
      fs.writeFileSync(process.env.JS_PJSON, JSON.stringify(pj, null, 2) + '\n');
    "
  fi
```

Replace all `cmd_set_project` calls:
```bash
# From:
cmd_set_project --workspace "$workspace" --project-id "$selected_id" --project-name "$selected_name" --project-dir "$project_dir" > /dev/null
# To:
cmd_set_project --workspace-id "$workspace_id" --project-id "$selected_id" --project-dir "$project_dir" > /dev/null
```

Update status messages — use `$workspace` (slug from token) for human-readable display, `$workspace_id` internally. Keep `$selected_name` in project success messages (it's extracted from the API, still available).

- [ ] **Step 7: Update `usage` function**

Update the usage text to reflect new parameter names for all commands.

- [ ] **Step 8: Sync `scripts/write-config.sh`**

```bash
cp .claude/scripts/write-config.sh scripts/write-config.sh
```

- [ ] **Step 9: Commit**

```bash
git add .claude/scripts/write-config.sh scripts/write-config.sh
git commit -m "refactor: rewrite write-config.sh for UUID-keyed workspaces and global board_url"
```

---

## Task 2: send-event.sh — Use read-workspace

**Files:**
- Modify: `.claude/scripts/send-event.sh`

- [ ] **Step 1: Rewrite credential resolution**

Replace the entire file. Use `read-workspace --id` as canonical credential source:

```bash
#!/bin/bash
# send-event.sh — Send pipeline event to Dev Board
# Usage: bash .claude/scripts/send-event.sh <ticket_number> <agent_type> <event_type> [metadata_json]
#
# Reads workspace_id from project.json, resolves credentials via write-config.sh.
# Silent fail — never blocks the pipeline.

TICKET_NUMBER="$1"
AGENT_TYPE="$2"
EVENT_TYPE="$3"
METADATA="${4:-{}}"

[ -z "$TICKET_NUMBER" ] || [ -z "$AGENT_TYPE" ] || [ -z "$EVENT_TYPE" ] && exit 0

# Read workspace_id from project.json
if [ ! -f "project.json" ]; then exit 0; fi

WORKSPACE_ID=$(node -e "
  try { const p = require('./project.json'); process.stdout.write(p.pipeline?.workspace_id || ''); }
  catch(e) { process.stdout.write(''); }
" 2>/dev/null)

[ -z "$WORKSPACE_ID" ] && exit 0

# Resolve credentials via write-config.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WS_JSON=$("$SCRIPT_DIR/write-config.sh" read-workspace --id "$WORKSPACE_ID" 2>/dev/null)
[ -z "$WS_JSON" ] && exit 0

API_URL=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url || '')")
API_KEY=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key || '')")

[ -z "$API_URL" ] || [ -z "$API_KEY" ] && exit 0

curl -s --max-time 3 -X POST "${API_URL}/api/events" \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: ${API_KEY}" \
  -d "{\"ticket_number\": ${TICKET_NUMBER}, \"agent_type\": \"${AGENT_TYPE}\", \"event_type\": \"${EVENT_TYPE}\", \"metadata\": ${METADATA}}" \
  >/dev/null 2>&1 &
```

- [ ] **Step 2: Commit**

```bash
git add .claude/scripts/send-event.sh
git commit -m "refactor: send-event.sh uses read-workspace for credential resolution"
```

---

## Task 3: pipeline/lib/config.ts — SDK Config Resolution

**Files:**
- Modify: `pipeline/lib/config.ts`

- [ ] **Step 1: Update interfaces**

Replace `WorkspaceEntry` and `GlobalConfig`:

```typescript
interface WorkspaceEntry {
  slug?: string;
  api_key?: string;
}

interface GlobalConfig {
  board_url?: string;
  workspaces: Record<string, WorkspaceEntry>;
  default_workspace: string | null;
}
```

- [ ] **Step 2: Update `PipelineConfig` and `buildPipelineConfig`**

Remove `projectName`. Board URL comes from global config top-level:

```typescript
export interface PipelineConfig {
  projectId: string;
  workspaceId: string;
  apiUrl: string;
  apiKey: string;
}

function buildPipelineConfig(
  rawPipeline: Record<string, unknown>,
  globalConfig?: GlobalConfig | null,
  ws?: WorkspaceEntry,
): PipelineConfig {
  return {
    projectId:   (rawPipeline.project_id as string) ?? "",
    workspaceId: (rawPipeline.workspace_id as string) ?? "",
    apiUrl:      globalConfig?.board_url ?? "",
    apiKey:      ws?.api_key ?? "",
  };
}
```

- [ ] **Step 3: Update `loadProjectConfig` resolution logic**

New flow: read `workspace_id` (UUID) from project.json, look up in global config by UUID key. Keep backwards compatibility for old format (warn) and intermediate slug format (warn):

```typescript
export function loadProjectConfig(projectDir: string): ProjectConfig {
  const configPath = resolve(projectDir, "project.json");
  if (!existsSync(configPath)) {
    return {
      name: "project",
      description: "",
      conventions: { branch_prefix: "feature/" },
      pipeline: buildPipelineConfig({}),
    };
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));

  let pipeline: PipelineConfig;
  const rawPipeline = raw.pipeline ?? {};
  const globalConfig = loadGlobalConfig();

  if (rawPipeline.api_key) {
    // Old format: credentials in project.json
    console.warn(
      "\u26a0 api_key in project.json is deprecated.\n" +
      "  Run 'just-ship connect' or '.claude/scripts/write-config.sh migrate' to upgrade."
    );
    pipeline = buildPipelineConfig(rawPipeline, globalConfig);
    if (!pipeline.apiUrl) pipeline.apiUrl = (rawPipeline.api_url as string) ?? "";
    if (!pipeline.apiKey) pipeline.apiKey = (rawPipeline.api_key as string) ?? "";

  } else if (rawPipeline.workspace_id) {
    // New format: UUID-based lookup
    const wsId = rawPipeline.workspace_id as string;
    if (!globalConfig) {
      console.warn(
        `\u26a0 workspace_id '${wsId}' configured but ~/.just-ship/config.json not found.\n` +
        `  Run 'just-ship connect' to set up the connection.`
      );
      pipeline = buildPipelineConfig(rawPipeline, null);
    } else {
      const ws = globalConfig.workspaces[wsId];
      if (!ws) {
        console.error(
          `Workspace '${wsId}' not found in ~/.just-ship/config.json.\n` +
          `Run 'just-ship connect' to set up the connection.`
        );
        pipeline = buildPipelineConfig(rawPipeline, globalConfig);
      } else {
        pipeline = buildPipelineConfig(rawPipeline, globalConfig, ws);
      }
    }

  } else if (rawPipeline.workspace) {
    // Intermediate format: slug-based (deprecated)
    console.warn(
      `\u26a0 pipeline.workspace (slug) is deprecated.\n` +
      `  Run '.claude/scripts/write-config.sh migrate' to upgrade.`
    );
    const slug = rawPipeline.workspace as string;
    let ws: WorkspaceEntry | undefined;
    if (globalConfig) {
      for (const [, entry] of Object.entries(globalConfig.workspaces)) {
        if (entry.slug === slug) { ws = entry; break; }
      }
    }
    pipeline = buildPipelineConfig(rawPipeline, globalConfig, ws);

  } else {
    // No pipeline config — check for default workspace
    const defaultId = globalConfig?.default_workspace;
    const defaultWs = defaultId ? globalConfig?.workspaces[defaultId] : undefined;
    pipeline = buildPipelineConfig(rawPipeline, globalConfig, defaultWs);
  }

  return {
    name: raw.name ?? "project",
    description: raw.description ?? "",
    conventions: { branch_prefix: raw.conventions?.branch_prefix ?? "feature/" },
    pipeline,
  };
}
```

- [ ] **Step 4: Check compilation**

```bash
cd pipeline && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/config.ts
git commit -m "refactor: pipeline config.ts uses UUID-keyed workspaces and global board_url"
```

---

## Task 4: Commands — Credential Resolution Updates

**Files:**
- Modify: `commands/develop.md`
- Modify: `commands/ship.md`
- Modify: `skills/ticket-writer.md`

All three files share the same credential resolution pattern. Replace with the new simplified version.

- [ ] **Step 1: Update `commands/develop.md`**

Replace the "Pipeline (optional)" section (lines 20-34) with:

```markdown
**Pipeline (optional):** Lies `project.json` und bestimme den Pipeline-Modus:

1. **Board API** (bevorzugt): Falls `pipeline.workspace_id` gesetzt → Credentials auflösen:
   ```bash
   WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id <workspace_id>)
   ```
   Aus dem JSON-Output `board_url` und `api_key` verwenden. `pipeline.project_id` aus `project.json`.
2. **Legacy Supabase MCP**: Falls nur `project_id` gesetzt (ohne `workspace_id`), und `project_id` hat keine Bindestriche → `execute_sql` verwenden, Warnung ausgeben: "Kein Board API konfiguriert. Nutze Legacy Supabase MCP. Fuehre /setup-just-ship aus um zu upgraden."
3. **Standalone**: Falls weder `workspace_id` noch `project_id` konfiguriert → Alle Pipeline-Schritte überspringen. Ticket-Infos werden per `$ARGUMENTS` übergeben.

**project_id Format-Check:** Falls `pipeline.project_id` gesetzt ist und KEINE Bindestriche enthält (kurzer alphanumerischer String wie `wsmnutkobalfrceavpxs`), ist es eine alte Supabase-Projekt-ID. Warnung ausgeben: "pipeline.project_id sieht nach einer alten Supabase-ID aus. Fuehre /setup-just-ship aus um auf Board-UUID zu migrieren."
```

Then throughout the file, replace:
- `{pipeline.api_key}` → `{api_key}` (resolved from read-workspace)
- `{pipeline.api_url}` → `{board_url}` (resolved from read-workspace)
- `{pipeline.workspace_id}` in Legacy SQL stays as-is (it's the same UUID now in project.json)
- Remove the "Altes Format (Fallback)" branch wherever it appears

- [ ] **Step 2: Update `commands/ship.md`**

Same credential resolution replacement (lines 25-37).

Additionally update all curl placeholders in steps 3a and 6:
- `{pipeline.api_key}` → `{api_key}`
- `{pipeline.api_url}` → `{board_url}`

- [ ] **Step 3: Update `skills/ticket-writer.md`**

Replace the "Pipeline-Modus bestimmen" section (lines 246-257) with the same new credential resolution. Update the curl example placeholders.

- [ ] **Step 4: Commit**

```bash
git add commands/develop.md commands/ship.md skills/ticket-writer.md
git commit -m "refactor: commands use workspace_id for credential resolution"
```

---

## Task 5: Board Commands — connect, disconnect, add-project

**Files:**
- Modify: `commands/connect-board.md`
- Modify: `commands/disconnect-board.md`
- Modify: `commands/add-project.md`

- [ ] **Step 1: Update `commands/connect-board.md`**

Replace `pipeline.workspace` → `pipeline.workspace_id` throughout. Key changes:

Step 1 check: `pipeline.workspace_id` instead of `pipeline.workspace`
Step 3 workspace listing: iterate `Object.entries(c.workspaces)` showing `w.slug || id`
Step 3 set-project: `--workspace-id <uuid> --project-id <project-id>`

- [ ] **Step 2: Update `commands/disconnect-board.md`**

- Read `pipeline.workspace_id` instead of `pipeline.workspace`
- `remove-board --id <workspace_id>` instead of `--slug <workspace>`
- `workspace_id` stays in project.json for reconnection

- [ ] **Step 3: Update `commands/add-project.md`**

- Remove `--name` flag entirely
- Read `pipeline.workspace_id` instead of `pipeline.workspace`
- Fallback to `default_workspace` (now a UUID) from global config
- `set-project --workspace-id <workspace_id> --project-id <project>`

- [ ] **Step 4: Commit**

```bash
git add commands/connect-board.md commands/disconnect-board.md commands/add-project.md
git commit -m "refactor: board commands use workspace_id instead of slug"
```

---

## Task 6: setup-just-ship.md — Connect Flow

**Files:**
- Modify: `commands/setup-just-ship.md`

- [ ] **Step 1: Update argument table**

Replace flags:
```markdown
| Flag | Beschreibung |
|---|---|
| `--board` | Board URL (z.B. `https://board.just-ship.io`) |
| `--workspace-id` | Workspace UUID |
| `--project` | Projekt UUID |
```

- [ ] **Step 2: Update flag-based connect flow**

When flags are passed (from Board ProjectSetupDialog):
- Check if workspace exists: `read-workspace --id <workspace-id>`
- If EXISTS: `set-project --workspace-id <workspace-id> --project-id <project>`
- If NOT_FOUND: ask for `--key`, then `add-workspace --workspace-id <workspace-id> --key <key> --board <board>`, then `set-project`

- [ ] **Step 3: Update step 0c status check**

Replace `pipeline.workspace` → `pipeline.workspace_id` in all status checks.

- [ ] **Step 4: Update step 5 board connection check**

Replace workspace slug references with workspace_id.

- [ ] **Step 5: Update step 6 Sidekick — workspace resolution**

Replace:
```bash
WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --slug <workspace>)
```
With:
```bash
WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id <workspace_id>)
```

Remove `project_name` usage — derive Sidekick slug from API response only, fallback to project name from `project.json` `name` field (not `pipeline.project_name`).

- [ ] **Step 6: Commit**

```bash
git add commands/setup-just-ship.md
git commit -m "refactor: setup-just-ship uses workspace_id for board connection"
```

---

## Task 7: Templates and Documentation

**Files:**
- Modify: `templates/project.json`
- Modify: `templates/CLAUDE.md`
- Modify: `CLAUDE.md`
- Modify: `vps/README.md`

- [ ] **Step 1: Update `templates/project.json`**

Replace the pipeline section with:
```json
"pipeline": {
  "workspace_id": "",
  "project_id": ""
}
```

- [ ] **Step 2: Update `templates/CLAUDE.md`**

Replace the Ticket-Workflow section. Change from SQL/Supabase to Board API:
- Trigger condition: `pipeline.workspace_id` and `pipeline.project_id`
- Show `read-workspace --id` + curl pattern
- Remove SQL example entirely

- [ ] **Step 3: Update `CLAUDE.md`**

Same Ticket-Workflow update as templates/CLAUDE.md. Replace the SQL example with Board API curl pattern.

- [ ] **Step 4: Update `vps/README.md`**

Replace config example with new format:
```json
{
  "board_url": "https://board.just-ship.io",
  "default_workspace": "<workspace-uuid>",
  "workspaces": {
    "<workspace-uuid>": {
      "slug": "my-workspace",
      "api_key": "<api-key>"
    }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add templates/project.json templates/CLAUDE.md CLAUDE.md vps/README.md
git commit -m "docs: update templates and docs for new pipeline config format"
```

---

## Task 8: Migrate Own project.json and Rotate Key

**Files:**
- Modify: `project.json`

**Note:** The current `project.json` has `api_key` committed in git history. After migration removes it from the file, the key should be rotated in the Board (Settings → API Keys) since the old key is exposed in git history.

- [ ] **Step 1: Run migration**

```bash
bash .claude/scripts/write-config.sh migrate --project-dir .
```

- [ ] **Step 2: Verify project.json**

Should contain only:
```json
"pipeline": {
  "workspace_id": "421dffa5-5f2e-44a8-bdc1-7e0f31a87149",
  "project_id": "f866f2ac-be4d-4481-97e4-4f213efe4534"
}
```

No `workspace`, `api_url`, `api_key`, `project_name`.

- [ ] **Step 3: Verify global config**

```bash
cat ~/.just-ship/config.json
```

Should have `board_url` at top level, workspaces keyed by UUID.

- [ ] **Step 4: Commit**

```bash
git add project.json
git commit -m "chore: migrate project.json to new pipeline config format"
```

- [ ] **Step 5: Remind user to rotate API key**

The old `api_key` value (`adp_70e47c08...`) is in git history. Remind user to rotate it in the Board.

---

## Task 9: Integration Verification

- [ ] **Step 1: Test `read-workspace` by UUID**

```bash
bash .claude/scripts/write-config.sh read-workspace --id 421dffa5-5f2e-44a8-bdc1-7e0f31a87149
```

Expected: JSON with `workspace_id`, `slug`, `api_key`, `board_url`

- [ ] **Step 2: Test `read-workspace` by slug fallback**

```bash
bash .claude/scripts/write-config.sh read-workspace --slug agentic-dev
```

Expected: Same JSON output

- [ ] **Step 3: Test credential resolution end-to-end**

```bash
WORKSPACE_ID=$(node -e "process.stdout.write(require('./project.json').pipeline?.workspace_id || '')")
WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id "$WORKSPACE_ID")
echo "$WS_JSON" | node -e "
  const ws = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  console.log('board_url:', ws.board_url);
  console.log('api_key:', ws.api_key ? 'SET' : 'MISSING');
"
```

Expected: `board_url: https://board.just-ship.io` and `api_key: SET`

- [ ] **Step 4: Test TypeScript compilation**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: Final commit (if any fixes needed)**

Only if integration tests revealed issues that needed fixing.
