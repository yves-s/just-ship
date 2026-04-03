# P2 — Client Reports Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build client-facing project reports as Board pages with token-based access (no account needed). Developers generate reports from the Board; clients receive a link to view their report directly in the Board UI. Reports show ticket progress, cost summaries, agent activity, and next steps.

**Architecture:** Reports live as Board pages at `/report/[token]` (public, token-based — same pattern as `/intake/[token]` and `/proposal/[token]`). A new `project_reports` table stores report metadata + data snapshot. Developers manage reports from `/[slug]/reports`. Reports are generated via API route that queries tickets + task_events, aggregates data, and stores the snapshot. Optional email notification via Resend when a report is published.

**Why not static HTML files?** The Board already has the UI components, the data, and the token-based access pattern (Intake, Proposal). Reports as Board pages mean consistent branding, responsive design, interactive elements (collapsible sections, links to tickets), and no separate storage/hosting concern.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui, Supabase, Resend (optional email)

**Spec:** `docs/specs/p2-agency-layer.md` — Section 3 (HTML Reports), adapted to Board-native approach

**Target repo:** `just-ship-board` at `/Users/yschleich/Developer/just-ship-board/`

**Important context:**
- Token-based public pages pattern: `/intake/[token]` and `/proposal/[token]` already exist
- Proposal page (`src/app/proposal/[token]/`) uses: own layout (html/body), `createServiceClient()` for token lookup, SSR page with client component, `force-dynamic`
- Cost data on `task_events`: `estimated_cost_usd`, `input_tokens`, `output_tokens` (all live)
- Resend already integrated for auth + invite emails
- Pipeline-DB: `wsmnutkobalfrceavpxs`
- Middleware already allows `/intake` as public — need to add `/report`

---

## File Structure

### New Files (Board Repo)

| File | Responsibility |
|---|---|
| **DB** | |
| `supabase/migrations/023_project_reports.sql` | `project_reports` table + RLS + `report_config` on workspaces |
| **Types** | |
| `src/lib/types/report.ts` | TypeScript interfaces for reports |
| `src/lib/validations/report.ts` | Zod schemas for create/generate report |
| **Report Generation** | |
| `src/lib/reports/generate.ts` | Query tickets + events, aggregate into report data snapshot |
| **Client-Facing Pages (public, token-based)** | |
| `src/app/report/[token]/layout.tsx` | Public layout (no sidebar, no auth, report branding) |
| `src/app/report/[token]/page.tsx` | SSR page: token lookup, render report |
| `src/components/reports/report-view.tsx` | Client component: the actual report UI (sections, tables, charts) |
| **Developer Pages (Board auth)** | |
| `src/app/(main)/[slug]/reports/page.tsx` | Reports list page |
| `src/components/reports/reports-list.tsx` | Client component: list of reports with status/actions |
| `src/components/reports/generate-report-dialog.tsx` | Dialog: select project + date range, generate report |
| **API** | |
| `src/app/api/reports/route.ts` | GET (list) + POST (create/generate) — Board auth |
| `src/app/api/reports/[id]/route.ts` | GET + PATCH + DELETE — Board auth |
| `src/app/api/reports/[id]/publish/route.ts` | POST — publish report (makes token link active) |

### Modified Files (Board Repo)

| File | Changes |
|---|---|
| `src/components/layout/sidebar.tsx` | Add "Reports" nav item with `FileText` icon |
| `src/components/layout/mobile-nav.tsx` | Add "Reports" to mobile nav |
| `src/lib/supabase/middleware.ts` | Add `/report` to public routes |
| `src/lib/types.ts` | Re-export report types |

---

## Task 1: DB Migration — project_reports Table

**Files:**
- Create: `supabase/migrations/023_project_reports.sql`

- [ ] **Step 1: Apply migration via Supabase MCP**

Run against Pipeline-DB `wsmnutkobalfrceavpxs`:

```sql
-- ============================================
-- Project Reports
-- ============================================

CREATE TABLE project_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  period_label text,

  -- Snapshot data (frozen at generation time)
  report_data jsonb NOT NULL DEFAULT '{}',

  -- Tracking
  viewed_at timestamptz,
  view_count integer DEFAULT 0,
  published_at timestamptz,
  email_sent_to text[],

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_reports_workspace ON project_reports(workspace_id);
CREATE INDEX idx_reports_token ON project_reports(token);
CREATE INDEX idx_reports_status ON project_reports(workspace_id, status);

ALTER TABLE project_reports ENABLE ROW LEVEL SECURITY;

-- Workspace members: full access
CREATE POLICY "workspace_members_select_reports"
  ON project_reports FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "workspace_members_insert_reports"
  ON project_reports FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "workspace_members_update_reports"
  ON project_reports FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "workspace_members_delete_reports"
  ON project_reports FOR DELETE
  USING (is_workspace_member(workspace_id));

-- Auto-update updated_at
CREATE TRIGGER set_updated_at_reports
  BEFORE UPDATE ON project_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Report config on workspaces (auto-generation settings)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS report_config jsonb DEFAULT '{}';
```

- [ ] **Step 2: Save migration file**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/023_project_reports.sql
git commit -m "feat: add project_reports table with RLS and report_config on workspaces"
```

---

## Task 2: Types, Validations, Report Generator

**Files:**
- Create: `src/lib/types/report.ts`
- Create: `src/lib/validations/report.ts`
- Create: `src/lib/reports/generate.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Create report types**

Create `src/lib/types/report.ts`:

```typescript
export type ReportStatus = 'draft' | 'published' | 'archived';

export interface ProjectReport {
  id: string;
  workspace_id: string;
  project_id: string | null;
  token: string;
  title: string;
  status: ReportStatus;
  period_start: string;
  period_end: string;
  period_label: string | null;
  report_data: ReportData;
  viewed_at: string | null;
  view_count: number;
  published_at: string | null;
  email_sent_to: string[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  project?: { id: string; name: string } | null;
}

export interface ReportData {
  workspace_name: string;
  project_name: string | null;

  // Ticket summary
  completed_tickets: ReportTicket[];
  in_progress_tickets: ReportTicket[];
  open_tickets_count: number;

  // Costs
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  cost_per_ticket_avg: number;

  // Agent activity
  agent_summary: { agent_type: string; runs: number }[];
  total_agent_runs: number;

  // Next steps
  next_steps: ReportTicket[];
}

export interface ReportTicket {
  number: number;
  title: string;
  status: string;
  priority: string;
  agent_type?: string;
}

export interface ReportListItem {
  id: string;
  title: string;
  status: ReportStatus;
  period_label: string | null;
  period_start: string;
  period_end: string;
  project: { name: string } | null;
  view_count: number;
  published_at: string | null;
  created_at: string;
  token: string;
}

export interface ReportConfig {
  auto_generate?: boolean;
  frequency?: 'weekly' | 'monthly';
  day?: string;
  send_to?: string[];
}
```

- [ ] **Step 2: Create validations**

Create `src/lib/validations/report.ts`:

```typescript
import { z } from "zod";

export const generateReportSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  title: z.string().min(1).max(200).optional(),
}).strict();

export const updateReportSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
}).strict();

export type GenerateReportInput = z.infer<typeof generateReportSchema>;
```

- [ ] **Step 3: Create report generator**

Create `src/lib/reports/generate.ts` — exports `generateReportData(supabase, workspaceId, projectId, startDate, endDate): Promise<ReportData>`.

Logic:
1. Fetch workspace name
2. Fetch project name (if projectId)
3. Query tickets completed in period (status = 'done', updated_at in range)
4. Query tickets currently in_progress
5. Count open tickets (backlog + ready_to_develop)
6. Query task_events with cost data for period
7. Aggregate agent activity (group by agent_type, count runs)
8. Get top priority open tickets as "next steps"
9. Return `ReportData` snapshot

- [ ] **Step 4: Add re-export to types.ts**

Append to `src/lib/types.ts`:
```typescript
export type { ProjectReport, ReportData, ReportTicket, ReportListItem, ReportConfig, ReportStatus } from "./types/report";
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/report.ts src/lib/validations/report.ts src/lib/reports/generate.ts src/lib/types.ts
git commit -m "feat: add report types, validations, and data generator"
```

---

## Task 3: API Routes — CRUD + Generate + Publish

**Files:**
- Create: `src/app/api/reports/route.ts`
- Create: `src/app/api/reports/[id]/route.ts`
- Create: `src/app/api/reports/[id]/publish/route.ts`

- [ ] **Step 1: Create GET + POST /api/reports**

Board auth. GET lists reports for workspace (`?workspace_id=`). POST generates a new report: validates input, calls `generateReportData()`, inserts into `project_reports` with status 'draft', returns the report with token.

- [ ] **Step 2: Create GET + PATCH + DELETE /api/reports/[id]**

Board auth. GET returns full report. PATCH updates title/status. DELETE removes report.

- [ ] **Step 3: Create POST /api/reports/[id]/publish**

Board auth. Sets status to 'published', sets published_at. Optionally sends email with report link via Resend if `send_to` recipients provided in request body.

Email contains: report title, period, direct link (`{origin}/report/{token}`), brief summary.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/reports/
git commit -m "feat: add report API routes (list, generate, publish, CRUD)"
```

---

## Task 4: Client-Facing Report Page (Public, Token-Based)

**Files:**
- Create: `src/app/report/[token]/layout.tsx`
- Create: `src/app/report/[token]/page.tsx`
- Create: `src/components/reports/report-view.tsx`
- Modify: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Add /report to middleware public routes**

In `src/lib/supabase/middleware.ts`, add:
```typescript
request.nextUrl.pathname.startsWith("/report") ||
```

- [ ] **Step 2: Create report layout**

Create `src/app/report/[token]/layout.tsx` — minimal public layout (same pattern as proposal layout): own html/body, globals.css, no sidebar. Title: "Report | Just Ship".

- [ ] **Step 3: Create report page (SSR)**

Create `src/app/report/[token]/page.tsx`:
- `force-dynamic`
- Use `createServiceClient()` to look up report by token
- Only show if status is 'published' (draft/archived → notFound)
- Increment `view_count`, set `viewed_at` on first view
- Pass `report_data` + metadata to `ReportView` client component

- [ ] **Step 4: Create ReportView client component**

Create `src/components/reports/report-view.tsx` — the actual report UI:

**Sections:**
1. **Header** — Report title, project name, period label, "Powered by Just Ship" footer
2. **Summary Cards** — 4 cards: Tickets Completed, Total Cost, Agent Runs, Open Tickets
3. **Completed Tickets** — Table: T-number, title, agent that worked on it
4. **In Progress** — Table: T-number, title, status
5. **Cost Breakdown** — Total cost, avg per ticket, token breakdown (input/output)
6. **Agent Activity** — Bar chart (CSS bars): agent types by run count
7. **Next Steps** — Top priority open tickets

Design: Use existing shadcn/ui Card components, consistent with Board styling. Responsive. Clean and professional for client viewing.

- [ ] **Step 5: Commit**

```bash
git add src/app/report/ src/components/reports/report-view.tsx src/lib/supabase/middleware.ts
git commit -m "feat: add client-facing report page with token-based access"
```

---

## Task 5: Developer Dashboard — Reports List + Generate Dialog

**Files:**
- Create: `src/app/(main)/[slug]/reports/page.tsx`
- Create: `src/components/reports/reports-list.tsx`
- Create: `src/components/reports/generate-report-dialog.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/mobile-nav.tsx`

- [ ] **Step 1: Add Reports to sidebar**

In `sidebar.tsx`, add to `NAV_ITEMS`:
```typescript
import { FileText } from "lucide-react";
{ label: "Reports", icon: FileText, href: (slug: string) => `/${slug}/reports` },
```

Same for `mobile-nav.tsx` if it has its own nav items.

- [ ] **Step 2: Create Reports list page**

`src/app/(main)/[slug]/reports/page.tsx` — Server Component rendering `ReportsList`.

- [ ] **Step 3: Create ReportsList component**

Table showing reports: Title, Project, Period, Status (draft/published), Views, Published At, Actions.

Actions per report:
- **Draft**: "Preview" (opens report page), "Publish" (publishes + shows link), "Delete"
- **Published**: "Copy Link" (report token URL), "Email" (send to client), "Archive"

"Generate Report" button → opens dialog.

Empty state when no reports.

- [ ] **Step 4: Create GenerateReportDialog**

Dialog with:
- Project selector (dropdown with "All Projects" option)
- Period presets: "This Week", "This Month", "Last Month", "Last Quarter"
- Custom date range (start/end date inputs)
- Optional title (auto-generated from project + period if empty)
- "Generate" button → POST /api/reports, shows loading, adds to list as draft

- [ ] **Step 5: Commit**

```bash
git add src/app/(main)/[slug]/reports/ src/components/reports/reports-list.tsx src/components/reports/generate-report-dialog.tsx src/components/layout/sidebar.tsx src/components/layout/mobile-nav.tsx
git commit -m "feat: add developer reports dashboard (list, generate, publish)"
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

- `/[slug]/reports` loads with empty state
- "Generate Report" dialog opens, accepts project + date range
- Generated report appears in list as draft
- "Preview" opens `/report/[token]` — shows report data
- "Publish" sets status, link becomes shareable
- Client link works without auth
- Sidebar shows "Reports" nav item

- [ ] **Step 4: Commit fixes if any**

---

## Acceptance Criteria Checklist

| Criterion (adapted from spec) | Task |
|---|---|
| Report enthält Ticket-Summary, Kosten, Agent-Activity | Task 2 (generator) + Task 4 (report view) |
| Report ohne Login zugänglich | Task 4 (token-based public page) |
| Report wird generiert und gespeichert | Task 2 (generator) + Task 3 (POST /api/reports) |
| Manueller Trigger aus Board funktioniert | Task 5 (generate dialog) |
| Clients bekommen Link zum Report | Task 3 (publish + email) + Task 5 (copy link) |
