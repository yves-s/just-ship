# /recover — Universal Pipeline Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/recover T-{N}` command that detects and recovers stuck pipeline tickets — resuming from partial work or restarting cleanly — with automatic detection at session start and VPS watchdog integration.

**Architecture:** Three deliverables: (1) a slash command `commands/recover.md` that reads Board state + worktree state and dispatches Resume or Restart, (2) a `.claude/rules/` rule for automatic detection, (3) an extension to `pipeline/lib/watchdog.ts` that sends `agent_failed` events and sets `pipeline_status: crashed` on timeout. The command is a Markdown command definition (like `/develop` and `/ship`), not TypeScript.

**Tech Stack:** Markdown (command definition, rule), Bash (Board API calls via curl), TypeScript (watchdog extension)

**Spec:** `docs/superpowers/specs/2026-03-31-recover-command-design.md`

**Important context:**
- Worker uses `config.pipeline.apiUrl` / `config.pipeline.apiKey` (from `loadProjectConfig`), NOT env vars
- Server's `getApiCredentials()` takes ZERO arguments — it accesses module-scoped `config` and `serverConfig`
- `pipeline_status` and `status` are separate fields — both must be checked and updated
- `pipeline_status: crashed` is a NEW value distinct from `paused` (human-in-the-loop) and `failed` (retriable)

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `commands/recover.md` | `/recover T-{N}` slash command — decision flow, Resume mode, Restart mode |
| `.claude/rules/detect-stuck-tickets.md` | Automatic detection rule — checks worktrees at session start |

### Modified Files

| File | Changes |
|---|---|
| `pipeline/lib/watchdog.ts` | Add `sendAgentFailedEvent()` helper function |
| `pipeline/worker.ts` | Refactor watchdog catch block: send `agent_failed` event, set `pipeline_status: crashed` when WIP saved |
| `pipeline/server.ts` | Send `agent_failed` on crash, handle `crashed` pipeline_status in zombie detection |

---

## Task 1: Automatic Detection Rule

**Files:**
- Create: `.claude/rules/detect-stuck-tickets.md`

- [ ] **Step 1: Create the detection rule**

Write the file `.claude/rules/detect-stuck-tickets.md` with the following content:

```
At the start of each session, on your first interaction with the user, check for stuck pipeline tickets:

1. Check if .worktrees/ directory exists and contains subdirectories:
   ls -d .worktrees/T-*/ 2>/dev/null

2. If worktrees exist, check if each one has an active agent process:
   ACTIVE_TICKET=$(cat .claude/.active-ticket 2>/dev/null || echo "")

3. For each worktree where the ticket number does NOT match .active-ticket (no agent actively working on it):
   - Extract ticket number from directory name (.worktrees/T-{N} -> {N})
   - Resolve Board API credentials (workspace_id from project.json -> write-config.sh)
   - Query ticket status with 3-second timeout:
     curl -s --max-time 3 -H "X-Pipeline-Key: {api_key}" "{board_url}/api/tickets/{N}"
   - Check both status and pipeline_status fields

4. A ticket is "stuck" when:
   - status is in_progress AND
   - pipeline_status is running, crashed, or null AND
   - No active agent is working on it (not in .active-ticket)

5. If stuck tickets are found, inform the user:
   "T-{N} appears stuck on in_progress with an orphaned worktree. Run /recover T-{N} to resume or restart."

6. If pipeline_status is paused: do NOT flag as stuck. Instead:
   "T-{N} is paused waiting for input."

7. If the Board is unreachable (curl timeout or no pipeline config): skip detection silently.

Do NOT automatically run recovery. Only inform the user.
```

- [ ] **Step 2: Verify rule file exists**

Run: `ls -la .claude/rules/detect-stuck-tickets.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/rules/detect-stuck-tickets.md
git commit -m "feat: add automatic stuck-ticket detection rule"
```

---

## Task 2: /recover Command

**Files:**
- Create: `commands/recover.md`

- [ ] **Step 1: Create the recover command**

Write the file `commands/recover.md`. The command follows the same structure as `commands/develop.md` and `commands/ship.md`. Read both files for reference on the format.

The command must include:

**Frontmatter:**
```yaml
name: recover
description: Stuck-Ticket recovern — Resume bei vorhandenem Code, Restart bei leerem Worktree
```

**Konfiguration:** Same Board API credential resolution pattern as `/develop` and `/ship` (workspace_id from project.json -> write-config.sh -> board_url + api_key). Falls pipeline.workspace_id NICHT gesetzt: nur lokales Cleanup, keine Board-Updates.

**WICHTIGSTE REGEL:** Keine Rückfragen. Entscheide selbst ob Resume oder Restart.

**Ausführung — 6 Schritte:**

**Schritt 0 — Ticket-Nummer extrahieren:** Aus $ARGUMENTS: `T-501` -> `501`, `501` -> `501`. Falls kein Argument: prüfe `.claude/.active-ticket`. Falls leer: Fehlermeldung.

**Schritt 1 — Concurrency Guard:** `ACTIVE=$(cat .claude/.active-ticket 2>/dev/null || echo "")`. Falls $ACTIVE == {N}: Abbruch "T-{N} wird gerade aktiv bearbeitet."

**Schritt 2 — Ticket-Status prüfen (falls Pipeline konfiguriert):**
- Ticket vom Board holen, `status` und `pipeline_status` auslesen
- `pipeline_status == paused` -> "T-{N} wartet auf Input." -> Stop
- `status != in_progress` UND `pipeline_status` nicht `running`/`crashed` -> "T-{N} ist nicht blockiert." -> Stop
- Board nicht erreichbar -> nur lokales Recovery

**Schritt 3 — Agent-Failed Event senden** (bevor Cleanup passiert):
`bash .claude/scripts/send-event.sh {N} orchestrator agent_failed '{"reason": "manual_stop"}'`

**Schritt 4 — Worktree prüfen und Modus wählen:**
- Prüfe `.worktrees/T-{N}` existiert
- Falls ja: `git diff --stat` gegen merge-base + uncommitted changes
- Hat Änderungen -> RESUME
- Keine Änderungen -> RESTART

**Schritt 5a — RESUME Modus:**
1. Infrastruktur re-etablieren: Write-Tool für `.claude/.active-ticket`, orchestrator `agent_started` event senden
2. Vorhandene Arbeit analysieren: `git diff --stat`, `git status --porcelain`, `git log --oneline`
3. Phase bestimmen via Checkpoint (falls vorhanden) oder Heuristik:
   - Uncommitted Änderungen -> ab Schritt 6 (Build-Check) aus `/develop`
   - Commits vorhanden, kein PR -> ab Schritt 9 (Commit/PR) aus `/develop`
   - PR existiert -> ab Schritt 10 (Automated QA) aus `/develop`
4. **Lies `commands/develop.md` und führe die Schritte ab dem bestimmten Schritt aus.** Alle Schritte im Worktree `.worktrees/T-{N}/` ausführen. Ticket-Daten aus dem Board-Response verwenden.
5. **WICHTIG:** Triage und Planung werden NICHT wiederholt. Der Code im Worktree IST das Ergebnis der Planung.

**Schritt 5b — RESTART Modus:**
1. Event zuerst senden (Evidenz erhalten — schon in Schritt 3 geschehen)
2. Aufräumen: `git worktree remove --force`, Branch löschen mit spezifischem Pattern (`feature/T-{N}-*`, `fix/T-{N}-*`, `chore/T-{N}-*`, `docs/T-{N}-*`)
3. Ticket zurücksetzen: PATCH mit `{"status": "ready_to_develop", "pipeline_status": null}`
4. `/develop T-{N}` aufrufen

**Schritt 6 — Abschluss-Ausgabe:**
- Resume: `✓ recover — T-{N} fortgesetzt ab Schritt {X}`
- Restart: `✓ recover — T-{N} neu gestartet via /develop`

- [ ] **Step 2: Verify command file structure**

Run: `head -5 commands/recover.md` — should show frontmatter with name and description.

- [ ] **Step 3: Commit**

```bash
git add commands/recover.md
git commit -m "feat: add /recover command for stuck pipeline ticket recovery"
```

---

## Task 3: Watchdog Extension — sendAgentFailedEvent Helper

**Files:**
- Modify: `pipeline/lib/watchdog.ts`

- [ ] **Step 1: Add sendAgentFailedEvent function**

Read `pipeline/lib/watchdog.ts`. After the existing `saveWorktreeWIP` function (after line 50), add:

```typescript
/**
 * Send an agent_failed event to the Board API.
 * Best-effort — never blocks or throws.
 */
export async function sendAgentFailedEvent(
  apiUrl: string,
  apiKey: string,
  ticketNumber: number | string,
  reason: "timeout" | "crashed" | "manual_stop",
  worktreeHadChanges: boolean,
): Promise<void> {
  try {
    await fetch(`${apiUrl}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": apiKey,
      },
      body: JSON.stringify({
        ticket_number: Number(ticketNumber),
        agent_type: "orchestrator",
        event_type: "agent_failed",
        metadata: {
          reason,
          recovery_mode: worktreeHadChanges ? "resume" : "restart",
          worktree_had_changes: worktreeHadChanges,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort — don't fail the pipeline on event delivery failure
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsx --eval "import { sendAgentFailedEvent } from './pipeline/lib/watchdog.ts'; console.log('OK');"`

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/watchdog.ts
git commit -m "feat: add sendAgentFailedEvent to watchdog module"
```

---

## Task 4: Integrate Watchdog Recovery into Worker

**Files:**
- Modify: `pipeline/worker.ts`

The worker's catch block (lines 324-368) handles watchdog timeouts with WIP-save. This task refactors it to send `agent_failed` events and set `pipeline_status: crashed` when partial work exists.

- [ ] **Step 1: Update import**

Read `pipeline/worker.ts` line 8. Change the existing import:

```typescript
// FROM:
import { withWatchdog, saveWorktreeWIP } from "./lib/watchdog.ts";
// TO:
import { withWatchdog, saveWorktreeWIP, sendAgentFailedEvent } from "./lib/watchdog.ts";
```

- [ ] **Step 2: Refactor the entire watchdog catch block**

Read `pipeline/worker.ts` lines 324-368 (the catch block of `runPipeline`). Replace the watchdog handling section (lines 326-340) AND the error classification + failTicket section (lines 342-358) with this single coherent block:

```typescript
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const isWatchdog = errorObj.message.startsWith("Watchdog timeout:");

    // --- Watchdog timeout: abort subprocess, save WIP, send agent_failed ---
    let watchdogHadWip = false;
    if (isWatchdog) {
      runAbortController.abort();
      await sleep(5000);
      if (slotId !== undefined) {
        const worktreeDir = worktreeManager.getSlotDir(slotId);
        if (worktreeDir) {
          watchdogHadWip = saveWorktreeWIP(worktreeDir, ticket.number);
        }
      }
      // Send agent_failed event via Board API
      if (config.pipeline.apiUrl && config.pipeline.apiKey) {
        await sendAgentFailedEvent(config.pipeline.apiUrl, config.pipeline.apiKey, ticket.number, "timeout", watchdogHadWip);
      }
    }

    // --- Error classification and ticket status update ---
    const classification = classifyError({
      error: errorObj,
      ticketId: String(ticket.number),
      exitCode: 1,
      timedOut: false,
      branch: branchName,
      projectDir: PROJECT_DIR,
    });

    log(`Pipeline failed: T-${ticket.number} (${errorObj.message}) [${classification.action}]`);
    Sentry.captureException(error);

    if (watchdogHadWip) {
      // Partial work saved — set crashed so recovery can resume instead of restart
      await supabasePatch(`/rest/v1/tickets?number=eq.${ticket.number}`, {
        pipeline_status: "crashed",
        summary: `Watchdog timeout with partial work saved. Use /recover T-${ticket.number} to resume.`,
      });
      log(`T-${ticket.number}: watchdog timeout, WIP saved, set pipeline_status=crashed`);
    } else {
      await failTicket(ticket.number, `Pipeline error: ${errorObj.message}`);
    }
```

**IMPORTANT:** Keep the existing auto-heal section (lines 355-358 approximately) and slot-failure tracking (lines 360-363) AFTER this block — those are not being changed. Only the watchdog block (lines 326-340) and the classification+failTicket section (lines 342-353) are replaced.

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsx --eval "import './pipeline/worker.ts'; console.log('OK');" 2>&1 | head -10`

If compilation fails due to module-level side effects, try: `npx tsc --noEmit pipeline/worker.ts 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add pipeline/worker.ts
git commit -m "feat: worker sends agent_failed event and sets crashed status on watchdog timeout with WIP"
```

---

## Task 5: Integrate Recovery into Server

**Files:**
- Modify: `pipeline/server.ts`

The server's catch block (lines 479-504) handles pipeline crashes. This task adds `agent_failed` event sending and handles the `crashed` pipeline_status in zombie detection.

**Key difference from worker:** The server does NOT do WIP-save in its catch block (no worktree access at that point). It always sets `pipeline_status: failed`. The `agent_failed` event is for Board visibility only.

- [ ] **Step 1: Update import**

Read `pipeline/server.ts` line 11. Change the existing import:

```typescript
// FROM:
import { withWatchdog, getWatchdogTimeoutMs } from "./lib/watchdog.ts";
// TO:
import { withWatchdog, getWatchdogTimeoutMs, sendAgentFailedEvent } from "./lib/watchdog.ts";
```

Do NOT import `saveWorktreeWIP` — the server doesn't use it.

- [ ] **Step 2: Add agent_failed event in catch block**

Read `pipeline/server.ts` lines 479-504 (the catch block in handleLaunch). After `Sentry.captureException(error)` (line 492) and BEFORE `patchTicket(...)` (line 493), add:

```typescript
      // Send agent_failed event for Board visibility
      const creds = getApiCredentials();
      await sendAgentFailedEvent(creds.apiUrl, creds.apiKey, ticketNumber, "crashed", false);
```

Note: `getApiCredentials()` takes ZERO arguments — it accesses module-scoped variables.

- [ ] **Step 3: Handle crashed status in zombie detection — SEPARATELY from running**

Read `pipeline/server.ts` lines 278-298 (zombie detection). After the existing `if (pipelineStatus === "running") { ... }` block (ends at line 291) and BEFORE `if (pipelineStatus === "paused")` (line 293), add a NEW block:

```typescript
  if (pipelineStatus === "crashed") {
    // Crashed = watchdog timeout with partial work saved. Allow re-launch.
    // The pipeline will create a new worktree (or reattach via checkpoint in P1).
    log(`Crashed ticket: T-${ticketNumber} has pipeline_status=crashed — allowing re-launch`);
  }
```

This is DIFFERENT from the `running` zombie handling. Zombies get silently reset; crashed tickets are logged and allowed to proceed to the normal launch flow (which will reset pipeline_status to `running` in the atomic claim at line 365).

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsx --eval "console.log('OK');" 2>&1 | head -5`

Then verify the import resolves: `grep -n "sendAgentFailedEvent" pipeline/server.ts`

- [ ] **Step 5: Commit**

```bash
git add pipeline/server.ts
git commit -m "feat: server sends agent_failed on crash and handles crashed pipeline_status"
```

---

## Task 6: Documentation Updates

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md` (if commands table exists)

- [ ] **Step 1: Add CHANGELOG entry**

Read `CHANGELOG.md`. Under `## [Unreleased]`, add:

```markdown
### Added
- `/recover T-{N}` command for recovering stuck pipeline tickets (resume partial work or restart clean)
- Automatic stuck-ticket detection rule at session start
- `agent_failed` pipeline event type for crash visibility on the Board
- `pipeline_status: crashed` state for watchdog timeouts with partial work saved
```

- [ ] **Step 2: Update README commands table (if it exists)**

Read `README.md` and check if a commands table exists. If yes, add `/recover T-{N}` with description: "Recover stuck pipeline ticket — resume or restart".

- [ ] **Step 3: Update spec to reflect server.ts changes**

The spec at `docs/superpowers/specs/2026-03-31-recover-command-design.md` lists server.ts under "No Changes Needed". Update the spec to move server.ts to "Modified Files" with: "Send agent_failed event on crash, handle crashed pipeline_status in zombie detection".

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md README.md docs/superpowers/specs/2026-03-31-recover-command-design.md
git commit -m "docs: add /recover command to changelog, readme, and update spec"
```

---

## Task Summary & Dependencies

```
Task 1: Detection Rule          <- no dependencies, standalone
Task 2: /recover Command        <- no dependencies, standalone
Task 3: Watchdog Extension      <- no dependencies, standalone
Task 4: Worker Integration      <- depends on Task 3 (imports sendAgentFailedEvent)
Task 5: Server Integration      <- depends on Task 3 (imports sendAgentFailedEvent)
Task 6: Documentation           <- depends on Tasks 1-5 (documents what was built)
```

**Parallel opportunities:**
- Tasks 1, 2, 3 can all run in parallel (no shared state)
- Tasks 4 and 5 can run in parallel after Task 3
- Task 6 runs last

**Total commits:** 6
