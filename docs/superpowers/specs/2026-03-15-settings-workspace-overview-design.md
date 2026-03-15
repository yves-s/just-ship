# Settings Redesign: Workspace Overview & Identity Header

**Date:** 2026-03-15
**Status:** Draft
**Inspiration:** Sanity Management Dashboard (manage.sanity.io)

---

## Summary

Redesign the board Settings pages to show workspace identity information at a glance, inspired by Sanity's project management dashboard. Replace the current minimal "Settings" header and left sidebar navigation with a Workspace Identity Header and horizontal tab bar. Add a new Overview tab as the default landing page with stats, project/member summaries, and a derived activity feed.

## Current State

- Settings header shows only "Settings" text
- Left sidebar navigation: General, Projects, Members, API Keys
- General page (`/[slug]/settings`) shows two cards: Workspace Name (editable) and Workspace Slug (read-only)
- No workspace ID visible anywhere in the UI
- No overview/dashboard with stats or activity

## Design

### 1. Workspace Identity Header

Replaces the current "Settings" header. Visible on all Settings tabs.

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│  [Avatar]  Workspace Name                                │
│            WORKSPACE ID        SLUG           CREATED    │
│            ws_7f3k9x 📋       acme-corp      Jan 2026   │
├──────────────────────────────────────────────────────────┤
│  Overview  Projects  Members  API Keys  General          │
└──────────────────────────────────────────────────────────┘
```

**Components:**
- **Avatar**: First letter of workspace name, 48px, rounded, primary color background (matches sidebar avatar style but larger)
- **Workspace Name**: 20px, font-bold
- **Workspace ID**: Full UUID from Supabase, displayed in monospace, muted color, with clipboard copy button. On click: copies full ID, shows brief "Copied!" feedback. Display truncated (first 8 chars + "...") with full ID on hover/copy.
- **Slug**: Monospace, muted color
- **Created**: Formatted date (e.g., "Jan 15, 2026")

**Data source:** All fields from the existing `workspace` object (id, name, slug, created_at). The settings layout must fetch the workspace from Supabase (by slug) and pass it to the header component. Note: the parent `WorkspaceLayout` already fetches the workspace and provides it via `WorkspaceProvider` / `useWorkspace()`. The identity header is a client component that reads from `useWorkspace()` — no additional query needed in the settings layout.

### 2. Horizontal Tab Navigation

Replaces the current left sidebar `SettingsNav` component.

**Tabs (left to right):**
1. Overview (new, default)
2. Projects (existing)
3. Members (existing)
4. API Keys (existing)
5. General (existing, moved)

**Styling:**
- Horizontal row below the identity header
- Active tab: text-foreground + 2px bottom border in primary color
- Inactive tabs: text-muted-foreground, hover highlight
- No horizontal scroll needed for 5 tabs; if viewport is very narrow, tabs can scroll horizontally with `overflow-x: auto`

**Active state logic:**
- Overview (`/[slug]/settings`): **exact match only** — must not highlight when on `/[slug]/settings/general` or other sub-routes
- All other tabs: `startsWith` match (e.g., `/[slug]/settings/projects` matches `/[slug]/settings/projects/...`)

### 3. Tab Routing

| Tab | Route | Content | Change |
|---|---|---|---|
| **Overview** | `/[slug]/settings` | New dashboard page | Replaces current General as default |
| **Projects** | `/[slug]/settings/projects` | Project management | No change to content |
| **Members** | `/[slug]/settings/members` | Members + invites | No change to content |
| **API Keys** | `/[slug]/settings/api-keys` | API key management | No change to content |
| **General** | `/[slug]/settings/general` | Workspace name + slug edit | Moved from `/[slug]/settings` to new sub-route |

**Key change:** `/[slug]/settings` now shows Overview instead of General. The previous General content moves to `/[slug]/settings/general`.

### 4. Overview Tab Content

**Stats Row (top):**
Four stat cards in a horizontal row:
- **Projects** — count of projects in workspace
- **Members** — count of workspace members
- **Open Tickets** — count of tickets where `workspace_id` matches and `status NOT IN ('done', 'cancelled')`
- **API Keys** — count of active (non-revoked) API keys

Each card: dark background, uppercase label, large number.

**Two-Column Layout (middle):**

**Projects Card (left column):**
- Header: "Projects (N)" + "View all →" link (navigates to Projects tab)
- List of first 3-5 projects with:
  - Project avatar (first letter, colored background)
  - Project name
  - Ticket count per project (via `tickets` table filtered by `project_id`)
- Click "View all" → navigates to `/[slug]/settings/projects`

**Members Card (right column):**
- Header: "Members (N)" + "View all →" link (navigates to Members tab)
- List of first 3-5 members with:
  - User avatar (initials from email)
  - Email
  - Role (Owner/Admin/Member)
- If more than displayed, show "+N more members" row
- Click "View all" → navigates to `/[slug]/settings/members`

**Activity Feed (bottom, full width):**
- Header: "Recent Activity"
- Derived from existing data (no new DB table):
  - Tickets: `created_at` → "Ticket #42 created" (we can only reliably track creation, not status transitions — there is no status history in the current data model)
  - Members: `joined_at` → "john@team.com joined the workspace"
  - Projects: `created_at` → "Project Mobile App created"
- Union of recent entries sorted by timestamp, limit 5-10
- Each entry: colored dot indicator + description text + relative timestamp
- Color coding: green for completed/positive, blue for info, amber for new items
- **Note:** True status-change tracking (e.g., "Ticket moved to Done") would require a `ticket_status_log` table — out of scope for this iteration

**Responsive behavior:**
- Stats cards: 4 columns desktop → 2 columns mobile
- Projects/Members: 2 columns desktop → stacked on mobile

### 5. Data Fetching

**Overview page (server component):**
```
// All queries run in parallel via Promise.all
- workspace (already available from layout)
- projects count + first 5 projects
- members count + first 5 members
- open tickets count
- active API keys count
- recent tickets (last 10, ordered by updated_at)
- recent members (last 5, ordered by joined_at)
- recent projects (last 5, ordered by created_at)
```

Stats are only loaded on the Overview tab, not on every Settings page. The identity header uses only the workspace object from `useWorkspace()` context (no extra queries).

**Loading & Empty States:**
- Overview page uses a `loading.tsx` with skeleton placeholders for stats cards and content sections
- Empty workspace (no projects, no tickets, no extra members): stat cards show "0", project/member cards show an empty state with CTA ("Create your first project", "Invite a team member")
- Activity feed with no entries: "No recent activity" placeholder text

### 6. Copy-to-Clipboard

- Uses `navigator.clipboard.writeText(workspace.id)`
- Visual feedback: clipboard icon briefly changes to checkmark, or shows small "Copied!" tooltip
- Falls back gracefully if clipboard API is unavailable

## Files Changed

| File | Change |
|---|---|
| `src/app/[slug]/settings/layout.tsx` | Replace "Settings" header with identity header + horizontal tabs. Remove left sidebar nav wrapper (`max-w-4xl` + sidebar gap). Content area becomes full-width with max-width constraint. |
| `src/app/[slug]/settings/page.tsx` | Change from rendering `SettingsGeneral` to new `SettingsOverview` component with data fetching for stats, projects, members, activity |
| `src/app/[slug]/settings/loading.tsx` | **New file.** Skeleton loading state for the Overview page |
| `src/app/[slug]/settings/general/page.tsx` | **New file.** Fetches workspace by slug from Supabase, renders `SettingsGeneral` (same logic as current `page.tsx`) |
| `src/components/settings/settings-nav.tsx` | Rewrite: vertical sidebar → horizontal tab bar with correct active-state logic |
| `src/components/settings/settings-overview.tsx` | **New file.** Overview dashboard with stats, projects, members, activity |
| `src/components/settings/workspace-identity-header.tsx` | **New file.** Client component using `useWorkspace()` — workspace name, ID (copy), slug, created date |
| `src/components/ui/copy-button.tsx` | **New file.** Reusable copy-to-clipboard button (shared, can be used for API keys etc.) |

**Unchanged files (content stays the same, routing unaffected):**

| File | Status |
|---|---|
| `src/app/[slug]/settings/projects/page.tsx` | No change |
| `src/app/[slug]/settings/members/page.tsx` | No change |
| `src/app/[slug]/settings/api-keys/page.tsx` | No change |
| `src/components/settings/settings-general.tsx` | No change |
| `src/components/settings/members-view.tsx` | No change |
| `src/components/settings/projects-settings-view.tsx` | No change |

## Out of Scope

- Billing/Plan concepts (we don't have plans yet)
- Usage analytics tab
- Dedicated Activity/Audit log table (derived feed from existing data is sufficient for now)
- Changes to the Board header (stays as-is)
- Agent activity in the overview (stays in the Board's agent panel)
