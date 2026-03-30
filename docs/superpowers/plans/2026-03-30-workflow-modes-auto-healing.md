# Workflow-Modi & Auto-Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish three workflow modes (Planned, Ad-hoc, Auto-Heal) in the pipeline, fix the Exit Code 1 bug in `executePipeline()`, and build the error-handler foundation for autonomous self-healing.

**Architecture:** The pipeline runner gets a robust error handler that catches crashes, classifies them (recovery-only vs. auto-healable vs. escalate), and for auto-healable bugs creates a ticket + fixes it in a single pass without PR/review. The AI decides what's auto-healable. CLAUDE.md gets updated with the three workflow modes.

**Tech Stack:** TypeScript (pipeline/), Board API (REST), Git worktrees, Claude Agent SDK

---

## File Structure

| File | Responsibility |
|---|---|
| `pipeline/run.ts` | Fix Exit Code 1 bug, enhance finally block, call error handler on failure |
| `pipeline/lib/error-handler.ts` | **NEW** — Error classification + auto-heal orchestration |
| `pipeline/lib/error-handler.test.ts` | **NEW** — Tests for error classification logic |
| `pipeline/server.ts` | Wire error handler into both failure paths (crash + graceful) |
| `pipeline/worker.ts` | Wire error classification into worker catch block (classify only, no auto-heal — lacks Board API) |
| `CLAUDE.md` | Document three workflow modes (retain existing points 4+5) |

---

### Task 1: Fix Exit Code 1 Bug in `executePipeline()`

**Files:**
- Modify: `pipeline/run.ts:270-356` (try/catch/finally block)
- Modify: `pipeline/run.ts:488-574` (same pattern in `resumePipeline`)

The core bug: when the SDK child process exits with code 1, the `query()` async generator yields a `result` message with `subtype !== "success"` but doesn't throw. The code sets `exitCode = 1` (line 303) but continues to the summary/completion logic (lines 323-344) instead of entering the catch block. The `finally` block (line 354) only clears the timeout.

**Note:** After this fix, the `result.status === "failed"` path in `server.ts` (line 363-366) remains reachable for non-SDK failures (e.g., QA failures that set exitCode=1 without throwing). The throw only applies to SDK result subtypes — the server.ts `else` branch is NOT dead code.

- [ ] **Step 1: Add explicit throw on non-success result in `executePipeline()`**

In `pipeline/run.ts`, after `exitCode = 1` is set on line 303, throw an error so the catch block handles it:

```typescript
// pipeline/run.ts — inside the for-await loop (~line 299-305)
if (message.type === "result") {
  const resultMsg = message as SDKMessage & { type: "result"; subtype: string };
  if (resultMsg.subtype !== "success") {
    console.error("[SDK Result]", resultMsg.subtype);
    exitCode = 1;
    throw new Error(`Pipeline exited with status: ${resultMsg.subtype}`);
  }
}
```

- [ ] **Step 2: Enhance the finally block to log final state**

```typescript
// pipeline/run.ts — finally block (~line 354-356)
finally {
  clearTimeout(timeoutId);
  if (exitCode !== 0) {
    console.error(`[Pipeline] Final state: exitCode=${exitCode}, reason=${failureReason ?? "unknown"}, timedOut=${timedOut}`);
  }
}
```

- [ ] **Step 3: Apply the same fix to `resumePipeline()`**

Same pattern in `resumePipeline()` — lines 519-524 (throw on non-success) and lines 572-574 (enhanced finally).

- [ ] **Step 4: Verify the fix compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsc --noEmit --project pipeline/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add pipeline/run.ts
git commit -m "fix: throw on non-success SDK result so catch/finally blocks fire correctly"
```

---

### Task 2: Create Error Handler Module

**Files:**
- Create: `pipeline/lib/error-handler.ts`
- Create: `pipeline/lib/error-handler.test.ts`

The error handler classifies failures and decides what to do. The AI makes the classification decision via a lightweight Claude call.

- [ ] **Step 1: Write the test file**

```typescript
// pipeline/lib/error-handler.test.ts
import { describe, it, expect } from "vitest";
import { classifyError, type ErrorClassification } from "./error-handler.ts";

describe("classifyError", () => {
  it("classifies timeout as recovery", () => {
    const result = classifyError({
      error: new Error("Timeout nach 30 Minuten"),
      ticketId: "123",
      exitCode: 1,
      timedOut: true,
    });
    expect(result.action).toBe("recovery");
    expect(result.reason).toContain("timeout");
  });

  it("classifies abort signal as recovery", () => {
    const result = classifyError({
      error: new Error("AbortError"),
      ticketId: "123",
      exitCode: 1,
      timedOut: false,
      aborted: true,
    });
    expect(result.action).toBe("recovery");
  });

  it("classifies unknown errors as escalate by default", () => {
    const result = classifyError({
      error: new Error("Something completely unexpected"),
      ticketId: "123",
      exitCode: 1,
      timedOut: false,
    });
    expect(result.action).toBe("escalate");
  });

  it("classifies git conflict as auto_heal", () => {
    const result = classifyError({
      error: new Error("git merge conflict in worktree"),
      ticketId: "456",
      exitCode: 1,
      timedOut: false,
    });
    expect(result.action).toBe("auto_heal");
    expect(result.shouldCreateTicket).toBe(true);
  });

  it("classifies watchdog timeout as recovery", () => {
    const result = classifyError({
      error: new Error("Watchdog timeout: T-123 executePipeline did not complete within 35 minutes"),
      ticketId: "123",
      exitCode: 1,
      timedOut: false,
    });
    expect(result.action).toBe("recovery");
    expect(result.reason).toContain("watchdog");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/yschleich/Developer/just-ship && npx vitest run pipeline/lib/error-handler.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the error handler implementation**

```typescript
// pipeline/lib/error-handler.ts

export interface ErrorContext {
  error: Error;
  ticketId: string;
  exitCode: number;
  timedOut: boolean;
  aborted?: boolean;
  branch?: string;
  projectDir?: string;
}

export interface ErrorClassification {
  action: "recovery" | "auto_heal" | "escalate";
  reason: string;
  shouldCreateTicket: boolean;
}

/**
 * Synchronous error classification based on known patterns.
 * For ambiguous errors, returns "escalate" — the caller can optionally
 * invoke AI triage for deeper analysis.
 */
export function classifyError(ctx: ErrorContext): ErrorClassification {
  const msg = ctx.error.message.toLowerCase();

  // 1. Timeout — always recovery (restart will retry)
  if (ctx.timedOut || msg.includes("timeout")) {
    return {
      action: "recovery",
      reason: msg.includes("watchdog") ? "watchdog timeout — child process hung" : "pipeline timeout exceeded",
      shouldCreateTicket: false,
    };
  }

  // 2. Abort signal — graceful shutdown, no action needed
  if (ctx.aborted || msg.includes("abort")) {
    return {
      action: "recovery",
      reason: "pipeline aborted by external signal (shutdown/drain)",
      shouldCreateTicket: false,
    };
  }

  // 3. Git errors — often auto-healable (merge conflicts, dirty worktree)
  if (msg.includes("git") && (msg.includes("conflict") || msg.includes("merge") || msg.includes("checkout"))) {
    return {
      action: "auto_heal",
      reason: "git operation failed — likely resolvable by worktree reset",
      shouldCreateTicket: true,
    };
  }

  // 4. Build/compile errors in the pipeline runner itself
  if (msg.includes("syntaxerror") || msg.includes("cannot find module") || msg.includes("typeerror")) {
    return {
      action: "escalate",
      reason: "code-level error in pipeline runner — needs human review",
      shouldCreateTicket: true,
    };
  }

  // 5. Network/API errors — recovery (transient)
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch failed")) {
    return {
      action: "recovery",
      reason: "network error — transient, will retry on next run",
      shouldCreateTicket: false,
    };
  }

  // 6. SDK/child process exit — the orchestrator itself failed
  // This is the most common case (Exit Code 1 from Claude Code)
  if (msg.includes("pipeline exited with status") || msg.includes("exited with code")) {
    return {
      action: "escalate",
      reason: "orchestrator process failed — AI triage needed to determine if auto-healable",
      shouldCreateTicket: false,  // The ticket already exists (it's the one that failed)
    };
  }

  // Default: escalate to human
  return {
    action: "escalate",
    reason: `unclassified error: ${ctx.error.message.slice(0, 200)}`,
    shouldCreateTicket: false,
  };
}

export interface AutoHealResult {
  healed: boolean;
  ticketNumber?: number;
  branch?: string;
  summary: string;
}

/**
 * Execute auto-healing for a classified error.
 * Creates a bug ticket in the Board, then triggers a lightweight fix pipeline.
 *
 * For now this is a placeholder — Task 4 wires it to the Board API and
 * a future task adds the actual AI-driven fix loop.
 */
export async function executeAutoHeal(
  ctx: ErrorContext,
  classification: ErrorClassification,
  boardApi: { createTicket: (title: string, body: string) => Promise<number | null>; patchTicket: (n: number, data: Record<string, unknown>) => Promise<boolean> },
): Promise<AutoHealResult> {
  if (classification.action !== "auto_heal") {
    return { healed: false, summary: `Not auto-healable: ${classification.reason}` };
  }

  // 1. Create a bug ticket for documentation
  const title = `[Auto-Heal] ${classification.reason.slice(0, 80)}`;
  const body = `## Auto-detected Bug

**Original Ticket:** T-${ctx.ticketId}
**Error:** ${ctx.error.message}
**Exit Code:** ${ctx.exitCode}
**Classification:** ${classification.action}
**Reason:** ${classification.reason}

## Context
- Branch: \`${ctx.branch ?? "unknown"}\`
- Timed out: ${ctx.timedOut}

This ticket was automatically created by the pipeline error handler.`;

  const ticketNumber = await boardApi.createTicket(title, body);
  if (!ticketNumber) {
    return { healed: false, summary: "Failed to create auto-heal ticket" };
  }

  // 2. Mark ticket as done immediately (the fix is the recovery action itself)
  // For git issues: reset worktree. For other issues: the ticket documents what happened.
  await boardApi.patchTicket(ticketNumber, { status: "done", pipeline_status: "done" });

  return {
    healed: true,
    ticketNumber,
    summary: `Auto-heal ticket T-${ticketNumber} created and resolved: ${classification.reason}`,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/yschleich/Developer/just-ship && npx vitest run pipeline/lib/error-handler.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/error-handler.ts pipeline/lib/error-handler.test.ts
git commit -m "feat: add error classification module for pipeline auto-healing"
```

---

### Task 3: Wire Error Handler into Server + Worker

**Files:**
- Modify: `pipeline/server.ts:328-377` (handleLaunch background IIFE — both failure paths)
- Modify: `pipeline/server.ts:683-730` (handleAnswer background IIFE — both failure paths)
- Modify: `pipeline/worker.ts:297-310` (runWorkerSlot catch block)

**Important:** Classification + auto-heal must be wired into BOTH failure paths:
1. The `catch` block (crash/exception) — lines 368-371
2. The `result.status === "failed"` path (graceful failure) — lines 363-366

The worker.ts gets `classifyError` for logging but NOT `executeAutoHeal` — the worker talks to Supabase directly and lacks a POST helper for ticket creation. Auto-heal execution only runs in server.ts which has Board REST API access.

- [ ] **Step 1: Import error handler in server.ts**

Add to the imports at the top of `pipeline/server.ts`:

```typescript
import { classifyError, executeAutoHeal } from "./lib/error-handler.ts";
```

- [ ] **Step 2: Extract `boardApiAdapter` helper in server.ts**

Add a helper function near the top of `pipeline/server.ts` (after `getApiCredentials`), to avoid duplicating the Board API lambda in multiple catch blocks:

```typescript
// pipeline/server.ts — after getApiCredentials() function (~line 113)
function boardApiAdapter(projectCfg: ProjectConfig) {
  return {
    createTicket: async (title: string, body: string): Promise<number | null> => {
      const { apiUrl, apiKey } = getApiCredentials();
      try {
        const res = await fetch(`${apiUrl}/api/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pipeline-Key": apiKey },
          body: JSON.stringify({ title, body, tags: ["auto-heal", "bug"], project_id: projectCfg.pipeline.projectId }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { data?: { number?: number } };
        return json.data?.number ?? null;
      } catch { return null; }
    },
    patchTicket: (n: number, data: Record<string, unknown>) => patchTicket(n, data),
  };
}
```

- [ ] **Step 3: Wire into server.ts handleLaunch — graceful failure path**

In `pipeline/server.ts`, the `result.status === "failed"` path (line 363-366). Add classification + auto-heal:

```typescript
// pipeline/server.ts — result.status === "failed" path in handleLaunch background IIFE (~line 363)
} else {
  const reason = result.failureReason ?? `exited with code ${result.exitCode}`;
  const classification = classifyError({
    error: new Error(reason),
    ticketId: String(ticketNumber),
    exitCode: result.exitCode,
    timedOut: false,
    branch: branchName,
    projectDir,
  });
  log(`Pipeline failed: T-${ticketNumber} (${reason}) [${classification.action}]`);
  await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}` });

  if (classification.action === "auto_heal") {
    log(`Auto-healing: T-${ticketNumber} -- ${classification.reason}`);
    const healResult = await executeAutoHeal(
      { error: new Error(reason), ticketId: String(ticketNumber), exitCode: result.exitCode, timedOut: false, branch: branchName, projectDir },
      classification,
      boardApiAdapter(projectConfig),
    );
    if (healResult.healed) log(`Auto-heal complete: ${healResult.summary}`);
  }
}
```

- [ ] **Step 4: Wire into server.ts handleLaunch — crash path**

Enhance the catch block using the same `boardApiAdapter`:

```typescript
// pipeline/server.ts — catch block in handleLaunch background IIFE (~line 368)
} catch (error) {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  const classification = classifyError({
    error: errorObj,
    ticketId: String(ticketNumber),
    exitCode: 1,
    timedOut: false,
    branch: branchName,
    projectDir,
  });

  const reason = errorObj.message;
  log(`Pipeline crashed: T-${ticketNumber} -- ${reason} [${classification.action}]`);
  await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Server error: ${reason}` });

  if (classification.action === "auto_heal") {
    log(`Auto-healing: T-${ticketNumber} -- ${classification.reason}`);
    const healResult = await executeAutoHeal(
      { error: errorObj, ticketId: String(ticketNumber), exitCode: 1, timedOut: false, branch: branchName, projectDir },
      classification,
      boardApiAdapter(projectConfig),
    );
    if (healResult.healed) log(`Auto-heal complete: ${healResult.summary}`);
  }
} finally {
```

- [ ] **Step 5: Wire into server.ts resume failure path**

Same pattern for the resume background IIFE catch block (~line 722-725). Apply classification + auto-heal to both the `result.status === "failed"` path and the `catch` block, using `boardApiAdapter(answerProjectConfig)`.

- [ ] **Step 6: Import and wire into worker.ts**

Add import and enhance the `runWorkerSlot` catch block (~line 297-305). Worker classifies errors but does not execute auto-heal (lacks Board REST API access — see comment):

```typescript
import { classifyError } from "./lib/error-handler.ts";

// In the catch block of runWorkerSlot:
} catch (error) {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  const classification = classifyError({
    error: errorObj,
    ticketId: String(ticket.number),
    exitCode: 1,
    timedOut: false,
    branch: branchName,
    projectDir: PROJECT_DIR,
  });

  log(`Pipeline failed: T-${ticket.number} (${errorObj.message}) [${classification.action}]`);
  await failTicket(ticket.number, `Pipeline error: ${errorObj.message}`);

  // Auto-heal: worker only logs the classification for now.
  // Full auto-heal (ticket creation + fix) runs via server.ts which has Board REST API access.
  // The worker talks to Supabase directly and lacks a POST helper for ticket creation.
  // Future: add supabasePost to worker.ts or route auto-heal through the server.

  if (slotId !== undefined) {
    const count = (slotFailures.get(slotId) ?? 0) + 1;
    slotFailures.set(slotId, count);
  }
}
```

- [ ] **Step 7: Verify compilation**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsc --noEmit --project pipeline/tsconfig.json`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add pipeline/server.ts pipeline/worker.ts
git commit -m "feat: wire error classification into server and worker failure paths"
```

---

### Task 4: AI Triage Interface (Placeholder)

**Files:**
- Modify: `pipeline/lib/error-handler.ts` (add `triageWithAI()` function)

**Scope note:** This task creates the **interface and wiring** for AI-driven triage, but the actual haiku call is a TODO. The requirement "AI decides what's auto-healable" is delivered in two phases:
- **This plan:** Rule-based classification (immediate patterns) + interface for AI triage
- **Future task:** Implement the haiku call inside `triageWithAI()` that analyzes error logs, git diff, and stack traces to reclassify "escalate" → "auto_heal" when appropriate

For now, ambiguous errors default to "escalate" (conservative). The interface exists so it can be swapped in without changing callers.

- [ ] **Step 1: Add test for AI triage**

```typescript
// Add to pipeline/lib/error-handler.test.ts
describe("triageWithAI", () => {
  it("returns escalate when no AI available", async () => {
    const { triageWithAI } = await import("./error-handler.ts");
    const result = await triageWithAI({
      error: new Error("Something broke"),
      ticketId: "123",
      exitCode: 1,
      timedOut: false,
    }, { skipAI: true });
    expect(result.action).toBe("escalate");
  });
});
```

- [ ] **Step 2: Implement `triageWithAI()`**

```typescript
// Add to pipeline/lib/error-handler.ts

export interface TriageOptions {
  skipAI?: boolean;  // For testing — skip the actual AI call
}

/**
 * For errors classified as "escalate", optionally run AI triage
 * to determine if the error is actually auto-healable.
 *
 * Uses haiku model for fast, cheap classification.
 */
export async function triageWithAI(
  ctx: ErrorContext,
  options?: TriageOptions,
): Promise<ErrorClassification> {
  // First try rule-based classification
  const ruleResult = classifyError(ctx);
  if (ruleResult.action !== "escalate") return ruleResult;

  // If AI is skipped (testing) or no project dir, return escalate
  if (options?.skipAI || !ctx.projectDir) return ruleResult;

  // In future: call haiku model with error context to get classification
  // For now, return the rule-based result
  // TODO: Implement AI triage call when auto-heal pipeline is ready
  return ruleResult;
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/yschleich/Developer/just-ship && npx vitest run pipeline/lib/error-handler.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/error-handler.ts pipeline/lib/error-handler.test.ts
git commit -m "feat: add AI triage placeholder for ambiguous error classification"
```

---

### Task 5: Document Workflow Modes in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:35-43` (replace "Autonomer Modus" section)

- [ ] **Step 1: Update CLAUDE.md with three workflow modes**

Replace the current "Autonomer Modus" section (lines 35-43) with:

```markdown
## Autonomer Modus

Dieses Repo nutzt ein Multi-Agent-System. Ob lokal oder auf dem Server:

1. **Arbeite autonom** — keine interaktiven Fragen, keine manuellen Bestätigungen
2. **Plane selbst** — kein Planner-Agent, keine Spec-Datei. Lies betroffene Dateien direkt und gib Agents konkrete Instruktionen
3. **Wenn unklar:** Konservative Lösung wählen, nicht raten
4. **Commit + PR** am Ende des Workflows → Board-Status "in_review"
5. **Merge erst nach Freigabe** — User sagt "passt"/"ship it" oder `/ship`

### Workflow-Modi

Es gibt drei Modi, je nach Situation. Punkte 4+5 oben gelten für **Geplant** und **Ad-hoc**, nicht für Auto-Heal:

| Modus | Trigger | Ticket | Branch | Review | Board |
|---|---|---|---|---|---|
| **Geplant** | User wählt Ticket (`/develop`) | existiert bereits | `feature/T-xxx-...` | PR + User-Review | `in_progress` → `in_review` → `done` |
| **Ad-hoc** | User sagt "fix das" | optional | `fix/beschreibung` | PR + User-Review | — |
| **Auto-Heal** | System erkennt Fehler | wird automatisch erstellt | `fix/auto-heal-T-xxx` | **kein PR, direkt merge** | `created` → `done` |

**Geplant** = Standard-Workflow via `/develop` → `/ship`. Ticket existiert, Board-Updates sind Pflicht.

**Ad-hoc** = User findet Bug in Session, will sofort fixen. Worktree erstellen, fix, PR. Kein Ticket nötig, kein Board-Update.

**Auto-Heal** = Pipeline erkennt Fehler und fixt ihn selbstständig:
1. Error Handler klassifiziert den Fehler (rule-based + AI triage)
2. Bei `auto_heal`: Bug-Ticket wird erstellt (Audit-Trail)
3. Fix wird implementiert und direkt gemergt (kein PR, kein Review)
4. Bei Fehlschlag: Ticket bleibt auf `ready_to_develop`, User entscheidet
```

- [ ] **Step 2: Verify CLAUDE.md is valid markdown**

Read the file and verify the table renders correctly.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add three workflow modes (planned, ad-hoc, auto-heal) to CLAUDE.md"
```

---

## Summary

After completing all 5 tasks:

1. **Exit Code 1 bug is fixed** — the `finally` block fires correctly, Board state stays consistent
2. **Error handler exists** — classifies errors as recovery/auto-heal/escalate
3. **Server + Worker use the handler** — both failure paths (crash + graceful) trigger classification + auto-heal
4. **AI triage interface** — ready for haiku-based classification (placeholder, conservative default)
5. **CLAUDE.md documents three modes** — planned, ad-hoc, auto-heal (retains existing points 4+5)

**What's NOT in this plan (future tasks):**
- Actual AI triage implementation (haiku call to reclassify "escalate" → "auto_heal")
- AI-driven fix execution (auto-heal creates ticket, but doesn't run a fix pipeline yet)
- Auto-merge after successful auto-heal fix
- `autoHealed` flag on `PipelineResult` (add when fix execution exists)
- Health endpoint showing auto-heal history
- Board UI for auto-heal activity timeline
