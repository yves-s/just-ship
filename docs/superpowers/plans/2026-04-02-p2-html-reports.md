# P2 — HTML Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate static HTML reports per project and time range that can be emailed to clients without requiring a login. Reports show ticket summaries, cost breakdowns, agent activity, and next steps. Triggered manually from the Board or automatically on a weekly schedule.

**Architecture:** API-route-based report generation (not Edge Functions). A new route `/api/workspace/[workspaceId]/reports/generate` queries task_events + tickets for the given period, renders an HTML template with inline CSS, stores the result in Supabase Storage (`reports/` bucket), and returns a signed URL. Auto-generation uses a cron-triggered API route. Reports are email-compatible (inline CSS, no JS).

**Tech Stack:** Next.js 16 API Routes, Supabase (DB + Storage), Resend (email delivery, already integrated)

**Spec:** `docs/specs/p2-agency-layer.md` — Section 3 (HTML Reports)

**Target repo:** `just-ship-board` at `/Users/yschleich/Developer/just-ship-board/`

**Important context:**
- Resend already integrated (`src/lib/email.ts`)
- Cost data available via `task_events.estimated_cost_usd`, `input_tokens`, `output_tokens`
- Ticket data via `tickets` table with status transitions
- No Supabase Edge Functions exist yet — using API routes instead
- Pipeline-DB: `wsmnutkobalfrceavpxs`
- The `workspaces` table may get a `report_config` JSONB column for auto-generation settings

---

## File Structure

### New Files (Board Repo)

| File | Responsibility |
|---|---|
| **DB** | |
| `supabase/migrations/021_reports.sql` | `report_config` on workspaces + `reports` storage bucket |
| **Report Engine** | |
| `src/lib/reports/generate.ts` | Core: query data, aggregate, render HTML, store in Supabase Storage |
| `src/lib/reports/template.ts` | HTML template with inline CSS — email-compatible, standalone |
| `src/lib/reports/types.ts` | TypeScript types for report data, config |
| **API** | |
| `src/app/api/workspace/[workspaceId]/reports/generate/route.ts` | POST — generate report (Board auth) |
| `src/app/api/workspace/[workspaceId]/reports/route.ts` | GET — list generated reports |
| `src/app/api/workspace/[workspaceId]/reports/[id]/route.ts` | GET — download/view report |
| `src/app/api/workspace/[workspaceId]/reports/config/route.ts` | GET/PATCH — auto-generation config |
| `src/app/api/cron/reports/route.ts` | POST — cron trigger for auto-generation (secured by cron secret) |
| **UI** | |
| `src/app/(main)/[slug]/reports/page.tsx` | Reports list page |
| `src/components/reports/reports-list.tsx` | Client component: list of generated reports |
| `src/components/reports/generate-report-dialog.tsx` | Dialog: select project + date range, trigger generation |
| `src/components/settings/report-settings.tsx` | Auto-generation config in settings |

### Modified Files (Board Repo)

| File | Changes |
|---|---|
| `src/components/layout/sidebar.tsx` | Add "Reports" nav item with `FileText` icon |
| `src/components/layout/mobile-nav.tsx` | Add "Reports" to mobile nav |

---

## Task 1: DB Migration — report_config, Storage Bucket

**Files:**
- Create: `supabase/migrations/021_reports.sql`

- [ ] **Step 1: Apply migration via Supabase MCP**

Run against Pipeline-DB `wsmnutkobalfrceavpxs`:

```sql
-- ============================================
-- Report Config on Workspaces
-- ============================================

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS report_config jsonb DEFAULT '{}';

COMMENT ON COLUMN workspaces.report_config IS 'Auto-report generation config: frequency, day, recipients.';

-- ============================================
-- Reports Storage Bucket
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reports',
  'reports',
  false,
  10485760, -- 10MB
  ARRAY['text/html']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: workspace members can read, service role writes
CREATE POLICY "reports_select_members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'reports'
    AND (storage.foldername(name))[1] IN (
      SELECT w.id::text FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Save migration file**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/021_reports.sql
git commit -m "feat: add report_config column and reports storage bucket"
```

---

## Task 2: Report Engine — Types, Template, Generator

**Files:**
- Create: `src/lib/reports/types.ts`
- Create: `src/lib/reports/template.ts`
- Create: `src/lib/reports/generate.ts`

- [ ] **Step 1: Create report types**

Create `src/lib/reports/types.ts`:

```typescript
export interface ReportConfig {
  auto_generate?: boolean;
  frequency?: "weekly" | "monthly";
  day?: "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
  send_to?: string[];
}

export interface ReportData {
  workspace_name: string;
  project_name: string | null;
  period_label: string;
  period_start: string;
  period_end: string;
  generated_at: string;

  // Ticket summary
  completed_tickets: {
    number: number;
    title: string;
    agent_type: string;
    completed_at: string;
  }[];
  open_tickets: {
    number: number;
    title: string;
    status: string;
    priority: string;
  }[];

  // Costs
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;

  // Agent activity
  agent_summary: {
    agent_type: string;
    event_count: number;
    model: string | null;
  }[];

  // Next steps (highest priority open tickets)
  next_steps: {
    number: number;
    title: string;
    priority: string;
  }[];
}

export interface GeneratedReport {
  storage_path: string;
  signed_url: string;
  period_label: string;
  project_name: string | null;
  generated_at: string;
}
```

- [ ] **Step 2: Create HTML template**

Create `src/lib/reports/template.ts` — exports `renderReportHtml(data: ReportData): string`.

Requirements:
- Inline CSS only (no external stylesheets, no `<link>` tags)
- No JavaScript
- Email-compatible (works in Gmail, Outlook)
- Clean, professional layout: header with branding, sections with tables
- Uses system fonts (Arial/Helvetica stack)
- Color scheme: neutral grays, blue accents for links
- Responsive (works on mobile email clients)
- Sections: Period Header → Completed Tickets → Open Tickets → Costs Summary → Agent Activity → Next Steps → Footer

- [ ] **Step 3: Create report generator**

Create `src/lib/reports/generate.ts` — exports `generateReport(workspaceId, projectId, startDate, endDate)`.

Logic:
1. Query tickets completed in period (status changed to "done")
2. Query open tickets (backlog, ready_to_develop, in_progress)
3. Query task_events with cost data for period
4. Aggregate agent activity
5. Build `ReportData` object
6. Render HTML via template
7. Upload to Supabase Storage: `reports/{workspace_id}/{project_id || 'all'}/{date}.html`
8. Create signed URL (7-day expiry)
9. Return `GeneratedReport`

- [ ] **Step 4: Commit**

```bash
git add src/lib/reports/
git commit -m "feat: add report engine with HTML template and generator"
```

---

## Task 3: API Routes — Generate, List, Download, Config, Cron

**Files:**
- Create: `src/app/api/workspace/[workspaceId]/reports/generate/route.ts`
- Create: `src/app/api/workspace/[workspaceId]/reports/route.ts`
- Create: `src/app/api/workspace/[workspaceId]/reports/config/route.ts`
- Create: `src/app/api/cron/reports/route.ts`

- [ ] **Step 1: Create POST /generate**

Board auth. Accepts `{ project_id?, start_date, end_date }`. Calls `generateReport()`. Optionally sends email to `send_to` recipients via Resend with the report HTML as email body.

- [ ] **Step 2: Create GET /reports**

Board auth. Lists files in Supabase Storage under `reports/{workspace_id}/`. Returns list of generated reports with signed URLs.

- [ ] **Step 3: Create GET/PATCH /reports/config**

Board auth (admin only). GET returns `report_config` from workspace. PATCH updates it (Zod-validated).

- [ ] **Step 4: Create POST /cron/reports**

Secured by `CRON_SECRET` header (not Board auth — called by external cron). Iterates all workspaces with `report_config.auto_generate = true`, generates reports for configured frequency/day, sends emails.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/workspace/*/reports/ src/app/api/cron/
git commit -m "feat: add report API routes (generate, list, config, cron)"
```

---

## Task 4: Reports UI — List Page, Generate Dialog, Settings

**Files:**
- Create: `src/app/(main)/[slug]/reports/page.tsx`
- Create: `src/components/reports/reports-list.tsx`
- Create: `src/components/reports/generate-report-dialog.tsx`
- Create: `src/components/settings/report-settings.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/mobile-nav.tsx`

- [ ] **Step 1: Add Reports to sidebar**

Add to `NAV_ITEMS` in `sidebar.tsx`:
```typescript
import { FileText } from "lucide-react";
{ label: "Reports", icon: FileText, href: (slug: string) => `/${slug}/reports` },
```

Same for `mobile-nav.tsx` if it has its own nav items.

- [ ] **Step 2: Create Reports list page**

`src/app/(main)/[slug]/reports/page.tsx` — Server Component rendering `ReportsList`.

- [ ] **Step 3: Create ReportsList component**

Table showing generated reports: Period, Project, Generated At, Actions (View, Download, Email).
"Generate Report" button → opens dialog.
Empty state when no reports.

- [ ] **Step 4: Create GenerateReportDialog**

Dialog with:
- Project selector (dropdown, or "All Projects")
- Date range (start/end date pickers, or preset: This Week, This Month, Last Month)
- Optional: email recipients
- "Generate" button → calls POST /generate, shows loading, then adds to list

- [ ] **Step 5: Create ReportSettings component**

For settings page — auto-generation toggle, frequency selector, day-of-week, recipient list.
Save calls PATCH `/api/workspace/[workspaceId]/reports/config`.

- [ ] **Step 6: Commit**

```bash
git add src/app/(main)/[slug]/reports/ src/components/reports/ src/components/settings/report-settings.tsx src/components/layout/sidebar.tsx src/components/layout/mobile-nav.tsx
git commit -m "feat: add reports UI (list page, generate dialog, settings)"
```

---

## Task 5: Build Check + Verification

- [ ] **Step 1: Run build**

```bash
npm run build
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

- [ ] **Step 3: Verify**

- `/[slug]/reports` page loads
- "Generate Report" dialog opens and accepts input
- Generated report HTML is standalone (open in browser, no broken styles)
- Report appears in list after generation
- Settings page shows auto-generation config

- [ ] **Step 4: Commit fixes if any**

---

## Acceptance Criteria Checklist

| Criterion | Task |
|---|---|
| Report enthält Ticket-Summary, Kosten, Agent-Activity | Task 2 (generator + template) |
| HTML ist standalone (Inline CSS, kein JS, kein Login) | Task 2 (template requirements) |
| Report wird in Supabase Storage gespeichert | Task 2 (generator uploads to storage) |
| Manueller Trigger aus Board funktioniert | Task 3 (POST /generate) + Task 4 (generate dialog) |
| Automatische wöchentliche Generierung konfigurierbar | Task 3 (cron route) + Task 4 (report settings) |
