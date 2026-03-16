# Board Project Setup Flow — Design Spec

> Date: 2026-03-13
> Status: Draft
> Scope: just-ship-board + just-ship

---

## Problem

The current setup flow has three critical gaps:

1. **Projects cannot be created in the Board UI** — the DB supports it, but no UI exists. Users must insert directly into Supabase.
2. **The API Key is shown during workspace creation with no guidance** — the user sees it once and must know on their own that it belongs in `project.json`.
3. **`/setup-just-ship` depends on the Supabase MCP** — only users with direct Supabase access can connect the pipeline. External developers cannot self-onboard.

## Goal

A self-service, guided flow from workspace creation to connected pipeline that works for both internal team members and external developers — without requiring Supabase access.

## Design Decisions

- **API Key scope:** Per workspace (not per project). Access control via workspace membership and roles.
- **Project creation:** Inline dialog in Board toolbar (not a separate settings page). Projects are simple (name + description).
- **Pipeline standalone:** `/setup-just-ship` works without Board connection. Board integration is optional.
- **Telegram Bot:** No changes needed. Bot reads projects dynamically from DB.
- **API Key storage:** Keys are stored in `project.json` as plaintext for simplicity. `project.json` should be in `.gitignore` (it contains project-specific config). The `/setup-just-ship` command should warn if `project.json` is tracked by git.
- **Board UI language:** English (matches existing Board UI). German labels shown in this spec are illustrative only.
- **`project_id` semantics change:** The `pipeline.project_id` field changes from Supabase hosting project ID to Board project UUID. See Section 3.2 for migration details.

---

## 1. User Flow (End-to-End)

```
1. Register/Login → Create Workspace (name + slug only)
2. → Redirect to Board (empty)
3. → Empty State: "Create your first project" CTA
4. → Create project (name + description)
5. → Setup Dialog appears:
     - Option 1 (prominent): CLI command with --board and --key
     - Option 2 (expandable): Manual project.json snippet
6. → Setup Dialog accessible anytime via icon on project
7. → Developer runs /setup-just-ship in their terminal
8. → project.json is configured, pipeline is connected
```

## 2. Board Changes (just-ship-board)

### 2.1 Workspace Creation — Simplified

**File:** `src/app/new-workspace/page.tsx`

**Changes:**
- Remove API key generation and display from workspace creation
- After creation: redirect to `/{slug}/board`
- API key is generated later, on first project setup dialog open

### 2.2 Board Empty State

**File:** `src/app/[slug]/board/page.tsx`

When a workspace has 0 projects, show an empty state instead of the bare board:

```
┌──────────────────────────────────────────────┐
│                                              │
│      Willkommen in deinem Workspace!         │
│                                              │
│  Projekte gruppieren deine Tickets und       │
│  verbinden sich mit deiner Codebase.         │
│                                              │
│      [+ Erstes Projekt erstellen]            │
│                                              │
└──────────────────────────────────────────────┘
```

The CTA opens the Create Project Dialog.

### 2.3 Create Project Dialog

**New component:** Inline dialog triggered from Board toolbar ("+" button next to project filter dropdown) and from empty state CTA.

**Fields:**
- Name (required, text input)
- Description (optional, text input)

**On submit:**
- Insert into `projects` table (RLS ensures workspace scoping)
- On success: open Setup Dialog (section 2.4)

### 2.4 Project Setup Dialog

**New component:** Appears after project creation. Also accessible anytime via a "Setup" icon on each project.

**Content:**

```
┌─ Verbinde dein Projekt mit deiner Codebase ─────────┐
│                                                      │
│ ┌─ OPTION 1 (prominent) ─────────────────────────┐   │
│ │ Führe das in deinem Projekt-Terminal aus:       │   │
│ │                                                 │   │
│ │ /setup-just-ship \                               │   │
│ │   --board https://board.just-ship.io \         │   │
│ │   --key adp_ab18e060...                         │   │
│ │                                  [Kopieren]     │   │
│ └─────────────────────────────────────────────────┘   │
│                                                      │
│ ▸ Manuell in project.json eintragen (aufklappbar)    │
│                                                      │
│ ─────────────────────────────────────────────────     │
│ API Key: adp_ab18...****                             │
│ [Neuen Key generieren]                               │
│                                                      │
│ [Später]  [Fertig]                                   │
└──────────────────────────────────────────────────────┘
```

**The CLI command includes `--project` so it's fully non-interactive (true copy-paste-and-done):**

```
/setup-just-ship \
  --board https://board.just-ship.io \
  --key adp_ab18e060... \
  --project e904798e-...
```

**API Key behavior:**
- Key is generated automatically when the Setup Dialog opens for the first time (if no key exists for the workspace). If generation fails (network/DB error), show error message with retry button.
- Key is displayed masked: `adp_<first 8 hex>...****`
- Full plaintext key is shown only once (at generation/regeneration) within the CLI command and manual config
- "Neuen Key generieren" button invalidates the old key and generates a new one

**Key regeneration warning:**

> **Neuen API Key generieren?**
>
> Der aktuelle Key wird sofort ungültig. Folgende Schritte sind danach nötig:
> - Alle verbundenen Projekte müssen den neuen Key erhalten
> - Führe `/setup-just-ship --board <url> --key <neuer-key>` in jedem Projekt erneut aus
> - Oder ersetze `api_key` in der `project.json` manuell
> - Der VPS Worker muss neu gestartet werden (falls aktiv)
>
> [Abbrechen] [Neuen Key generieren]

### 2.5 New API Endpoints

#### `GET /api/projects`

Lists projects for the authenticated workspace. Used by `/setup-just-ship`.

```
Request:
  GET /api/projects
  X-Pipeline-Key: adp_...

Response 200:
  {
    "workspace_id": "421dffa5-...",
    "workspace_name": "Just Ship",
    "projects": [
      { "id": "e904798e-...", "name": "Aime Web", "description": "..." },
      { "id": "d81500be-...", "name": "Aime Superadmin", "description": null }
    ]
  }
```

#### `POST /api/projects`

Creates a project in the authenticated workspace. Used by `/setup-just-ship` when user wants to create a new project from CLI.

```
Request:
  POST /api/projects
  X-Pipeline-Key: adp_...
  Content-Type: application/json
  { "name": "Mein Projekt", "description": "Optional" }

Response 201:
  { "id": "...", "name": "Mein Projekt", "workspace_id": "421dffa5-..." }

Response 409 (name already exists in workspace):
  { "error": "Project name already exists" }
```

#### `POST /api/workspace/[workspaceId]/api-keys/regenerate`

Regenerates the workspace API key. Board UI only (session auth, not pipeline key).

**DB operation:** Sets `revoked_at = now()` on all active keys for the workspace, then inserts a new key row. This is atomic — if insertion fails, revocation is rolled back.

```
Request:
  POST /api/workspace/{workspaceId}/api-keys/regenerate
  Authorization: Bearer <supabase-session>

Response 200:
  { "api_key": "adp_NEW...", "prefix": "adp_ab18e060" }
```

**No DELETE/PATCH endpoints for projects.** Project management (rename, delete) stays Board-UI-only for now. YAGNI.

**Rate limiting:** `POST /api/projects` limited to 50 projects per workspace. Not enforced via middleware initially — just a DB check before insert.

## 3. Pipeline Changes (just-ship)

### 3.1 `/setup-just-ship` Command — Reworked

**File:** `commands/setup-just-ship.md`

The command is freed from Supabase MCP dependency and uses the Board API instead.

#### Two Modes

**Mode 1: Interactive (no arguments)**

The "interactive" mode means Claude Code asks the user within the chat conversation (not terminal I/O prompts). The command's markdown instructions guide Claude to ask these questions conversationally.

```
> /setup-just-ship

✓ Stack detected: Next.js 15, TypeScript, Supabase, pnpm
✓ project.json updated (stack, build, paths)
✓ CLAUDE.md enriched

Connect to Just Ship Board? (y/n)
> y

Board URL: [https://board.just-ship.io]
API Key: [adp_...]

✓ Connected to Workspace "Just Ship"

Available projects:
  1. Aime Web
  2. Aime Superadmin
  3. + Create new project

Selection: [3]
Project name: [My Project]

✓ Project created
✓ project.json pipeline config written
```

**Mode 2: Direct Connect (copy-paste from Board)**

```
> /setup-just-ship --board https://board.just-ship.io --key adp_... --project e904798e-...

✓ Stack detected: Next.js 15, TypeScript, Supabase, pnpm
✓ project.json updated

✓ Connected to Workspace "Just Ship"
✓ Project: Aime Web

✓ project.json pipeline config written
```

If `--project` is omitted, the command lists available projects and asks the user to choose (same as interactive mode).

#### Pipeline Config Written to `project.json`

The command writes the complete pipeline section. Field mapping from Board API:

```json
"pipeline": {
  "project_id": "<Board project UUID from GET /api/projects → projects[].id>",
  "project_name": "<Board project name from GET /api/projects → projects[].name>",
  "workspace_id": "<from GET /api/projects → workspace_id>",
  "api_url": "<Board URL from --board flag or user input>",
  "api_key": "<API key from --key flag or user input>"
}
```

**Security check:** If `project.json` is tracked by git, warn the user and recommend adding it to `.gitignore` (since it contains the API key).

#### API Communication

Instead of Supabase MCP, the command uses `WebFetch` or `curl`:

```
GET {board_url}/api/projects
Header: X-Pipeline-Key: {api_key}
```

#### Standalone Mode (no Board)

If the user declines Board connection, only stack/build/paths are filled. The `pipeline` section in `project.json` stays empty. `/develop` and `/ship` still work — they operate locally with git branches, without Board status updates.

### 3.2 `project_id` Semantic Change — Migration

**Breaking change:** `pipeline.project_id` previously stored the Supabase hosting project ID (e.g., `wsmnutkobalfrceavpxs`). It now stores the Board project UUID (e.g., `e904798e-8622-4c6e-bc6c-660e862bf423`).

**Why:** The old value was used to target `execute_sql` calls via Supabase MCP. The new flow uses the Board API instead, so the Supabase project ID is no longer needed in the pipeline config.

**Affected commands that currently use `pipeline.project_id` for `execute_sql`:**
- `/develop` — ticket status updates
- `/ship` — ticket status updates
- `/merge` — ticket status updates

**Migration path:** These commands must be updated to use the Board API (e.g., `PATCH /api/tickets/{number}`) instead of direct `execute_sql`. This is a follow-up task tracked separately — the new Board API endpoints for ticket status updates already exist at `/api/tickets/[number]`.

**Backward compatibility:** If `pipeline.project_id` looks like a Supabase project ID (short alphanumeric, no dashes), commands should log a warning suggesting to re-run `/setup-just-ship`.

## 4. No Changes Required

| Component | Reason |
|---|---|
| **Telegram Bot** | Reads projects dynamically from DB. New projects appear automatically as buttons. |
| **DB Schema** | `projects`, `api_keys`, `tickets` tables stay as-is. No migrations needed. The `api_keys` table already has a `revoked_at` column sufficient for key regeneration. |
| **VPS Worker** | Uses `project.json` config. No change needed. |
| **Existing API endpoints** | `/api/events`, `/api/tickets` remain unchanged. |

## 5. Implementation Scope

### just-ship-board

| # | Task | Complexity |
|---|---|---|
| B1 | Remove API key generation from `/new-workspace` page | Small |
| B2 | Add Board empty state (0 projects) | Small |
| B3 | Create Project Dialog component (inline, toolbar) | Medium |
| B4 | Project Setup Dialog component (CLI command + manual config + key management) | Medium |
| B5 | `GET /api/projects` endpoint (pipeline key auth) | Small |
| B6 | `POST /api/projects` endpoint (pipeline key auth) | Small |
| B7 | `POST /api/workspace/[id]/api-keys/regenerate` endpoint (session auth) | Small |
| B8 | "Setup" icon on project in toolbar/filter for re-opening Setup Dialog | Small |

### just-ship

| # | Task | Complexity |
|---|---|---|
| P1 | Rework `/setup-just-ship` command: Board API instead of Supabase MCP | Medium |
| P2 | Support `--board`, `--key`, and `--project` flags for direct connect mode | Small |
| P3 | Write complete pipeline config (including `api_url` and `api_key`) | Small |
| P4 | Add git-tracking warning for `project.json` with API key | Small |
| P5 | Update `/develop`, `/ship`, `/merge` to use Board API instead of `execute_sql` | Medium |

## 6. Out of Scope

- Project CRUD settings page (rename, delete) — add later if needed
- Per-project API keys — workspace-level keys are sufficient
- Telegram bot user self-registration — separate concern
- Role-based access control — future iteration
