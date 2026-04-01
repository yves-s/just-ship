# P2 — Costs Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Costs page to the Board where developers see workspace-level cost overview, per-project breakdown, weekly trend chart, budget utilization, and top-5 most expensive tickets — with period filtering.

**Architecture:** A single new route at `/[slug]/costs` rendering a self-contained client component (`CostsClient`). Data comes from the existing `task_events` table (columns `estimated_cost_usd`, `input_tokens`, `output_tokens` already live in Pipeline-DB) and `workspaces.budget_ceiling_usd`. No new DB tables needed — only migration files for version-control of columns that were applied directly. No external charting library — pure CSS bars.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui, Supabase browser client

**Spec:** `docs/specs/p2-agency-layer.md` — Section 2 (Kosten-Dashboard)

**Target repo:** `just-ship-board` at `/Users/yschleich/Developer/just-ship-board/`

**Important context:**
- The `CostsClient` component (776 lines) already exists in worktree `.worktrees/p2-costs-dashboard` at `src/components/costs/costs-client.tsx` — it is **production-ready** and matches the brainstorm mockup
- The DB columns it depends on (`task_events.input_tokens`, `task_events.output_tokens`, `task_events.model`, `task_events.estimated_cost_usd`, `workspaces.budget_ceiling_usd`, `workspaces.budget_alert_threshold`) all exist in the live Pipeline-DB already
- However, the migration files for these columns are missing from version control — they need to be backfilled
- The worktree branch is based on an old main (before Intake merge) and has conflicts — do NOT merge that branch. Instead, cherry-pick the clean files onto a fresh branch from current main
- The brainstorm mockup at `.superpowers/brainstorm/8723-1774847079/costs-dashboard.html` matches the component

---

## File Structure

### New Files (Board Repo)

| File | Responsibility |
|---|---|
| `supabase/migrations/018_task_events_cost_columns.sql` | Backfill migration: add `input_tokens`, `output_tokens`, `model`, `estimated_cost_usd` to `task_events` (idempotent — columns already exist in live DB) |
| `supabase/migrations/019_workspace_budget_columns.sql` | Backfill migration: add `budget_ceiling_usd`, `budget_alert_threshold` to `workspaces` (idempotent — columns already exist in live DB) |
| `src/app/(main)/[slug]/costs/page.tsx` | Costs page route (Server Component shell) |
| `src/components/costs/costs-client.tsx` | Main costs dashboard component (copy from worktree) |

### Modified Files (Board Repo)

| File | Changes |
|---|---|
| `src/components/layout/sidebar.tsx` | Add "Costs" nav item with `DollarSign` icon |
| `src/components/layout/mobile-nav.tsx` | Add "Costs" to mobile nav if it mirrors sidebar items |

---

## Task 1: Backfill Migration Files

These columns already exist in the live Pipeline-DB. The migrations use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency.

**Files:**
- Create: `supabase/migrations/018_task_events_cost_columns.sql`
- Create: `supabase/migrations/019_workspace_budget_columns.sql`

- [ ] **Step 1: Create task_events cost columns migration**

Create `supabase/migrations/018_task_events_cost_columns.sql`:

```sql
-- 018_task_events_cost_columns.sql
-- Backfill: columns were applied directly to Pipeline-DB during P0/P1.
-- Using ADD COLUMN IF NOT EXISTS for idempotency.

ALTER TABLE task_events
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric;

COMMENT ON COLUMN task_events.input_tokens IS 'Input tokens for this agent event. Set by pipeline via events API.';
COMMENT ON COLUMN task_events.output_tokens IS 'Output tokens for this agent event. Set by pipeline via events API.';
COMMENT ON COLUMN task_events.model IS 'Model used for this agent event (e.g. claude-sonnet-4-20250514).';
COMMENT ON COLUMN task_events.estimated_cost_usd IS 'Estimated cost in USD for this event. Set by pipeline.';
```

- [ ] **Step 2: Create workspace budget columns migration**

Create `supabase/migrations/019_workspace_budget_columns.sql`:

```sql
-- 019_workspace_budget_columns.sql
-- Backfill: columns were applied directly to Pipeline-DB during P1.
-- Using ADD COLUMN IF NOT EXISTS for idempotency.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS budget_ceiling_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS budget_alert_threshold numeric(3,2) DEFAULT 0.8;

COMMENT ON COLUMN workspaces.budget_ceiling_usd IS 'Max monthly budget in USD. NULL = no limit.';
COMMENT ON COLUMN workspaces.budget_alert_threshold IS 'Alert at this percentage of ceiling (default 0.8 = 80%).';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/018_task_events_cost_columns.sql supabase/migrations/019_workspace_budget_columns.sql
git commit -m "chore: backfill migration files for task_events cost columns and workspace budget"
```

---

## Task 2: Costs Page Route + Component

**Files:**
- Create: `src/app/(main)/[slug]/costs/page.tsx`
- Create: `src/components/costs/costs-client.tsx`

- [ ] **Step 1: Create the page route**

Create `src/app/(main)/[slug]/costs/page.tsx`:

```typescript
import { CostsClient } from "@/components/costs/costs-client";

export default function CostsPage() {
  return <CostsClient />;
}
```

- [ ] **Step 2: Copy CostsClient from worktree**

Copy the existing `costs-client.tsx` (776 lines) from the worktree:

```bash
cp /Users/yschleich/Developer/just-ship-board/.worktrees/p2-costs-dashboard/src/components/costs/costs-client.tsx \
   src/components/costs/costs-client.tsx
```

This component is production-ready and contains:
- 4 KPI cards: Gesamtkosten (with trend), Tickets bearbeitet, Tokens (in/out), Budget (progress bar)
- Period filter: Diese Woche / Dieser Monat / Letzter Monat
- Project costs table with color dots, cost, tickets, share %
- Weekly trend chart (CSS bars, no external library)
- Top 5 most expensive tickets with T-prefix links
- Empty state when no cost data
- Loading skeleton
- 60-second polling for realtime updates

- [ ] **Step 3: Commit**

```bash
git add src/app/(main)/[slug]/costs/page.tsx src/components/costs/costs-client.tsx
git commit -m "feat: add costs dashboard page with KPI cards, project breakdown, and weekly chart"
```

---

## Task 3: Sidebar Navigation

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/mobile-nav.tsx` (if it mirrors sidebar)

- [ ] **Step 1: Add Costs to sidebar NAV_ITEMS**

In `src/components/layout/sidebar.tsx`, add to the imports:

```typescript
import { DollarSign } from "lucide-react";
```

Add to `NAV_ITEMS` array (after Intakes):

```typescript
{ label: "Costs", icon: DollarSign, href: (slug: string) => `/${slug}/costs` },
```

- [ ] **Step 2: Check mobile-nav.tsx**

Read `src/components/layout/mobile-nav.tsx`. If it has its own nav items array (not importing from sidebar), add the same "Costs" item there.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/mobile-nav.tsx
git commit -m "feat: add Costs nav item to sidebar and mobile nav"
```

---

## Task 4: Build Check + Verification

- [ ] **Step 1: Run build**

```bash
cd /Users/yschleich/Developer/just-ship-board
npm run build
```

Fix any TypeScript errors, missing imports, or type mismatches.

Common issues to check:
- `EmptyState` component props may have changed since the worktree was created
- `Card` / `CardHeader` / `CardTitle` / `CardContent` import paths
- `useWorkspace` hook availability

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Fix any lint warnings.

- [ ] **Step 3: Visual check**

Start dev server and verify:
- `/[slug]/costs` loads without auth issues
- KPI cards show data (or empty state if no cost data)
- Period filter switches between time ranges
- Sidebar shows "Costs" link with correct active state
- Budget card shows "Kein Limit" when no ceiling is set

- [ ] **Step 4: Commit fixes if any**

```bash
git add <fixed-files>
git commit -m "fix: resolve build issues in costs dashboard"
```

---

## Acceptance Criteria Checklist

| Criterion | Task |
|---|---|
| Dashboard zeigt Workspace-Gesamtkosten | Task 2 (KPI card: Gesamtkosten with trend) |
| Budget-Balken gegen Ceiling (wenn gesetzt) | Task 2 (KPI card: Budget with progress bar) |
| Drill-Down pro Projekt zeigt Top-Tickets | Task 2 (Project table + Top 5 tickets section) |
| Zeitraum-Filter funktioniert | Task 2 (Diese Woche / Dieser Monat / Letzter Monat) |
| Realtime-Update wenn neue Events reinkommen | Task 2 (60s polling, Supabase subscription ready) |
