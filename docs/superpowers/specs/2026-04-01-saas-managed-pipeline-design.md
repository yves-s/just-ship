# SaaS Managed Pipeline — Design Spec

**Date:** 2026-04-01
**Status:** Draft
**Scope:** MVP (Phase 1)

---

## Problem

Just Ship requires users to bring their own VPS, Anthropic API Key, and GitHub PAT, then run a local CLI setup. This creates a high barrier to entry for agencies and freelancers who want autonomous development without infrastructure management.

## Solution

Offer Just Ship as a fully managed SaaS: User signs up in the Board, picks a subscription plan, connects GitHub, and runs pipelines on a shared VPS pool operated by Just Ship. No local setup, no own server, no API keys.

## Target Audience

Agencies and freelancers managing multiple client projects. One workspace = one agency/freelancer, multiple projects underneath.

---

## Onboarding: Self-Hosted vs. SaaS Split

After signup, the user chooses their mode:

```
Signup → Workspace created
         │
         ▼
   "How do you want to use Just Ship?"
         │
    ┌────┴────┐
    ▼         ▼
 Self-Hosted   SaaS (Managed)
    │         │
    │         ├─ Pick plan → Stripe Checkout
    │         ├─ Connect GitHub (App)
    │         ├─ Select repo → Project created
    │         └─ Pipeline runs on shared pool
    │
    ├─ Board is free (Tickets, Kanban, Sidekick, Teams)
    ├─ Connect own VPS or work locally (existing flow, unchanged)
    └─ User can upgrade to SaaS anytime
```

**Self-Hosted changes nothing.** The existing flow (local Claude Code, own VPS via `/just-ship-vps`, own Anthropic Key) remains 100% intact. The split is purely a UI gate in the Board that controls whether the user sees billing/credit pages.

**Workspace field:** `mode: "self_hosted" | "saas"` — drives UI visibility and dispatcher routing.

---

## Billing: Subscriptions + Credits

### Plans

| | Starter | Agency | Enterprise |
|---|---|---|---|
| Price | TBD | TBD | Custom |
| Included Credits | TBD | TBD | Custom |
| Projects | Limited | Unlimited | Unlimited |
| Team Members | 1 | Multiple | Unlimited |
| Credit Topup | Yes | Yes | Yes |
| Pipeline Priority | Normal | Priority | Dedicated |

Concrete pricing TBD — architecture supports any tier/credit configuration.

### Credit Mechanics

- Subscription runs via Stripe Subscriptions; credits are granted monthly upon renewal.
- Unused credits expire at month-end (or roll over — configurable).
- When credits run out: user can buy a topup (Stripe One-Time Payment) or pipeline blocks with "Credits exhausted" message.
- Board shows credit balance prominently (sidebar), warns at <10% remaining.
- Each pipeline run costs X credits based on actual token consumption (charged after run, not before).
- Token-to-credit ratio is configurable (e.g. 1 credit = 10,000 tokens).
- If credits deplete mid-run: run completes (no abort), user is warned afterward.

---

## GitHub App Integration

### Setup (one-time, by Just Ship operator)

- Register GitHub App "Just Ship" under Just Ship's GitHub org.
- Permissions: `contents: write`, `pull_requests: write`, `metadata: read`.
- Callback URL: `https://board.just-ship.io/api/auth/github/callback`.
- Webhook URL: Optional for push-triggered runs (Phase 2).

### User Flow

1. User clicks "Connect GitHub" in Board → redirect to GitHub.
2. GitHub shows: "Just Ship wants access to your repositories."
3. User selects: all repos or specific repos.
4. GitHub redirects back to Board with `installation_id`.
5. Board stores `installation_id` on workspace.

### Token Management

- **App-Level JWT** — Board uses this to generate Installation Tokens (short-lived, ~10 min).
- **Installation Token** — freshly generated per pipeline run, scoped to user's selected repos.
- No long-lived token stored — only the `installation_id`.
- Per run: Board generates fresh Installation Token → sends to VPS → token expires after run.

### Project Creation

1. User clicks "New Project" in Board.
2. Board lists all repos the GitHub App can access (via Installation Token).
3. User selects repo → Board creates project with `repo_url`, `github_repo_id`.
4. Done — no `project.json` needed in the repo. Board is source of truth.
5. `CLAUDE.md` in the repo is still respected (project instructions).
6. `setup.sh` installs framework files temporarily at each run.

---

## Infrastructure: Shared VPS Pool

### Architecture

```
                    ┌─────────────┐
                    │    Board    │
                    │ (Dispatcher) │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌─────────┐ ┌─────────┐ ┌─────────┐
         │  VPS 1  │ │  VPS 2  │ │  VPS 3  │
         │ (Pool)  │ │ (Pool)  │ │ (Pool)  │
         └─────────┘ └─────────┘ └─────────┘
```

### Dispatcher (in Board)

- Each pool VPS reports status to Board: `idle`, `running`, `draining`.
- Board receives pipeline request → selects an `idle` VPS → sends run command.
- All busy → request enters a queue (`pipeline_queue` table), next free VPS picks it up.
- Priority: Agency tier before Starter tier in queue.

### Pool Management

- Pool starts with 2-3 VPS instances (Hetzner, provisioned manually or via Terraform).
- Each VPS runs identically: Docker + Pipeline Server + Just Ship's Anthropic Key.
- No VPS is assigned to a customer — any can handle any run.
- Scaling: add/remove VPS based on utilization (manual initially, auto-scaling Phase 2).

### Ephemeral Runs (Isolation)

- Each run: repo is cloned into a temporary directory.
- Pipeline runs, PR is created.
- Afterward: directory is deleted — no state persists on VPS.
- GitHub App Installation Token is delivered per-run from Board.
- Anthropic Key lives on VPS (operator's key), token usage is reported back.

---

## Pipeline Run Lifecycle

```
User clicks "Run" on Ticket T-42
         │
         ▼
Board: Pre-Flight Checks
  ├─ Workspace has enough credits? (minimum balance check)
  ├─ GitHub App still connected?
  ├─ Repo still accessible?
         │
         ▼
Board: Dispatcher
  ├─ Free VPS in pool? → Assign directly
  ├─ All busy? → Queue (pipeline_queue table)
  ├─ Queue position shown live to user
         │
         ▼
Board → VPS: POST /api/launch
  {
    ticket_number: 42,
    project_id: "uuid",
    repo_url: "github.com/client/repo",
    github_token: "<installation-token>",
    callback_url: "https://board.just-ship.io/api/v1/pipeline/callback"
  }
         │
         ▼
VPS: Pipeline Run
  ├─ git clone with github_token
  ├─ setup.sh --update (install framework)
  ├─ Claude Code agent runs (operator's Anthropic Key)
  ├─ Token usage tracked
  ├─ PR created
  ├─ Cleanup: delete directory
         │
         ▼
VPS → Board: POST /callback
  {
    ticket_number: 42,
    status: "completed",
    pr_url: "github.com/client/repo/pull/7",
    tokens_used: { input: 125000, output: 38000 },
    duration_seconds: 340
  }
         │
         ▼
Board: Post-Run
  ├─ Deduct credits (tokens → credits conversion)
  ├─ Ticket status → "in_review"
  ├─ User notification (Board + optional email)
  ├─ PR link shown on ticket
```

### Error Handling

- Run fails → callback with `status: "failed"` + error details.
- Credits are still deducted (tokens were consumed).
- User sees error in Board, can click Retry (new run, new credits).
- VPS crash → Board detects missing callback after timeout → marks run as `timeout`, VPS removed from pool until health check passes.

---

## Data Model (Supabase Extensions)

### New Tables

```sql
-- Subscriptions & Billing
subscriptions
  ├─ id (uuid, PK)
  ├─ workspace_id (FK → workspaces)
  ├─ stripe_subscription_id
  ├─ plan (starter | agency | enterprise)
  ├─ status (active | canceled | past_due)
  ├─ current_period_start / end
  └─ created_at / updated_at

credit_balances
  ├─ workspace_id (FK → workspaces, PK)
  ├─ balance (integer, credits)
  └─ updated_at

credit_transactions
  ├─ id (uuid, PK)
  ├─ workspace_id (FK → workspaces)
  ├─ type (subscription_grant | topup | pipeline_usage | refund)
  ├─ amount (integer, positive = credit, negative = debit)
  ├─ description ("Pipeline Run T-42: 125k tokens")
  ├─ pipeline_run_id (FK → pipeline_runs, nullable)
  └─ created_at

-- GitHub Integration
github_installations
  ├─ id (uuid, PK)
  ├─ workspace_id (FK → workspaces)
  ├─ github_installation_id (integer, from GitHub)
  ├─ account_login (GitHub username/org)
  └─ created_at

-- Pipeline Runs
pipeline_runs
  ├─ id (uuid, PK)
  ├─ workspace_id (FK → workspaces)
  ├─ project_id (FK → projects)
  ├─ ticket_number (integer)
  ├─ vps_instance_id (FK → vps_instances)
  ├─ status (queued | running | completed | failed | timeout)
  ├─ pr_url (nullable)
  ├─ tokens_input / tokens_output (integer)
  ├─ credits_charged (integer)
  ├─ duration_seconds (integer)
  ├─ error_message (nullable)
  ├─ queued_at / started_at / completed_at
  └─ created_at

-- Pipeline Queue
pipeline_queue
  ├─ id (uuid, PK)
  ├─ workspace_id (FK → workspaces)
  ├─ project_id (FK → projects)
  ├─ ticket_number (integer)
  ├─ priority (integer, Agency=10, Starter=1)
  ├─ status (waiting | dispatched | expired)
  └─ created_at
  -- Note: priority aging is computed at query time:
  -- effective_priority = priority + FLOOR(EXTRACT(EPOCH FROM NOW() - created_at) / 300)

-- Billing Config
billing_config
  ├─ key (text, PK)          -- e.g. "tokens_per_credit", "min_balance_credits"
  ├─ value (text)             -- e.g. "10000", "5"
  └─ updated_at
```

### Extensions to Existing Tables

```sql
workspaces (new fields)
  ├─ mode (self_hosted | saas)
  ├─ plan (starter | agency | enterprise | null)
  ├─ stripe_customer_id (nullable)

projects (new fields)
  ├─ repo_url (nullable — only for saas)
  ├─ github_repo_id (integer, nullable)
  ├─ source (local | saas)

vps_instances (new fields)
  ├─ pool_type (shared | dedicated)
  ├─ current_run_id (FK → pipeline_runs, nullable)
  ├─ last_health_check (timestamp)
  ├─ capacity_status (idle | running | draining | offline)
```

### RLS Policies

- Everything isolated by `workspace_id`.
- `credit_balances` read-only for workspace members.
- `credit_transactions` read-only, never directly writable (server functions only).
- `pipeline_runs` readable by workspace members, writable only via service role.

---

## Board UI Extensions

### New Pages

**1. Onboarding (after signup):**
- Mode selection: Self-Hosted vs. SaaS
- SaaS path: Plan selection → Stripe → GitHub App → Repo selection → First ticket
- Self-Hosted path: Straight to Board (existing flow)

**2. Settings → Billing (SaaS only):**
- Current plan + next billing date
- Credit balance (prominent, always visible in sidebar)
- Credit history (table: date, type, amount, description)
- "Buy Credits" button → Stripe One-Time Payment
- "Upgrade Plan" / "Cancel" buttons

**3. Settings → GitHub (SaaS only):**
- Connected GitHub account + org
- List of authorized repos
- "Manage on GitHub" link (to GitHub App settings page)
- "Disconnect" button

**4. Project Dashboard (extended):**
- Pipeline run history: status, duration, credits consumed, PR link
- "Run Pipeline" button on ticket (replaces Board→VPS trigger)
- Live status during run: Queued → Running → Creating PR → Done
- Credit cost indicator: "Estimated: ~15 Credits" before run

**5. Workspace Dashboard (extended):**
- Credit usage last 30 days (chart)
- Top projects by credit usage
- Active runs / queue status
- Quick actions: "Buy Credits", "Add Project"

### Unchanged

- Ticket board (Kanban) stays identical.
- Ticket creation stays identical.
- Sidekick (AI Chat) stays identical.
- Team management stays identical.

---

## Security & Isolation

### Tenant Isolation

- No customer code persists on VPS — deleted after each run.
- GitHub Installation Tokens are short-lived (max 1h), freshly generated per run.
- No customer can access another customer's repos — token scoped to own installation.
- RLS on all Supabase tables by `workspace_id`.

### Secret Management

- **Anthropic Key:** Only on pool VPS (operator's key, never exposed to customers).
- **GitHub App Private Key:** Only in Board backend (generates Installation Tokens).
- **Stripe Keys:** Only in Board backend.
- **Customer secrets (.env):** Not supported in MVP. Projects needing runtime secrets must use GitHub Secrets or repo-level config. Phase 2: Secure Vault in Board.

### VPS Security

- Pool VPS not publicly reachable (only Board knows the IPs).
- Pipeline Server only accessible via `X-Pipeline-Key`.
- Each run executes as non-root user (`claude-agent`).
- No SSH access for customers.

### Abuse Prevention

- Credit system is natural rate limiting (no balance = no run).
- Minimum balance check before each run (estimated cost must be covered).
- Max concurrent runs per workspace: 1 (Starter), 3 (Agency).
- Timeout per run: 30 minutes (configurable per plan).
- Anomaly detection: unusually high token consumption → alert to operator.

---

## Technical Details: Resolved Design Decisions

### Callback Endpoint (Board → VPS → Board)

The Board exposes a new endpoint for SaaS pipeline run callbacks:

```
POST /api/v1/pipeline/callback
Headers:
  X-Run-Token: <run_token>   // per-run HMAC token, generated by Board at dispatch
Content-Type: application/json
Body:
  {
    run_id: "uuid",           // pipeline_runs.id, assigned by Board at dispatch
    status: "completed",
    pr_url: "...",
    tokens_used: { input: 125000, output: 38000 },
    duration_seconds: 340,
    error_message: null
  }
```

**Authentication:** Board generates a unique `run_token` (HMAC-SHA256 of `run_id` + shared secret) per dispatch and sends it to the VPS in the launch payload. VPS echoes it back in the callback header. Board verifies the HMAC before processing. This prevents spoofed callbacks — only the VPS that received the token can call back.

**Idempotency:** Callback is idempotent on `run_id`. Duplicate calls are ignored (status already set).

**Distinction from existing `/api/events`:** The existing event stream is for self-hosted VPS instances reporting task-level events. The new callback is a single, final report per SaaS run. They coexist — self-hosted uses `/api/events`, SaaS uses `/api/v1/pipeline/callback`.

### Extended Launch Payload (Board → Pool VPS)

The SaaS launch payload extends the existing contract:

```
POST /api/launch
Headers:
  X-Pipeline-Key: <pool_pipeline_key>
Body:
  {
    ticket_number: 42,
    project_id: "uuid",
    // SaaS-only fields (ignored in self-hosted mode):
    run_id: "uuid",
    run_token: "<hmac-token>",
    repo_url: "https://github.com/client/repo.git",
    github_token: "<installation-token>",
    callback_url: "https://board.just-ship.io/api/v1/pipeline/callback",
    project_config: {           // Board-managed config, replaces project.json
      project_name: "Client App",
      stack: { language: "typescript", framework: "nextjs" },
      pipeline: { model: "sonnet", timeouts: { agent: 1500000 } }
    }
  }
```

`pipeline/server.ts` detects SaaS mode when `repo_url` is present in the payload. In SaaS mode, it clones from `repo_url` using `github_token` instead of looking up a pre-existing project directory.

### Ephemeral Project Setup (setup.sh without project.json)

For SaaS runs, the VPS pipeline does not rely on an existing `project.json` in the repo:

1. Clone repo into `/tmp/run-<run_id>/`
2. Generate a temporary `project.json` from the `project_config` in the launch payload
3. Run `setup.sh --update` which installs `.claude/` framework files (agents, commands, skills)
4. If the repo already has a `CLAUDE.md`, it is preserved (project-specific instructions)
5. If the repo already has a `project.json`, the Board-provided config takes precedence for pipeline fields, but repo-level config (stack, build commands) is merged
6. Pipeline runs normally
7. Cleanup: entire `/tmp/run-<run_id>/` is deleted

This means repos do not need any Just Ship files to work with the SaaS pipeline. The framework is injected at runtime.

### Token Usage Metering

Token consumption is tracked via Claude Code's built-in cost reporting:

1. **Claude Code `--output-format json`** — When Claude Code CLI runs, it outputs a session summary including token usage (input/output tokens, cost). The pipeline runner captures this from stdout/stderr.
2. **Fallback: Anthropic API Usage endpoint** — If CLI output parsing fails, the pipeline queries the Anthropic Admin API (`/v1/organizations/{org_id}/usage`) filtered by the run's time window.
3. **Pipeline runner reports back** — `run.ts` is extended to return `{ status, branch, pr_url, tokens: { input, output } }` from the execution result.

The `tokens_used` field in the callback is populated from whichever source is available. If neither works (edge case), the run is flagged for manual review and credits are not charged.

**Token-to-credit conversion:** Configurable ratio stored in a `billing_config` table (see Data Model). Default: 1 credit = 10,000 tokens (input + output combined). Operator can adjust without code changes.

**Callback responsibility:** `server.ts` is responsible for POSTing the callback after `run.ts` returns its result. The pipeline runner (`run.ts`) returns `{ status, branch, pr_url, tokens }` to the server, and the server constructs and sends the callback using `run_id`, `run_token`, and `callback_url` from the original launch payload.

**HMAC shared secret:** The shared secret used for HMAC-SHA256 is the VPS's `pipeline_key` (same as `X-Pipeline-Key`). Board knows each VPS's key from the `vps_instances` table and can verify the HMAC on callback.

### VPS Health Checks

**Mechanism:** Board polls each pool VPS every 60 seconds:

```
GET /health
Response: { status: "ok", mode: "multi-project", running: <run_id|null>, capacity: "idle|running|draining" }
```

**What is checked:**
- HTTP 200 response within 5 seconds
- `status: "ok"` in body
- If no response for 3 consecutive checks → VPS marked `offline`, removed from dispatcher pool

**VPS registration:** Operator adds pool VPS instances via a Board admin endpoint or directly in Supabase. Each `vps_instances` row includes: `url` (internal IP/hostname), `pool_type`, `pipeline_key`.

### Queue Fairness & Limits

**Starvation prevention:** Queued Starter-tier runs have an aging mechanism. Priority increases by 1 every 5 minutes. After 15 minutes, a Starter run has priority 4 (above default 1), approaching Agency-tier priority (10). Maximum wait time: 30 minutes, then the run is marked `expired` and user is notified.

**Workspace concurrency:** The dispatcher checks active `pipeline_runs` for the workspace before dispatching. If at limit (1 for Starter, 3 for Agency), the request is queued even if pool VPS are available.

**Queue entry lifecycle:** `waiting` → `dispatched` (VPS assigned) → removed. Entries expire after 30 minutes. Expired entries trigger a Board notification to the user. No automatic retry — user can manually re-trigger.

### Credit Expiry

**MVP decision: Credits roll over.** No expiry, no scheduled zeroing job. This simplifies billing logic and is more customer-friendly. Expiry can be introduced in Phase 2 if needed for revenue predictability.

### Pipeline Status Mapping

| `pipeline_runs.status` | Ticket `pipeline_status` | Ticket `status` |
|---|---|---|
| `queued` | `running` | `in_progress` |
| `running` | `running` | `in_progress` |
| `completed` | `done` | `in_review` |
| `failed` | `failed` | `in_progress` |
| `timeout` | `failed` | `in_progress` |

### GitHub App Lifecycle

**Installation revocation handling:**
- GitHub sends `installation.deleted` webhook → Board marks `github_installations` row as deleted
- Running pipeline runs continue (token was already generated) but new runs are blocked
- Board UI shows disconnected state: "GitHub disconnected — reconnect to run pipelines"
- Queued runs for affected workspace are expired with notification

**Stripe webhook security:** All Stripe webhooks are verified via signature (`stripe.webhooks.constructEvent`) before processing. No credit grants or subscription changes without valid signature.

---

## Coexistence: Self-Hosted & SaaS

| | Self-Hosted (existing) | SaaS (new) |
|---|---|---|
| VPS | Customer's own | Operator's shared pool |
| Setup | `/just-ship-vps` via CLI or local | Board onboarding |
| Anthropic Key | Customer's own | Operator's key, credits |
| GitHub | PAT | GitHub App |
| Pipeline Trigger | Board → customer's VPS | Board → pool VPS |
| Project Config | `project.json` in repo | Board is source of truth |
| Target Audience | Power users, Enterprise | Agencies, Freelancers |

### Dispatcher Routing

```
Pipeline Run Triggered
  │
  ├─ workspace.mode == "self_hosted"?
  │   ├─ Workspace has vps_url? → POST to workspace.vps_url (unchanged)
  │   └─ No vps_url? → Error: "Connect VPS first" (local-only users don't trigger from Board)
  │
  └─ workspace.mode == "saas"?
      ├─ Credits sufficient? → Dispatcher selects pool VPS → POST to pool VPS
      └─ Credits insufficient? → Error: "Buy credits or upgrade plan"
```

No breaking changes. Existing self-hosted customers do not need to migrate.

---

## Phases

### MVP (Phase 1) — "Board as SaaS Interface"

- Stripe integration: Subscriptions + credit topup
- Credit system: balance, transactions, deduction after run
- GitHub App: OAuth flow, Installation Token generation
- Project creation via repo selection in Board
- Dispatcher: pool VPS selection + queue
- Pipeline run lifecycle: launch → callback → credit deduction
- Ephemeral runs: clone → run → cleanup
- Board UI: onboarding split, billing page, run status, credit display
- Pool VPS setup: 2-3 instances with operator's Anthropic Key
- Data model: new tables + RLS

### Phase 2 — "Scale & Polish"

- Auto-scaling: pool VPS auto-provision/deprovision based on load
- Live log streaming: WebSocket from VPS to Board
- Secure Vault: customers store environment variables in Board
- Webhook trigger: push to main → automatic pipeline run
- Email notifications: run complete, credits low, plan upgrade

### Phase 3 — "Enterprise"

- Dedicated VPS per workspace (auto-provisioned via Hetzner API)
- Custom model selection (Sonnet vs. Opus)
- Audit log
- SSO / SAML
- SLA guarantees
