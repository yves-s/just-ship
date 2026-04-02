# P2 — Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an event-driven notification system that routes pipeline events (failures, completions, budget alerts, intake submissions) to configurable channels (Telegram, Slack, Email) per workspace. Secrets stored securely in a separate table with restrictive RLS.

**Architecture:** API-route-based approach (not Edge Functions — they don't exist yet in the project). A new API route `/api/notifications/process` is called by the pipeline event hooks. It reads workspace `notification_config` (JSONB on workspaces table), matches events against rules, resolves secrets from `workspace_secrets`, and dispatches to the appropriate channel. The existing Telegram bot infrastructure (connect/disconnect/verify) and Resend email client are reused.

**Tech Stack:** Next.js 16 API Routes, Supabase (DB + RLS), Resend (email, already integrated), Telegram Bot API, Slack Incoming Webhooks

**Spec:** `docs/specs/p2-agency-layer.md` — Section 4 (Notification-System)

**Target repo:** `just-ship-board` at `/Users/yschleich/Developer/just-ship-board/`

**Important context:**
- Telegram infrastructure exists: connect/disconnect/verify endpoints, `telegram_connections` table (live in DB, no migration file), `telegram-status-indicator.tsx` UI
- Resend is integrated (`resend@6.9.4`): client at `src/lib/email.ts`, used for auth + invite emails
- Desktop notifications already work via Supabase Realtime subscriptions in `use-desktop-notifications.ts`
- Current notification settings page (`settings/notifications/page.tsx`) only has desktop browser notifications
- `workspace_secrets` table and `notification_config` column do NOT exist yet
- Pipeline-DB: `wsmnutkobalfrceavpxs`

---

## File Structure

### New Files (Board Repo)

| File | Responsibility |
|---|---|
| **DB** | |
| `supabase/migrations/020_notification_system.sql` | `workspace_secrets` table + `notification_config` column + RLS + telegram tables backfill |
| **Notification Engine** | |
| `src/lib/notifications/engine.ts` | Core: match event against rules, resolve secrets, dispatch to channels |
| `src/lib/notifications/channels/telegram.ts` | Send Telegram message via Bot API |
| `src/lib/notifications/channels/slack.ts` | Send Slack message via Incoming Webhook |
| `src/lib/notifications/channels/email.ts` | Send email notification via Resend |
| `src/lib/notifications/format.ts` | Format notification messages per event type (human-readable) |
| `src/lib/notifications/types.ts` | TypeScript types for notification config, rules, secrets |
| **API** | |
| `src/app/api/notifications/process/route.ts` | POST — process a notification event (pipeline-key auth) |
| `src/app/api/workspace/[workspaceId]/notifications/route.ts` | GET/PATCH — read/update notification config (Board auth) |
| `src/app/api/workspace/[workspaceId]/secrets/route.ts` | GET/POST/DELETE — manage channel secrets (Board auth, owner only) |
| **UI** | |
| `src/components/settings/notification-rules-editor.tsx` | UI for configuring notification rules per event type |
| `src/components/settings/channel-secrets-manager.tsx` | UI for adding/removing channel secrets (Slack webhook, etc.) |

### Modified Files (Board Repo)

| File | Changes |
|---|---|
| `src/components/settings/notification-settings.tsx` | Add sections for channel config below existing desktop notifications |
| `src/lib/supabase/middleware.ts` | Add `/api/notifications` to public routes (pipeline-key auth) |

---

## Task 1: DB Migration — workspace_secrets, notification_config, telegram backfill

**Files:**
- Create: `supabase/migrations/020_notification_system.sql`

- [ ] **Step 1: Apply migration via Supabase MCP**

Run against Pipeline-DB `wsmnutkobalfrceavpxs`:

```sql
-- ============================================
-- Notification Config on Workspaces
-- ============================================

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS notification_config jsonb DEFAULT '{"rules": []}';

COMMENT ON COLUMN workspaces.notification_config IS 'Notification routing rules: which events go to which channels.';

-- ============================================
-- Workspace Secrets (channel credentials)
-- ============================================

CREATE TABLE IF NOT EXISTS workspace_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,
  secret_key text NOT NULL,
  encrypted_value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, channel, secret_key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_secrets_workspace ON workspace_secrets(workspace_id);

ALTER TABLE workspace_secrets ENABLE ROW LEVEL SECURITY;

-- Only workspace owner/admin can manage secrets
CREATE POLICY "workspace_admin_select_secrets"
  ON workspace_secrets FOR SELECT
  USING (is_workspace_admin(workspace_id));

CREATE POLICY "workspace_admin_insert_secrets"
  ON workspace_secrets FOR INSERT
  WITH CHECK (is_workspace_admin(workspace_id));

CREATE POLICY "workspace_admin_update_secrets"
  ON workspace_secrets FOR UPDATE
  USING (is_workspace_admin(workspace_id));

CREATE POLICY "workspace_admin_delete_secrets"
  ON workspace_secrets FOR DELETE
  USING (is_workspace_admin(workspace_id));

-- ============================================
-- Telegram Tables Backfill (already live, need migration file)
-- ============================================

CREATE TABLE IF NOT EXISTS telegram_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  telegram_user_id bigint NOT NULL UNIQUE,
  telegram_username text,
  connected_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  code text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

- [ ] **Step 2: Save migration file**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/020_notification_system.sql
git commit -m "feat: add notification system DB schema (workspace_secrets, notification_config, telegram backfill)"
```

---

## Task 2: Notification Engine — Types, Formatter, Channel Dispatchers

**Files:**
- Create: `src/lib/notifications/types.ts`
- Create: `src/lib/notifications/format.ts`
- Create: `src/lib/notifications/channels/telegram.ts`
- Create: `src/lib/notifications/channels/slack.ts`
- Create: `src/lib/notifications/channels/email.ts`
- Create: `src/lib/notifications/engine.ts`

- [ ] **Step 1: Create notification types**

Create `src/lib/notifications/types.ts`:

```typescript
export type NotificationChannel = "telegram" | "slack" | "email";
export type NotificationSeverity = "low" | "medium" | "high";

export type NotificationEventType =
  | "pipeline_failed"
  | "pipeline_completed"
  | "ticket_completed"
  | "budget_threshold"
  | "budget_exceeded"
  | "agent_stuck"
  | "intake_submitted"
  | "intake_ready";

export interface NotificationRule {
  event: NotificationEventType;
  channels: NotificationChannel[];
  severity: NotificationSeverity;
}

export interface NotificationConfig {
  rules: NotificationRule[];
}

export interface NotificationPayload {
  event_type: NotificationEventType;
  workspace_id: string;
  workspace_name?: string;
  ticket_number?: number;
  ticket_title?: string;
  project_name?: string;
  agent_type?: string;
  cost_usd?: number;
  budget_ceiling_usd?: number;
  intake_title?: string;
  client_name?: string;
  details?: string;
}

export interface ChannelSecrets {
  telegram?: { bot_token: string; chat_id: string };
  slack?: { webhook_url: string };
  email?: { recipients: string };
}
```

- [ ] **Step 2: Create message formatter**

Create `src/lib/notifications/format.ts` — formats human-readable messages per event type. Messages should be concise, include T-{number} for tickets, and use Markdown for Telegram / plain text for Slack.

- [ ] **Step 3: Create channel dispatchers**

Create three files under `src/lib/notifications/channels/`:
- `telegram.ts` — `sendTelegram(chatId, botToken, message)` using Telegram Bot API
- `slack.ts` — `sendSlack(webhookUrl, message)` using Incoming Webhook
- `email.ts` — `sendNotificationEmail(to, subject, html)` using existing Resend client from `src/lib/email.ts`

Each dispatcher: fire-and-forget, catch errors and log (don't throw), return `{ success: boolean; error?: string }`.

- [ ] **Step 4: Create notification engine**

Create `src/lib/notifications/engine.ts`:
- `processNotification(payload: NotificationPayload)` — main entry point
- Reads workspace `notification_config` via service client
- Matches `payload.event_type` against rules
- For each matching channel: resolve secrets from `workspace_secrets`, dispatch
- Returns summary of what was sent

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/
git commit -m "feat: add notification engine with Telegram, Slack, and Email channels"
```

---

## Task 3: API Routes — Process, Config, Secrets

**Files:**
- Create: `src/app/api/notifications/process/route.ts`
- Create: `src/app/api/workspace/[workspaceId]/notifications/route.ts`
- Create: `src/app/api/workspace/[workspaceId]/secrets/route.ts`
- Modify: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Add /api/notifications to middleware public routes**

In `src/lib/supabase/middleware.ts`, add:
```typescript
request.nextUrl.pathname.startsWith("/api/notifications") ||
```

- [ ] **Step 2: Create POST /api/notifications/process**

Pipeline-key authenticated. Accepts `NotificationPayload`, calls `processNotification()`. This is what the pipeline's event hooks call after writing a task_event.

- [ ] **Step 3: Create GET/PATCH /api/workspace/[workspaceId]/notifications**

Board auth. GET returns current `notification_config`. PATCH updates it (Zod-validated).

- [ ] **Step 4: Create GET/POST/DELETE /api/workspace/[workspaceId]/secrets**

Board auth (admin only). GET lists secrets (masked values). POST adds a secret. DELETE removes a secret. Secret values stored as-is (application-level, not encrypted for MVP — can upgrade to Supabase Vault later).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/notifications/ src/app/api/workspace/*/notifications/ src/app/api/workspace/*/secrets/ src/lib/supabase/middleware.ts
git commit -m "feat: add notification API routes (process, config, secrets)"
```

---

## Task 4: Settings UI — Notification Rules + Channel Secrets

**Files:**
- Create: `src/components/settings/notification-rules-editor.tsx`
- Create: `src/components/settings/channel-secrets-manager.tsx`
- Modify: `src/components/settings/notification-settings.tsx`

- [ ] **Step 1: Create NotificationRulesEditor**

Table-style editor showing all event types with toggleable channels per event:

| Event | Telegram | Slack | Email | Severity |
|---|---|---|---|---|
| Pipeline Failed | [x] | [ ] | [x] | high |
| Ticket Completed | [ ] | [x] | [ ] | low |

Toggle = checkbox. Severity = dropdown. Save button calls PATCH `/api/workspace/[workspaceId]/notifications`.

- [ ] **Step 2: Create ChannelSecretsManager**

Per-channel accordion/card sections:
- **Telegram**: Shows connection status (reuse existing `telegram-status-indicator` logic), chat_id input
- **Slack**: Webhook URL input (masked after save)
- **Email**: Recipients input (comma-separated)

Each section: "Save" button calls POST `/api/workspace/[workspaceId]/secrets`. "Remove" calls DELETE.

- [ ] **Step 3: Integrate into notification-settings.tsx**

Add the new sections below the existing desktop notifications:
1. Desktop Notifications (existing)
2. Notification Rules (new)
3. Channel Configuration (new)

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/notification-rules-editor.tsx src/components/settings/channel-secrets-manager.tsx src/components/settings/notification-settings.tsx
git commit -m "feat: add notification settings UI (rules editor, channel secrets manager)"
```

---

## Task 5: Pipeline Integration Hook

**Files:**
- Modify: `src/app/api/events/route.ts` (or new helper)

- [ ] **Step 1: Fire notification after event creation**

In the events API route, after successfully creating a task_event, fire a notification if the event type matches known notification triggers. This is a fire-and-forget call to the notification engine (no await needed — don't block event creation).

Map event types:
- `event_type` contains "fail"/"error" + `agent_type` is "orchestrator" → `pipeline_failed`
- `event_type` contains "complet"/"done" + `agent_type` is "orchestrator" → `pipeline_completed`
- Ticket status changes to "done" → `ticket_completed`

- [ ] **Step 2: Commit**

```bash
git add src/app/api/events/route.ts
git commit -m "feat: trigger notifications on pipeline events"
```

---

## Task 6: Build Check + Verification

- [ ] **Step 1: Run build**

```bash
npm run build
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

- [ ] **Step 3: Verify**

- Settings page loads with new sections
- Notification rules can be toggled and saved
- Secrets can be added (masked display) and removed
- API routes respond correctly (auth, validation)

- [ ] **Step 4: Commit fixes if any**

---

## Acceptance Criteria Checklist

| Criterion | Task |
|---|---|
| Edge Function triggert bei relevanten task_events | Task 5 (pipeline hook fires notifications) |
| Notification-Rules pro Workspace konfigurierbar | Task 4 (rules editor UI) + Task 3 (config API) |
| Secrets in separater Tabelle mit restriktiver RLS | Task 1 (workspace_secrets + admin-only RLS) |
| Telegram: Nachricht wird gesendet | Task 2 (telegram channel dispatcher) |
| Slack: Webhook wird aufgerufen | Task 2 (slack channel dispatcher) |
| Email: Resend API wird aufgerufen | Task 2 (email channel dispatcher) |
| Nicht-konfigurierte Events werden ignoriert | Task 2 (engine only dispatches matching rules) |
