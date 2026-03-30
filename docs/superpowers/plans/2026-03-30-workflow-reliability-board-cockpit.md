# Workflow Reliability & Board Cockpit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the autonomous pipeline reliable (tickets run end-to-end without hanging) and turn the Board into the operational cockpit (no terminal needed for oversight).

**Architecture:** Two repos — `just-ship` (Engine: worker watchdog, complexity gate, lifecycle timeouts, question text capture) and `just-ship-board` (Board: pipeline widget, lifecycle indicators, question UI, cleanup dashboard). Existing infrastructure is further along than expected: `complexity`, `pipeline_status`, and `TicketQuestion` all exist in the Board already. The main gaps are: worker has no watchdog, no lifecycle timeout runner, no question text capture, and the Board has no pipeline visibility widget.

**Tech Stack:** TypeScript (Pipeline SDK), Next.js 16 / React 19 / TanStack Query (Board), Supabase (DB), Claude Agent SDK

**Cross-Repo Note:** This plan covers both repos. Tasks are prefixed with `[Engine]` or `[Board]` to indicate which repo. Engine = `/Users/yschleich/Developer/just-ship`, Board = `/Users/yschleich/Developer/just-ship-board`.

---

## File Structure

### Engine (`just-ship`)

| Action | File | Responsibility |
|---|---|---|
| Create | `pipeline/lib/watchdog.ts` | Shared `withWatchdog()` + worktree cleanup helpers |
| Modify | `pipeline/worker.ts` | Add watchdog, complexity filter, lifecycle timeout runner |
| Modify | `pipeline/server.ts` | Import shared watchdog, extend `/health`, add CORS, lifecycle runner |
| Modify | `pipeline/run.ts` | Buffer last assistant text for question capture |
| Modify | `pipeline/lib/event-hooks.ts` | Extend `onPause` to include question text |
| Modify | `pipeline/lib/config.ts` | Add `maxAutonomousComplexity` to `ProjectConfig` |
| Modify | `skills/ticket-writer.md` | Add complexity heuristics + spike due_date |

### Board (`just-ship-board`)

| Action | File | Responsibility |
|---|---|---|
| Create | `src/components/dashboard/pipeline-status-widget.tsx` | Pipeline server status + recent runs + needs attention |
| Create | `src/components/shared/pipeline-indicator.tsx` | Pulsing dot indicators for ticket lifecycle |
| Modify | `src/components/dashboard/dashboard-client.tsx` | Add PipelineStatusWidget to dashboard grid |
| Modify | `src/components/board/ticket-card.tsx` | Add lifecycle indicators |
| Modify | `src/components/tickets/ticket-list-view.tsx` | Add lifecycle indicator column |
| Modify | `src/components/tickets/ticket-detail-sheet.tsx` | Add answer UI for pending questions |
| Modify | `src/lib/types.ts` | Add `pipeline_retry_count`, `pending_question` to Ticket |
| Modify | `src/lib/validations/ticket.ts` | Add `pipeline_retry_count`, `pending_question` to update schema |
| Create | `src/app/api/tickets/[number]/answer/route.ts` | Server-side proxy for VPS answer endpoint (avoids leaking api_key) |

---

### Task 1: Extract Shared Watchdog Module [Engine]

Extract `withWatchdog()` from `server.ts` into a shared module and add worktree cleanup helpers.

**Files:**
- Create: `pipeline/lib/watchdog.ts`
- Modify: `pipeline/server.ts:90-105` (remove inline implementation, import from shared)

- [ ] **Step 1: Create `pipeline/lib/watchdog.ts`**

```typescript
import { execSync } from "node:child_process";

const WATCHDOG_GRACE_MS = 5 * 60_000;
const DEFAULT_PIPELINE_TIMEOUT_MS = 1_800_000;
const WATCHDOG_SENTINEL = Symbol("watchdog");

export function getWatchdogTimeoutMs(): number {
  const pipelineTimeout = Number(process.env.PIPELINE_TIMEOUT_MS) || DEFAULT_PIPELINE_TIMEOUT_MS;
  return pipelineTimeout + WATCHDOG_GRACE_MS;
}

export async function withWatchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeoutMs = getWatchdogTimeoutMs();
  let timer: ReturnType<typeof setTimeout>;
  const watchdog = new Promise<typeof WATCHDOG_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(WATCHDOG_SENTINEL), timeoutMs);
  });

  const result = await Promise.race([promise, watchdog]);
  clearTimeout(timer!);

  if (result === WATCHDOG_SENTINEL) {
    throw new Error(`Watchdog timeout: ${label} did not complete within ${Math.round(timeoutMs / 60_000)} minutes`);
  }

  return result as T;
}

/**
 * Save any uncommitted work in a worktree before cleanup.
 * Returns true if WIP was pushed, false if worktree was clean.
 */
export function saveWorktreeWIP(workDir: string, ticketNumber: number | string): boolean {
  try {
    const status = execSync("git status --porcelain", { cwd: workDir, encoding: "utf-8", timeout: 10_000 }).trim();
    if (!status) return false;

    execSync(`git add -A`, { cwd: workDir, stdio: "pipe", timeout: 10_000 });
    execSync(`git commit -m "WIP: watchdog timeout T-${ticketNumber}"`, { cwd: workDir, stdio: "pipe", timeout: 10_000 });
    try {
      execSync(`git push -u origin HEAD`, { cwd: workDir, stdio: "pipe", timeout: 30_000 });
    } catch {
      // Push may fail if branch doesn't have remote tracking — that's ok
    }
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Update `server.ts` to import from shared module**

Replace the inline `withWatchdog` implementation (lines 77-105 of server.ts) with:
```typescript
import { withWatchdog, getWatchdogTimeoutMs } from "./lib/watchdog.ts";
```

Remove the local `WATCHDOG_GRACE_MS`, `DEFAULT_PIPELINE_TIMEOUT_MS`, `WATCHDOG_SENTINEL`, `getWatchdogTimeoutMs`, and `withWatchdog` definitions.

- [ ] **Step 3: Verify server.ts still compiles**

```bash
npx tsc --noEmit pipeline/server.ts 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/watchdog.ts pipeline/server.ts
git commit -m "refactor: extract withWatchdog to shared module"
```

---

### Task 2: Add Watchdog to Worker [Engine]

Wrap `executePipeline()` in `withWatchdog()` in the worker. On timeout: abort subprocess, save WIP, reset ticket.

**Files:**
- Modify: `pipeline/worker.ts:231-331` (runWorkerSlot function)

- [ ] **Step 1: Add imports to `worker.ts`**

Add at top of file (after existing imports):
```typescript
import { withWatchdog, saveWorktreeWIP } from "./lib/watchdog.ts";
```

- [ ] **Step 2: Wrap `executePipeline` call in watchdog**

In `runWorkerSlot()`, replace the direct `executePipeline` call (line 257) with:
```typescript
    const result = await withWatchdog(
      executePipeline({
        projectDir: PROJECT_DIR,
        workDir: slot.workDir,
        branchName,
        ticket: {
          ticketId: String(ticket.number),
          title: ticket.title,
          description: ticket.body ?? "No description provided",
          labels: Array.isArray(ticket.tags) ? ticket.tags.join(",") : "",
        },
        abortSignal: abortController.signal,
      }),
      `T-${ticket.number}`
    );
```

- [ ] **Step 3: Handle watchdog timeout in catch block**

In `runWorkerSlot()`, create a **per-run** AbortController (do NOT use the module-level one, which would shut down the entire worker):

Before the `executePipeline` call, add:
```typescript
    const runAbortController = new AbortController();
    // Forward module-level abort to per-run controller
    if (abortController.signal.aborted) {
      runAbortController.abort();
    } else {
      abortController.signal.addEventListener("abort", () => runAbortController.abort(), { once: true });
    }
```

Then pass `runAbortController.signal` instead of `abortController.signal` to `executePipeline`.

In the `catch` block of `runWorkerSlot()` (line 302), add watchdog-specific handling before the generic error handling:
```typescript
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const isWatchdog = errorObj.message.startsWith("Watchdog timeout:");

    if (isWatchdog) {
      // Abort only this run's subprocess, not the entire worker
      runAbortController.abort();
      // Wait briefly for subprocess to terminate
      await sleep(5000);
      // Try to save WIP
      if (slotId !== undefined) {
        const worktreeDir = worktreeManager.getSlotDir(slotId);
        if (worktreeDir) {
          saveWorktreeWIP(worktreeDir, ticket.number);
        }
      }
    }

    const classification = classifyError({
```

- [ ] **Step 4: Add `getSlotDir` method to WorktreeManager if not exists**

Check if `worktreeManager.getSlotDir(slotId)` exists. If not, add to `pipeline/lib/worktree-manager.ts`:
```typescript
getSlotDir(slotId: number): string | null {
  const slot = this.slots.get(slotId);
  return slot?.workDir ?? null;
}
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/worker.ts pipeline/lib/watchdog.ts pipeline/lib/worktree-manager.ts
git commit -m "feat: add watchdog timeout to pipeline worker"
```

---

### Task 3: Structured Logging + Sentry Breadcrumbs [Engine]

Add diagnostic logging before `query()` call and Sentry breadcrumbs at each pipeline phase.

**Files:**
- Modify: `pipeline/run.ts:146-310` (executePipeline function)

- [ ] **Step 1: Add structured logging before `query()` in `executePipeline()`**

Insert before the `for await` loop (before line 304 in run.ts):
```typescript
    // --- Diagnostic logging ---
    const agentNames = Object.keys(filteredAgents);
    const skillNames = loadedSkills.skillNames;
    console.error(`[Pipeline] Starting orchestrator query:`);
    console.error(`[Pipeline]   workDir: ${workDir}`);
    console.error(`[Pipeline]   model: opus`);
    console.error(`[Pipeline]   agents: ${agentNames.join(", ") || "none"}`);
    console.error(`[Pipeline]   skills: ${skillNames.join(", ") || "none"}`);
    console.error(`[Pipeline]   prompt length: ${prompt.length} chars`);
    console.error(`[Pipeline]   branch: ${branchName}`);
    console.error(`[Pipeline]   timeout: ${timeoutMs / 60_000} min`);

    Sentry.addBreadcrumb({ category: "pipeline", message: "orchestrator_start", data: { ticketId: ticket.ticketId, branch: branchName } });
```

- [ ] **Step 2: Add Sentry breadcrumb after triage**

Insert after the triage call (after line 243):
```typescript
    Sentry.addBreadcrumb({ category: "pipeline", message: "triage_done", data: { verdict: triageResult?.verdict, qaTier: triageResult?.qaTier } });
```

- [ ] **Step 3: Add import for Sentry if not already imported**

Check if `Sentry` is imported in `run.ts`. If not, add:
```typescript
import { Sentry } from "./lib/sentry.ts";
```

- [ ] **Step 4: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat: add structured logging and Sentry breadcrumbs to pipeline"
```

---

### Task 4: Extend Health Endpoint [Engine]

Add `last_completed`, `last_error`, `uptime_seconds` to `/health` response with in-memory ring buffer.

**Files:**
- Modify: `pipeline/server.ts:538-561` (health endpoint)

- [ ] **Step 1: Add in-memory run history after the `pipelineState` declaration**

Insert after line 72 in server.ts:
```typescript
// --- In-memory run history (ring buffer, last 10 runs) ---
interface RunRecord {
  ticketNumber: number;
  status: "completed" | "failed";
  error?: string;
  at: string;
  durationMs?: number;
}
const runHistory: RunRecord[] = [];
const MAX_RUN_HISTORY = 10;
const serverStartedAt = Date.now();

function recordRun(record: RunRecord) {
  runHistory.push(record);
  if (runHistory.length > MAX_RUN_HISTORY) runHistory.shift();
}
```

- [ ] **Step 2: Call `recordRun` after pipeline completion/failure in `handleLaunch`**

In the background execution block (around line 380-440), add after the `completeTicket` / `failTicket` calls:
```typescript
// After successful completion:
recordRun({ ticketNumber, status: "completed", at: new Date().toISOString(), durationMs: Date.now() - startTime });

// After failure:
recordRun({ ticketNumber, status: "failed", error: errorObj.message, at: new Date().toISOString(), durationMs: Date.now() - startTime });
```

Add `const startTime = Date.now();` at the start of the background execution block.

- [ ] **Step 3: Extend health endpoint response**

Replace the health endpoint handler (around line 538-561) to include:
```typescript
const lastCompleted = runHistory.filter(r => r.status === "completed").at(-1) ?? null;
const lastError = runHistory.filter(r => r.status === "failed").at(-1) ?? null;

sendJson(res, 200, {
  status: drainManager.getState() === "drained" ? "draining" : "ok",
  mode: isMultiProjectMode ? "multi-project" : "single",
  running: pipelineState.running
    ? {
        ticket_number: pipelineState.running.ticketNumber,
        project: pipelineState.running.projectSlug,
        started_at: pipelineState.running.startedAt.toISOString(),
        elapsed_seconds: Math.round((Date.now() - pipelineState.running.startedAt.getTime()) / 1000),
      }
    : null,
  last_completed: lastCompleted,
  last_error: lastError,
  recent_runs: runHistory.slice(-5),
  uptime_seconds: Math.round((Date.now() - serverStartedAt) / 1000),
  drain: drainManager.getStatus(),
});
```

- [ ] **Step 4: Add CORS headers for Board access**

Add CORS handling at the top of the request handler. Scope to the Board domain (from workspace config), not wildcard:
```typescript
// CORS for Board dashboard access — scoped to Board domain
const boardOrigin = serverConfig?.workspace?.board_url ?? process.env.BOARD_URL ?? "https://board.just-ship.io";
const requestOrigin = req.headers.origin;
const allowedOrigin = requestOrigin === boardOrigin ? boardOrigin : "";

if (req.method === "OPTIONS") {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Pipeline-Key",
    "Access-Control-Max-Age": "86400",
  });
  res.end();
  return;
}
if (allowedOrigin) res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/server.ts
git commit -m "feat: extend /health with run history, uptime, and CORS"
```

---

### Task 5: Complexity Gate [Engine]

Filter tickets by complexity in worker and server. Add config option.

**Files:**
- Modify: `pipeline/worker.ts:101-106` (getNextTicket)
- Modify: `pipeline/server.ts:190-440` (handleLaunch)
- Modify: `pipeline/lib/config.ts` (ProjectConfig)

- [ ] **Step 1: Add `maxAutonomousComplexity` to config**

In `pipeline/lib/config.ts`, add to the `ProjectConfig` interface (after `skipAgents`):
```typescript
pipeline: PipelineConfig & { skipAgents?: string[]; maxAutonomousComplexity?: string };
```

In `loadProjectConfig()`, add to the returned pipeline config object (line 190-193 of config.ts):
```typescript
  // Before:
  pipeline: {
    ...pipeline,
    skipAgents: (rawPipeline.skip_agents as string[]) ?? [],
  },
  // After:
  pipeline: {
    ...pipeline,
    skipAgents: (rawPipeline.skip_agents as string[]) ?? [],
    maxAutonomousComplexity: (rawPipeline.max_autonomous_complexity as string) ?? "medium",
  },
```

- [ ] **Step 2: Update worker `getNextTicket` filter**

In `worker.ts`, modify the `getNextTicket` query to add complexity filter:
```typescript
async function getNextTicket(): Promise<Ticket | null> {
  const maxComplexity = config.pipeline.maxAutonomousComplexity ?? "medium";
  const allowedComplexities = getAllowedComplexities(maxComplexity);
  const tickets = await supabaseGet<Ticket[]>(
    `/rest/v1/tickets?status=eq.ready_to_develop&project_id=eq.${SUPABASE_PROJECT_ID}&pipeline_status=is.null&complexity=in.(${allowedComplexities.join(",")})&order=priority.asc,created_at.asc&limit=1&select=number,title,body,priority,tags,complexity`
  );
  return tickets?.[0] ?? null;
}

function getAllowedComplexities(maxLevel: string): string[] {
  const levels = ["low", "medium", "high", "critical"];
  const idx = levels.indexOf(maxLevel);
  return idx >= 0 ? levels.slice(0, idx + 1) : ["low", "medium"];
}
```

Add `complexity` to the `Ticket` interface in worker.ts:
```typescript
interface Ticket {
  number: number;
  title: string;
  body: string | null;
  priority: string;
  tags: string[] | null;
  complexity: string | null;
}
```

- [ ] **Step 3: Add complexity check in server `handleLaunch`**

In `server.ts`, after the ticket status checks (around line 300), add:
```typescript
  // Complexity gate
  const ticketComplexity = (ticket.complexity as string) ?? "medium";
  const maxComplexity = projectConfig.pipeline.maxAutonomousComplexity ?? "medium";
  const allowedLevels = ["low", "medium", "high", "critical"];
  const maxIdx = allowedLevels.indexOf(maxComplexity);
  const ticketIdx = allowedLevels.indexOf(ticketComplexity);
  if (ticketIdx > maxIdx) {
    sendJson(res, 422, {
      status: "rejected",
      ticket_number: ticketNumber,
      message: `Ticket complexity '${ticketComplexity}' exceeds max autonomous level '${maxComplexity}'`,
    });
    return;
  }
```

- [ ] **Step 4: Commit**

```bash
git add pipeline/worker.ts pipeline/server.ts pipeline/lib/config.ts
git commit -m "feat: add complexity gate for autonomous pipeline"
```

---

### Task 6: Question Text Capture [Engine]

Buffer last assistant message in `run.ts` so that when `onPause` fires, the question text is available.

**Files:**
- Modify: `pipeline/run.ts:298-340` (for await loop in executePipeline)
- Modify: `pipeline/run.ts:580-618` (for await loop in resumePipeline)
- Modify: `pipeline/lib/event-hooks.ts:38-40` (onPause callback signature)

- [ ] **Step 1: Extend `onPause` callback to accept question text**

In `event-hooks.ts`, change the callback signature (line 38):
```typescript
// Before:
onPause?: (reason: string) => void;
// After:
onPause?: (reason: string, questionText?: string) => void;
```

- [ ] **Step 2: Add `lastAssistantText` buffer in `executePipeline`**

In `run.ts`, before the `for await` loop (before line 304), add:
```typescript
    let lastAssistantText = "";
```

Inside the `for await` loop, add text buffering:
```typescript
    for await (const message of query({ ... })) {
      if (message.type === "assistant") {
        const msg = message as SDKMessage & { content?: Array<{ type: string; text?: string }> };
        if (Array.isArray(msg.content)) {
          const texts = msg.content.filter(b => b.type === "text" && b.text).map(b => b.text!);
          if (texts.length > 0) lastAssistantText = texts.join("\n");
        }
      }
      // ... existing message handling
    }
```

- [ ] **Step 3: Pass `lastAssistantText` through `onPause`**

In `event-hooks.ts`, update the onBashResult hook where `onPause` is called (line 131):
```typescript
// This needs access to lastAssistantText — pass it via the hooks options
options?.onPause?.("human_in_the_loop", options?.getLastAssistantText?.());
```

Update the options interface:
```typescript
interface EventHookOptions {
  onPause?: (reason: string, questionText?: string) => void;
  getLastAssistantText?: () => string;
}
```

In `run.ts`, pass the getter when creating event hooks:
```typescript
const eventHooks = hasPipeline ? createEventHooks(eventConfig, {
  onPause: (reason, questionText) => {
    pauseReason = reason;
    pauseQuestion = questionText;
  },
  getLastAssistantText: () => lastAssistantText,
}) : null;
```

Add `let pauseQuestion: string | undefined;` alongside `pauseReason`.

- [ ] **Step 4: Store question via Board API on pause**

The Board already has a `ticket_questions` table with full question/answer infrastructure. Use the Board API to create a question record instead of patching `pending_question` directly.

In `executePipeline`, when pause is detected (around line 343):
```typescript
    if (pauseReason === 'human_in_the_loop') {
      // Store question via Board API (creates ticket_question record)
      if (hasPipeline && pauseQuestion) {
        try {
          // 1. Create question record in Board
          await fetch(`${config.pipeline.apiUrl}/api/events`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Pipeline-Key": config.pipeline.apiKey,
            },
            body: JSON.stringify({
              ticket_number: Number(ticket.ticketId),
              agent_type: "orchestrator",
              event_type: "question",
              metadata: { question: pauseQuestion },
            }),
            signal: AbortSignal.timeout(8000),
          });
          // 2. Also store as denormalized field for quick widget display
          await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticket.ticketId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-Pipeline-Key": config.pipeline.apiKey,
            },
            body: JSON.stringify({ pending_question: pauseQuestion, pipeline_status: "paused" }),
            signal: AbortSignal.timeout(8000),
          });
        } catch {
          console.error("[Pipeline] Warning: could not store question in ticket");
        }
      }
      return {
        status: "paused",
        exitCode: 0,
        branch: branchName,
        project: config.name,
        sessionId,
      };
    }
```

**Note:** `pending_question` is a denormalized cache on the ticket for quick display in the widget. The `ticket_questions` table (populated via the events API) is the source of truth. The Board's existing question UI in the detail sheet reads from `ticket_questions`.

- [ ] **Step 5: Apply same changes to `resumePipeline`**

Duplicate the `lastAssistantText` buffer and `pauseQuestion` capture in the `resumePipeline` function.

- [ ] **Step 6: Commit**

```bash
git add pipeline/run.ts pipeline/lib/event-hooks.ts
git commit -m "feat: capture question text on agent pause for Board display"
```

---

### Task 7: Lifecycle Timeout Runner [Engine]

Add periodic check in worker main loop for stuck/paused/failed tickets.

**Prerequisite:** Task 9 (DB migration for `pipeline_retry_count`) must be completed first, or the Supabase PATCH for `pipeline_retry_count` will silently fail. If implementing Engine tasks before Board, run the migration SQL manually first.

**Files:**
- Modify: `pipeline/worker.ts:334-369` (main loop)

- [ ] **Step 1: Add lifecycle check function**

Add after `runWorkerSlot` function in worker.ts:
```typescript
// --- Lifecycle timeout runner (runs every poll cycle) ---
async function runLifecycleChecks(): Promise<void> {
  const now = new Date();

  // 1. Failed tickets > 1h → auto-reset (max 3 retries)
  const failedTickets = await supabaseGet<Array<{ number: number; pipeline_retry_count: number; updated_at: string }>>(
    `/rest/v1/tickets?pipeline_status=eq.failed&project_id=eq.${SUPABASE_PROJECT_ID}&select=number,pipeline_retry_count,updated_at`
  );
  if (failedTickets) {
    for (const t of failedTickets) {
      const age = now.getTime() - new Date(t.updated_at).getTime();
      if (age < 60 * 60_000) continue; // < 1h, skip
      const retries = t.pipeline_retry_count ?? 0;
      if (retries >= 3) {
        // Max retries reached → move to backlog
        await supabasePatch(`/rest/v1/tickets?number=eq.${t.number}`, {
          pipeline_status: null,
          status: "backlog",
          summary: `Blocked after ${retries} failed autonomous attempts. Requires manual intervention.`,
        });
        log(`T-${t.number}: moved to backlog after ${retries} failed retries`);
      } else {
        // Auto-reset for retry
        await supabasePatch(`/rest/v1/tickets?number=eq.${t.number}`, {
          pipeline_status: null,
          status: "ready_to_develop",
          pipeline_retry_count: retries + 1,
        });
        log(`T-${t.number}: auto-reset for retry (attempt ${retries + 1}/3)`);
      }
      await clearBoardAgentEvents(t.number);
    }
  }

  // 2. Paused tickets > 24h → auto-cancel
  const pausedTickets = await supabaseGet<Array<{ number: number; updated_at: string }>>(
    `/rest/v1/tickets?pipeline_status=eq.paused&project_id=eq.${SUPABASE_PROJECT_ID}&select=number,updated_at`
  );
  if (pausedTickets) {
    for (const t of pausedTickets) {
      const age = now.getTime() - new Date(t.updated_at).getTime();
      if (age < 24 * 60 * 60_000) continue; // < 24h, skip
      // Try to save WIP from parked worktree
      const worktreeDir = worktreeManager.findParkedForTicket(t.number);
      if (worktreeDir) {
        saveWorktreeWIP(worktreeDir, t.number);
        await worktreeManager.releaseByDir(worktreeDir);
      }
      await supabasePatch(`/rest/v1/tickets?number=eq.${t.number}`, {
        pipeline_status: null,
        status: "ready_to_develop",
        summary: `Auto-cancelled after 24h without answer. Branch may contain partial work.`,
      });
      await clearBoardAgentEvents(t.number);
      log(`T-${t.number}: auto-cancelled after 24h pause`);
    }
  }
}
```

- [ ] **Step 2: Add helper methods to WorktreeManager**

In `pipeline/lib/worktree-manager.ts`, add:
```typescript
findParkedForTicket(ticketNumber: number): string | null {
  for (const [, slot] of this.slots) {
    if (slot.parked && slot.branchName?.includes(String(ticketNumber))) {
      return slot.workDir;
    }
  }
  return null;
}

async releaseByDir(workDir: string): Promise<void> {
  for (const [slotId, slot] of this.slots) {
    if (slot.workDir === workDir) {
      await this.release(slotId);
      return;
    }
  }
}
```

- [ ] **Step 3: Call lifecycle checks in main loop**

In the main `while (running)` loop (around line 334), add after the ticket processing block:
```typescript
    // Run lifecycle checks each poll cycle
    try {
      await runLifecycleChecks();
    } catch (e) {
      log(`Lifecycle check error: ${e instanceof Error ? e.message : String(e)}`);
    }
```

- [ ] **Step 4: Import `saveWorktreeWIP`**

Ensure `saveWorktreeWIP` is imported (should already be from Task 2).

- [ ] **Step 5: Commit**

```bash
git add pipeline/worker.ts pipeline/lib/worktree-manager.ts
git commit -m "feat: add lifecycle timeout runner — auto-reset failed, auto-cancel paused"
```

---

### Task 8: Ticket-Writer Skill Update [Engine]

Add complexity heuristics and spike due_date to the ticket-writer skill.

**Files:**
- Modify: `skills/ticket-writer.md`

- [ ] **Step 1: Read current ticket-writer skill**

Read `skills/ticket-writer.md` to find the ticket property section.

- [ ] **Step 2: Add complexity heuristics section**

Insert after the priority guidelines section:

```markdown
### Komplexität

Setze die Komplexität basierend auf diesen Heuristiken:

| Komplexität | Signale |
|---|---|
| `low` | Einzelne Datei, Bug-Fix mit klarer Reproduktion, Config-Update, Text-Änderung, Dependency-Bump |
| `medium` | Feature in 1 Repo, 2-5 Dateien, klare Acceptance Criteria, eine Domain (Frontend ODER Backend ODER DB) |
| `high` | Cross-Domain (Frontend + Backend + DB), Architektur-Änderung, Migration, vage Anforderungen, 6+ Dateien |
| `critical` | Cross-Repo, System-Redesign, Breaking Changes, Infrastruktur-Umbau, durchgehend menschliches Urteil nötig |

**Wichtig:** `low` und `medium` Tickets können autonom auf dem VPS bearbeitet werden. `high` und `critical` werden nur lokal via `/develop` bearbeitet. Setze die Komplexität konservativ — im Zweifel eher höher.
```

- [ ] **Step 3: Add spike due_date rule**

Insert in the ticket creation section:

```markdown
### Spike Due Date

Bei Spike-Tickets: Setze automatisch ein `due_date` von +3 Tagen ab Erstellung. Spikes sind zeitbegrenzte Untersuchungen — ohne Deadline werden sie vergessen.
```

- [ ] **Step 4: Commit**

```bash
git add skills/ticket-writer.md
git commit -m "feat: add complexity heuristics and spike due_date to ticket-writer"
```

---

### Task 9: DB Migrations — `pipeline_retry_count` + `pending_question` [Board]

Add retry counter and denormalized question field to tickets.

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/validations/ticket.ts`
- DB migration via Supabase MCP

- [ ] **Step 1: Run DB migration**

Execute SQL on Pipeline-DB (`wsmnutkobalfrceavpxs`):
```sql
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS pipeline_retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS pending_question text;
```

- [ ] **Step 2: Add fields to Ticket type**

In `src/lib/types.ts`, add to Ticket interface (after `session_id`):
```typescript
  pipeline_retry_count: number;
  pending_question: string | null;
```

- [ ] **Step 3: Add to update validation schema**

In `src/lib/validations/ticket.ts`, add to `updateTicketSchema`:
```typescript
  pipeline_retry_count: z.number().int().nonnegative().optional(),
  pending_question: z.string().nullable().optional(),
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/validations/ticket.ts
git commit -m "feat: add pipeline_retry_count and pending_question to ticket schema"
```

---

### Task 10: Pipeline Status Widget [Board]

Create the pipeline status widget for the dashboard.

**Files:**
- Create: `src/components/dashboard/pipeline-status-widget.tsx`
- Modify: `src/components/dashboard/dashboard-client.tsx`

- [ ] **Step 1: Create PipelineStatusWidget component**

Create `src/components/dashboard/pipeline-status-widget.tsx`:
```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, CheckCircle2, XCircle, Clock, MessageSquare, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Ticket } from "@/lib/types";

interface PipelineHealth {
  status: string;
  mode: string;
  running: { ticket_number: number; project: string; started_at: string; elapsed_seconds: number } | null;
  last_completed: { ticketNumber: number; status: string; at: string } | null;
  last_error: { ticketNumber: number; error: string; at: string } | null;
  recent_runs: Array<{ ticketNumber: number; status: string; error?: string; at: string; durationMs?: number }>;
  uptime_seconds: number;
  drain: { state: string; running_count: number };
}

interface AttentionItem {
  ticket: Ticket;
  reason: "stuck" | "failed" | "review_overdue" | "paused" | "spike_overdue";
  detail: string;
}

export function PipelineStatusWidget() {
  const { workspace } = useWorkspace();
  const [health, setHealth] = useState<PipelineHealth | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const supabase = createClient();

  // Fetch pipeline server health
  const fetchHealth = useCallback(async () => {
    try {
      // Pipeline URL from workspace config or convention
      const pipelineUrl = workspace.vps_url;
      if (!pipelineUrl) { setHealthError(true); return; }
      const res = await fetch(`${pipelineUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) { setHealthError(true); return; }
      setHealth(await res.json());
      setHealthError(false);
    } catch {
      setHealthError(true);
    }
  }, [workspace.vps_url]);

  // Fetch tickets needing attention
  const fetchAttention = useCallback(async () => {
    const now = new Date();
    const items: AttentionItem[] = [];

    // Stuck: in_progress + running > 35 min — use task_events timestamps (not updated_at which can be bumped by unrelated PATCHes)
    const { data: runningTickets } = await supabase
      .from("tickets")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("status", "in_progress")
      .eq("pipeline_status", "running");

    for (const t of runningTickets ?? []) {
      // Get the most recent task_event for this ticket
      const { data: lastEvent } = await supabase
        .from("task_events")
        .select("created_at")
        .eq("ticket_number", t.number)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      const lastActivityAt = lastEvent?.created_at ?? t.updated_at;
      const age = now.getTime() - new Date(lastActivityAt).getTime();
      if (age > 35 * 60_000) {
        items.push({ ticket: t, reason: "stuck", detail: `No activity for ${Math.round(age / 60_000)}m` });
      }
    }

    // Failed
    const { data: failedTickets } = await supabase
      .from("tickets")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("pipeline_status", "failed");

    for (const t of failedTickets ?? []) {
      items.push({ ticket: t, reason: "failed", detail: t.summary ?? "Pipeline failed" });
    }

    // Paused (waiting for answer)
    const { data: pausedTickets } = await supabase
      .from("tickets")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("pipeline_status", "paused");

    for (const t of pausedTickets ?? []) {
      items.push({ ticket: t, reason: "paused", detail: "Waiting for answer" });
    }

    // Review overdue (> 72h)
    const { data: reviewTickets } = await supabase
      .from("tickets")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("status", "in_review");

    for (const t of reviewTickets ?? []) {
      const age = now.getTime() - new Date(t.updated_at).getTime();
      if (age > 72 * 60 * 60_000) {
        items.push({ ticket: t, reason: "review_overdue", detail: `In review for ${Math.round(age / (24 * 60 * 60_000))}d` });
      }
    }

    // Overdue spikes
    const { data: spikeTickets } = await supabase
      .from("tickets")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("type", "spike")
      .not("due_date", "is", null)
      .in("status", ["in_progress", "ready_to_develop"]);

    for (const t of spikeTickets ?? []) {
      if (t.due_date && new Date(t.due_date) < now) {
        const overdueDays = Math.round((now.getTime() - new Date(t.due_date).getTime()) / (24 * 60 * 60_000));
        items.push({ ticket: t, reason: "spike_overdue", detail: `Spike overdue by ${overdueDays}d` });
      }
    }

    setAttentionItems(items);
  }, [supabase, workspace.id]);

  useEffect(() => {
    fetchHealth();
    fetchAttention();
    const interval = setInterval(() => { fetchHealth(); fetchAttention(); }, 30_000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchAttention]);

  const handleRetry = async (ticketNumber: number) => {
    await supabase
      .from("tickets")
      .update({ pipeline_status: null, status: "ready_to_develop", pipeline_retry_count: 0 })
      .eq("number", ticketNumber)
      .eq("workspace_id", workspace.id);
    fetchAttention();
  };

  const statusColor = healthError ? "text-red-500" : health?.status === "ok" ? "text-emerald-500" : "text-amber-500";
  const statusLabel = healthError ? "Offline" : health?.status === "ok" ? "Online" : "Draining";

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Pipeline
        </h3>
        <div className="flex items-center gap-1.5 text-xs">
          <span className={cn("h-2 w-2 rounded-full", healthError ? "bg-red-500" : health?.status === "ok" ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
          <span className={statusColor}>{statusLabel}</span>
          {health && <span className="text-muted-foreground">| {formatUptime(health.uptime_seconds)}</span>}
        </div>
      </div>

      {/* Current Run */}
      {health?.running && (
        <div className="text-xs bg-muted/50 rounded p-2 space-y-0.5">
          <div className="font-medium">T-{health.running.ticket_number}</div>
          <div className="text-muted-foreground">Running {formatDuration(health.running.elapsed_seconds)}</div>
        </div>
      )}

      {/* Needs Attention */}
      {attentionItems.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {attentionItems.length} need{attentionItems.length === 1 ? "s" : ""} attention
          </div>
          {attentionItems.map((item) => (
            <div key={item.ticket.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
              <div className="flex items-center gap-2">
                {item.reason === "stuck" && <Clock className="h-3 w-3 text-amber-500" />}
                {item.reason === "failed" && <XCircle className="h-3 w-3 text-red-500" />}
                {item.reason === "paused" && <MessageSquare className="h-3 w-3 text-amber-500" />}
                {item.reason === "review_overdue" && <AlertTriangle className="h-3 w-3 text-orange-500" />}
                {item.reason === "spike_overdue" && <Clock className="h-3 w-3 text-orange-500" />}
                <span>T-{item.ticket.number}</span>
                <span className="text-muted-foreground">{item.detail}</span>
              </div>
              {(item.reason === "stuck" || item.reason === "failed") && (
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs" onClick={() => handleRetry(item.ticket.number)}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent Runs */}
      {health && health.recent_runs.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Recent</div>
          {health.recent_runs.slice(-3).reverse().map((run, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                {run.status === "completed" ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                <span>T-{run.ticketNumber}</span>
              </div>
              {run.durationMs && <span className="text-muted-foreground">{formatDuration(run.durationMs / 1000)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}
```

- [ ] **Step 2: Add PipelineStatusWidget to DashboardClient**

In `src/components/dashboard/dashboard-client.tsx`, add import:
```typescript
import { PipelineStatusWidget } from "./pipeline-status-widget";
```

Add the widget in the grid layout (after KpiCards, before or alongside RecentTasks):
```tsx
<PipelineStatusWidget />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pipeline-status-widget.tsx src/components/dashboard/dashboard-client.tsx
git commit -m "feat: add pipeline status widget to dashboard"
```

---

### Task 11: Lifecycle Indicators on Ticket Cards [Board]

Add pulsing dots and status indicators to ticket cards and list view.

**Files:**
- Create: `src/components/shared/pipeline-indicator.tsx`
- Modify: `src/components/board/ticket-card.tsx`
- Modify: `src/components/tickets/ticket-list-view.tsx`

- [ ] **Step 1: Create PipelineIndicator component**

Create `src/components/shared/pipeline-indicator.tsx`:
```tsx
import { cn } from "@/lib/utils";
import { Lock, MessageSquare } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface PipelineIndicatorProps {
  status: string | null;       // ticket.status
  pipelineStatus: string | null; // ticket.pipeline_status
  complexity?: string | null;
  updatedAt?: string | null;
}

export function PipelineIndicator({ status, pipelineStatus, complexity, updatedAt }: PipelineIndicatorProps) {
  // Agent working
  if (status === "in_progress" && pipelineStatus === "running") {
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Agent working</TooltipContent>
      </Tooltip>
    );
  }

  // Waiting for answer
  if (status === "in_progress" && pipelineStatus === "paused") {
    return (
      <Tooltip>
        <TooltipTrigger>
          <MessageSquare className="h-3.5 w-3.5 text-amber-500" />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Waiting for answer</TooltipContent>
      </Tooltip>
    );
  }

  // Failed
  if (pipelineStatus === "failed") {
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Pipeline failed</TooltipContent>
      </Tooltip>
    );
  }

  // Local only (high/critical complexity)
  if (status === "ready_to_develop" && (complexity === "high" || complexity === "critical")) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <Lock className="h-3 w-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Local only — too complex for autonomous mode</TooltipContent>
      </Tooltip>
    );
  }

  // Review overdue
  if (status === "in_review" && updatedAt) {
    const age = Date.now() - new Date(updatedAt).getTime();
    if (age > 48 * 60 * 60_000) {
      return (
        <Tooltip>
          <TooltipTrigger>
            <span className="inline-flex rounded-full h-2.5 w-2.5 bg-orange-400" />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Review overdue ({Math.round(age / (24 * 60 * 60_000))}d)</TooltipContent>
        </Tooltip>
      );
    }
  }

  return null;
}
```

- [ ] **Step 2: Add PipelineIndicator to ticket-card.tsx**

Import and add to the ticket card footer area (near the pipeline_status pill):
```typescript
import { PipelineIndicator } from "@/components/shared/pipeline-indicator";
```

Add in the card header or footer:
```tsx
<PipelineIndicator
  status={ticket.status}
  pipelineStatus={ticket.pipeline_status}
  complexity={ticket.complexity}
  updatedAt={ticket.updated_at}
/>
```

- [ ] **Step 3: Add PipelineIndicator to ticket-list-view.tsx**

Import and add as a cell in the table, next to the status column.

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/pipeline-indicator.tsx src/components/board/ticket-card.tsx src/components/tickets/ticket-list-view.tsx
git commit -m "feat: add pipeline lifecycle indicators to ticket cards and list"
```

---

### Task 12: Question Answer UI Enhancement + Server-Side Proxy [Board]

The Board already has a complete question-answer UI in the ticket detail sheet (reading from `ticket_questions`, rendering with `QuestionAnswerInput`, submitting answers). The existing answer endpoint at `/api/tickets/[number]/questions/[id]/route.ts` already forwards to the VPS.

**What's needed:**
1. Add quick-response buttons ("Weiter", "Konservativ") to the existing UI
2. Create a server-side proxy for the VPS answer endpoint (to avoid leaking `vps_api_key` to the client)
3. Clear `pending_question` when answer is submitted

**Files:**
- Modify: `src/components/tickets/ticket-detail-sheet.tsx`
- Create: `src/app/api/tickets/[number]/answer/route.ts`

- [ ] **Step 1: Read existing question rendering in ticket-detail-sheet.tsx**

Read the section around lines 1186-1238 to understand the existing `QuestionAnswerInput` component and answer flow.

- [ ] **Step 2: Add quick-response buttons to existing question UI**

Find the existing question rendering and add quick-response buttons before the free-text input:
```tsx
{/* Quick responses — added to existing question UI */}
<div className="flex gap-2 flex-wrap">
  <Button variant="outline" size="sm" onClick={() => submitAnswer("Ja, mach weiter")}>
    Weiter
  </Button>
  <Button variant="outline" size="sm" onClick={() => submitAnswer("Konservative Lösung wählen")}>
    Konservativ
  </Button>
  <Button variant="outline" size="sm" onClick={() => submitAnswer("Abbrechen")}>
    Abbrechen
  </Button>
</div>
```

Where `submitAnswer` uses the existing answer submission logic but also clears `pending_question`:
```typescript
const submitAnswer = async (answer: string) => {
  // Use existing answer flow (writes to ticket_questions + forwards to VPS)
  // Then clear the denormalized pending_question field
  await supabase
    .from("tickets")
    .update({ pending_question: null })
    .eq("id", ticket.id);
};
```

- [ ] **Step 3: Create server-side proxy for VPS answer**

Create `src/app/api/tickets/[number]/answer/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { requirePipelineAuth } from "@/lib/api/pipeline-auth";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const auth = await requirePipelineAuth(req);
  if (!auth.ok) return auth.error;

  const body = await req.json();
  const { answer, project_id } = body;

  // Get workspace VPS URL
  const supabase = createServiceClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("vps_url, vps_api_key")
    .eq("id", auth.workspace_id)
    .single();

  if (!workspace?.vps_url) {
    return NextResponse.json({ error: "No VPS configured" }, { status: 400 });
  }

  // Forward to VPS
  const res = await fetch(`${workspace.vps_url}/api/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pipeline-Key": workspace.vps_api_key,
    },
    body: JSON.stringify({ ticket_number: Number(number), answer, project_id }),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tickets/ticket-detail-sheet.tsx src/app/api/tickets/\[number\]/answer/route.ts
git commit -m "feat: add quick-response buttons and server-side VPS answer proxy"
```

---

### Task 13: Build Verification [Both Repos]

- [ ] **Step 1: Build Engine**

```bash
cd /Users/yschleich/Developer/just-ship && npx tsc --noEmit pipeline/worker.ts pipeline/server.ts pipeline/run.ts 2>&1 | head -30
```

- [ ] **Step 2: Build Board**

```bash
cd /Users/yschleich/Developer/just-ship-board && npm run build 2>&1 | tail -30
```

- [ ] **Step 3: Fix any build errors**

- [ ] **Step 4: Final commit if fixes needed**

```bash
git commit -m "fix: resolve build errors"
```

---

### Task 14: Documentation Updates [Engine]

- [ ] **Step 1: Update CHANGELOG.md**

- [ ] **Step 2: Update relevant docs (README.md, ARCHITECTURE.md)**

- [ ] **Step 3: Commit docs**

```bash
git add CHANGELOG.md README.md docs/ARCHITECTURE.md
git commit -m "docs: update changelog and architecture for workflow reliability"
```
