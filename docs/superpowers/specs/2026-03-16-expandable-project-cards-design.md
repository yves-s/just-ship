# Expandable Project Cards in Settings

**Date:** 2026-03-16
**Status:** Draft
**Inspiration:** Sanity Project-Level Dashboard

---

## Summary

Redesign the projects list in Settings from a flat list with dropdown menus to expandable accordion-style cards. Each card shows project identity info (ID with copy, created date), ticket stats, pipeline connection status, and action buttons when expanded. Primary goal: make the Project ID visible and copyable without opening dialogs.

## Current State

- Projects are displayed as flat list items in a single Card component
- Each item shows: name, description, "Connect" button, three-dot dropdown menu (Rename, Move, Delete)
- Project ID is only visible inside the ProjectSetupDialog (behind "Connect" button)
- No ticket stats per project visible
- No pipeline connection status visible at a glance

## Design

### Expandable Project Card

**Collapsed State:**
Each project renders as a bordered card with:
- Project avatar (first letter, deterministic color based on hashing the project ID to pick from a fixed color palette — stable across reorders)
- Project name (bold)
- Description (muted, truncated — if present)
- Connection status badge: green "Connected" or muted "Not connected"
- Chevron icon (▾/▴) indicating expandable

**Expanded State (click to toggle):**
The card expands below the header to reveal:

**Info Row:**
- **Project ID**: Truncated UUID (first 8 chars + "…") with CopyButton, full ID on hover/copy. Reuses `CopyButton` from `src/components/ui/copy-button.tsx`.
- **Created**: Formatted date (e.g., "Mar 9, 2026")
- **Pipeline**: "Connected" (green) or "Not connected" (muted)

**Stats Row:**
Three mini stat cards side by side:
- **Open**: Count of tickets where `status NOT IN ('done', 'cancelled')` — amber
- **Done**: Count of tickets where `status = 'done'` — green
- **Total**: Open + Done (excludes cancelled tickets, which are irrelevant for project health)

"Total" is defined as `open + done` so the numbers always add up. Cancelled tickets are excluded from all counts.

**Actions Row:**
Inline buttons replacing the dropdown menu:
- **Setup** — opens ProjectSetupDialog (same as current "Connect")
- **Edit** — opens EditProjectDialog (same as current "Rename")
- **Move** — opens MoveProjectDialog (same as current "Move to workspace")
- **Delete** — opens DeleteProjectDialog (destructive styling)

### Accordion Behavior

- Only one project card expanded at a time (accordion pattern)
- Clicking an expanded card collapses it
- Clicking a collapsed card while another is expanded: collapse the other, expand the clicked one
- State managed via `expandedProjectId: string | null`
- Use existing `Collapsible` / `CollapsibleTrigger` / `CollapsibleContent` from `@/components/ui/collapsible` (Radix, already installed) with controlled `open` state
- The entire collapsed card header is the click trigger (not just the chevron)
- No animation needed (instant expand/collapse, consistent with existing Collapsible usage in `ProjectSetupDialog`)

### Connection Status Detection

The current code does not track whether a project has an active pipeline connection. We need to determine connection status from existing data:

- A project is "Connected" if the workspace has at least one active (non-revoked) API key. This is a **workspace-level** check, not per-project — the API key is shared across all projects in a workspace. This means all projects in a connected workspace will show "Connected" simultaneously. This is a known limitation; per-project connection tracking would require a new data model (out of scope).
- The connection status is pre-fetched in the server component page as a single boolean `hasApiKey`.

**Data needed:** The projects page already fetches projects. Additionally fetch:
- Ticket counts per project (total, open, done) — via Supabase queries
- Whether workspace has an active API key — single boolean check

### Data Fetching

The Settings projects page (`src/app/[slug]/settings/projects/page.tsx`) is a server component. Add queries:

**Ticket stats strategy:** Fetch all tickets for the workspace in a single query (`select('id, project_id, status').eq('workspace_id', wid)`), then aggregate counts client-side in the server component by grouping on `project_id`. This avoids N+1 queries regardless of how many projects exist.

**API key check:** Single query: `select('id', { count: 'exact', head: true }).eq('workspace_id', wid).is('revoked_at', null)` → `hasApiKey = count > 0`.

Pass ticket counts and connection status as props to the component. The component stays a client component for interactive accordion behavior.

**Client-side state mutations:**
- New project created via dialog → added to local state with `ticketStats: { total: 0, open: 0, done: 0 }`
- Project deleted/moved → removed from local state (stats irrelevant)
- Project renamed → stats preserved from server-fetched data
- Stats are not live-updated; they reflect the state at page load (documented in Out of Scope)

**Props change for ProjectsSettingsView:**
```typescript
interface ProjectWithStats extends Project {
  ticketStats: {
    open: number;   // status NOT IN ('done', 'cancelled')
    done: number;   // status = 'done'
    total: number;  // open + done (excludes cancelled)
  };
}

interface ProjectsSettingsViewProps {
  projects: ProjectWithStats[];
  workspaceId: string;
  workspaceSlug: string;
  boardUrl: string;
  hasApiKey: boolean;  // new: workspace-level connection status
}
```

## Files Changed

| File | Change |
|---|---|
| `src/app/[slug]/settings/projects/page.tsx` | Add ticket count queries per project + API key existence check. Pass `ProjectWithStats[]` and `hasApiKey` to component. |
| `src/components/settings/projects-settings-view.tsx` | Rewrite: flat list → expandable accordion cards with ID, stats, actions. Remove dropdown menu, add inline actions. |

**Unchanged files:**

| File | Status |
|---|---|
| `src/components/ui/copy-button.tsx` | Reused, no change |
| `src/components/settings/edit-project-dialog.tsx` | No change |
| `src/components/settings/delete-project-dialog.tsx` | No change |
| `src/components/settings/move-project-dialog.tsx` | No change |
| `src/components/board/project-setup-dialog.tsx` | No change |
| `src/components/board/create-project-dialog.tsx` | No change |

## Out of Scope

- Dedicated project detail page / route
- Project-level activity feed
- Project switcher in sidebar
- Per-project member management (members belong to workspaces, not projects)
- Real-time ticket count updates (server-fetched on page load is sufficient)
