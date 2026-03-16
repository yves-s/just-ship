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
- Project avatar (first letter, colored background — same pattern as Overview)
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
- **Total Tickets**: Count of all tickets with `project_id` matching this project
- **Open**: Count of tickets where `status NOT IN ('done', 'cancelled')`
- **Done**: Count of tickets where `status = 'done'`

Stats color coding: Open in amber, Done in green.

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

### Connection Status Detection

The current code does not track whether a project has an active pipeline connection. We need to determine connection status from existing data:

- A project is "Connected" if the workspace has at least one active (non-revoked) API key. This is a workspace-level check, not per-project. The API key is shared across all projects in a workspace.
- The connection status is already implicitly available — the `ensureApiKey` function checks for existing keys. We can pre-fetch this in the server component page.

**Data needed:** The projects page already fetches projects. Additionally fetch:
- Ticket counts per project (total, open, done) — via Supabase queries
- Whether workspace has an active API key — single boolean check

### Data Fetching

The Settings projects page (`src/app/[slug]/settings/projects/page.tsx`) is a server component. Add queries:

```
// Existing: projects list
// New: for each project, get ticket counts
// New: check if workspace has active API key (boolean)
```

Pass ticket counts and connection status as props to the component. The component stays a client component for interactive accordion behavior.

**Props change for ProjectsSettingsView:**
```typescript
interface ProjectWithStats extends Project {
  ticketStats: {
    total: number;
    open: number;
    done: number;
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
