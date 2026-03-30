# Workflow Reliability & Board Cockpit — Design Spec

> **Date:** 2026-03-30
> **Status:** Review
> **Scope:** just-ship (Engine), just-ship-board (Board UI), VPS Pipeline

---

## Problem Statement

The just-ship workflow has grown feature-rich but is unreliable in depth. Specific failure modes:

1. **VPS Agent doesn't start** — Worker claims ticket, SDK `query()` hangs, Board shows "loading" forever. No ticket has completed the autonomous pipeline successfully.
2. **No question flow** — Agent can't ask for clarification. Large tickets can't be autonomously processed because there's no fallback when the agent is uncertain.
3. **Tickets too large for autonomy** — No gate to prevent complex tickets from entering the autonomous pipeline where they'll fail.
4. **Board doesn't show operational state** — Open worktrees, hanging agents, stale reviews, orphaned branches — none visible in the Board. Requires terminal `/just-ship-status`.
5. **Lifecycle gaps** — Tickets stuck in intermediate states, worktrees orphaned, spikes without follow-up, reviews forgotten.

**Root cause:** The user spends time building the engine instead of using it, because each use reveals friction that pulls them back into engine work.

**Goal:** Fix the core loop so the engine is trustworthy, then make the Board the single cockpit for all operational visibility. After this: engine freeze, focus on product tickets.

---

## Section 1: VPS Agent-Start Fix + Stuck Detection

### 1a. Agent-Start Diagnostik

**Where:** `pipeline/run.ts` — `executePipeline()` function

Add structured logging BEFORE the `query()` call:
- Log: prompt length, model, workDir, loaded agents (names), loaded skills (names), branch name
- Set Sentry breadcrumbs at each phase: "triage_start", "triage_done", "orchestrator_start"
- On SDK error: capture full error + context to Sentry

**Where:** `pipeline/server.ts` — `/health` endpoint

Extend health response:
```json
{
  "status": "ok",
  "mode": "multi-project",
  "running": { "ticket_number": 123, "started_at": "...", "agent": "orchestrator", "elapsed_seconds": 542 },
  "last_completed": { "ticket_number": 120, "status": "completed", "at": "..." },
  "last_error": { "ticket_number": 121, "error": "Timeout nach 30 Minuten", "at": "..." },
  "uptime_seconds": 86400,
  "drain": { "state": "normal", "running_count": 0 }
}
```

**Data source for `last_completed` / `last_error`:** In-memory ring buffer (last 10 runs), reset on server restart. This is acceptable because the Board can query `task_events` for full history — the health endpoint is for quick glance, not audit trail.

### 1b. Watchdog in Worker

**Where:** `pipeline/worker.ts` — `runWorkerSlot()` function

The `server.ts` has `withWatchdog()` but `worker.ts` does not. If `executePipeline()` hangs in worker mode, the worker slot is blocked forever.

**Fix:** Wrap `executePipeline()` in the same `withWatchdog()` pattern:
```typescript
const result = await withWatchdog(
  executePipeline({ ... }),
  `T-${ticket.number}`
);
```

On watchdog timeout:
1. **Abort the subprocess first** — call `queryAbortController.abort()` and wait briefly (5s) for the Claude Code process to terminate. This prevents conflicts with a still-running agent writing to the worktree.
2. Check for uncommitted changes in worktree
3. If changes exist → `git add -A && git commit -m "WIP: watchdog timeout T-{N}"` + `git push`
4. Set ticket `pipeline_status=failed`, `status=ready_to_develop`
5. Clear Board agent events
6. Send Sentry alert
7. Release worker slot

**Shared code:** Extract `withWatchdog()` from `server.ts` into `pipeline/lib/watchdog.ts` so both `server.ts` and `worker.ts` can import it.

### 1c. Board-Side Stuck Detection

**Where:** Board API + Dashboard

New logic (can be a periodic check in the Dashboard component or a Board API endpoint):
- Query tickets where `status=in_progress` AND `pipeline_status=running`
- Compare against `task_events` timestamps (last event for this ticket) rather than `updated_at`, which can be bumped by unrelated PATCH operations
- If > 35 minutes since last `task_event` → mark as "stuck" (visual indicator only, no auto-reset — the Watchdog handles reset)
- Board shows stuck tickets with actions:
  - **"Retry"** → PATCH ticket: `pipeline_status=null, status=ready_to_develop`
  - **"Cancel"** → PATCH ticket: `pipeline_status=null, status=backlog`

---

## Section 2: Autonomy Gate — Complexity Controls What Runs Autonomously

### 2a. Complexity as Autonomy Gate in Worker

**Prerequisite:** Ticket complexity field exists in DB. Implementation plan exists in Board repo. The `TicketComplexity` type and `ComplexityBadge` component are already in the Board codebase — verify whether the DB column already exists before planning a migration.

**NULL handling:** Tickets without a complexity value (NULL) are excluded from autonomous mode by default. The worker filter `complexity=in.(low,medium)` skips NULL. The ticket-writer skill MUST always set complexity on new tickets. Existing tickets without complexity should default to `medium` via a one-time DB migration.

**Where:** `pipeline/worker.ts` — `getNextTicket()` and `pipeline/server.ts` — `handleLaunch()`

Worker query filter adds complexity constraint:
```sql
-- Current:
status=eq.ready_to_develop&pipeline_status=is.null
-- New:
status=eq.ready_to_develop&pipeline_status=is.null&complexity=in.(low,medium)
```

Server launch handler checks complexity before accepting:
```typescript
if (['high', 'critical'].includes(ticket.complexity)) {
  sendJson(res, 422, {
    status: "rejected",
    message: "Ticket complexity too high for autonomous mode",
    complexity: ticket.complexity,
    max_allowed: config.pipeline.maxAutonomousComplexity,
  });
  return;
}
```

**Config:** `project.json` → `pipeline.max_autonomous_complexity: "medium"` (default)

The threshold is configurable per project — some mature projects with good test coverage might allow `high`.

### 2b. Ticket-Writer Sets Complexity Automatically

**Where:** `skills/ticket-writer.md`

Add complexity heuristics to the ticket-writer skill:

| Complexity | Signals |
|---|---|
| `low` | Single file change, bug fix with clear reproduction, config update, text/copy change, dependency bump |
| `medium` | Feature in 1 repo, 2-5 files, clear acceptance criteria, one domain (frontend OR backend OR DB) |
| `high` | Cross-domain (frontend + backend + DB), architecture change, migration, vague requirements, 6+ files |
| `critical` | Cross-repo, system redesign, breaking changes, infrastructure rebuild, requires human judgment throughout |

The ticket-writer proposes complexity during ticket creation. User can override in the Board UI or during creation.

**Board UI:** Complexity dropdown in ticket detail sheet + create dialog (already planned in complexity implementation plan).

---

## Section 3: Board as Cockpit — Operational Visibility

### 3a. Pipeline Status Widget

**Where:** Board Dashboard page (`src/app/[slug]/dashboard/`)

New component: `PipelineStatusWidget`

**Data sources:**
- Pipeline Server `/health` endpoint → server status, current run, uptime
- `task_events` table → recent runs, agent activity
- `tickets` table → stuck/failed tickets

**Display:**
```
┌─ Pipeline Status ──────────────────────────────┐
│ ● Online  |  Uptime: 3d 12h  |  Mode: multi   │
├─────────────────────────────────────────────────┤
│ Current Run: T-467 "Improve Property Sidebar"   │
│ Agent: orchestrator  |  Running: 8m 23s         │
├─────────────────────────────────────────────────┤
│ Recent Runs:                                     │
│  ✓ T-498  Bugsink monitoring      12m   $0.42   │
│  ✓ T-499  Spike review workflow    5m   $0.18   │
│  ✗ T-501  GHCR deploys          30m   timeout   │
├─────────────────────────────────────────────────┤
│ ⚠ 1 ticket needs attention                      │
│  T-468 — in_review since 48h  [Review] [Close]  │
└─────────────────────────────────────────────────┘
```

**Polling:** Fetch `/health` every 30 seconds while Dashboard is open. Recent runs from DB via TanStack Query.

**Board → Pipeline Server connectivity:**
- The Pipeline Server URL is derived from the workspace's `board_url` (same domain, e.g. `pipeline.just-ship.io`). Store as `pipeline_url` in workspace settings or derive from convention.
- CORS: Pipeline Server already serves API endpoints — add `Access-Control-Allow-Origin` for the Board domain.
- Auth: `/health` requires no auth (public status). Action endpoints (`/api/answer`, `/api/launch`) use `X-Pipeline-Key` which the Board already has via workspace config.

### 3b. Ticket-Lifecycle Indicators

**Where:** Board ticket cards (`src/components/board/ticket-card.tsx`) + list view

Visual indicators on ticket cards based on combined `status` + `pipeline_status`:

| State | Indicator |
|---|---|
| `in_progress` + `running` | Pulsing green dot — "Agent working" |
| `in_progress` + `paused` | Yellow dot — "Waiting for answer" |
| `in_progress` + `failed` | Red dot — "Failed" |
| `in_review` + PR open | Link icon → PR URL |
| `in_review` > 48h | Orange warning — "Review overdue" |
| `ready_to_develop` + `high`/`critical` | Lock icon — "Local only" |

Implementation: Extend `TicketCard` and `TicketListView` to read `pipeline_status`, `complexity`, `updated_at`, and render the appropriate indicator.

### 3c. Stale Work Cleanup

**Where:** Dashboard or dedicated "Health" tab

Shows actionable items:
- **Stuck tickets:** `in_progress` with no progress > 35 min
- **Stale reviews:** `in_review` > 72h
- **Failed runs:** `pipeline_status=failed` not yet reset
- **Overdue spikes:** Spike tickets past due date without follow-up
- **Waiting for answer:** `pipeline_status=paused` with pending question

Each item has 1-click actions: "Reset", "Close", "Retry", "View PR"

This replaces the need for terminal `/just-ship-status` for operational overview.

---

## Section 4: Question Flow — Agent Pauses, Board Shows Question, User Answers

### 4a. Question Visibility in Board

**Existing infrastructure:**
- `run.ts`: `persistSession: true`, pause detection via `onPause` callback
- `server.ts`: `/api/answer` endpoint that calls `resumePipeline()`
- `worker.ts`: Session ID stored in ticket on pause

**Missing pieces (3):**
1. UI to see the question and answer it
2. `pending_question` field on tickets (DB column + Board type) — needs migration
3. Question text extraction from SDK — the current `onPause` callback only receives a static reason string (`"human_in_the_loop"`), not the actual question text

**Question text extraction — approach:**
The SDK's `query()` emits `assistant` messages before a pause. Buffer the last assistant text message during the `for await` loop. When `onPause` fires, the buffered text IS the question. Implementation:
```typescript
let lastAssistantText = "";
for await (const message of query({ ... })) {
  if (message.type === "assistant") {
    // Extract text blocks
    const texts = message.content?.filter(b => b.type === "text").map(b => b.text) ?? [];
    if (texts.length > 0) lastAssistantText = texts.join("\n");
  }
}
// In onPause callback, use lastAssistantText as the question
```
This requires the `onPause` callback to have access to `lastAssistantText` via closure.

**DB migration:** Add `pending_question TEXT` column to `tickets` table (nullable, cleared on resume).

**Where:** Board ticket detail + Board API

When agent pauses:
1. Pipeline server stores question in ticket: PATCH ticket with `pending_question: lastAssistantText` and `pipeline_status: "paused"`
2. A `task_event` is created: `event_type: "question"`, payload contains the question text
3. Board ticket detail sheet shows:
   - Yellow banner: "Agent wartet auf Antwort"
   - Question text (markdown-rendered)
   - Answer text input
   - "Antworten" button
   - Quick-response buttons: "Ja, mach weiter", "Abbrechen", "Konservative Lösung"
4. On answer → Board POSTs to Pipeline Server `/api/answer`

### 4b. Answer Flow

**Board → Pipeline Server:**
```
POST /api/answer
{
  "ticket_number": 467,
  "answer": "Use the conservative approach, no breaking changes",
  "project_id": "f866f2ac-..."
}
```

Pipeline Server:
1. Finds parked worktree for ticket
2. Calls `resumePipeline()` with answer + session ID
3. Updates ticket: `pipeline_status: "running"`, clears `pending_question`
4. Board sees status change, shows green pulsing dot again

### 4c. Notification + Timeout

**Notification:**
- Dashboard widget shows count: "1 ticket waiting for answer"
- Ticket card shows yellow dot (from Section 3b)
- Future: Telegram Bot notification (bot repo exists)

**Multiple pause/resume cycles:** The agent may pause more than once in a single run. The Board UI must handle this — each new pause overwrites `pending_question` and resets the answer field. The question/answer history is preserved in `task_events`.

**Timeout:**
- The 24h timer is **DB-based**, not in-memory. When `pipeline_status` is set to `"paused"`, `updated_at` is bumped. The lifecycle timeout runner (Section 5a) checks `updated_at` for paused tickets — this survives server restarts.
- If no answer after 24h:
  1. Push branch with current work: `git add -A && git commit -m "WIP: auto-cancelled after 24h pause T-{N}"` + `git push`
  2. Reset ticket: `pipeline_status=null, status=ready_to_develop`
  3. Add note to ticket: "Auto-cancelled — Branch `feature/T-{N}-...` enthält bisherige Arbeit"
  4. Clean up worktree

---

## Section 5: Lifecycle Hygiene — Nothing Stays Stuck

### 5a. Ticket Lifecycle Timeouts

**Where:** Pipeline Server — periodic interval (every 5 minutes) in the main loop. The Pipeline Server already runs continuously and has DB access. Board-side cron would require a separate scheduler (Vercel cron) and add complexity. The Pipeline Server is the right place because it also handles the worktree cleanup that follows timeout actions.

**Race condition mitigation:** All timeout actions check the current `pipeline_status` before acting (optimistic concurrency). If a Board "Retry" click and a Watchdog timeout race, the second one to arrive finds the status already changed and skips.

**Per-ticket retry counter:** Add `pipeline_retry_count INTEGER DEFAULT 0` to tickets table. Incremented on each auto-reset. Reset to 0 on manual status change or successful completion.

| Condition | Timeout | Action |
|---|---|---|
| `in_progress` + `running` > 35 min | Watchdog | Reset to `ready_to_develop`, clear events, Sentry alert |
| `in_progress` + `paused` > 24h | Auto-cancel | Push WIP branch, reset to `ready_to_develop`, notification |
| `in_progress` + `failed` > 1h | Auto-reset | Reset to `ready_to_develop` IF retry_count < 3. After 3 failures → set to `backlog` with note "Blocked after 3 failed attempts" |
| `in_review` > 72h | Warning | Badge in Board "Review überfällig" |

All resets log a `task_event` with the reason for traceability.

### 5b. Worktree Cleanup Rules

**Critical: What happens to the worktree on each auto-action?**

| Auto-Action | Worktree Has Changes? | Behavior |
|---|---|---|
| **Watchdog Timeout** (35 min) | Yes | `git add -A && git commit -m "WIP: watchdog timeout T-{N}"` + `git push` → delete worktree |
| **Watchdog Timeout** (35 min) | No | Delete worktree |
| **Auto-Cancel** (24h pause) | Yes (likely) | `git push` (agent already committed during work) → delete worktree. Ticket note: "Branch contains partial work" |
| **Auto-Cancel** (24h pause) | No | Delete worktree |
| **Auto-Reset** (failed > 1h) | Yes/No | Delete worktree directly (failed work is not worth preserving — error and failure reason are logged in `task_events`). No `git reset` needed — just remove the worktree. |
| **Manual Retry** (user clicks) | N/A | Delete existing worktree, next run creates fresh one |
| **Ticket done + branch merged** | N/A | Periodic cleanup: detect merged branches → delete worktree + local branch |

### 5c. Spike Lifecycle

**Where:** `skills/ticket-writer.md` + Board UI

- Ticket-writer sets `due_date` on spike tickets (default: +3 days from creation)
- Board shows overdue spikes with warning badge
- Spike tickets marked `done` without follow-up tickets → hint in Board: "Keine Follow-Up-Tickets erstellt"
- This builds on the existing `/spike-review` command

### 5d. Board Cleanup Dashboard

**Where:** Dashboard page — "Health" section or tab in Pipeline Widget

Consolidated view of everything that needs attention:

```
┌─ Needs Attention ──────────────────────────────┐
│                                                  │
│ ⚠ Stuck (1)                                     │
│   T-468 in_review 48h  [Review] [Reset] [Close] │
│                                                  │
│ 💬 Waiting for Answer (0)                        │
│   No pending questions                           │
│                                                  │
│ ✗ Failed Runs (0)                                │
│   All clear                                      │
│                                                  │
│ 📋 Overdue Spikes (1)                            │
│   T-472 due 3d ago  [Review] [Close]             │
│                                                  │
│ 🌿 Orphaned Branches (1)                         │
│   workflow-modes-auto-healing [Delete]            │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## Implementation Scope

### Repos Involved

| Repo | Changes |
|---|---|
| **just-ship** (Engine) | Worker watchdog, diagnostics, complexity gate, worktree cleanup, ticket-writer skill |
| **just-ship-board** (Board) | Complexity field (DB + UI), Pipeline Widget, Lifecycle indicators, Question UI, Cleanup Dashboard |

### Dependencies / Order

1. **Worker Watchdog + Diagnostics** (Engine) — **highest priority**, no dependencies. Directly addresses "no ticket completes" problem. Extract `withWatchdog` to shared lib, add to worker, add structured logging + Sentry breadcrumbs.
2. **Ticket Complexity DB + UI** (Board) — verify if DB column exists already. If not, migrate. Wire up existing `ComplexityBadge` component in remaining UI locations.
3. **Complexity Gate** (Engine) — depends on #2. One-line filter change in worker + server guard.
4. **DB migrations for Question Flow** (Board) — `pending_question TEXT`, `pipeline_retry_count INTEGER DEFAULT 0` columns. Independent of #1-3.
5. **Pipeline Widget + Lifecycle Indicators** (Board) — depends on Pipeline Server URL being accessible from Board. Add CORS to Pipeline Server.
6. **Question Flow — Engine side** (Engine) — buffer last assistant text in `run.ts`, extend `onPause` to store question. Depends on #4.
7. **Question Flow — Board UI** (Board) — question banner + answer form in ticket detail. Depends on #4 and #6.
8. **Lifecycle Timeouts + Cleanup** (Engine) — periodic interval in Pipeline Server. Depends on #1 (watchdog) and #4 (retry counter).
9. **Cleanup Dashboard** (Board) — builds on #5 and #8. Final piece.
10. **Ticket-Writer Skill Update** (Engine) — add complexity heuristics + spike due_date. Independent, can happen anytime after #2.

### What This Does NOT Include

- Telegram Bot notifications (future, separate ticket)
- Automatic ticket decomposition (not needed if complexity gate blocks large tickets)
- VPS multi-worker parallelism (current: 1 ticket at a time, sufficient for now)
- Cross-repo worktree management (out of scope)
- `/develop` vs `/implement` command consolidation (separate concern)

---

## Edge Cases

1. **Worker watchdog fires during `git push`** — Skip WIP commit/push if git lock exists. The worktree will be deleted anyway.
2. **Multiple pause/resume cycles** — Board overwrites `pending_question` on each new pause. Full history in `task_events`.
3. **Race: Board "Retry" + Watchdog timeout** — Both check `pipeline_status` before acting. Second arrival finds status changed, skips.
4. **Failed ticket retry loop** — `pipeline_retry_count` incremented on each auto-reset. After 3 failures → moved to `backlog` with note. Counter resets on manual intervention or success.
5. **NULL complexity on existing tickets** — One-time migration sets `DEFAULT 'medium'`. Worker filter excludes NULL, so un-migrated tickets are blocked from autonomous mode (safe default).
6. **Pipeline Server restart during 24h pause** — Timer is DB-based (`updated_at` on the paused ticket). Lifecycle runner checks DB, not in-memory state. Survives restarts.
7. **Watchdog fires while agent subprocess still running** — Abort subprocess first (`abortController.abort()`), wait 5s, then proceed with cleanup.

---

## Success Criteria

1. A `low` or `medium` complexity ticket runs end-to-end on the VPS without hanging — from `ready_to_develop` to `in_review` with a PR
2. A stuck agent is automatically detected and reset within 35 minutes
3. The Board dashboard shows: server status, current run, stuck tickets, stale reviews, pending questions — without touching the terminal
4. An agent can pause with a question, the user sees it in the Board, answers, and the agent resumes
5. `high`/`critical` tickets are blocked from autonomous mode and clearly marked in the Board
6. No ticket stays in an intermediate status forever — all states have timeouts or warnings
