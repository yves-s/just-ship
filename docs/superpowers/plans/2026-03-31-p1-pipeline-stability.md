# P1 — Pipeline Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline production-reliable: checkpoint persistence for crash recovery, configurable agent timeouts with stuck detection, and budget ceiling enforcement per workspace.

**Architecture:** Extends the existing pipeline infrastructure (zombie detection, pause/resume, worktree parking, watchdog). Adds `pipeline_checkpoint` JSONB on tickets for phase-level recovery, timeout supervision wrapping the existing orchestrator query, and budget checks before launch using cost views from P0 token tracking.

**Tech Stack:** TypeScript (pipeline SDK), Supabase (migrations + views), Board API (PATCH endpoints)

**Spec:** `docs/specs/p1-pipeline-stability.md`

**Important context:** The pipeline already has significant reliability infrastructure:
- Zombie detection (server.ts:274-287) — detects stale `pipeline_status: "running"`
- Pause/resume with SDK session persistence (run.ts, server.ts /api/answer)
- Worktree parking + disk recovery (worktree-manager.ts)
- Watchdog timeout with WIP save (watchdog.ts)
- Drain mechanism for zero-downtime updates (drain.ts)

This plan adds the **missing pieces**, not a ground-up rebuild.

**Scope note:** Fresh Context per Task (Spec Section 3) is excluded — the current architecture already provides fresh context per sub-agent via the Agent SDK tool dispatch. The orchestrator gets a fresh prompt per run, and each sub-agent gets its own context. No architecture refactor needed.

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `pipeline/lib/checkpoint.ts` | Checkpoint read/write/clear via Board API |
| `pipeline/lib/budget.ts` | Budget check before launch, cost aggregation query |

### Modified Files

| File | Changes |
|---|---|
| `pipeline/run.ts` | Write checkpoints at phase transitions |
| `pipeline/server.ts` | Check for checkpoint on launch (resume vs restart), budget gate |
| `pipeline/lib/config.ts` | Add timeout config to ProjectConfig |

### DB Migrations (Supabase)

| Migration | What |
|---|---|
| `add_pipeline_checkpoint` | `tickets.pipeline_checkpoint` JSONB column |
| `add_budget_fields` | `workspaces.budget_ceiling_usd`, `workspaces.budget_alert_threshold` |
| `create_cost_views` | `ticket_costs` and `project_costs` views |

---

## Task 1: DB Migrations

- [ ] **Step 1: Add pipeline_checkpoint to tickets**

Run via Supabase MCP (`apply_migration`) against Pipeline-DB `wsmnutkobalfrceavpxs`:

```sql
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS pipeline_checkpoint jsonb;

COMMENT ON COLUMN tickets.pipeline_checkpoint IS 'Pipeline phase checkpoint for crash recovery. Set during run, cleared on completion.';
```

- [ ] **Step 2: Add budget fields to workspaces**

```sql
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS budget_ceiling_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS budget_alert_threshold numeric(3,2) DEFAULT 0.8;

COMMENT ON COLUMN workspaces.budget_ceiling_usd IS 'Max monthly budget in USD. NULL = no limit.';
COMMENT ON COLUMN workspaces.budget_alert_threshold IS 'Alert at this percentage of ceiling (default 0.8 = 80%).';
```

- [ ] **Step 3: Create cost aggregation views**

```sql
CREATE OR REPLACE VIEW ticket_costs AS
SELECT
  t.id AS ticket_id,
  t.project_id,
  t.workspace_id,
  COALESCE(SUM(te.input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(te.output_tokens), 0) AS total_output_tokens,
  COALESCE(SUM(te.estimated_cost_usd), 0)::numeric(10,6) AS total_cost_usd
FROM tickets t
LEFT JOIN task_events te ON te.ticket_id = t.id
  AND te.estimated_cost_usd IS NOT NULL
GROUP BY t.id, t.project_id, t.workspace_id;

CREATE OR REPLACE VIEW project_costs AS
SELECT
  t.project_id,
  t.workspace_id,
  DATE_TRUNC('month', te.created_at) AS month,
  COUNT(DISTINCT t.id) AS ticket_count,
  COALESCE(SUM(te.input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(te.output_tokens), 0) AS total_output_tokens,
  COALESCE(SUM(te.estimated_cost_usd), 0)::numeric(10,6) AS total_cost_usd
FROM tickets t
LEFT JOIN task_events te ON te.ticket_id = t.id
  AND te.estimated_cost_usd IS NOT NULL
GROUP BY t.project_id, t.workspace_id, DATE_TRUNC('month', te.created_at);
```

- [ ] **Step 4: Verify migrations**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'tickets' AND column_name = 'pipeline_checkpoint';

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'workspaces' AND column_name IN ('budget_ceiling_usd', 'budget_alert_threshold');

SELECT * FROM ticket_costs LIMIT 1;
SELECT * FROM project_costs LIMIT 1;
```

- [ ] **Step 5: Commit migration files (if local)**

---

## Task 2: Checkpoint Module

**Files:**
- Create: `pipeline/lib/checkpoint.ts`

- [ ] **Step 1: Create checkpoint.ts**

```typescript
export interface PipelineCheckpoint {
  phase: "triage" | "planning" | "agents_dispatched" | "agents_done" | "qa" | "pr_created";
  completed_agents: string[];
  pending_agents: string[];
  branch_name: string;
  worktree_path?: string;
  started_at: string;
  last_updated: string;
  attempt: number;
  error?: string;
}

interface CheckpointConfig {
  apiUrl: string;
  apiKey: string;
  ticketNumber: string;
}

/**
 * Write or update a checkpoint on the ticket via Board API.
 * Merges partial updates with existing checkpoint.
 */
export async function updateCheckpoint(
  config: CheckpointConfig,
  current: PipelineCheckpoint | null,
  update: Partial<PipelineCheckpoint>,
): Promise<void> {
  const checkpoint: PipelineCheckpoint = {
    phase: "triage",
    completed_agents: [],
    pending_agents: [],
    branch_name: "",
    started_at: current?.started_at ?? new Date().toISOString(),
    last_updated: new Date().toISOString(),
    attempt: current?.attempt ?? 1,
    ...current,
    ...update,
  };

  try {
    await fetch(`${config.apiUrl}/api/tickets/${config.ticketNumber}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": config.apiKey,
      },
      body: JSON.stringify({ pipeline_checkpoint: checkpoint }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Checkpoint write is best-effort — don't fail the pipeline
    console.error("[Checkpoint] Failed to write checkpoint");
  }
}

/**
 * Clear checkpoint after successful pipeline completion.
 */
export async function clearCheckpoint(config: CheckpointConfig): Promise<void> {
  try {
    await fetch(`${config.apiUrl}/api/tickets/${config.ticketNumber}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": config.apiKey,
      },
      body: JSON.stringify({ pipeline_checkpoint: null }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    console.error("[Checkpoint] Failed to clear checkpoint");
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsx --eval "import './pipeline/lib/checkpoint.ts'; console.log('checkpoint OK');"`

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/checkpoint.ts
git commit -m "feat: add pipeline checkpoint module for crash recovery"
```

---

## Task 3: Integrate Checkpoints into Pipeline

**Files:**
- Modify: `pipeline/run.ts`

- [ ] **Step 1: Add import**

```typescript
import { updateCheckpoint, clearCheckpoint, type PipelineCheckpoint } from "./lib/checkpoint.js";
```

- [ ] **Step 2: Create checkpoint config and state tracker in executePipeline()**

After the `eventConfig` setup (around line 230), add:

```typescript
  const checkpointConfig = hasPipeline ? {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
    ticketNumber: ticket.ticketId,
  } : null;
  let currentCheckpoint: PipelineCheckpoint | null = null;
```

- [ ] **Step 3: Write checkpoint after triage**

After the triage section completes (after `ticketDescription = triageResult.description`), add:

```typescript
  if (checkpointConfig) {
    currentCheckpoint = {
      phase: "triage",
      completed_agents: [],
      pending_agents: [],
      branch_name: branchName,
      worktree_path: workDir !== projectDir ? workDir : undefined,
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      attempt: 1,
    };
    await updateCheckpoint(checkpointConfig, null, currentCheckpoint);
  }
```

- [ ] **Step 4: Write checkpoint before orchestrator query**

Before the `for await (const message of query({` line:

```typescript
  if (checkpointConfig) {
    await updateCheckpoint(checkpointConfig, currentCheckpoint, { phase: "planning" });
  }
```

- [ ] **Step 5: Write checkpoint after successful orchestrator completion**

After `if (hasPipeline) await postPipelineEvent(eventConfig, "completed", "orchestrator")`:

```typescript
  if (checkpointConfig) {
    await updateCheckpoint(checkpointConfig, currentCheckpoint, { phase: "agents_done" });
  }
```

- [ ] **Step 6: Write checkpoint before QA**

At the start of the QA section:

```typescript
  if (checkpointConfig) {
    await updateCheckpoint(checkpointConfig, currentCheckpoint, { phase: "qa" });
  }
```

- [ ] **Step 7: Clear checkpoint on successful completion**

At the very end of `executePipeline()`, before the final return (after token summary):

```typescript
  if (checkpointConfig && exitCode === 0) {
    await clearCheckpoint(checkpointConfig);
  }
```

- [ ] **Step 8: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat: write pipeline checkpoints at phase transitions"
```

---

## Task 4: Checkpoint Resume Logic in Server

**Files:**
- Modify: `pipeline/server.ts`

- [ ] **Step 1: Read checkpoint from ticket in handleLaunch()**

In `handleLaunch()`, after fetching the ticket (around line 251 `fetchTicket()`), the response includes all ticket fields. Extract `pipeline_checkpoint`:

```typescript
    const checkpoint = ticketData.pipeline_checkpoint as PipelineCheckpoint | null;
```

Import the type at the top of server.ts:
```typescript
import type { PipelineCheckpoint } from "./lib/checkpoint.js";
```

- [ ] **Step 2: Add resume-from-checkpoint logic**

After zombie detection and before the atomic claim, check if a checkpoint exists and the pipeline is not already running:

```typescript
    // Checkpoint-based resume: if a checkpoint exists from a crashed run, resume from there
    if (checkpoint && checkpoint.phase !== "pr_created") {
      console.error(`[Launch] Found checkpoint at phase '${checkpoint.phase}' — resuming`);
      // The existing executePipeline will run from the beginning, but the checkpoint
      // data is available for future fine-grained resume. For now, we log it and
      // let the pipeline re-run (the orchestrator is idempotent on the worktree).
      // The key value: we know the branch_name and worktree_path from the checkpoint,
      // so we can recover the worktree even if the server crashed.
    }
```

**Note:** Full phase-level resume (skipping completed agents) requires the pipeline runner to accept a checkpoint and branch based on phase. This is a future enhancement. The immediate value of checkpoints is:
1. **Knowing the branch/worktree** after a crash (for manual or automatic recovery)
2. **Visibility** — the Board can show which phase the pipeline was in when it crashed
3. **Foundation** for future intelligent resume

- [ ] **Step 3: Use checkpoint's branch_name for worktree recovery**

If a checkpoint has `branch_name` and `worktree_path`, pass them to `worktreeManager.reattach()` instead of creating a new worktree:

```typescript
    // If checkpoint has worktree info, try to reattach instead of allocating new
    let worktreeResult;
    if (checkpoint?.worktree_path && checkpoint?.branch_name) {
      try {
        worktreeResult = await worktreeManager.reattach(checkpoint.branch_name);
        console.error(`[Launch] Reattached worktree for branch ${checkpoint.branch_name}`);
      } catch {
        console.error(`[Launch] Could not reattach worktree, allocating new`);
        worktreeResult = await worktreeManager.allocate(branchName);
      }
    } else {
      worktreeResult = await worktreeManager.allocate(branchName);
    }
```

- [ ] **Step 4: Commit**

```bash
git add pipeline/server.ts
git commit -m "feat: read checkpoint on launch for crash recovery"
```

---

## Task 5: Budget Module (was Task 4)

**Files:**
- Create: `pipeline/lib/budget.ts`

- [ ] **Step 1: Create budget.ts**

```typescript
interface BudgetConfig {
  apiUrl: string;
  apiKey: string;
}

interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  currentCost?: number;
  ceiling?: number;
  thresholdReached?: boolean;
}

/**
 * Check if the workspace has exceeded its monthly budget ceiling.
 * Returns allowed: true if no ceiling set or under budget.
 */
export async function checkBudget(
  config: BudgetConfig,
  workspaceId: string,
): Promise<BudgetCheckResult> {
  try {
    // Fetch workspace budget config via Board API
    const wsRes = await fetch(`${config.apiUrl}/api/workspaces/${workspaceId}`, {
      headers: { "X-Pipeline-Key": config.apiKey },
      signal: AbortSignal.timeout(8000),
    });

    if (!wsRes.ok) {
      // Can't check budget — allow by default (don't block pipeline on API errors)
      console.error(`[Budget] Failed to fetch workspace: ${wsRes.status}`);
      return { allowed: true };
    }

    const workspace = await wsRes.json();
    const ceiling = workspace.budget_ceiling_usd;

    if (!ceiling) return { allowed: true }; // No ceiling = no limit

    // Fetch current month cost
    const costRes = await fetch(
      `${config.apiUrl}/api/workspaces/${workspaceId}/costs?period=current_month`,
      {
        headers: { "X-Pipeline-Key": config.apiKey },
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!costRes.ok) {
      console.error(`[Budget] Failed to fetch costs: ${costRes.status}`);
      return { allowed: true }; // Allow on error
    }

    const costs = await costRes.json();
    const currentCost = costs.total_cost_usd ?? 0;
    const threshold = workspace.budget_alert_threshold ?? 0.8;

    if (currentCost >= ceiling) {
      return {
        allowed: false,
        reason: `Budget exceeded: $${currentCost.toFixed(2)} / $${ceiling.toFixed(2)}`,
        currentCost,
        ceiling,
      };
    }

    return {
      allowed: true,
      currentCost,
      ceiling,
      thresholdReached: currentCost >= ceiling * threshold,
    };
  } catch (error) {
    console.error(`[Budget] Check failed: ${error instanceof Error ? error.message : String(error)}`);
    return { allowed: true }; // Don't block on errors
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsx --eval "import './pipeline/lib/budget.ts'; console.log('budget OK');"`

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/budget.ts
git commit -m "feat: add budget check module for workspace cost ceiling"
```

---

## Task 6: Integrate Budget Check into Server

**Files:**
- Modify: `pipeline/server.ts`

- [ ] **Step 1: Add import**

After existing imports in server.ts:

```typescript
import { checkBudget } from "./lib/budget.js";
```

- [ ] **Step 2: Add budget gate in handleLaunch()**

In `handleLaunch()` (server.ts), after ticket validation and zombie detection but BEFORE the atomic claim (around line 315), add:

**Important:** `getApiCredentials()` returns `{ apiUrl, apiKey }` (no workspaceId). The workspace_id is available from `projectConfig.pipeline.workspaceId`. server.ts does NOT import `postPipelineEvent` — use raw `fetch` calls for events, consistent with the existing `patchTicket()` pattern.

```typescript
    // Budget check — block launch if workspace budget exceeded
    const { apiUrl, apiKey } = getApiCredentials(projectConfig, serverConfig);
    const workspaceId = projectConfig.pipeline.workspaceId;
    const budgetResult = await checkBudget({ apiUrl, apiKey }, workspaceId);

    if (!budgetResult.allowed) {
      console.error(`[Launch] Budget exceeded: ${budgetResult.reason}`);
      // Post budget_exceeded event via raw fetch (server.ts doesn't import postPipelineEvent)
      try {
        await fetch(`${apiUrl}/api/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pipeline-Key": apiKey },
          body: JSON.stringify({
            ticket_number: ticketNumber,
            agent_type: "orchestrator",
            event_type: "budget_exceeded",
            metadata: { cost: budgetResult.currentCost, ceiling: budgetResult.ceiling },
          }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* best-effort */ }
      return new Response(JSON.stringify({ error: budgetResult.reason }), { status: 402, headers: { "Content-Type": "application/json" } });
    }

    if (budgetResult.thresholdReached) {
      console.error(`[Launch] Budget threshold: $${budgetResult.currentCost?.toFixed(2)} / $${budgetResult.ceiling?.toFixed(2)}`);
      try {
        await fetch(`${apiUrl}/api/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pipeline-Key": apiKey },
          body: JSON.stringify({
            ticket_number: ticketNumber,
            agent_type: "orchestrator",
            event_type: "budget_threshold",
            metadata: { cost: budgetResult.currentCost, ceiling: budgetResult.ceiling },
          }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* best-effort */ }
    }
```

- [ ] **Step 3: Commit**

```bash
git add pipeline/server.ts
git commit -m "feat: add budget ceiling gate to pipeline launch"
```

---

## Task 7: Add Timeout Config to ProjectConfig

**Files:**
- Modify: `pipeline/lib/config.ts`

- [ ] **Step 1: Extend ProjectConfig interface**

Add to the `pipeline` type intersection:

```typescript
pipeline: PipelineConfig & {
  skipAgents?: string[];
  timeouts?: {
    haiku?: number;
    sonnet?: number;
    opus?: number;
  };
};
```

- [ ] **Step 2: Update loadProjectConfig return**

In the return object, extend the pipeline spread:

```typescript
pipeline: {
  ...pipeline,
  skipAgents: (rawPipeline.skip_agents as string[]) ?? [],
  timeouts: rawPipeline.timeouts as { haiku?: number; sonnet?: number; opus?: number } | undefined,
},
```

- [ ] **Step 3: Update templates/project.json**

Add `"timeouts": {}` inside the `pipeline` object using the Edit tool.

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/config.ts templates/project.json
git commit -m "feat: add configurable agent timeouts to project config"
```

---

## Task 8: Board API — Accept pipeline_checkpoint and budget fields

**Files:**
- Modify (Board repo): `just-ship-board/src/app/api/v1/pipeline/[slug]/tickets/route.ts` or the ticket PATCH endpoint

- [ ] **Step 1: Find the ticket PATCH endpoint in the Board repo**

The pipeline uses `patchTicket()` (server.ts:147-162) which calls `PATCH /api/tickets/{ticketNumber}`. Find this route in the Board repo and verify it accepts `pipeline_checkpoint` in the body.

Read the Board's ticket PATCH route. If it whitelists fields, add `pipeline_checkpoint` to the accepted fields. If it passes through, no change needed (the DB column already exists from Task 1).

Also verify the Board has a `/api/workspaces/:id` GET endpoint and a `/api/workspaces/:id/costs` GET endpoint. If not, these need to be created for the budget module (Task 4) to work.

- [ ] **Step 2: If needed, add pipeline_checkpoint to ticket PATCH**

- [ ] **Step 3: If needed, create workspace costs API endpoint**

The budget check (Task 4) calls `GET /api/workspaces/{id}/costs?period=current_month`. This endpoint needs to query the `project_costs` view and return aggregated workspace costs.

- [ ] **Step 4: Commit Board changes**

```bash
cd just-ship-board
git add <changed files>
git commit -m "feat: accept pipeline_checkpoint in ticket PATCH, add workspace costs endpoint"
```

---

## Task Summary & Dependencies

```
Task 1: DB Migrations                ← no dependencies, do first
  │
  ├──→ Task 2: Checkpoint Module     ← needs DB column from Task 1
  │      │
  │      └──→ Task 3: Pipeline Checkpoint Integration
  │             │
  │             └──→ Task 4: Server Resume Logic ← needs checkpoints in pipeline
  │
  ├──→ Task 5: Budget Module         ← needs cost views from Task 1
  │      │
  │      └──→ Task 6: Server Budget Gate ← needs budget module
  │
  └──→ Task 7: Timeout Config        ← independent

Task 8: Board API Changes            ← parallel, needed for Tasks 3+6 to work
```

**Parallel opportunities:**
- Tasks 2+5+7 can all start after Task 1
- Task 8 (Board) is independent and can run in parallel
- Task 4 (resume logic) depends on Task 3 (checkpoints must be written first)

**Total commits:** 8

**Not in this plan:**
- Stuck Detection / Agent-level timeout supervision (the Orchestrator's SDK query already has a wall-clock timeout via watchdog.ts — individual agent timeouts would require intercepting the Agent SDK's sub-agent dispatch, which is not exposed). The `timeouts` config field is added (Task 6) so it's ready when the SDK supports per-agent timeouts.
- Fresh Context per Task (already handled by current architecture — each sub-agent gets fresh context via Agent tool dispatch)
