# `/recover` — Universal Pipeline Recovery

**Date:** 2026-03-31
**Status:** Approved
**Author:** Claude Opus 4.6

---

## Problem

When an agent crashes or hangs during `/develop`, the system enters an unrecoverable state:

1. Ticket stuck on `in_progress` / `pipeline_status: running` on the Board
2. Board shows a phantom agent (last `agent_started` event without `completed`)
3. Worktree orphaned in `.worktrees/T-{N}/`
4. No automated way to resume or restart — requires manual cleanup

This happens both locally (Claude Code IDE — "Not responding") and on the VPS (agent timeout, OOM, API disconnect). The recovery mechanism must work identically in both environments.

---

## Solution

A `/recover T-{N}` command with two modes (Resume / Restart), chosen automatically based on worktree state. Plus a `.claude/rules/` rule for automatic detection at session start.

---

## Design

### Two Status Fields

The Board has two separate status fields:

- **`status`** — Board-level lifecycle: `ready_to_develop`, `in_progress`, `in_review`, `done`
- **`pipeline_status`** — Pipeline-level state: `running`, `paused`, `crashed`, `done`, `null`

A ticket is "stuck" when `status: in_progress` AND `pipeline_status` is one of: `running` (zombie), `crashed`, or `null` (already reset by server). If `pipeline_status: paused`, the ticket is waiting for human input via `/api/answer` — recovery should not be offered.

### Concurrency Guard

Before recovery, check if an agent process is actively working on this ticket:

- **Local:** Check if `.claude/.active-ticket` contains the ticket number (indicates an active session)
- **VPS:** The server tracks `runningTickets` in memory

If the ticket is actively being processed, warn the user and abort: "T-{N} appears to be actively worked on. Stop the running session first."

### Decision Flow

```
/recover T-{N}
  |
  +-- Concurrency guard: is an agent actively working on T-{N}?
  |     +-- Yes -> "T-{N} is actively being worked on. Stop the session first." -> Stop
  |
  +-- Read ticket from Board API (both `status` and `pipeline_status`)
  |     +-- Not stuck? -> "T-{N} is not blocked (status: {status}, pipeline: {pipeline_status})" -> Stop
  |     +-- pipeline_status: paused? -> "T-{N} is paused waiting for input. Use /api/answer to resume." -> Stop
  |     +-- Board unreachable? -> Continue with local-only recovery
  |
  +-- Send `agent_failed` event for last running agent (while evidence still exists)
  |
  +-- Worktree `.worktrees/T-{N}` exists?
  |     +-- Yes -> git diff against merge-base
  |     |     +-- Has changes -> RESUME mode
  |     |     +-- No changes  -> RESTART mode
  |     +-- No -> RESTART mode
  |
  +-- Execute chosen mode
```

### Resume Mode

**Trigger:** Worktree exists and has code changes (the crashed agent did partial work).

**Steps:**

1. Send `agent_failed` event for the last `agent_started` without matching `completed`
2. Re-establish infrastructure (these are normally done in `/develop` Steps 3a/3c/3d but must be re-done since the original session is dead):
   - Resolve Board API credentials (read `project.json` → `write-config.sh read-workspace`)
   - Write `.claude/.active-ticket` with ticket number
   - Send `orchestrator agent_started` pipeline event
3. Change working directory to worktree `.worktrees/T-{N}/`
4. Analyze existing work: `git diff --stat $(git merge-base main HEAD)`
5. Assess what's done vs what's missing based on the diff, then continue `/develop` flow from the appropriate step:
   - If code changes exist but no commits: continue from Step 6 (Build-Check)
   - If code changes exist with commits: continue from Step 7 (QA Review)
   - If checkpoint exists on ticket (P1 feature): read exact phase and resume from there
6. Complete the remaining `/develop` steps through Step 10 (Commit → Push → PR → QA)

**Why not re-plan:** The planning phase reads the ticket and codebase to formulate agent instructions. The worktree already contains the results of that planning. Re-planning would generate different instructions that conflict with already-written code. Instead, assess what's done and what's missing.

**Reading checkpoints (P1 integration):**
```bash
CHECKPOINT=$(curl -s -H "X-Pipeline-Key: {api_key}" "{board_url}/api/tickets/{N}" \
  | node -e "const t=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); \
     console.log(JSON.stringify(t.pipeline_checkpoint || null))")
```
If checkpoint is non-null, map `checkpoint.phase` to `/develop` step numbers:
- `triage` → Step 4 (Planning)
- `planning` → Step 5 (Implementation)
- `agents_dispatched` / `agents_done` → Step 6 (Build-Check)
- `qa` → Step 9 (Commit/PR)
- `pr_created` → Step 10 (Automated QA)

### Restart Mode

**Trigger:** No worktree, or worktree has no changes (agent crashed before doing any work).

**Steps:**

1. Send `agent_failed` event (while branch/worktree evidence still exists)
2. Reset ticket status AND pipeline_status:
   ```bash
   curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
     -H "Content-Type: application/json" \
     -d '{"status": "ready_to_develop", "pipeline_status": null}' \
     "{board_url}/api/tickets/{N}"
   ```
3. Clean up worktree + branch (if they exist):
   ```bash
   git worktree remove .worktrees/T-{N} --force 2>/dev/null || true
   git branch -D {branch} 2>/dev/null || true
   ```
4. Call `/develop T-{N}` to start fresh

### Automatic Detection Rule

A `.claude/rules/detect-stuck-tickets.md` rule loaded at every session start:

> On your first interaction with the user in this session: check if `.worktrees/` contains any directories. For each found worktree, extract the ticket number and check its Board status (with a 3-second timeout per call). If a ticket has `status: in_progress` and `pipeline_status` is `running`, `crashed`, or `null` — but no active agent process is running (`.claude/.active-ticket` does not contain this number) — inform the user:
>
> "T-{N} appears stuck on `in_progress` with an orphaned worktree. Run `/recover T-{N}` to resume or restart."
>
> If the Board is unreachable, skip detection silently.
>
> Do NOT automatically run recovery. Only inform.

### VPS Integration

On the VPS, the watchdog timeout handler (`pipeline/lib/watchdog.ts`) currently does WIP-save and cleanup. Extend it to invoke the same recovery logic:

- After WIP-save: check if the worktree has changes
- If changes: set `pipeline_status: 'crashed'` (distinct from `paused` which means human-in-the-loop) so the next launch can distinguish crash recovery from human input
- If no changes: reset to `status: ready_to_develop, pipeline_status: null` for automatic retry on next poll cycle
- Send `agent_failed` event in both cases

**New pipeline_status value: `crashed`**

Distinct from `paused` (waiting for human input via `/api/answer`). The server's launch handler should treat `crashed` like `running`-zombie: eligible for recovery/restart, not waiting for human input.

This replaces the current behavior where watchdog timeout leaves the ticket in an ambiguous state.

### Board Events

New event type `agent_failed` with metadata:

```json
{
  "ticket_number": 501,
  "agent_type": "backend",
  "event_type": "agent_failed",
  "metadata": {
    "reason": "timeout" | "crashed" | "manual_stop",
    "recovery_mode": "resume" | "restart",
    "worktree_had_changes": true | false
  }
}
```

The Board should handle this event by:
- Clearing the "running agent" indicator
- Showing a "recovered" or "retrying" status badge

**Board API verification required:** The Board's `/api/events` endpoint may validate `event_type` against a whitelist. Before implementation, verify that `agent_failed` is accepted. If the Board validates event types, `agent_failed` must be added to the accepted list.

---

## Files

### New Files

| File | Responsibility |
|---|---|
| `commands/recover.md` | `/recover` slash command definition |
| `.claude/rules/detect-stuck-tickets.md` | Automatic detection rule |

### Modified Files

| File | Changes |
|---|---|
| `pipeline/lib/watchdog.ts` | Extend timeout handler: set `pipeline_status: crashed` + send `agent_failed` event |

### Verification Required

| File / System | What to verify |
|---|---|
| Board `/api/events` endpoint | Accepts `agent_failed` event type (or add to whitelist) |
| Board `/api/tickets` PATCH | Accepts `pipeline_status` field updates |

### No Changes Needed

| File | Why |
|---|---|
| `commands/develop.md` | Already supports being called with a ticket number; resume mode calls it directly |
| `pipeline/lib/event-hooks.ts` | `postPipelineEvent()` already accepts arbitrary event type strings |
| `pipeline/server.ts` | Zombie detection already handles stale `running`; P1 checkpoint resume extends this |

---

## Interaction with P1 Pipeline Stability

This design works **without** P1 checkpoints:
- Resume/Restart decision is based on `git diff` (filesystem state), not checkpoints
- Phase detection is heuristic (diff analysis → map to step numbers)

With P1 checkpoints, `/recover` gets **smarter**:
- Reads `pipeline_checkpoint` from ticket to know exact phase
- Can resume mid-agent-dispatch (e.g., "backend done, frontend pending")
- Checkpoint's `attempt` counter enables max-retry limits

The `/recover` command checks for checkpoint existence and uses it when available, falling back to git-diff heuristic when not.

---

## Edge Cases

### Multiple Stuck Tickets

The detection rule reports all stuck tickets. `/recover` handles one at a time. The user chooses which to recover first.

### No Board Configuration (Standalone Mode)

If `pipeline.workspace_id` is not set in `project.json`, skip all Board API calls. Recovery becomes local-only: check worktree, clean up or reuse, restart `/develop`.

### Race with VPS Worker

On the VPS, the worker's stuck-ticket cleanup (worker.ts) may reset tickets independently. Local `/recover` runs separately from VPS processes, so no race. VPS `/recover` (via watchdog) coordinates through `pipeline_status` — the atomic PATCH ensures only one recovery path executes.

---

## Out of Scope

- Per-agent timeout supervision (SDK limitation)
- Budget gates (separate P1 concern)
- Board UI changes for recovery status (Board team decides)
- Checkpoint infrastructure itself (P1 Tasks 2-4)
