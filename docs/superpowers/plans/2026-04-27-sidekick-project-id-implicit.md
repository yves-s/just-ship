# Sidekick: project_id aus Tool-Args entfernen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Sidekick-Tool-Surface wird projekt-implizit. Das Modell schreibt nie eine `project_id`; der Server stempelt sie aus `ctx.projectId`. Das killt die `<active>`-Platzhalter-Bug-Klasse, die heute bei Tool-Calls 35-Sekunden-Hänger und stille `max_turns`-Aborts produziert.

**Architecture:** Fünf der acht Sidekick-Reasoning-Tools (`create_ticket`, `start_conversation_thread`, `run_expert_audit`, `consult_expert`, `start_sparring`) verlieren ihr `project_id`-Argument. `create_epic` verliert zusätzlich den cross-project-Pfad (Top-Level `project_id: null` und per-Child overrides). `ToolContext` bekommt ein neues required Feld `projectId`. Der HTTP-Handler in `pipeline/server.ts` reicht `validated.project_id` aus dem bereits existierenden Request-Schema in den Context durch. System-Prompt verliert alle `<active>`-Platzhalter; eine neue "Project context"-Klausel klärt das Verhalten ausdrücklich. Ein Snapshot-Test-Guard verhindert, dass künftig `<placeholder>`-Marker durchs CI rutschen.

**Tech Stack:** TypeScript, Zod, Node-Test-Runner, Anthropic Claude Agent SDK MCP-Tools.

**Spec:** [`docs/superpowers/specs/2026-04-27-sidekick-project-id-implicit-design.md`](../specs/2026-04-27-sidekick-project-id-implicit-design.md)

**Out-of-Scope:** Auth-Hardening (`ctx.projectId`-Validierung gegen Workspace), Telemetrie auf `tool_result.is_error: true`, `maxTurns: 4` Refactor, UI-Feedback im Board-Widget. Alles im Follow-up-Ticket.

---

## File Structure

| File | Status | Verantwortung |
|---|---|---|
| `pipeline/lib/sidekick-reasoning-tools.ts` | modify | Schemas + Handler-Implementierungen für alle acht Tools. `project_id` aus 5 Schemas raus, `ToolContext.projectId` rein, Handler nutzen `ctx.projectId` statt `args.project_id`. |
| `pipeline/lib/sidekick-system-prompt.ts` | modify | `SIDEKICK_PROMPT_EXAMPLES` (alle `<active>` raus), neuer "Project context"-Block im `PROMPT_BODY`, `buildSidekickSystemPrompt` erweitert um `workspaceId`, `SIDEKICK_PROMPT_VERSION` v3→v4. |
| `pipeline/lib/sidekick-system-prompt.test.ts` | modify | Snapshot-Test neu generieren (v4); neuer "no unresolved placeholders"-Guard. |
| `pipeline/lib/sidekick-reasoning-tools.test.ts` | modify | Schema-Tests aktualisieren (`project_id`-Feld wird strip'd, kein `ZodError`); Handler-Tests verifizieren `ctx.projectId`-Stempel. |
| `pipeline/lib/sidekick-chat.ts` | modify (minimal) | `buildPrompt`-Aufruf reicht `workspaceId` an `buildSidekickSystemPrompt` weiter; `ToolContext` an MCP-Server-Builder bekommt `projectId`. |
| `pipeline/lib/sidekick-chat.test.ts` | modify | Tests, die `ToolContext` bauen, kriegen ein `projectId`-Feld. |
| `pipeline/server.ts` | modify (minimal) | Closure, der `ToolContext` für `runChatSession` liefert (~Zeile 1972-1986), bekommt `projectId: validated.project_id` und `workspaceId: validated.workspace_id || serverConfig.workspace.workspace_id`. |

**Files NICHT angefasst:**
- `pipeline/lib/sidekick-create.ts` (Library, T-903 Cross-Project-Pfad bleibt erhalten)
- `pipeline/lib/audit-runtime.ts` (Audit-Spezialist liest seine Args via `run_expert_audit`-Tool, das nur `expert_skill` und `scope` durchreicht — keine `project_id` mehr nötig)
- Storage-/Thread-Layer
- SSE-Frame-Format

---

## Task 1: ToolContext erweitern

**Files:**
- Modify: `pipeline/lib/sidekick-reasoning-tools.ts:167-182` (ToolContext interface)

- [ ] **Step 1: Read current ToolContext definition**

```bash
sed -n '167,182p' pipeline/lib/sidekick-reasoning-tools.ts
```

Expected: Interface ohne `projectId`-Feld.

- [ ] **Step 2: Add `projectId` field**

In `pipeline/lib/sidekick-reasoning-tools.ts`, ToolContext interface:

```ts
export interface ToolContext {
  /** Board API base URL, e.g. "https://board.just-ship.io". No trailing slash. */
  apiUrl: string;
  /** Board pipeline key (workspace- or project-scoped). */
  apiKey: string;
  /** Active workspace uuid — stamped onto created threads. */
  workspaceId: string;
  /**
   * Active project uuid — stamped onto every project-scoped artifact created
   * during this chat turn. Sourced from the HTTP request body
   * (`validated.project_id` in `pipeline/server.ts`). Required for all tools
   * except `create_project` (which receives `workspace_id` in args because it
   * creates the project itself).
   */
  projectId: string;
  /** User uuid — stamped onto created threads; required for thread creation. */
  userId?: string;
  /** Board web base URL, used to build `url` fields in artifact responses. */
  boardUrl?: string;
  /** Request timeout in ms for Board API calls. Defaults to 10_000. */
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}
```

- [ ] **Step 3: Build TypeScript to surface broken call sites**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: errors at every site that builds a `ToolContext` literal without `projectId`. Note them — they are addressed in subsequent tasks. Do not fix them yet.

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/sidekick-reasoning-tools.ts
git commit -m "feat(sidekick): add ToolContext.projectId field

Required field for all project-scoped tool handlers. Source: HTTP
request body. Empty body in this commit — handlers and call sites
follow in next commits."
```

---

## Task 2: Schema — `project_id` aus den fünf "stempelbaren" Tools entfernen

**Files:**
- Modify: `pipeline/lib/sidekick-reasoning-tools.ts:81-157` (Zod schemas)
- Test: `pipeline/lib/sidekick-reasoning-tools.test.ts` (existing schema tests)

- [ ] **Step 1: Write failing tests for schema strip behaviour**

Append to `pipeline/lib/sidekick-reasoning-tools.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CreateTicketSchema,
  CreateEpicSchema,
  StartConversationThreadSchema,
  RunExpertAuditSchema,
  ConsultExpertSchema,
  StartSparringSchema,
} from "./sidekick-reasoning-tools.ts";

describe("Schema project_id stripping (B1)", () => {
  test("CreateTicketSchema strips legacy project_id", () => {
    const parsed = CreateTicketSchema.parse({
      title: "x",
      body: "y",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal((parsed as Record<string, unknown>).project_id, undefined);
    assert.equal(parsed.title, "x");
  });

  test("CreateEpicSchema strips legacy project_id (top-level + children)", () => {
    const parsed = CreateEpicSchema.parse({
      title: "x",
      body: "y",
      children: [{ title: "c1", body: "b1", project_id: "11111111-1111-1111-1111-111111111111" }],
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal((parsed as Record<string, unknown>).project_id, undefined);
    assert.equal((parsed.children[0] as Record<string, unknown>).project_id, undefined);
  });

  test("StartConversationThreadSchema strips legacy project_id", () => {
    const parsed = StartConversationThreadSchema.parse({
      topic: "x",
      initial_context: "y",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal((parsed as Record<string, unknown>).project_id, undefined);
  });

  test("RunExpertAuditSchema strips legacy project_id", () => {
    const parsed = RunExpertAuditSchema.parse({
      scope: "x",
      expert_skill: "design-lead",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal((parsed as Record<string, unknown>).project_id, undefined);
  });

  test("ConsultExpertSchema strips legacy project_id", () => {
    const parsed = ConsultExpertSchema.parse({
      question: "x",
      expert_skill: "design-lead",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal((parsed as Record<string, unknown>).project_id, undefined);
  });

  test("StartSparringSchema strips legacy project_id", () => {
    const parsed = StartSparringSchema.parse({
      topic: "x",
      experts: ["design-lead"],
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal((parsed as Record<string, unknown>).project_id, undefined);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd pipeline && node --test --experimental-strip-types lib/sidekick-reasoning-tools.test.ts
```

Expected: tests fail because schemas still require `project_id` (and Zod default actually does strip on `.object({...}).parse()` — but the existing schemas validate the field, so tests will pass ONLY after we remove it).

Note: if a test passes already (because Zod default strips unknown keys with no validation), that means Zod's behaviour is already correct — these tests document the contract.

- [ ] **Step 3: Update `CreateTicketSchema`**

Locate `CreateTicketSchema` (around line 81). Remove `project_id: zProjectId,`:

```ts
export const CreateTicketSchema = z.object({
  title: zTitle,
  body: zBody,
  priority: zPriority.default("medium"),
  tags: zTags,
});
```

- [ ] **Step 4: Update `CreateEpicSchema`**

Remove `project_id: zProjectId.optional(),` from `zChildTicket` and the top-level `project_id` union:

```ts
const zChildTicket = z.object({
  title: zTitle,
  body: zBody,
  priority: zPriority.optional(),
  tags: zTags,
});

export const CreateEpicSchema = z.object({
  title: zTitle,
  body: zBody,
  children: z.array(zChildTicket).min(1).max(20),
  priority: zPriority.default("medium"),
  tags: zTags,
});
```

- [ ] **Step 5: Update `StartConversationThreadSchema`, `RunExpertAuditSchema`, `ConsultExpertSchema`, `StartSparringSchema`**

In each case: delete the `project_id: zProjectId(.optional()?)` line.

```ts
export const StartConversationThreadSchema = z.object({
  topic: zTitle,
  initial_context: z.string().trim().min(1).max(10_000),
});

export const RunExpertAuditSchema = z.object({
  scope: zAuditScope,
  expert_skill: zExpertSkill,
});

export const ConsultExpertSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  expert_skill: zExpertSkill,
});

export const StartSparringSchema = z.object({
  topic: zTitle,
  experts: z.array(zExpertSkill).min(1).max(4),
});
```

- [ ] **Step 6: Verify `zProjectId` constant still in use (only in CreateProjectSchema-related context, if at all)**

```bash
grep -n "zProjectId" pipeline/lib/sidekick-reasoning-tools.ts
```

If no occurrences remain, delete the constant declaration (`const zProjectId = ...`).

- [ ] **Step 7: Run schema tests**

```bash
cd pipeline && node --test --experimental-strip-types lib/sidekick-reasoning-tools.test.ts
```

Expected: all six new strip-tests PASS.

- [ ] **Step 8: Commit**

```bash
git add pipeline/lib/sidekick-reasoning-tools.ts pipeline/lib/sidekick-reasoning-tools.test.ts
git commit -m "refactor(sidekick): drop project_id from 5 tool schemas

create_ticket, create_epic, start_conversation_thread, run_expert_audit,
consult_expert, start_sparring no longer accept project_id in args.
Zod default .strip() makes legacy callers backward-compatible (tested).
create_project keeps workspace_id; update_thread_status keeps thread_id."
```

---

## Task 3: Handler — `args.project_id` durch `ctx.projectId` ersetzen

**Files:**
- Modify: `pipeline/lib/sidekick-reasoning-tools.ts` (handler functions)

- [ ] **Step 1: Write failing handler tests**

Append to `pipeline/lib/sidekick-reasoning-tools.test.ts`:

```ts
describe("Handler stamps ctx.projectId (B1)", () => {
  // helper: build a stub ctx with a mock fetch that captures the request body
  function stubCtx(captured: { body?: unknown }): ToolContext {
    return {
      apiUrl: "https://board.test",
      apiKey: "test-key",
      workspaceId: "ws-uuid",
      projectId: "active-project-uuid",
      boardUrl: "https://board.test",
      fetchFn: async (_url, init) => {
        captured.body = JSON.parse((init?.body as string) ?? "{}");
        return new Response(JSON.stringify({
          category: "ticket",
          ticket: { number: 1, id: "t-1", title: "x", url: "https://board.test/t/1" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    };
  }

  test("execCreateTicket stamps ctx.projectId, ignores legacy args.project_id", async () => {
    const captured: { body?: unknown } = {};
    const ctx = stubCtx(captured);
    const result = await executeSidekickReasoningTool("create_ticket", ctx, {
      title: "x", body: "y",
    });
    assert.equal(result.ok, true);
    const body = captured.body as { project_id?: string };
    assert.equal(body.project_id, "active-project-uuid");
  });

  // Repeat for create_epic, start_conversation_thread, run_expert_audit (where applicable).
});
```

(Imports: `import type { ToolContext } from "./sidekick-reasoning-tools.ts"; import { executeSidekickReasoningTool } from "./sidekick-reasoning-tools.ts";`)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd pipeline && node --test --experimental-strip-types lib/sidekick-reasoning-tools.test.ts
```

Expected: handler tests fail with "args.project_id is undefined" or compile errors.

- [ ] **Step 3: Update `execCreateTicket`**

In `pipeline/lib/sidekick-reasoning-tools.ts`, locate `execCreateTicket` (around line 195):

```ts
async function execCreateTicket(
  ctx: ToolContext,
  args: z.infer<typeof CreateTicketSchema>,
): Promise<ToolResult<CreatedTicketResult>> {
  const req: CreateRequest = {
    category: "ticket",
    project_id: ctx.projectId,                 // ← was: args.project_id
    ...(ctx.boardUrl ? { board_url: ctx.boardUrl } : {}),
    ticket: {
      title: args.title,
      body: args.body,
      priority: args.priority,
      ...(args.tags && args.tags.length > 0 ? { tags: args.tags } : {}),
    },
  };
  // ...rest unchanged
}
```

- [ ] **Step 4: Update `execCreateEpic`**

Locate `execCreateEpic` (around line 236). Change top-level `project_id: args.project_id` to `project_id: ctx.projectId`. Remove the per-child `project_id` spread (`...(c.project_id ? { project_id: c.project_id } : {})`):

```ts
async function execCreateEpic(
  ctx: ToolContext,
  args: z.infer<typeof CreateEpicSchema>,
): Promise<ToolResult<CreatedEpicResult>> {
  const req: CreateRequest = {
    category: "epic",
    project_id: ctx.projectId,
    ...(ctx.boardUrl ? { board_url: ctx.boardUrl } : {}),
    epic: {
      title: args.title,
      body: args.body,
      priority: args.priority,
      ...(args.tags && args.tags.length > 0 ? { tags: args.tags } : {}),
    },
    children: args.children.map((c) => ({
      title: c.title,
      body: c.body,
      ...(c.priority ? { priority: c.priority } : {}),
      ...(c.tags && c.tags.length > 0 ? { tags: c.tags } : {}),
    })),
  };
  // ...rest unchanged
}
```

- [ ] **Step 5: Update `execStartConversationThread`, `execRunExpertAudit`, `execConsultExpert`, `execStartSparring`**

For each handler: replace `args.project_id` with `ctx.projectId`. Read each handler's current body (`grep -n "args.project_id" pipeline/lib/sidekick-reasoning-tools.ts`) and substitute.

- [ ] **Step 6: Verify `execCreateProject` and `execUpdateThreadStatus` are NOT touched**

```bash
grep -n "args.workspace_id\|args.thread_id" pipeline/lib/sidekick-reasoning-tools.ts
```

Expected: matches in `execCreateProject` (workspace_id) and `execUpdateThreadStatus` (thread_id), unchanged.

- [ ] **Step 7: Run handler tests**

```bash
cd pipeline && node --test --experimental-strip-types lib/sidekick-reasoning-tools.test.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add pipeline/lib/sidekick-reasoning-tools.ts pipeline/lib/sidekick-reasoning-tools.test.ts
git commit -m "refactor(sidekick): handlers stamp ctx.projectId instead of args.project_id

5 handlers (create_ticket, create_epic, start_conversation_thread,
run_expert_audit, consult_expert, start_sparring) now read project_id
from ToolContext. create_project (workspace_id) and update_thread_status
(thread_id) unchanged."
```

---

## Task 4: Tool-Description-Strings updaten

**Files:**
- Modify: `pipeline/lib/sidekick-reasoning-tools.ts:686-715` (tool registry descriptions)

- [ ] **Step 1: Locate registry block**

```bash
grep -n "create_ticket:\|create_epic:" pipeline/lib/sidekick-reasoning-tools.ts | head -5
```

- [ ] **Step 2: Update `create_epic` description**

Currently mentions `project_id: null` and per-child `project_id`. Rewrite:

> "Create an epic plus its child tickets when the user wants multiple connected changes (feature with several parts, cross-cutting initiative). The epic and all children land in the active project."

- [ ] **Step 3: Scan other tool descriptions for `project_id` references**

```bash
grep -n "project_id" pipeline/lib/sidekick-reasoning-tools.ts
```

For any description string mentioning `project_id`, rewrite to remove the reference (the field no longer exists in the args).

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/sidekick-reasoning-tools.ts
git commit -m "docs(sidekick): scrub project_id from tool descriptions"
```

---

## Task 5: System-Prompt — `<active>` aus Few-Shots, neuer "Project context"-Block, Version-Bump

**Files:**
- Modify: `pipeline/lib/sidekick-system-prompt.ts`

- [ ] **Step 1: Bump version**

Top of file:

```ts
export const SIDEKICK_PROMPT_VERSION = "v4" as const;
```

- [ ] **Step 2: Strip `project_id: "<active>"` from all `args_sketch` strings in `SIDEKICK_PROMPT_EXAMPLES`**

Pattern: every line of the form `..., project_id: "<active>" }` becomes `... }` (remove the trailing `, project_id: "<active>"`).

For `create_epic` examples: also remove top-level `project_id: "<active>"` and any per-child `project_id`.

- [ ] **Step 3: Special case — `create_project` example**

Today (line ~113):

```ts
args_sketch: `{ name: "Aime Coach", description: "...", workspace_id: "<active>", confirmed: true }`,
```

Replace with:

```ts
args_sketch: `{ name: "Aime Coach", description: "...", workspace_id: "use the Active workspace ID from the context block above", confirmed: true }`,
```

(English-phrase instruction, not a `<placeholder>` marker — the new snapshot guard tolerates this.)

- [ ] **Step 4: Add "Project context" section to `PROMPT_BODY`**

Insert directly before the `# Few-shot grounding` heading:

```
# Project context

You are always operating in the active project — the one the user is looking at. Tools that create or reference project-scoped artifacts (\`create_ticket\`, \`create_epic\`, \`start_conversation_thread\`, \`run_expert_audit\`, \`consult_expert\`, \`start_sparring\`) **do not** take a \`project_id\` argument. The server stamps it from the active context. Do not invent, guess, or pass project IDs.

Two exceptions:
- \`create_project\` takes \`workspace_id\` because it creates a new project inside the workspace.
- \`update_thread_status\` takes \`thread_id\` because it targets a specific thread.

`
```

(Note backtick escapes for the inline code spans.)

- [ ] **Step 5: Extend `buildSidekickSystemPrompt` to accept `workspaceId` and emit the per-turn line**

```ts
export function buildSidekickSystemPrompt(opts: {
  projectName?: string;
  projectType?: string;
  pageUrl?: string;
  pageTitle?: string;
  workspaceId?: string;        // NEW
} = {}): string {
  const ctxLines: string[] = [];
  if (opts.projectName) {
    ctxLines.push(
      `Active project: "${opts.projectName}"${opts.projectType ? ` (${opts.projectType})` : ""}`,
    );
  }
  if (opts.workspaceId) ctxLines.push(`Active workspace ID: ${opts.workspaceId}`);
  if (opts.pageUrl) ctxLines.push(`Page URL: ${opts.pageUrl}`);
  if (opts.pageTitle) ctxLines.push(`Page title: ${opts.pageTitle}`);
  if (ctxLines.length === 0) return SIDEKICK_SYSTEM_PROMPT;
  return `${SIDEKICK_SYSTEM_PROMPT}\n\n# Per-turn context\n\n${ctxLines.join("\n")}`;
}
```

- [ ] **Step 6: Build TypeScript to confirm no compile errors**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: clean (call sites in `sidekick-chat.ts` will be fixed in Task 7).

- [ ] **Step 7: Commit**

```bash
git add pipeline/lib/sidekick-system-prompt.ts
git commit -m "feat(sidekick): prompt v4 — drop <active>, add Project context block

- SIDEKICK_PROMPT_VERSION: v3 → v4
- All <active> placeholders removed from few-shot args_sketch strings
- create_project example uses english-phrase instruction (not a marker)
- New Project context section in PROMPT_BODY explains the contract
- buildSidekickSystemPrompt now accepts workspaceId for per-turn context"
```

---

## Task 6: Snapshot-Test-Guard und Snapshot-Refresh

**Files:**
- Modify: `pipeline/lib/sidekick-system-prompt.test.ts`

- [ ] **Step 1: Add the placeholder-guard test**

Append to `pipeline/lib/sidekick-system-prompt.test.ts`:

```ts
test("rendered prompt contains no unresolved placeholders", () => {
  const prompt = buildSidekickSystemPrompt({
    projectName: "Test Project",
    projectType: "web",
    workspaceId: "00000000-0000-0000-0000-000000000000",
    pageUrl: "https://example.com",
    pageTitle: "Test Page",
  });

  // The first pattern matches any `<single_lowercase_token>` style placeholder
  // (incl. snake_case and dashes). Broader than naming the specific names that
  // have leaked historically (`<active>`, `<workspace>`); catches future names
  // like `<project_id>` automatically. The prompt body is plain markdown — no
  // real HTML — so legitimate angle-bracket use does not occur here.
  // The second pattern catches Mustache-style markers.
  const FORBIDDEN_PATTERNS = [
    /<[a-z][a-z0-9_-]*>/i,
    /\{\{[^}]+\}\}/,
  ];

  for (const pattern of FORBIDDEN_PATTERNS) {
    assert.doesNotMatch(prompt, pattern,
      `prompt contains forbidden placeholder matching ${pattern}`);
  }
});
```

(Use the existing test framework's negative-match assertion — `assert.doesNotMatch` for node:test.)

- [ ] **Step 2: Run guard test**

```bash
cd pipeline && node --test --experimental-strip-types lib/sidekick-system-prompt.test.ts
```

Expected: PASS (because Task 5 already removed all `<active>` markers and replaced the workspace marker with an English phrase).

If it FAILS, find the remaining marker:

```bash
node --eval "const {buildSidekickSystemPrompt} = await import('./pipeline/lib/sidekick-system-prompt.ts'); console.log(buildSidekickSystemPrompt({workspaceId: 'test'}))" --experimental-strip-types | grep -E '<[a-z]'
```

Fix the source, re-run.

- [ ] **Step 3: Refresh the snapshot test**

If a snapshot file exists (look for `__snapshots__/` or inline expected-string blocks in `sidekick-system-prompt.test.ts`):

```bash
grep -n "snapshot\|toMatchSnapshot\|inline-snapshot" pipeline/lib/sidekick-system-prompt.test.ts
```

If snapshot tests use inline expected strings, update them by capturing the new prompt:

```bash
cd pipeline && node --eval "const {buildSidekickSystemPrompt, SIDEKICK_PROMPT_VERSION} = await import('./lib/sidekick-system-prompt.ts'); console.log('VERSION:', SIDEKICK_PROMPT_VERSION); console.log(buildSidekickSystemPrompt())" --experimental-strip-types > /tmp/v4-snapshot.txt
```

Update the test's expected version assertion to `"v4"` and any inline expected-prompt blocks.

- [ ] **Step 4: Run all prompt tests**

```bash
cd pipeline && node --test --experimental-strip-types lib/sidekick-system-prompt.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/sidekick-system-prompt.test.ts
git commit -m "test(sidekick): placeholder guard + v4 snapshot refresh

The <[a-z][a-z0-9_-]*> guard catches any future <placeholder> marker
that would reach the model. v4 snapshot reflects the new Project
context block and the stripped few-shot examples."
```

---

## Task 7: `sidekick-chat.ts` — `workspaceId` weiterreichen, `ToolContext` mit `projectId` bauen

**Files:**
- Modify: `pipeline/lib/sidekick-chat.ts:336-366` (`buildPrompt`) and `pipeline/lib/sidekick-chat.ts:412-475` (MCP server build / runner setup)

- [ ] **Step 1: `buildPrompt` reicht `workspaceId` durch**

Locate `buildPrompt` (line ~336). The `buildSidekickSystemPrompt({ ... pageUrl, pageTitle })` call needs `workspaceId` from somewhere — the closest source is the `ToolContext` available at `runChatSession`. Plumb `ctx.workspaceId` into `buildPrompt`:

If `buildPrompt` doesn't currently take a `ctx` argument, add one. Trace the call site (`grep -n "buildPrompt(" pipeline/lib/sidekick-chat.ts`) and add the parameter.

```ts
function buildPrompt(
  thread: ThreadState,
  newUserText: string,
  ctx: ChatContext | undefined,
  attachments: ChatAttachment[] | undefined,
  toolCtx: ToolContext,            // NEW
): string {
  const baseWithContext = buildSidekickSystemPrompt({
    ...(ctx?.page_url ? { pageUrl: ctx.page_url } : {}),
    ...(ctx?.page_title ? { pageTitle: ctx.page_title } : {}),
    workspaceId: toolCtx.workspaceId,    // NEW
  });
  // ...
}
```

(Note: do NOT use `toolCtx.projectId` in the prompt — the project ID is server-stamped, never visible to the model. Only `workspaceId` is needed because the `create_project` few-shot references it.)

- [ ] **Step 2: Pass `ctx` (the ToolContext) into `buildPrompt`**

Find the `buildPrompt(...)` call in the chat flow. Pass the `ctx` argument that is already in scope at the call site.

- [ ] **Step 3: Verify `ctx.projectId` reaches `buildSidekickMcpServer(ctx)`**

`buildSidekickMcpServer` (line ~412) receives the `ctx`. The MCP-server's tool handlers receive this same `ctx` object. No code change here — but verify the type-check passes after Task 1's `projectId` field was added.

```bash
cd pipeline && npx tsc --noEmit
```

Expected: errors only at sites that **construct** a `ToolContext` literal without `projectId`. List those sites; they are addressed in Tasks 8 (server.ts) and 9 (chat tests).

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/sidekick-chat.ts
git commit -m "feat(sidekick): plumb workspaceId from ToolContext into prompt

buildSidekickSystemPrompt now receives workspaceId; the create_project
few-shot example references it via the per-turn context block."
```

---

## Task 8: `pipeline/server.ts` — HTTP-Handler stempelt `projectId` in den ToolContext

**Files:**
- Modify: `pipeline/server.ts:1972-1986` (or thereabouts — the `provider`/`ToolContext`-builder closure inside `handleSidekickChatRoute`)

- [ ] **Step 1: Locate the ToolContext-builder closure**

```bash
grep -n "workspaceId" pipeline/server.ts | head -10
grep -n "handleSidekickChatRoute\|runChatSession" pipeline/server.ts
```

Identify where `runChatSession` is called and what builds its `ToolContext` argument. Read 30 lines around the closure.

- [ ] **Step 2: Verify `validated.project_id` is available in scope**

```bash
sed -n '1940,1970p' pipeline/server.ts
```

Look for the request validation step — `validated.project_id` should be a string at this point (it was already required by the existing chat-request schema, see `pipeline/server.ts:1952` per the spec).

- [ ] **Step 3: Add `projectId` and `workspaceId` to the closure**

In the closure that builds `ToolContext`:

```ts
// The closure captures values from validated.project_id / workspace_id
const toolCtx: ToolContext = {
  apiUrl: ...,
  apiKey: ...,
  workspaceId: validated.workspace_id ?? serverConfig.workspace?.workspace_id ?? "",   // existing or new
  projectId: validated.project_id,                                                     // NEW
  ...(serverConfig.boardUrl ? { boardUrl: serverConfig.boardUrl } : {}),
  ...(userId ? { userId } : {}),
};
```

(The exact existing closure shape may differ — adapt the field names while keeping the spirit: `projectId` source = `validated.project_id`.)

- [ ] **Step 4: Build TypeScript**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add pipeline/server.ts
git commit -m "feat(server): stamp projectId into Sidekick ToolContext

handleSidekickChatRoute now stamps validated.project_id (already
present in the request schema) into ctx.projectId. The Sidekick tool
handlers use this; the model never writes a project_id again.

Auth-validation that the project belongs to the active workspace is
out-of-scope here — see follow-up ticket Sidekick Auth-Hardening."
```

---

## Task 9: Test-Fixtures aktualisieren — alle `ToolContext`-Literale brauchen `projectId`

**Files:**
- Modify: `pipeline/lib/sidekick-chat.test.ts`
- Modify: `pipeline/lib/sidekick-reasoning-tools.test.ts` (review existing fixtures)
- Modify: any other `*.test.ts` that builds a `ToolContext` literal

- [ ] **Step 1: Find all `ToolContext` literals across test files**

```bash
grep -rn "ToolContext\|workspaceId:" pipeline/lib/*.test.ts pipeline/server.test.ts 2>/dev/null
```

- [ ] **Step 2: Add `projectId` field to every literal**

For each match, add `projectId: "test-project-uuid"` (or a meaningful placeholder for the test).

- [ ] **Step 3: Run full pipeline test suite**

```bash
cd pipeline && node --test --experimental-strip-types lib/*.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/*.test.ts
git commit -m "test(sidekick): add projectId to all ToolContext fixtures"
```

---

## Task 10: Integrationstest — End-to-end Tool-Call ohne `project_id`

**Files:**
- Modify: existing integration test in `pipeline/lib/sidekick-chat.test.ts` (or create new `pipeline/lib/sidekick-tool-stamping.test.ts`)

- [ ] **Step 1: Write a chat-loop test with mock model + mock board**

```ts
test("chat: model emits create_ticket without project_id; ctx stamps it", async () => {
  const captured: { body?: unknown } = {};
  const stubFetch = async (_url: string, init: RequestInit) => {
    captured.body = JSON.parse((init?.body as string) ?? "{}");
    return new Response(JSON.stringify({
      category: "ticket",
      ticket: { number: 42, id: "t-42", title: "Fix typo", url: "https://board.test/t/42" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  // Use the _internal seam to inject a scripted model that emits a tool_use
  // for create_ticket WITHOUT a project_id field.
  const scriptedRunner: ModelRunner = async function*(_prompt, _signal, _ctx) {
    yield { kind: "tool_use", id: "tu-1", name: "create_ticket", input: { title: "Fix typo", body: "details" } };
    yield { kind: "tool_result", tool_use_id: "tu-1", result: { ok: true, result: {} } };
    yield { kind: "assistant_final", id: "a-1", text: "Done." };
  };
  _internal.callChatModel = scriptedRunner;

  // Run a chat session; assert captured.body.project_id === "active-project-uuid"
  // (full setup will require setting up a SinkRecorder and ChatRequest).
  // ...
});
```

(This test is the long pole. If the existing test infrastructure is heavy, simplify by calling `executeSidekickReasoningTool("create_ticket", ctx, args)` directly instead of running the full chat loop — the goal is to verify that `ctx.projectId` lands in the outgoing board request.)

- [ ] **Step 2: Run test**

```bash
cd pipeline && node --test --experimental-strip-types lib/sidekick-chat.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/sidekick-chat.test.ts
git commit -m "test(sidekick): integration test — tool-call without project_id"
```

---

## Task 11: Smoke-Test — lokaler Sidekick-Chat-Turn

**Files:** none (manual verification)

- [ ] **Step 1: Start the engine locally**

```bash
cd pipeline && npm run dev
# or whatever the local-dev command is — check pipeline/package.json scripts
```

- [ ] **Step 2: Open the Board UI, attach to the local engine, open Sidekick**

Verify in the engine logs that the chat request body contains a `project_id`. Send: "Fix typo in header". Watch the engine log:

- The model's tool_use input should NOT contain `project_id`.
- The board API request from the handler should contain `project_id` matching the page's project.
- A ticket appears in the active project. No `max_turns` abort.

- [ ] **Step 3: Smoke an existing thread**

Open one of the existing Sidekick threads (e.g. "Darstellungsprobleme bei klei…"), send a follow-up message. Verify the model continues the conversation and any tool-call lands in the correct project.

- [ ] **Step 4: If smoke passes, append an empty success commit (paper-trail)**

```bash
git commit --allow-empty -m "smoke(sidekick): local chat-turn + existing-thread verified

Manual verification per spec test-plan #7 + #8."
```

If smoke FAILS → diagnose; the most likely failure mode is the conversation-history compatibility issue (legacy `tool_use`-blocks with `project_id` in messages). If that occurs, the issue moves into this ticket from the Out-of-Scope follow-up.

---

## Task 12: Folgeticket "Sidekick Auth-Hardening" anlegen

**Files:** none (board action)

- [ ] **Step 1: Create the follow-up ticket via Sidekick**

After this ticket merges, create a new ticket on the board titled:
> "Sidekick Auth-Hardening + Telemetry"

Body should include the four out-of-scope items from the spec's Non-Goals table:
- Auth-validation that `ctx.projectId` belongs to the active workspace
- Telemetrie auf `tool_result.is_error: true` mit Sentry-Tags `prompt_version`, `tool`, `error_code`
- Conversation-History-Verträglichkeit (alte `tool_use`-Blöcke mit `project_id`) verifizieren
- Rollback-Pfad-Dokumentation in `docs/`

This task is a checklist item for the implementer to perform AFTER the PR merges, not before.

---

## Definition of Done

- [ ] All 5 tool schemas in `sidekick-reasoning-tools.ts` no longer have `project_id` (except `create_project` with `workspace_id` and `update_thread_status` with `thread_id`)
- [ ] `ToolContext.projectId` is required; all 5 affected handlers use `ctx.projectId`
- [ ] `SIDEKICK_PROMPT_EXAMPLES`: every `<active>` removed from `args_sketch` strings
- [ ] `PROMPT_BODY` has the new "Project context" section
- [ ] `buildSidekickSystemPrompt` accepts `workspaceId`; per-turn context block emits "Active workspace ID: …"
- [ ] `SIDEKICK_PROMPT_VERSION === "v4"`
- [ ] Snapshot-test-guard added; all existing snapshot tests pass with v4
- [ ] `pipeline/server.ts` `handleSidekickChatRoute` stamps `validated.project_id` into `ctx.projectId`
- [ ] All `ToolContext` test-fixtures updated
- [ ] Smoke tests #11 (Step 2 + Step 3) executed and passed
- [ ] Follow-up ticket "Sidekick Auth-Hardening + Telemetry" created on the board

---

## Rollback

If post-deploy regression: set env var `SIDEKICK_REASONING_ENABLED=false` on the engine deployment → engine falls back to legacy tool-less chat path. No code revert. See `pipeline/lib/sidekick-chat.ts:isSidekickReasoningEnabled` for the flag mechanic.

---

## References

- **Spec:** [`docs/superpowers/specs/2026-04-27-sidekick-project-id-implicit-design.md`](../specs/2026-04-27-sidekick-project-id-implicit-design.md)
- **Architecture plan (background):** `docs/superpowers/plans/2026-04-23-sidekick-reasoning-architecture.md` (T-979 → T-986 → this)
- **T-903:** Workspace-scoped epic invariant — code path preserved as library function
- **T-924:** Threads + Conversations as first-class engine resource — interaction documented in spec
