# Shopify Board-Integration — Design Spec

> **Goal:** Enable Shopify agencies to work entirely from the Board — create a project, configure their store, write tickets, get results with preview links. No terminal required for the agency.

---

## Context

A Shopify agency wants to test Just Ship next week. They have their own dev stores. Today, Just Ship is CLI-first: `setup.sh` → `/connect-board` → `/develop` → `/ship`. The agency needs a Board-first workflow where they never touch a terminal.

**Minimal scope for next week:** Board knows the project type and store config. Repo setup on VPS happens manually (once). Everything after that is Board-only for the agency.

---

## 1. Project Type — Universal Concept

### New field on `projects` table: `type`

| Value | Extra Config | Description |
|---|---|---|
| `shopify` | Store URL, Access Token | Shopify theme/app development |
| `webapp` | — | Standard web application |
| `other` | — | Anything else |

**Default:** `NULL` (existing projects, backwards-compatible).

This is a universal concept — not Shopify-specific. Every project can optionally declare its type. The pipeline uses the type to determine which skills, agents, and deploy targets to activate.

### New fields for Shopify config

On the `projects` table (or a `project_settings` JSONB column):

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | TEXT | No | `shopify`, `webapp`, `other`, or NULL |
| `shopify_store_url` | TEXT | If type=shopify | e.g. `my-store.myshopify.com` |
| `shopify_access_token` | TEXT (encrypted) | If type=shopify | Theme Access Password or Admin API Token |

**Security:** The access token is encrypted at rest (Supabase Vault or application-level encryption). The Board UI masks it after entry (shows `••••••xxxx`). The Pipeline API can read it to pass as env var to agents.

### DB Migration

```sql
ALTER TABLE projects
  ADD COLUMN type TEXT CHECK (type IN ('shopify', 'webapp', 'other')),
  ADD COLUMN shopify_store_url TEXT,
  ADD COLUMN shopify_access_token TEXT;

-- Index for pipeline queries
CREATE INDEX idx_projects_type ON projects (type) WHERE type IS NOT NULL;
```

**Decision:** Separate columns over JSONB for `shopify_store_url` and `shopify_access_token` because:
- Type-safe, queryable, validatable at DB level
- Only 2 fields — no need for schema-less flexibility yet
- Encryption can target specific columns

**Token encryption (week one):** Plaintext column for the minimal scope. The agency test uses a manually configured token on the VPS anyway — the Board-stored token is not read by the pipeline yet. Encrypted storage (Supabase Vault / `pgsodium`) is a follow-up ticket before production use.

**RLS consideration:** The `projects` table has RLS via `is_workspace_member()`, meaning any workspace member can read `shopify_access_token` through Supabase client queries. Mitigations:
1. Board API responses explicitly exclude `shopify_access_token` (never returned in GET responses)
2. Board server components use a `select()` that omits the token column
3. Future: column-level encryption via `pgsodium` makes the raw column value useless even if read

---

## 2. Board UI Changes

### 2a. Project Creation — Add Type Selection

**Where:** Project creation flow in `/[workspace]/settings/projects/`

After entering project name/description, a type selector appears:

```
Project Type (optional)
┌─────────────────────────┐
│  Shopify                │  → Expands Shopify config fields
│  Web App                │  → No extra fields
│  Other                  │  → No extra fields
└─────────────────────────┘
```

When "Shopify" is selected:

```
Shopify Store
┌─────────────────────────────────────┐
│  Store URL: _______.myshopify.com   │
│  Access Token: ••••••••••           │
└─────────────────────────────────────┘
```

**Validation:**
- Store URL: required, must match `*.myshopify.com` pattern
- Access Token: required, minimum length, masked after save

### 2b. Project Settings — Edit Type & Config

**Where:** Project settings page (new section or tab)

Existing projects can set/change their type and Shopify config. Same fields as creation. Changing type from `shopify` to something else clears `shopify_store_url` and `shopify_access_token`.

### 2c. No Changes to Ticket UI

The ticket detail sheet already displays `preview_url` as a clickable link. No changes needed — the pipeline writes the Shopify preview URL to this existing field.

---

## 3. Pipeline Changes

### 3a. Read Project Metadata on Ticket Pickup

When the pipeline worker picks up a ticket, it already fetches the project. Extend this to include `type`, `shopify_store_url`, and `shopify_access_token`.

**Flow:**
1. Worker picks ticket → reads `project_id`
2. Fetches project including new fields
3. If `type === 'shopify'`:
   - Sets `SHOPIFY_STORE_URL` and `SHOPIFY_CLI_THEME_TOKEN` as env vars for the agent session
   - Pipeline knows to activate Shopify skills

### 3b. Write Preview URL After Completion

After a Shopify ticket is completed:
1. Pipeline runs `shopify-preview.sh push T-{N} "Title"` → gets preview URL
2. Pipeline PATCHes the ticket: `{ preview_url: "https://store.myshopify.com/?preview_theme_id=XXX" }`
3. Board displays the preview link in the ticket detail

**This already works** — `shopify-preview.sh` generates the URL, `board-api.sh` can PATCH it. The missing piece is orchestrating this in the pipeline completion flow.

### 3c. Minimal Scope (Next Week)

For the agency test, the pipeline reads `shopify_store_url` from the Board but the access token is configured manually on the VPS (in `.env` or `shopify.theme.toml`). This avoids building encrypted token retrieval for next week.

The Board still collects the token (so the UI is complete), but the pipeline doesn't read it from the DB yet — it reads from the local environment.

---

## 4. What Does NOT Change

| Area | Status |
|---|---|
| CLI workflow (`/develop`, `/ship`, etc.) | Unchanged |
| Individual (non-Shopify) projects | Unchanged — type is optional, NULL means "no type" |
| Sidekick | Unchanged — separate ticket |
| Pipeline worker polling logic | Unchanged — just reads extra fields |
| Ticket schema | Unchanged — `preview_url` already exists |
| Agent definitions | Unchanged — Shopify skills already exist |

---

## 5. Implementation Scope — Tickets

### Board (just-ship-board)

| Ticket | Description | Size |
|---|---|---|
| DB Migration | Add `type`, `shopify_store_url`, `shopify_access_token` to projects | XS |
| API: Project CRUD | Extend create/update to accept and validate new fields | S |
| UI: Project Type Selector | Type selection in project creation + settings | S |
| UI: Shopify Config Fields | Store URL + Token fields, validation, masking | S |

### Engine (just-ship)

| Ticket | Description | Size |
|---|---|---|
| Pipeline: Read Project Metadata | Fetch type + Shopify config on ticket pickup, set env vars | S |
| Pipeline: Shopify Preview URL | After completion, run shopify-preview.sh and PATCH preview_url | S |

### Manual (Next Week Only)

| Task | Description |
|---|---|
| VPS: Repo Setup | Clone agency's repo, run `setup.sh`, configure Shopify CLI |
| VPS: Credentials | Set `SHOPIFY_CLI_THEME_TOKEN` in `.env` on VPS |

---

## 6. Future Tickets (Out of Scope)

| Feature | Description |
|---|---|
| GitHub OAuth | Create/connect repos from Board, auto-push |
| Auto-Provisioning | Pipeline creates repo + VPS worktree from Board project type |
| Encrypted Token Retrieval | Pipeline reads Shopify token from DB (encrypted) instead of local env |
| Sidekick Enhancement | Conversational experience for agencies (separate ticket exists) |

---

## 7. Security Considerations

- **Access Token Storage:** Encrypted at rest. Never returned in API responses (write-only from Board, read-only from Pipeline internal). Board UI shows masked value only.
- **Pipeline API:** Existing Bearer token auth unchanged. New fields are project-scoped — a project API key can only read its own Shopify config.
- **VPS:** Token in `.env` file, not in code. `.env` is in `.gitignore`.
