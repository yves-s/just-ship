# Setup Flow Redesign — Unified Config & Contextual Board UI

**Date:** 2026-03-15
**Status:** Draft
**Scope:** setup.sh, CLI commands, Board UI, Pipeline runtime, migration

---

## Problem

The current setup flow treats every project connection the same: a full snippet with API key, workspace ID, project ID, and board URL. When a user adds a second project to an existing workspace, they see the same "full setup" snippet but with a masked API key — which is confusing. The user doesn't understand why the key is hidden or whether they need to redo the entire setup.

Additionally, the pipeline currently supports only one mode (Board + Pipeline) with no clear path for CLI-only usage or switching between modes.

## Goals

1. Separate workspace-level config (API key, board URL) from project-level config (project ID)
2. Board UI shows contextually appropriate setup instructions
3. Support three usage modes: CLI-only, Self-hosted Board, SaaS Board
4. Enable seamless mode-switching via CLI commands
5. Backwards-compatible migration from the old format

## Non-Goals

- Server-side tracking of setup state
- Automatic mode detection
- Self-service workspace creation from CLI (workspace is always created on the board first)
- OS keychain integration (future enhancement — plaintext keys in config file for now)
- OAuth/browser-based CLI login à la `sanity login` (separate ticket — would eliminate manual key copy-paste entirely)

---

## Design

### 1. Global Config: `~/.just-ship/config.json`

Central file managing all workspace connections:

```json
{
  "workspaces": {
    "my-team": {
      "board_url": "https://board.just-ship.io",
      "workspace_id": "421dffa5-5f2e-44a8-bdc1-7e0f31a87149",
      "api_key": "adp_a1b2c3..."
    },
    "freelance": {
      "board_url": "https://my-board.example.com",
      "workspace_id": "8833aaf1-...",
      "api_key": "adp_x9y8z7..."
    }
  },
  "default_workspace": "my-team"
}
```

**Rules:**
- Key in `workspaces` object is the workspace slug (human-readable)
- Slugs are unique per board instance. If the same slug exists on two different boards, the user must choose distinct local names (e.g., `my-team` vs `my-team-selfhosted`). The CLI warns on collision.
- CLI-only mode = entry without `board_url` and `api_key`
- `default_workspace` is used when `project.json` doesn't reference an explicit workspace. If only one workspace exists, it auto-becomes default. If no default and no workspace in `project.json`, the CLI prompts to select one.
- File is created with `chmod 600` (owner-only read/write) for security
- File is never committed to git (lives in home directory)

**`project.json` becomes leaner — no key:**

```json
{
  "pipeline": {
    "workspace": "my-team",
    "project_id": "dc2b647e-..."
  }
}
```

Since `project.json` no longer contains secrets, it **can be committed to git** — allowing teams to share workspace/project references. The `.gitignore` entry and "contains API keys" comment in `setup.sh` should be removed.

**Complete new `pipeline` schema in `project.json`:**
```json
{
  "pipeline": {
    "workspace": "my-team",
    "project_id": "dc2b647e-...",
    "project_name": "My Project"
  }
}
```

`project_name` stays in `project.json` (human-readable context for the project). All connection details (board URL, API key, workspace ID) are resolved from `~/.just-ship/config.json` via the `workspace` slug.

Resolution at runtime: `project.json` → `workspace: "my-team"` → `~/.just-ship/config.json` → key + board URL.

---

### 2. Setup Flow: `setup.sh` and Commands

#### Relationship to existing `/setup-just-ship`

The existing `/setup-just-ship` command currently handles board connection, stack detection, `project.json` writing, and `CLAUDE.md` generation in one flow. This redesign **replaces the board-connection part** of `/setup-just-ship` with dedicated commands:

- `/setup-just-ship` remains but is simplified: it handles only stack detection, `CLAUDE.md` generation, and `project.json` scaffolding. It no longer accepts `--board`, `--key` flags.
- Board connection is fully handled by `/connect-board` and `/add-project`.
- `setup.sh` orchestrates both: first mode selection, then delegates to the appropriate command.

The Board UI generates `/connect-board` commands (for workspace setup) and `/add-project` commands (for project connection) instead of the current `/setup-just-ship` command.

#### Initial Setup (`setup.sh`)

On first run:

```
Welcome to Just Ship!

How do you want to work?
  1) CLI-only — just agents & pipeline, no board
  2) Connect to a board

> 2

Paste the connect command from your board, or press Enter for manual setup:
> /connect-board --board https://board.just-ship.io --workspace my-team --workspace-id 421dffa5-... --key adp_a1b2c3... --project dc2b647e-...

✓ Config written to ~/.just-ship/config.json
✓ project.json updated (workspace: "my-team", project_id: "dc2b647e-...")
✓ Pipeline ready!
```

The **primary path** is paste-friendly: the Board generates a complete `/connect-board` command, the user pastes it into `setup.sh`. Manual entry (prompting for each value individually) is a fallback when the user presses Enter without pasting a command.

CLI-only:
```
> 1

✓ Agents & commands installed
✓ No board connection — run /connect-board anytime to add one
```

**Implementation boundary:** `setup.sh` handles file installation and mode selection only. The actual config writing (`~/.just-ship/config.json`, `project.json`) is implemented in a shared script `scripts/write-config.sh` that both `setup.sh` and the `/connect-board` slash command invoke. This avoids duplicate logic between bash and Claude Code contexts.

#### Commands

All commands support both **interactive mode** (prompts) and **flag mode** (for scripted/paste use from the Board UI).

| Command | Purpose |
|---|---|
| `/connect-board` | Add or change board connection. Asks for board URL, workspace, key. Writes to `~/.just-ship/config.json`. Supports flags: `--board`, `--workspace`, `--workspace-id`, `--key` |
| `/add-project` | Connect a new project in the current workspace. Asks only for project ID, writes to `project.json`. Supports flag: `--project` |
| `/disconnect-board` | Remove board connection (back to CLI-only). Removes `board_url` and `api_key` from the workspace entry in config. Does not delete the workspace entry itself (preserves workspace slug for potential reconnection). Does not modify `project.json`. |

#### Mode-Switch Scenarios

- **CLI-only → Board:** `/connect-board` — adds workspace + key to config
- **SaaS → Self-hosted (or vice versa):** `/connect-board` with new board URL
- **New project:** `/add-project` — no key needed, workspace already exists
- **New workspace:** `/connect-board` with new workspace — new entry in config

---

### 3. Board UI: Context-Dependent Setup Dialogs

The board shows different dialogs depending on the situation:

#### Situation A: Workspace just created → "Workspace Setup"

Appears immediately after creating a new workspace. Shows everything needed for the first connection.

**Dialog title:** "Connect your workspace"

**Content:**
1. API key in plaintext (visible once) + copy button
2. Setup command:
```
/connect-board \
  --board https://board.just-ship.io \
  --workspace my-team \
  --workspace-id 421dffa5-... \
  --key adp_a1b2c3...
```
3. Note: *"Save your API key — you won't see it again."*
4. Collapsible "First time?" with install instructions (as before)

#### Situation B: Project created in existing workspace → "Connect Project"

No key, no workspace setup. Just the project connection.

**Dialog title:** "Connect \"{project.name}\""

**Content:**
1. A single command:
```
/add-project --project dc2b647e-...
```
2. Project ID separately copyable
3. No API key visible, no workspace info — that's all already configured

#### Situation C: Existing workspace, key lost/forgotten

Via Settings → API Keys → "Regenerate Key". Shows new key once + note to run `/connect-board --key <new-key>`.

**Decision logic in the board (client-side only):**
- Workspace just created → redirect includes `?setup=workspace` query param → **Situation A**
- Project created in an existing workspace → **Situation B** (default when no query param)
- Settings page → **Situation C**

**Detection mechanism:** After workspace creation in `/new-workspace`, the redirect to `/${slug}/board` includes `?setup=workspace`. The board component reads this param, shows Situation A, and clears the param from the URL (via `router.replace`) after the dialog is opened. All subsequent project creations in that workspace show Situation B by default.

No server-side tracking needed.

---

### 4. Pipeline Runtime: Key Resolution

The pipeline resolves the API key at runtime from the global config instead of `project.json`.

**Resolution chain:**

```
project.json (workspace: "my-team", project_id: "...")
       ↓
~/.just-ship/config.json → workspaces["my-team"] → api_key, board_url
       ↓
API calls to the board with resolved key
```

**Fallback behavior:**
- `project.json` has `workspace` → look up config → key found → all good
- `project.json` has `workspace` but config has no entry → error: *"Workspace 'my-team' not found in ~/.just-ship/config.json. Run /connect-board to set it up."*
- `project.json` has no `workspace` field → check `default_workspace` from config
- `project.json` still has old format with `api_key` → **backwards compatibility:** continues to work, but warns: *"Migrate your api_key to ~/.just-ship/config.json with /connect-board"*
- No board configured (CLI-only) → pipeline runs without board features (no events, no status updates)

**VPS worker considerations:**
- On VPS, `~/.just-ship/config.json` resolves to the service user's home directory (e.g., `/home/justship/.just-ship/config.json`)
- The existing `.env.{slug}` files per project on VPS remain unchanged — they handle environment variables, not pipeline config
- `config.json` must be created on the VPS during VPS setup (via `vps/setup-vps.sh` or manually)
- Alternative for VPS: the old `api_key` in `project.json` format continues to work (backwards compatibility), so existing VPS setups don't break

**Affected files:**
- `pipeline/lib/config.ts` — key resolution logic
- `pipeline/run.ts` — config loading
- `pipeline/worker.ts` — config loading

---

### 5. Migration: Existing Setup → New Format

For users who already have `api_key` in `project.json`.

**Strategy: Soft Migration (no breaking change)**

The old format continues to work, but:

1. **Automatic detection:** If `project.json` still has an `api_key` field, the pipeline shows a one-time warning at startup:
   ```
   ⚠ api_key in project.json is deprecated.
     Run /connect-board to migrate to ~/.just-ship/config.json
   ```

2. **`/connect-board` migrates automatically:** If it finds an old `project.json` with `api_key`, it asks:
   ```
   Found existing api_key in project.json. Migrate to global config?
   > yes

   Workspace slug for this connection:
   > my-team

   ✓ Key moved to ~/.just-ship/config.json
   ✓ api_key removed from project.json
   ✓ workspace reference added to project.json
   ```
   The slug must be provided by the user during migration since the old format only has `workspace_id` (UUID), not a slug. The CLI suggests a default derived from `project_name` in the old config if available.

3. **Priority order:** If both exist (old `api_key` in `project.json` AND entry in `config.json`), the global config wins.

4. **`setup.sh --update`:** Existing update command detects old format and offers migration.

5. **No config file = CLI-only:** If `~/.just-ship/config.json` does not exist at all, the system operates in CLI-only mode (no error, no board features).

---

## Affected Components

| Component | Changes |
|---|---|
| `setup.sh` | Mode selection, delegates config writing to `scripts/write-config.sh` |
| `scripts/write-config.sh` | New shared script: writes `~/.just-ship/config.json` (chmod 600) and updates `project.json`. Used by both `setup.sh` and `/connect-board` |
| `commands/connect-board.md` | New command: add/change board connection |
| `commands/add-project.md` | New command: connect project to workspace |
| `commands/disconnect-board.md` | New command: remove board connection |
| `pipeline/lib/config.ts` | Key resolution from global config, fallback chain, migration warning |
| `pipeline/run.ts` | Updated config loading |
| `pipeline/worker.ts` | Updated config loading |
| Board: `project-setup-dialog.tsx` | Context-dependent dialogs (Situation A vs B) |
| Board: `board.tsx` | Pass context (workspace-just-created vs project-created) to dialog |
| Board: `create-api-key-dialog.tsx` | Updated instructions referencing `/connect-board` |
| Board: `projects-settings-view.tsx` | Updated setup dialog trigger |
| Board: `new-workspace/page.tsx` | Add `?setup=workspace` to redirect URL after workspace creation |
| `commands/setup-just-ship.md` | Remove `--board`, `--key` flags. Simplify to stack detection + `CLAUDE.md` only |
| `setup.sh` (`.gitignore` section) | Remove `project.json` from `.gitignore` and "contains API keys" comment |
| `vps/setup-vps.sh` | Document `~/.just-ship/config.json` creation for VPS service user |
