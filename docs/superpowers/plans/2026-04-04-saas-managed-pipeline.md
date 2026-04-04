# SaaS Managed Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Just Ship into a SaaS product where agencies/freelancers sign up in the Board, pick a subscription, connect GitHub, and run pipelines on a shared VPS pool — no local setup needed.

**Architecture:** The Board becomes the central SaaS interface. A Stripe-backed subscription + credit system handles billing. A GitHub App replaces PATs. A new Dispatcher in the Board routes pipeline runs to a shared VPS pool. The Pipeline Server gets an extended launch payload for ephemeral SaaS runs. Self-hosted mode remains untouched.

**Tech Stack:** Next.js 16 (Board), Supabase (DB + RLS), Stripe (Billing), GitHub Apps API, Node.js Pipeline Server, Docker

**Spec:** `docs/superpowers/specs/2026-04-01-saas-managed-pipeline-design.md`

---

## File Structure

### Board (`just-ship-board`)

**New files:**
- `supabase/migrations/029_saas_billing.sql` — New tables: subscriptions, credit_balances, credit_transactions, billing_config, github_installations, pipeline_runs, pipeline_queue, pool_vps + workspace extensions
- `src/lib/stripe/client.ts` — Stripe SDK initialization
- `src/lib/stripe/webhooks.ts` — Stripe webhook signature verification + event handlers
- `src/lib/stripe/credits.ts` — Credit grant, deduction, balance check functions
- `src/lib/github/app.ts` — GitHub App JWT generation, Installation Token creation
- `src/lib/github/repos.ts` — List repos for an installation
- `src/lib/dispatcher/dispatch.ts` — Pool VPS selection, queue management, callback handling
- `src/lib/dispatcher/health.ts` — Pool VPS health checking
- `src/lib/validations/billing.ts` — Zod schemas for billing operations
- `src/lib/validations/github.ts` — Zod schemas for GitHub operations
- `src/app/api/billing/webhook/route.ts` — Stripe webhook endpoint
- `src/app/api/billing/checkout/route.ts` — Create Stripe Checkout session
- `src/app/api/billing/topup/route.ts` — Credit topup checkout
- `src/app/api/billing/portal/route.ts` — Stripe Customer Portal redirect
- `src/app/api/auth/github/callback/route.ts` — GitHub App installation callback
- `src/app/api/github/repos/route.ts` — List repos for workspace's GitHub installation
- `src/app/api/github/webhook/route.ts` — GitHub App webhooks (installation events)
- `src/app/api/v1/pipeline/callback/route.ts` — SaaS pipeline run callback endpoint
- `src/app/api/dispatcher/launch/route.ts` — SaaS pipeline launch (dispatches to pool VPS)
- `src/app/(main)/[slug]/settings/billing/page.tsx` — Billing settings page
- `src/app/(main)/[slug]/settings/github/page.tsx` — GitHub connection page
- `src/components/settings/billing-view.tsx` — Billing UI (plan, credits, history)
- `src/components/settings/github-view.tsx` — GitHub connection UI
- `src/components/shared/credit-badge.tsx` — Credit balance display for sidebar
- `src/components/onboarding/mode-selection.tsx` — Self-Hosted vs. SaaS choice

**Modified files:**
- `src/lib/types.ts` — Add Workspace.mode, Workspace.plan, Project.source, new type interfaces
- `src/lib/constants.ts` — Add SaaS-related constants (plans, modes, queue priorities)
- `src/lib/workspace-context.tsx` — Expose mode/plan in context
- `src/components/settings/settings-nav.tsx` — Add Billing + GitHub nav items (SaaS only)
- `src/components/layout/sidebar.tsx` — Add credit badge (SaaS only)
- `src/app/api/pipeline/trigger/route.ts` — Route SaaS workspaces to dispatcher instead of VPS proxy
- `src/middleware.ts` — Add GitHub callback + Stripe webhook to public routes
- `.env.example` — Add Stripe + GitHub App env vars

### Pipeline (`just-ship`)

**Modified files:**
- `pipeline/server.ts` — Handle extended SaaS launch payload (repo_url, github_token, callback_url, run_id, run_token, project_config)
- `pipeline/run.ts` — Return token totals from executePipeline()
- `pipeline/lib/server-config.ts` — Support ephemeral SaaS project config alongside persistent projects

---

## Tasks

### Task 1: Database Migration — SaaS Tables

**Context:** All new tables for billing, GitHub integration, pipeline runs, and queue management. This is the foundation everything else builds on.

**Repo:** `just-ship-board`

**Files:**
- Create: `supabase/migrations/029_saas_billing.sql`

- [ ] **Step 1: Write the migration SQL**

Note: Migration `028_client_url.sql` already exists — this is `029`. The existing `vps_instances` table (from `015_vps_update_tables.sql`) has columns for self-hosted VPS (hostname, endpoint_url, update_secret, status, is_canary). We create a separate `pool_vps` table for the SaaS shared pool to avoid schema conflicts.

```sql
-- ============================================================
-- SaaS Managed Pipeline — Core Tables
-- ============================================================

-- 1. Extend workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'self_hosted'
    CHECK (mode IN ('self_hosted', 'saas')),
  ADD COLUMN IF NOT EXISTS plan text
    CHECK (plan IN ('starter', 'agency', 'enterprise')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- 2. Extend projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS repo_url text,
  ADD COLUMN IF NOT EXISTS github_repo_id bigint,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'local'
    CHECK (source IN ('local', 'saas'));

-- 3. Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL UNIQUE,
  plan text NOT NULL CHECK (plan IN ('starter', 'agency', 'enterprise')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Credit balances
CREATE TABLE IF NOT EXISTS credit_balances (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Credit transactions (append-only ledger)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL
    CHECK (type IN ('subscription_grant', 'topup', 'pipeline_usage', 'refund', 'adjustment')),
  amount integer NOT NULL,
  description text,
  pipeline_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_transactions_workspace
  ON credit_transactions(workspace_id, created_at DESC);

-- 6. Billing config (key-value)
CREATE TABLE IF NOT EXISTS billing_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO billing_config (key, value) VALUES
  ('tokens_per_credit', '10000'),
  ('min_balance_credits', '5')
ON CONFLICT (key) DO NOTHING;

-- 7. GitHub installations
CREATE TABLE IF NOT EXISTS github_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  github_installation_id bigint NOT NULL,
  account_login text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_github_installations_workspace
  ON github_installations(workspace_id) WHERE deleted_at IS NULL;

-- 8. Pipeline runs
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_number integer NOT NULL,
  pool_vps_id uuid,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'timeout')),
  pr_url text,
  tokens_input integer NOT NULL DEFAULT 0,
  tokens_output integer NOT NULL DEFAULT 0,
  credits_charged integer NOT NULL DEFAULT 0,
  duration_seconds integer,
  error_message text,
  run_token text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_runs_workspace ON pipeline_runs(workspace_id, created_at DESC);
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status) WHERE status IN ('queued', 'running');

-- 9. Pipeline queue
CREATE TABLE IF NOT EXISTS pipeline_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_number integer NOT NULL,
  priority integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'dispatched', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_queue_waiting
  ON pipeline_queue(priority DESC, created_at ASC) WHERE status = 'waiting';

-- 10. Pool VPS instances (separate from vps_instances which is for self-hosted)
-- vps_instances (015_vps_update_tables.sql) has: workspace_id (NOT NULL), hostname,
-- endpoint_url, update_secret, status, is_canary — designed for self-hosted VPS.
-- pool_vps is for the SaaS shared pool where VPS are operator-owned, not workspace-scoped.
CREATE TABLE IF NOT EXISTS pool_vps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  pipeline_key text NOT NULL,
  capacity_status text NOT NULL DEFAULT 'offline'
    CHECK (capacity_status IN ('idle', 'running', 'draining', 'offline')),
  current_run_id uuid REFERENCES pipeline_runs(id),
  last_health_check timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK from pipeline_runs to pool_vps
ALTER TABLE pipeline_runs
  ADD CONSTRAINT fk_pipeline_runs_pool_vps
  FOREIGN KEY (pool_vps_id) REFERENCES pool_vps(id);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_vps ENABLE ROW LEVEL SECURITY;

-- Subscriptions: workspace members can read
CREATE POLICY subscriptions_read ON subscriptions
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Credit balances: workspace members can read
CREATE POLICY credit_balances_read ON credit_balances
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Credit transactions: workspace members can read
CREATE POLICY credit_transactions_read ON credit_transactions
  FOR SELECT USING (is_workspace_member(workspace_id));

-- GitHub installations: workspace members can read
CREATE POLICY github_installations_read ON github_installations
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Pipeline runs: workspace members can read
CREATE POLICY pipeline_runs_read ON pipeline_runs
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Pipeline queue: workspace members can read
CREATE POLICY pipeline_queue_read ON pipeline_queue
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Billing config: readable by all authenticated users (non-sensitive)
CREATE POLICY billing_config_read ON billing_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Pool VPS: no user reads (service role only, operator manages)

-- Write policies: service role only (no user writes to billing tables)
-- Default: RLS blocks all writes for authenticated users. Service role bypasses RLS.
```

- [ ] **Step 2: Apply migration**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 3: Verify tables exist**

Run via Supabase MCP: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('subscriptions', 'credit_balances', 'credit_transactions', 'billing_config', 'github_installations', 'pipeline_runs', 'pipeline_queue', 'pool_vps');`
Expected: All 8 tables listed.

- [ ] **Step 4: Commit**

```bash
cd /Users/yschleich/Developer/just-ship-board
git add supabase/migrations/029_saas_billing.sql
git commit -m "feat: add SaaS billing, GitHub, and pipeline run tables"
```

---

### Task 2: TypeScript Types & Constants

**Context:** Add all new types, interfaces, and constants needed across the Board. This unblocks all subsequent tasks.

**Repo:** `just-ship-board`

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Add types to `src/lib/types.ts`**

Add the following types after the existing type definitions:

```typescript
// ============================================================
// SaaS Types
// ============================================================

export type WorkspaceMode = 'self_hosted' | 'saas'
export type WorkspacePlan = 'starter' | 'agency' | 'enterprise'
export type ProjectSource = 'local' | 'saas'
export type PipelineRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout'
export type QueueEntryStatus = 'waiting' | 'dispatched' | 'expired'
export type CreditTransactionType = 'subscription_grant' | 'topup' | 'pipeline_usage' | 'refund' | 'adjustment'
export type VpsCapacityStatus = 'idle' | 'running' | 'draining' | 'offline'

export interface Subscription {
  id: string
  workspace_id: string
  stripe_subscription_id: string
  plan: WorkspacePlan
  status: 'active' | 'canceled' | 'past_due' | 'trialing'
  current_period_start: string | null
  current_period_end: string | null
  created_at: string
  updated_at: string
}

export interface CreditBalance {
  workspace_id: string
  balance: number
  updated_at: string
}

export interface CreditTransaction {
  id: string
  workspace_id: string
  type: CreditTransactionType
  amount: number
  description: string | null
  pipeline_run_id: string | null
  created_at: string
}

export interface GitHubInstallation {
  id: string
  workspace_id: string
  github_installation_id: number
  account_login: string
  deleted_at: string | null
  created_at: string
}

export interface PipelineRun {
  id: string
  workspace_id: string
  project_id: string
  ticket_number: number
  vps_instance_id: string | null
  status: PipelineRunStatus
  pr_url: string | null
  tokens_input: number
  tokens_output: number
  credits_charged: number
  duration_seconds: number | null
  error_message: string | null
  run_token: string
  queued_at: string
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface PipelineQueueEntry {
  id: string
  workspace_id: string
  project_id: string
  ticket_number: number
  priority: number
  status: QueueEntryStatus
  created_at: string
}

export interface PoolVps {
  id: string
  url: string
  pipeline_key: string
  capacity_status: VpsCapacityStatus
  current_run_id: string | null
  last_health_check: string | null
  consecutive_failures: number
  version: string | null
  created_at: string
}

export interface SaasLaunchPayload {
  ticket_number: number
  project_id: string
  run_id: string
  run_token: string
  repo_url: string
  github_token: string
  callback_url: string
  project_config: {
    project_name: string
    stack?: Record<string, string>
    pipeline?: Record<string, unknown>
  }
}

export interface PipelineCallback {
  run_id: string
  status: 'completed' | 'failed' | 'timeout'
  pr_url?: string
  tokens_used: { input: number; output: number }
  duration_seconds: number
  error_message?: string
}
```

Also extend the existing `Workspace` interface:

```typescript
// Add to existing Workspace interface:
mode: WorkspaceMode
plan: WorkspacePlan | null
stripe_customer_id: string | null
```

And extend the existing `Project` interface:

```typescript
// Add to existing Project interface:
repo_url: string | null
github_repo_id: number | null
source: ProjectSource
```

- [ ] **Step 2: Add constants to `src/lib/constants.ts`**

```typescript
// ============================================================
// SaaS Constants
// ============================================================

export const WORKSPACE_MODES = {
  SELF_HOSTED: 'self_hosted',
  SAAS: 'saas',
} as const

export const PLANS = {
  STARTER: 'starter',
  AGENCY: 'agency',
  ENTERPRISE: 'enterprise',
} as const

export const PLAN_LIMITS = {
  starter: { maxProjects: 3, maxMembers: 1, maxConcurrentRuns: 1, queuePriority: 1 },
  agency: { maxProjects: -1, maxMembers: 5, maxConcurrentRuns: 3, queuePriority: 10 },
  enterprise: { maxProjects: -1, maxMembers: -1, maxConcurrentRuns: 10, queuePriority: 20 },
} as const

export const QUEUE_AGING_INTERVAL_SECONDS = 300 // +1 priority every 5 minutes
export const QUEUE_MAX_WAIT_SECONDS = 1800 // 30 minutes
export const VPS_HEALTH_CHECK_INTERVAL_MS = 60_000
export const VPS_HEALTH_CHECK_TIMEOUT_MS = 5_000
export const VPS_HEALTH_CHECK_FAILURE_THRESHOLD = 3

export const PIPELINE_RUN_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/constants.ts
git commit -m "feat: add SaaS types and constants"
```

---

### Task 3: Stripe Integration — Server Setup + Webhook

**Context:** Stripe SDK setup, webhook handler for subscription lifecycle events, and credit management functions. This is the billing backbone.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/lib/stripe/client.ts`
- Create: `src/lib/stripe/webhooks.ts`
- Create: `src/lib/stripe/credits.ts`
- Create: `src/lib/validations/billing.ts`
- Create: `src/app/api/billing/webhook/route.ts`
- Modify: `.env.example`
- Modify: `src/middleware.ts`

- [ ] **Step 1: Install Stripe SDK**

Run: `cd /Users/yschleich/Developer/just-ship-board && npm install stripe`

- [ ] **Step 2: Add env vars to `.env.example`**

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_AGENCY_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Step 3: Create `src/lib/stripe/client.ts`**

```typescript
import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
```

- [ ] **Step 4: Create `src/lib/stripe/credits.ts`**

Credit management functions using Supabase service role client. Functions:
- `grantCredits(workspaceId, amount, type, description)` — Insert transaction + update balance (atomic via RPC or transaction)
- `deductCredits(workspaceId, amount, pipelineRunId, description)` — Deduct with balance check
- `getBalance(workspaceId)` — Read current balance
- `hasMinimumBalance(workspaceId, minCredits)` — Check if enough credits for a run

All writes go through service role (bypasses RLS). Use `supabase.rpc()` or explicit transactions to ensure atomicity between `credit_transactions` insert and `credit_balances` update.

- [ ] **Step 5: Create `src/lib/stripe/webhooks.ts`**

Webhook event handlers:
- `checkout.session.completed` — Create subscription record, set workspace plan/mode, grant initial credits, create credit_balance row
- `invoice.paid` — Monthly renewal: grant credits for new period
- `customer.subscription.updated` — Plan changes: update subscription + workspace.plan
- `customer.subscription.deleted` — Cancellation: update status, keep credits until period end

All handlers verify signature via `stripe.webhooks.constructEvent()`.

- [ ] **Step 6: Create `src/lib/validations/billing.ts`**

Zod schemas:
- `checkoutSchema` — `{ plan: z.enum(['starter', 'agency']), workspace_id: z.string().uuid() }`
- `topupSchema` — `{ amount: z.number().positive(), workspace_id: z.string().uuid() }`

- [ ] **Step 7: Create `src/app/api/billing/webhook/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { handleWebhookEvent } from '@/lib/stripe/webhooks'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  await handleWebhookEvent(event)
  return NextResponse.json({ received: true })
}
```

- [ ] **Step 8: Add webhook route to public paths in middleware**

In `src/middleware.ts`, add `/api/billing/webhook` to the list of routes that bypass auth.

- [ ] **Step 9: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx tsc --noEmit`

- [ ] **Step 10: Commit**

```bash
git add src/lib/stripe/ src/lib/validations/billing.ts src/app/api/billing/webhook/ .env.example src/middleware.ts
git commit -m "feat: add Stripe integration with webhook handler and credit system"
```

---

### Task 4: Stripe Checkout & Customer Portal Endpoints

**Context:** API endpoints for creating checkout sessions (new subscriptions + credit topups) and managing existing subscriptions via Stripe Customer Portal.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/app/api/billing/checkout/route.ts`
- Create: `src/app/api/billing/topup/route.ts`
- Create: `src/app/api/billing/portal/route.ts`

- [ ] **Step 1: Create checkout endpoint**

`POST /api/billing/checkout` — Creates a Stripe Checkout session for a new subscription.
- Auth: verify Supabase session + workspace membership via `is_workspace_member()` RLS (follow pattern from `src/app/api/pipeline/trigger/route.ts`)
- Input: `{ plan: 'starter' | 'agency', workspace_id }`
- Creates Stripe customer if none exists, stores `stripe_customer_id` on workspace
- Returns: `{ url: session.url }` (redirect to Stripe)
- Success URL: `/{slug}/settings/billing?session_id={CHECKOUT_SESSION_ID}`
- Cancel URL: `/{slug}/settings/billing`

- [ ] **Step 2: Create topup endpoint**

`POST /api/billing/topup` — Creates a one-time Stripe Checkout for credit purchase.
- Auth: Supabase session + workspace membership (follow existing pattern from `src/app/api/pipeline/trigger/route.ts`)
- Input: `{ amount: number, workspace_id }` (amount in credits)
- Creates Stripe Checkout session with `mode: 'payment'`
- Metadata: `{ workspace_id, credits: amount }`
- Webhook handles credit grant on `checkout.session.completed` with `mode === 'payment'`

- [ ] **Step 3: Create portal endpoint**

`POST /api/billing/portal` — Redirects to Stripe Customer Portal for subscription management.
- Auth: Supabase session + workspace membership (follow existing pattern from `src/app/api/pipeline/trigger/route.ts`)
- Input: `{ workspace_id }`
- Returns: `{ url: portalSession.url }`

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/billing/
git commit -m "feat: add Stripe checkout, topup, and portal endpoints"
```

---

### Task 5: GitHub App Integration

**Context:** GitHub App authentication, Installation Token generation, repo listing, and webhook handler for installation lifecycle events.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/lib/github/app.ts`
- Create: `src/lib/github/repos.ts`
- Create: `src/lib/validations/github.ts`
- Create: `src/app/api/auth/github/callback/route.ts`
- Create: `src/app/api/github/repos/route.ts`
- Create: `src/app/api/github/webhook/route.ts`
- Modify: `.env.example`
- Modify: `src/middleware.ts`

- [ ] **Step 1: Add GitHub App env vars to `.env.example`**

```env
# GitHub App
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_CLIENT_ID=Iv1.abc123
GITHUB_APP_CLIENT_SECRET=secret123
GITHUB_APP_WEBHOOK_SECRET=whsec_...
```

- [ ] **Step 2: Create `src/lib/github/app.ts`**

Functions:
- `createAppJWT()` — Generate JWT from App ID + Private Key (RS256, 10 min expiry). Use `jsonwebtoken` package.
- `getInstallationToken(installationId)` — POST `/app/installations/{id}/access_tokens` with JWT. Returns short-lived token.
- `getInstallationRepos(installationId)` — List repos accessible to an installation.

- [ ] **Step 3: Install jsonwebtoken**

Run: `cd /Users/yschleich/Developer/just-ship-board && npm install jsonwebtoken && npm install -D @types/jsonwebtoken`

- [ ] **Step 4: Create `src/lib/github/repos.ts`**

```typescript
import { getInstallationToken } from './app'

export async function listRepos(installationId: number) {
  const token = await getInstallationToken(installationId)
  const res = await fetch('https://api.github.com/installation/repositories', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = await res.json()
  return data.repositories as Array<{ id: number; full_name: string; html_url: string; private: boolean }>
}
```

- [ ] **Step 5: Create GitHub App installation callback**

`GET /api/auth/github/callback?installation_id=123&setup_action=install` — Handles redirect from GitHub after user installs the app.
- Reads `installation_id` from query params
- Stores in `github_installations` table with workspace_id (from session or state param)
- Redirects to `/{slug}/settings/github`

- [ ] **Step 6: Create repos listing endpoint**

`GET /api/github/repos?workspace_id=...` — Returns repos accessible to workspace's GitHub installation.
- Auth: Supabase session + workspace membership (follow existing pattern from `src/app/api/pipeline/trigger/route.ts`)
- Looks up `github_installations` for workspace
- Calls `listRepos(installationId)`
- Returns repo list

- [ ] **Step 7: Create GitHub webhook handler**

`POST /api/github/webhook` — Handles GitHub App events.
- Verify webhook signature using `GITHUB_APP_WEBHOOK_SECRET`
- Handle `installation.deleted` — mark `github_installations.deleted_at`, expire queued runs
- Handle `installation.suspend` — similar

- [ ] **Step 8: Add GitHub routes to public paths in middleware**

Add `/api/auth/github/callback` and `/api/github/webhook` to bypass list.

- [ ] **Step 9: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx tsc --noEmit`

- [ ] **Step 10: Commit**

```bash
git add src/lib/github/ src/lib/validations/github.ts src/app/api/auth/github/ src/app/api/github/ .env.example src/middleware.ts
git commit -m "feat: add GitHub App integration with installation callback and repo listing"
```

---

### Task 6: Dispatcher — Pool VPS Selection + Queue + Callback

**Context:** The core routing logic that makes SaaS work. Selects a free VPS from the pool, queues if all busy, and processes callbacks from completed runs.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/lib/dispatcher/dispatch.ts`
- Create: `src/lib/dispatcher/health.ts`
- Create: `src/app/api/dispatcher/launch/route.ts`
- Create: `src/app/api/v1/pipeline/callback/route.ts`

- [ ] **Step 1: Create `src/lib/dispatcher/dispatch.ts`**

Functions:
- `dispatchRun(workspaceId, projectId, ticketNumber)` — Main dispatch logic:
  1. Check workspace mode === 'saas'
  2. Check credit balance >= minimum
  3. Check workspace concurrent run limit (query active `pipeline_runs`)
  4. Get GitHub installation → generate fresh Installation Token
  5. Get project → build `SaasLaunchPayload`
  6. Find idle VPS from `pool_vps` where `capacity_status = 'idle'`
  7. If found: create `pipeline_runs` row, generate `run_token` (HMAC-SHA256 of run_id + VPS pipeline_key), POST to VPS, update `pool_vps.capacity_status = 'running'`
  8. If none found: insert into `pipeline_queue`, return queue position
- `processQueue()` — Called after a run completes. Picks next `waiting` entry (ordered by effective priority with aging), dispatches it.
- `generateRunToken(runId, pipelineKey)` — HMAC-SHA256
- `verifyRunToken(runId, token, pipelineKey)` — Verify HMAC

- [ ] **Step 2: Create `src/lib/dispatcher/health.ts`**

Functions:
- `checkVpsHealth(poolVps)` — GET `/health` with 5s timeout, update `capacity_status`, `last_health_check`, and `consecutive_failures` in `pool_vps` table. Parse existing health response format: `{ status, mode, running: { ticket_number, ... } | null }`. Map `running !== null` → capacity `running`, `running === null` → capacity `idle`.
- `checkAllPoolVps()` — Iterate all `pool_vps` rows, check health, mark `offline` after 3 consecutive failures. Reset `consecutive_failures` on success.

Note: The existing VPS `/health` endpoint does not return a `capacity` field. The health checker infers capacity from the `running` field in the response.

- [ ] **Step 3: Create launch API endpoint**

`POST /api/dispatcher/launch` — SaaS pipeline launch.
- Auth: Supabase session + workspace membership (follow existing pattern from `src/app/api/pipeline/trigger/route.ts`)
- Input: `{ workspace_id, project_id, ticket_number }`
- Calls `dispatchRun()`
- Returns: `{ status: 'dispatched', run_id }` or `{ status: 'queued', position }`

- [ ] **Step 4: Create callback endpoint**

`POST /api/v1/pipeline/callback` — VPS calls this after a run completes.
- Auth: `X-Run-Token` header → verify HMAC against VPS's pipeline_key
- Input: `PipelineCallback` body
- Updates `pipeline_runs` row (status, tokens, duration, pr_url, error)
- Deducts credits: `(tokens_input + tokens_output) / tokens_per_credit`
- Updates `pool_vps.capacity_status = 'idle'`, clears `current_run_id`
- Updates ticket status (completed → in_review, failed → in_progress)
- Calls `processQueue()` to dispatch next waiting run
- Idempotent on `run_id` (ignore if already completed)

- [ ] **Step 5: Add callback route to public paths in middleware**

Add `/api/v1/pipeline/callback` to bypass list (authenticated via run_token, not session).

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/lib/dispatcher/ src/app/api/dispatcher/ src/app/api/v1/pipeline/callback/ src/middleware.ts
git commit -m "feat: add pipeline dispatcher with pool VPS selection, queue, and callback"
```

---

### Task 7: Pipeline Trigger Routing — SaaS vs. Self-Hosted

**Context:** The existing `/api/pipeline/trigger` endpoint proxies to a workspace's VPS. For SaaS workspaces, it should route to the dispatcher instead.

**Repo:** `just-ship-board`

**Files:**
- Modify: `src/app/api/pipeline/trigger/route.ts`

- [ ] **Step 1: Read the existing trigger route**

Read: `src/app/api/pipeline/trigger/route.ts`

- [ ] **Step 2: Add SaaS routing**

At the top of the POST handler, after workspace auth:
1. Query `workspace.mode`
2. If `mode === 'saas'`: call `dispatchRun()` from `src/lib/dispatcher/dispatch.ts` instead of proxying to VPS
3. If `mode === 'self_hosted'`: existing proxy logic (unchanged)

This is the central routing decision from the spec's dispatcher routing diagram.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/pipeline/trigger/route.ts
git commit -m "feat: route SaaS workspaces to dispatcher, self-hosted to VPS proxy"
```

---

### Task 8: Pipeline Server — Extended SaaS Launch Payload

**Context:** The VPS pipeline server needs to handle the new SaaS launch payload with `repo_url`, `github_token`, `callback_url`, and `project_config`. It clones the repo ephemerally, runs the pipeline, sends a callback, and cleans up.

**Repo:** `just-ship` (engine)

**Files:**
- Modify: `pipeline/server.ts`
- Modify: `pipeline/run.ts`
- Modify: `pipeline/lib/server-config.ts`

- [ ] **Step 1: Read current server.ts launch handler**

Read: `pipeline/server.ts` (focus on `handleLaunch` function)

- [ ] **Step 2: Extend launch handler for SaaS mode**

In `handleLaunch()`, detect SaaS mode by checking if `req.body.repo_url` is present:

If SaaS mode:
1. Extract `repo_url`, `github_token`, `run_id`, `run_token`, `callback_url`, `project_config` from body
2. Create temp directory: `/tmp/run-${run_id}/`
3. Clone repo: `git clone --depth 1 https://x-access-token:${github_token}@github.com/${repo}.git /tmp/run-${run_id}/`
4. Generate temporary `project.json` from `project_config`
5. Run `setup.sh --update` in the cloned directory
6. Execute pipeline with ephemeral project dir
7. On completion: POST callback to `callback_url` with `run_id`, `run_token`, status, tokens, pr_url
8. Cleanup: `rm -rf /tmp/run-${run_id}/`

If not SaaS mode: existing logic (unchanged).

- [ ] **Step 3: Extend run.ts to return token totals**

Modify `executePipeline()` to return token usage from `getTotals()` (already tracked by event-hooks):

```typescript
// In PipelineResult, add:
tokens?: { input: number; output: number; estimatedCostUsd: number }
```

After the pipeline completes, call `getTotals()` from the event hooks and include in the result.

- [ ] **Step 4: Add SaaS callback function to server.ts**

```typescript
async function sendSaasCallback(
  callbackUrl: string,
  runToken: string,
  payload: {
    run_id: string
    status: 'completed' | 'failed' | 'timeout'
    pr_url?: string
    tokens_used: { input: number; output: number }
    duration_seconds: number
    error_message?: string
  }
): Promise<void> {
  await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Run-Token': runToken,
    },
    body: JSON.stringify(payload),
  })
}
```

- [ ] **Step 5: Add cleanup logic**

After the callback is sent (success or failure), always clean up:
```typescript
import { rm } from 'node:fs/promises'
await rm(`/tmp/run-${runId}`, { recursive: true, force: true })
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsc --noEmit -p pipeline/tsconfig.json` (or equivalent)

- [ ] **Step 7: Commit**

```bash
git add pipeline/server.ts pipeline/run.ts pipeline/lib/server-config.ts
git commit -m "feat: extend pipeline server for SaaS ephemeral runs with callback"
```

---

### Task 9: Onboarding — Mode Selection UI

**Context:** After signup, the user picks Self-Hosted or SaaS. This is the first UI touchpoint that drives the workspace `mode` field.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/components/onboarding/mode-selection.tsx`
- Modify: Onboarding page (find exact path — likely where workspace is created after signup)

- [ ] **Step 1: Find the current onboarding/workspace creation flow**

Search for workspace creation UI — likely in the auth flow after registration.

- [ ] **Step 2: Create mode selection component**

```typescript
// src/components/onboarding/mode-selection.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Server, Cloud } from 'lucide-react'

interface ModeSelectionProps {
  onSelect: (mode: 'self_hosted' | 'saas') => void
}

export function ModeSelection({ onSelect }: ModeSelectionProps) {
  const [selected, setSelected] = useState<'self_hosted' | 'saas' | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">How do you want to use Just Ship?</h2>
        <p className="text-muted-foreground mt-1">You can change this later in settings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          className={`cursor-pointer p-6 transition-colors ${selected === 'self_hosted' ? 'border-primary' : ''}`}
          onClick={() => setSelected('self_hosted')}
        >
          <Server className="h-8 w-8 mb-3" />
          <h3 className="font-semibold text-lg">Self-Hosted</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Use your own VPS and API keys. The Board is free for ticket management, Kanban, and team collaboration.
          </p>
        </Card>

        <Card
          className={`cursor-pointer p-6 transition-colors ${selected === 'saas' ? 'border-primary' : ''}`}
          onClick={() => setSelected('saas')}
        >
          <Cloud className="h-8 w-8 mb-3" />
          <h3 className="font-semibold text-lg">Managed (SaaS)</h3>
          <p className="text-sm text-muted-foreground mt-1">
            We handle the infrastructure. Connect GitHub, pick a plan, and start running pipelines from the Board.
          </p>
        </Card>
      </div>

      <Button
        onClick={() => selected && onSelect(selected)}
        disabled={!selected}
        className="w-full"
      >
        Continue
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Integrate into onboarding flow**

After workspace creation, show mode selection. On select:
- PATCH workspace with `mode` value
- If `saas`: redirect to plan selection / billing setup
- If `self_hosted`: redirect to workspace dashboard (existing flow)

- [ ] **Step 4: Verify it renders**

Run: `cd /Users/yschleich/Developer/just-ship-board && npm run dev`
Navigate to the workspace creation flow and verify the mode selection appears.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/ src/app/
git commit -m "feat: add mode selection (self-hosted vs. SaaS) to onboarding"
```

---

### Task 10: Billing Settings Page

**Context:** SaaS users need a billing page in settings to see their plan, credit balance, transaction history, and manage their subscription.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/app/(main)/[slug]/settings/billing/page.tsx`
- Create: `src/components/settings/billing-view.tsx`
- Modify: `src/components/settings/settings-nav.tsx`

- [ ] **Step 1: Read existing settings nav**

Read: `src/components/settings/settings-nav.tsx`

- [ ] **Step 2: Add Billing nav item (SaaS only)**

Add a "Billing" tab to the settings nav. Only show when `workspace.mode === 'saas'`. Use `CreditCard` icon from lucide-react.

- [ ] **Step 3: Create billing settings page**

```typescript
// src/app/(main)/[slug]/settings/billing/page.tsx
import { BillingView } from '@/components/settings/billing-view'
export default function BillingPage() {
  return <BillingView />
}
```

- [ ] **Step 4: Create billing view component**

`src/components/settings/billing-view.tsx` — Client component that shows:
- Current plan badge + "Upgrade" or "Manage" button (opens Stripe portal)
- Credit balance (large number, prominent)
- "Buy Credits" button (opens Stripe checkout for topup)
- Credit transaction history table (date, type, amount, description) — paginated, from `credit_transactions`
- Next billing date (from active subscription)

Fetch data via Supabase client queries to `subscriptions`, `credit_balances`, `credit_transactions`.

- [ ] **Step 5: Verify it renders**

Run dev server, navigate to `/{slug}/settings/billing`.

- [ ] **Step 6: Commit**

```bash
git add src/app/(main)/[slug]/settings/billing/ src/components/settings/billing-view.tsx src/components/settings/settings-nav.tsx
git commit -m "feat: add billing settings page with plan, credits, and transaction history"
```

---

### Task 11: GitHub Settings Page

**Context:** SaaS users need a page to connect/disconnect their GitHub account and see which repos are accessible.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/app/(main)/[slug]/settings/github/page.tsx`
- Create: `src/components/settings/github-view.tsx`
- Modify: `src/components/settings/settings-nav.tsx`

- [ ] **Step 1: Add GitHub nav item (SaaS only)**

Add a "GitHub" tab to settings nav. Only show when `workspace.mode === 'saas'`. Use `Github` icon from lucide-react.

- [ ] **Step 2: Create GitHub settings page**

```typescript
// src/app/(main)/[slug]/settings/github/page.tsx
import { GitHubView } from '@/components/settings/github-view'
export default function GitHubPage() {
  return <GitHubView />
}
```

- [ ] **Step 3: Create GitHub view component**

`src/components/settings/github-view.tsx` — Client component that shows:
- If not connected: "Connect GitHub" button → redirects to GitHub App installation URL (`https://github.com/apps/just-ship/installations/new?state={workspace_id}`)
- If connected: account name, list of accessible repos, "Manage on GitHub" link, "Disconnect" button
- Fetch from `github_installations` table + `/api/github/repos`

- [ ] **Step 4: Verify it renders**

Run dev server, navigate to `/{slug}/settings/github`.

- [ ] **Step 5: Commit**

```bash
git add src/app/(main)/[slug]/settings/github/ src/components/settings/github-view.tsx src/components/settings/settings-nav.tsx
git commit -m "feat: add GitHub connection settings page"
```

---

### Task 12: SaaS Project Creation (from GitHub Repos)

**Context:** SaaS users create projects by selecting from their connected GitHub repos instead of manually entering a name. The Board becomes source of truth for project config.

**Repo:** `just-ship-board`

**Files:**
- Modify: `src/components/settings/projects-settings-view.tsx` (or the "create project" dialog)

- [ ] **Step 1: Read current project creation UI**

Read: `src/components/settings/projects-settings-view.tsx`

- [ ] **Step 2: Extend create project dialog for SaaS**

When `workspace.mode === 'saas'`:
- Replace manual name input with a repo selector dropdown
- Fetch repos from `/api/github/repos`
- On select: create project with `name = repo.full_name`, `repo_url = repo.html_url`, `github_repo_id = repo.id`, `source = 'saas'`

When `workspace.mode === 'self_hosted'`:
- Keep existing manual project creation (unchanged)

- [ ] **Step 3: Verify it works**

Test both modes in dev.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/
git commit -m "feat: add GitHub repo selection for SaaS project creation"
```

---

### Task 13: Credit Badge in Sidebar

**Context:** SaaS users should see their credit balance at all times in the sidebar.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/components/shared/credit-badge.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Create credit badge component**

```typescript
// src/components/shared/credit-badge.tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from '@/lib/workspace-context'
import { Coins } from 'lucide-react'

export function CreditBadge() {
  const workspace = useWorkspace()
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    if (workspace?.mode !== 'saas') return
    const supabase = createClient()
    supabase
      .from('credit_balances')
      .select('balance')
      .eq('workspace_id', workspace.id)
      .single()
      .then(({ data }) => setBalance(data?.balance ?? 0))
  }, [workspace])

  if (workspace?.mode !== 'saas' || balance === null) return null

  const isLow = balance < 50 // below ~10% for starter

  return (
    <div className={`flex items-center gap-1.5 text-sm px-2 py-1 rounded ${isLow ? 'text-destructive' : 'text-muted-foreground'}`}>
      <Coins className="h-3.5 w-3.5" />
      <span>{balance} Credits</span>
    </div>
  )
}
```

- [ ] **Step 2: Add credit badge to sidebar**

Read `src/components/layout/sidebar.tsx`, add `<CreditBadge />` in a sensible location (near the bottom or next to workspace name).

- [ ] **Step 3: Verify it renders**

Run dev server, check sidebar for SaaS workspace.

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/credit-badge.tsx src/components/layout/sidebar.tsx
git commit -m "feat: add credit balance badge to sidebar for SaaS workspaces"
```

---

### Task 14: Pipeline Run Status in Board

**Context:** SaaS users need to see pipeline run status on tickets — queued, running, completed, with cost info.

**Repo:** `just-ship-board`

**Files:**
- Modify: Ticket detail component (likely `src/components/tickets/ticket-detail-sheet.tsx` or similar)

- [ ] **Step 1: Find ticket detail component**

Search for where pipeline status is displayed on tickets.

- [ ] **Step 2: Add pipeline run info for SaaS**

When `workspace.mode === 'saas'` and a pipeline run exists for the ticket:
- Show run status badge (Queued / Running / Completed / Failed)
- Show queue position if queued
- Show credits charged after completion
- Show PR link after completion
- Fetch from `pipeline_runs` table filtered by `ticket_number` + `workspace_id`

This supplements (does not replace) the existing `pipeline_status` display which works for self-hosted.

- [ ] **Step 3: Verify it renders**

Check ticket detail in dev.

- [ ] **Step 4: Commit**

```bash
git add src/components/tickets/
git commit -m "feat: show SaaS pipeline run status and credits on ticket detail"
```

---

### Task 15: Workspace Context Extension + Conditional UI

**Context:** The workspace context needs to expose `mode` and `plan` so all components can conditionally render SaaS features.

**Repo:** `just-ship-board`

**Files:**
- Modify: `src/lib/workspace-context.tsx`

- [ ] **Step 1: Read current workspace context**

Read: `src/lib/workspace-context.tsx`

- [ ] **Step 2: Ensure mode and plan are in context**

The workspace object fetched from Supabase should already include the new `mode` and `plan` columns (from the migration). Verify the query includes them. If not, update the query.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace-context.tsx
git commit -m "feat: expose workspace mode and plan in context"
```

---

### Task 16: Integration Test — Full SaaS Flow

**Context:** End-to-end verification that the SaaS flow works: mode selection → billing → GitHub → project → dispatch → callback → credits.

**Repo:** `just-ship-board`

**Files:**
- Create: `src/lib/dispatcher/__tests__/dispatch.test.ts`
- Create: `src/lib/stripe/__tests__/credits.test.ts`

- [ ] **Step 1: Write credit system tests**

Test `grantCredits`, `deductCredits`, `getBalance`, `hasMinimumBalance` with mock Supabase.

- [ ] **Step 2: Write dispatcher tests**

Test `dispatchRun` with:
- Happy path: idle VPS available → dispatched
- All busy: queued
- Credits insufficient: rejected
- Concurrent run limit reached: queued
- Callback: updates run, deducts credits, processes queue

- [ ] **Step 3: Run tests**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add src/lib/dispatcher/__tests__/ src/lib/stripe/__tests__/
git commit -m "test: add credit system and dispatcher tests"
```

---

### Task 17: Build Verification + Final Cleanup

**Context:** Ensure everything compiles and builds cleanly.

**Repo:** `just-ship-board`

- [ ] **Step 1: TypeScript check**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx tsc --noEmit`

- [ ] **Step 2: Build**

Run: `cd /Users/yschleich/Developer/just-ship-board && npm run build`

- [ ] **Step 3: Fix any build errors**

Address any compilation or build errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: fix build issues for SaaS pipeline feature"
```

---

## Task Dependency Graph

```
Task 1 (DB Migration)
  └─→ Task 2 (Types & Constants)
        ├─→ Task 15 (Workspace Context) ← MUST come before all UI tasks
        │     ├─→ Task 9 (Mode Selection UI)
        │     ├─→ Task 10 (Billing Page) ← also needs Task 4
        │     ├─→ Task 11 (GitHub Page) ← also needs Task 5
        │     ├─→ Task 12 (SaaS Project Creation) ← also needs Task 5
        │     ├─→ Task 13 (Credit Badge) ← also needs Task 3
        │     └─→ Task 14 (Run Status UI) ← also needs Task 6
        ├─→ Task 3 (Stripe Setup)
        │     └─→ Task 4 (Checkout Endpoints)
        ├─→ Task 5 (GitHub App)
        ├─→ Task 6 (Dispatcher)
        │     └─→ Task 7 (Trigger Routing)
        └─→ Task 8 (Pipeline Server Extension) — independent, just-ship repo

Task 16 (Tests) — after Tasks 3, 6
Task 17 (Build Verification) — after all
```

**Parallelizable groups:**
- Tasks 3, 5, 6, 8, 15 can run in parallel (after Task 2)
- Tasks 4, 7 can run in parallel (after Task 3 / Task 6)
- Tasks 9, 10, 11, 12, 13, 14 can run in parallel (after Task 15 + their backend dependencies)

**Critical path:** Task 1 → Task 2 → Task 15 → UI tasks (9-14) → Task 16 → Task 17

---

## Out of Scope (deferred to follow-up)

- **Email notifications** — run complete, credits low, plan upgrade reminders
- **Workspace dashboard extensions** — credit usage chart (30 days), top projects by credit usage, active runs overview
- **VPS health check scheduling** — `checkAllPoolVps()` needs a cron trigger (Next.js cron route or external). For MVP, health is checked reactively before dispatch.
- **Queue expiry cron** — entries older than 30 minutes should be expired automatically. For MVP, expiry is checked at dispatch time (lazy expiry).
- **Pipeline status constants alignment** — existing `PIPELINE_STATUSES` uses `done/paused`, new `PipelineRunStatus` uses `completed/timeout`. These are intentionally different (ticket-level vs. run-level) but should be documented clearly.
