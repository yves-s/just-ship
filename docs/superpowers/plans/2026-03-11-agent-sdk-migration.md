# Agent SDK Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shell-based pipeline (`run.sh`, `worker.sh`, `send-event.sh`, `devboard-hook.sh`) with TypeScript using `@anthropic-ai/claude-agent-sdk` for native event streaming and parallel agent execution.

**Architecture:** SDK `query()` runs the orchestrator as main agent, pre-registering sub-agents from `agents/*.md`. SDK hooks intercept agent lifecycle events and POST them to the Dev Board API. A thin `run.sh` wrapper maintains backwards compatibility.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk`, `tsx` (runtime), Node.js 20+

**Spec:** `docs/superpowers/specs/2026-03-11-agent-sdk-migration-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `pipeline/package.json` | Dependencies: `@anthropic-ai/claude-agent-sdk`, `tsx` |
| `pipeline/tsconfig.json` | TypeScript config for tsx runtime |
| `pipeline/lib/config.ts` | Read `project.json` + parse CLI args |
| `pipeline/lib/load-agents.ts` | Parse `agents/*.md` frontmatter → `AgentDefinition[]` |
| `pipeline/lib/event-hooks.ts` | SDK hooks → POST `/api/events` to Dev Board |
| `pipeline/run.ts` | Main entry point — branch creation, query(), JSON output |
| `pipeline/worker.ts` | Supabase polling loop — replaces `vps/worker.sh` |

### Modified files

| File | Change |
|------|--------|
| `pipeline/run.sh` | Replace 114-line script with 3-line wrapper: `exec npx tsx run.ts "$@"` |
| `agents/orchestrator.md` | Remove `send-event.sh` calls, `Task` → `Agent` tool |
| `commands/develop.md` | Remove `send-event.sh` calls |
| `settings.json` | Remove `hooks.PostToolUse` entry |
| `setup.sh` | Add `npm install` step, cleanup removed files on update |
| `vps/agentic-dev-pipeline@.service` | Update `ExecStart` to `npx tsx worker.ts` |

### Removed files

| File | Reason |
|------|--------|
| `pipeline/send-event.sh` | Replaced by SDK hooks |
| `.claude/scripts/devboard-hook.sh` | Replaced by SDK hooks |
| `vps/worker.sh` | Replaced by `pipeline/worker.ts` |

---

## Chunk 1: Project Foundation + Config + Agent Loading

### Task 1: Initialize TypeScript project

**Files:**
- Create: `pipeline/package.json`
- Create: `pipeline/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "agentic-dev-pipeline",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "tsx": "^4.0.0"
  }
}
```

Write to `pipeline/package.json`.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false,
    "resolveJsonModule": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Write to `pipeline/tsconfig.json`.

- [ ] **Step 3: Add node_modules to .gitignore**

Append `pipeline/node_modules/` to the root `.gitignore` (create if it doesn't exist):

```
pipeline/node_modules/
```

- [ ] **Step 4: Install dependencies**

Run: `cd pipeline && npm install`
Expected: `node_modules/` created with `@anthropic-ai/claude-agent-sdk` and `tsx`

- [ ] **Step 5: Verify tsx works**

Run: `cd pipeline && npx tsx -e "console.log('SDK migration ready')"`
Expected: Prints `SDK migration ready`

- [ ] **Step 6: Commit**

```bash
git add pipeline/package.json pipeline/tsconfig.json pipeline/package-lock.json .gitignore
git commit -m "chore: initialize TypeScript pipeline project with Agent SDK"
```

---

### Task 2: Implement config.ts

**Files:**
- Create: `pipeline/lib/config.ts`

- [ ] **Step 1: Write config.ts**

`pipeline/lib/config.ts` reads `project.json` from the working directory and parses CLI arguments. It exports typed interfaces and a `loadConfig()` function.

```typescript
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface PipelineConfig {
  projectId: string;
  projectName: string;
  workspaceId: string;
  apiUrl: string;
  apiKey: string;
}

export interface ProjectConfig {
  name: string;
  description: string;
  conventions: { branch_prefix: string };
  pipeline: PipelineConfig;
}

export interface TicketArgs {
  ticketId: string;
  title: string;
  description: string;
  labels: string;
}

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const configPath = resolve(projectDir, "project.json");
  if (!existsSync(configPath)) {
    return {
      name: "project",
      description: "",
      conventions: { branch_prefix: "feature/" },
      pipeline: { projectId: "", projectName: "", workspaceId: "", apiUrl: "", apiKey: "" },
    };
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  return {
    name: raw.name ?? "project",
    description: raw.description ?? "",
    conventions: { branch_prefix: raw.conventions?.branch_prefix ?? "feature/" },
    pipeline: {
      projectId: raw.pipeline?.project_id ?? "",
      projectName: raw.pipeline?.project_name ?? "",
      workspaceId: raw.pipeline?.workspace_id ?? "",
      apiUrl: raw.pipeline?.api_url ?? "",
      apiKey: raw.pipeline?.api_key ?? "",
    },
  };
}

export function parseCliArgs(args: string[]): TicketArgs {
  const [ticketId, title, description, labels] = args;
  if (!ticketId || !title) {
    console.error("Usage: run.ts <TICKET_ID> <TITLE> [DESCRIPTION] [LABELS]");
    process.exit(1);
  }
  return {
    ticketId,
    title,
    description: description ?? "No description provided",
    labels: labels ?? "",
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd pipeline && npx tsx -e "import { loadProjectConfig } from './lib/config.ts'; console.log(typeof loadProjectConfig)"`
Expected: Prints `function`

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/config.ts
git commit -m "feat: add config.ts for project.json parsing and CLI args"
```

---

### Task 3: Implement load-agents.ts

**Files:**
- Create: `pipeline/lib/load-agents.ts`

- [ ] **Step 1: Write load-agents.ts**

Reads all `agents/*.md` files from the project's `.claude/agents/` directory, parses YAML frontmatter, and returns a `Record<string, AgentDefinition>` for the SDK. The orchestrator is excluded (it's the main agent, not a sub-agent).

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
}

interface AgentFrontmatter {
  name: string;
  description: string;
  tools: string;
  model: string;
  permissionMode: string;
  skills?: string[];
}

function parseFrontmatter(content: string): { frontmatter: Partial<AgentFrontmatter>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (value.startsWith("\n") || value === "") continue;
    // Handle simple YAML arrays (indented with -)
    frontmatter[key] = value;
  }

  return { frontmatter: frontmatter as unknown as Partial<AgentFrontmatter>, body: match[2] };
}

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

export function loadAgents(projectDir: string): Record<string, AgentDefinition> {
  const agentsDir = resolve(projectDir, ".claude", "agents");
  const agents: Record<string, AgentDefinition> = {};

  let files: string[];
  try {
    files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  } catch {
    console.error(`No agents directory found at ${agentsDir}`);
    return agents;
  }

  for (const file of files) {
    const name = basename(file, ".md");

    // Skip orchestrator — it's the main agent, not a sub-agent
    if (name === "orchestrator") continue;

    const content = readFileSync(resolve(agentsDir, file), "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    const tools = frontmatter.tools
      ? String(frontmatter.tools).split(",").map((t) => t.trim())
      : DEFAULT_TOOLS;

    agents[name] = {
      description: String(frontmatter.description ?? `${name} agent`),
      prompt: body.trim(),
      tools,
    };
  }

  return agents;
}

export function loadOrchestratorPrompt(projectDir: string): string {
  const orchestratorPath = resolve(projectDir, ".claude", "agents", "orchestrator.md");
  const content = readFileSync(orchestratorPath, "utf-8");
  const { body } = parseFrontmatter(content);
  return body.trim();
}
```

- [ ] **Step 2: Verify it loads agents from the framework's own agents/ dir**

Run: `cd pipeline && npx tsx -e "import { loadAgents } from './lib/load-agents.ts'; const a = loadAgents('..'); console.log(Object.keys(a).sort().join(', '))"`
Expected: Prints `backend, data-engineer, devops, frontend, qa, security` (orchestrator excluded)

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/load-agents.ts
git commit -m "feat: add load-agents.ts to parse agent .md files into AgentDefinitions"
```

---

## Chunk 2: Event Hooks + Main Runner

### Task 4: Implement event-hooks.ts

**Files:**
- Create: `pipeline/lib/event-hooks.ts`

- [ ] **Step 1: Write event-hooks.ts**

Creates SDK hook callbacks that POST events to the Dev Board API. All hooks are fire-and-forget with 3s timeout.

```typescript
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

export interface EventConfig {
  apiUrl: string;
  apiKey: string;
  ticketNumber: string;
}

async function postEvent(config: EventConfig, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${config.apiUrl}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": config.apiKey,
      },
      body: JSON.stringify({
        ticket_number: Number(config.ticketNumber),
        ...payload,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Silent fail — pipeline continues regardless of Dev Board availability
  }
}

export function createEventHooks(config: EventConfig) {
  const onAgentStarted: HookCallback = async (input) => {
    const agentType = (input as Record<string, unknown>).agent_type ?? "unknown";
    await postEvent(config, {
      agent_type: agentType,
      event_type: "agent_started",
    });
    return { async: true };
  };

  const onAgentCompleted: HookCallback = async (input) => {
    const agentType = (input as Record<string, unknown>).agent_type ?? "unknown";
    await postEvent(config, {
      agent_type: agentType,
      event_type: "completed",
    });
    return { async: true };
  };

  const onFileChanged: HookCallback = async (input) => {
    const postInput = input as Record<string, unknown>;
    const toolInput = (postInput.tool_input ?? {}) as Record<string, unknown>;
    await postEvent(config, {
      agent_type: (postInput.agent_type as string) ?? "orchestrator",
      event_type: "tool_use",
      metadata: {
        tool_name: postInput.tool_name ?? "unknown",
        file_path: toolInput.file_path ?? "",
      },
    });
    return { async: true };
  };

  return {
    SubagentStart: [{ matcher: ".*", hooks: [onAgentStarted] }],
    SubagentStop: [{ matcher: ".*", hooks: [onAgentCompleted] }],
    PostToolUse: [{ matcher: "Write|Edit", hooks: [onFileChanged] }],
  };
}

export async function postPipelineEvent(
  config: EventConfig,
  eventType: string,
  agentType = "orchestrator"
): Promise<void> {
  await postEvent(config, { agent_type: agentType, event_type: eventType });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd pipeline && npx tsx -e "import { createEventHooks } from './lib/event-hooks.ts'; console.log(typeof createEventHooks)"`
Expected: Prints `function`

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/event-hooks.ts
git commit -m "feat: add event-hooks.ts for SDK lifecycle event streaming to Dev Board"
```

---

### Task 5: Implement run.ts

**Files:**
- Create: `pipeline/run.ts`

- [ ] **Step 1: Write run.ts**

Main entry point. Reads config, creates branch, loads agents, sets up hooks, runs `query()`, outputs JSON. The core pipeline logic is in an exported `executePipeline()` function so `worker.ts` can import it directly.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import { loadProjectConfig, parseCliArgs, type ProjectConfig, type TicketArgs } from "./lib/config.ts";
import { loadAgents, loadOrchestratorPrompt } from "./lib/load-agents.ts";
import { createEventHooks, postPipelineEvent, type EventConfig } from "./lib/event-hooks.ts";

// --- Exported pipeline function (used by worker.ts) ---
export interface PipelineOptions {
  projectDir: string;
  ticket: TicketArgs;
  abortSignal?: AbortSignal;
}

export interface PipelineResult {
  status: "completed" | "failed";
  exitCode: number;
  branch: string;
  project: string;
}

export async function executePipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { projectDir, ticket, abortSignal } = opts;
  const config = loadProjectConfig(projectDir);

  // --- Git: create feature branch ---
  const branchSlug = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  const branchName = `${config.conventions.branch_prefix}${ticket.ticketId}-${branchSlug}`;

  try {
    execSync("git checkout main", { cwd: projectDir, stdio: "pipe" });
    execSync("git pull origin main", { cwd: projectDir, stdio: "pipe" });
  } catch { /* continue */ }

  try {
    execSync(`git checkout -b ${branchName}`, { cwd: projectDir, stdio: "pipe" });
  } catch {
    execSync(`git checkout ${branchName}`, { cwd: projectDir, stdio: "pipe" });
  }

  // --- Load agents + orchestrator prompt ---
  const agents = loadAgents(projectDir);
  const orchestratorPrompt = loadOrchestratorPrompt(projectDir);

  // --- Event hooks ---
  const hasPipeline = !!(config.pipeline.apiUrl && config.pipeline.apiKey);
  const eventConfig: EventConfig = {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
    ticketNumber: ticket.ticketId,
  };
  const hooks = hasPipeline ? createEventHooks(eventConfig) : {};

  // --- Build prompt ---
  const prompt = `${orchestratorPrompt}

Implementiere folgendes Ticket end-to-end:

Ticket-ID: ${ticket.ticketId}
Titel: ${ticket.title}
Beschreibung: ${ticket.description}
Labels: ${ticket.labels}

Folge deinem Workflow:
1. Lies project.json und CLAUDE.md für Projekt-Kontext
2. Plane die Implementierung (Phase 1)
3. Spawne die nötigen Experten-Agents (Phase 2: Implementierung)
4. Build-Check + QA Review (Phase 3-4)
5. Ship: Commit, Push, PR erstellen (Phase 5) — KEIN Merge

Branch ist bereits erstellt: ${branchName}`;

  // --- Run orchestrator ---
  let exitCode = 0;
  try {
    if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "orchestrator");

    for await (const message of query({
      prompt,
      options: {
        cwd: projectDir,
        model: "opus",
        permissionMode: "bypassPermissions",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
        agents,
        hooks,
        maxTurns: 200,
        abortController: abortSignal ? { signal: abortSignal } as AbortController : undefined,
      },
    })) {
      if (message.type === "error") {
        console.error("[SDK Error]", message);
        exitCode = 1;
      }
    }

    if (hasPipeline) await postPipelineEvent(eventConfig, "completed", "orchestrator");
  } catch (error) {
    console.error("Pipeline error:", error);
    exitCode = 1;
    if (hasPipeline) await postPipelineEvent(eventConfig, "pipeline_failed", "orchestrator");
  }

  return {
    status: exitCode === 0 ? "completed" : "failed",
    exitCode,
    branch: branchName,
    project: config.name,
  };
}

// --- CLI entry point (only runs when executed directly) ---
const isMain = process.argv[1]?.endsWith("run.ts");
if (isMain) {
  const projectDir = process.cwd();
  const ticket = parseCliArgs(process.argv.slice(2));
  const config = loadProjectConfig(projectDir);

  // --- Banner ---
  console.error("================================================");
  console.error(`  ${config.name} — Autonomous Pipeline (SDK)`);
  console.error(`  Ticket: ${ticket.ticketId} — ${ticket.title}`);
  console.error("================================================\n");

  const result = await executePipeline({ projectDir, ticket });

  // --- JSON output (stdout, for n8n / worker) ---
  console.error("\n================================================");
  console.error(`  Pipeline ${result.status}`);
  console.error("================================================");

  console.log(JSON.stringify({
    status: result.status,
    ...(result.status === "failed" ? { exit_code: result.exitCode } : {}),
    ticket_id: ticket.ticketId,
    ticket_title: ticket.title,
    branch: result.branch,
    project: result.project,
  }));

  if (result.status === "failed") process.exit(result.exitCode);
}
```

- [ ] **Step 2: Verify it compiles (dry run with missing args shows usage)**

Run: `cd pipeline && npx tsx run.ts 2>&1 || true`
Expected: Prints usage message and exits (no crash)

- [ ] **Step 3: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat: add run.ts as main SDK-based pipeline entry point"
```

---

## Chunk 3: Update Existing Files

### Task 6: Replace run.sh with thin wrapper

**Files:**
- Modify: `pipeline/run.sh`

- [ ] **Step 1: Replace run.sh content**

Replace the entire 114-line `pipeline/run.sh` with a 3-line wrapper:

```bash
#!/bin/sh
exec npx tsx "$(dirname "$0")/run.ts" "$@"
```

- [ ] **Step 2: Verify wrapper forwards args**

Run: `cd pipeline && bash run.sh 2>&1 || true`
Expected: Shows usage message from `run.ts` (proving args are forwarded)

- [ ] **Step 3: Commit**

```bash
git add pipeline/run.sh
git commit -m "refactor: replace run.sh with thin wrapper forwarding to run.ts"
```

---

### Task 7: Update orchestrator.md

**Files:**
- Modify: `agents/orchestrator.md`

- [ ] **Step 1: Update tools line**

Change line 4 from:
```
tools: Read, Write, Edit, Bash, Grep, Glob, Task
```
To:
```
tools: Read, Write, Edit, Bash, Grep, Glob, Agent
```

- [ ] **Step 2: Remove send-event.sh calls from Phase 2**

In Phase 2 (lines 34-39), remove the block:
```
**Für JEDEN Agent-Spawn (PFLICHT falls `pipeline` in project.json konfiguriert):**

\```
VOR Agent-Start:   bash .pipeline/send-event.sh {N} {agent-type} agent_started
NACH Agent-Ende:   bash .pipeline/send-event.sh {N} {agent-type} completed
\```
```

Replace with:
```
**Agent-Events werden automatisch vom SDK getrackt.** Keine manuellen Event-Calls nötig.
```

- [ ] **Step 3: Update "Spawne Agents" reference**

Change "Spawne Agents via Task-Tool" to "Spawne Agents via Agent-Tool" (line 41).

- [ ] **Step 4: Commit**

```bash
git add agents/orchestrator.md
git commit -m "refactor: update orchestrator to use Agent tool, remove manual event posting"
```

---

### Task 8: Update commands/develop.md

**Files:**
- Modify: `commands/develop.md`

- [ ] **Step 1: Remove send-event.sh from Step 3a**

In Step 3 (line 79-82), remove the block:
```
**3a) Event senden** (sofort, damit das Board den aktiven Agent anzeigt):
\```bash
bash .pipeline/send-event.sh {N} orchestrator agent_started
\```
```

- [ ] **Step 2: Remove send-event.sh from Step 5**

In Step 5 (lines 117-125), remove the block:
```
**Für JEDEN Agent-Spawn (PFLICHT falls Pipeline konfiguriert):**

\```
VOR Agent-Start:   bash .pipeline/send-event.sh {N} {agent-type} agent_started
                   Ausgabe: ▶ [{agent-type}] — {was der Agent macht}

NACH Agent-Ende:   bash .pipeline/send-event.sh {N} {agent-type} completed
                   Ausgabe: ✓ [{agent-type}] abgeschlossen
\```
```

Replace with:
```
**Agent-Events werden automatisch vom SDK getrackt.** Ausgabe weiterhin anzeigen:
- Vor Agent-Start: `▶ [{agent-type}] — {was der Agent macht}`
- Nach Agent-Ende: `✓ [{agent-type}] abgeschlossen`
```

- [ ] **Step 3: Update Task-Tool reference to Agent-Tool**

Replace "Spawne Agents via Task-Tool" with "Spawne Agents via Agent-Tool".

- [ ] **Step 4: Commit**

```bash
git add commands/develop.md
git commit -m "refactor: remove manual event posting from /develop command"
```

---

### Task 9: Update settings.json

**Files:**
- Modify: `settings.json`

- [ ] **Step 1: Remove PostToolUse hook**

Remove the `hooks` block entirely from `settings.json`:

```json
"hooks": {
  "PostToolUse": [
    {
      "matcher": "Edit|Write|Bash|Read|Glob|Grep",
      "command": "sh .claude/scripts/devboard-hook.sh tool_use \"$CLAUDE_TOOL_NAME\" \"$CLAUDE_FILE_PATH\""
    }
  ]
}
```

Result should be:
```json
{
  "permissions": {
    "allow": [
      "Read(**)",
      "Edit(**)",
      "Write(**)",
      "Glob(**)",
      "Grep(**)",
      "Bash(*)",
      "mcp__claude_ai_Supabase__*",
      "mcp__claude_ai_Vercel__*",
      "mcp__claude_ai_n8n__*"
    ]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add settings.json
git commit -m "refactor: remove devboard-hook.sh from settings, SDK hooks replace it"
```

---

### Task 10: Remove obsolete files

**Files:**
- Remove: `pipeline/send-event.sh`
- Remove: `.claude/scripts/devboard-hook.sh`

- [ ] **Step 1: Delete files**

```bash
git rm pipeline/send-event.sh
git rm .claude/scripts/devboard-hook.sh
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove send-event.sh and devboard-hook.sh, replaced by SDK hooks"
```

---

## Chunk 3 Checkpoint

At this point, Stage 1 and Stage 2 from the spec are complete:
- `run.ts` can be invoked locally with `npx tsx .pipeline/run.ts <TICKET_ID> <TITLE>`
- SDK hooks stream events to the Dev Board
- All existing files are updated
- Obsolete shell scripts are removed

**Manual test:** Run the pipeline against a test project with a dummy ticket to verify end-to-end flow. This requires a project with `project.json` and `.claude/agents/` set up.

---

## Chunk 4: Worker + Setup Changes

### Task 11: Implement worker.ts

**Files:**
- Create: `pipeline/worker.ts`

- [ ] **Step 1: Write worker.ts**

Replaces `vps/worker.sh` — polls Supabase for `ready_to_develop` tickets and runs the pipeline.

```typescript
import { resolve } from "node:path";
import { mkdirSync, appendFileSync } from "node:fs";
import { executePipeline } from "./run.ts";

// --- Environment validation ---
const required = [
  "ANTHROPIC_API_KEY",
  "GH_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_PROJECT_ID",
  "PROJECT_DIR",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`ERROR: ${key} must be set`);
    process.exit(1);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID!;
const PROJECT_DIR = process.env.PROJECT_DIR!;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL ?? "60") * 1000;
const LOG_DIR = process.env.LOG_DIR ?? resolve(process.env.HOME ?? "/tmp", "pipeline-logs");
const MAX_FAILURES = Number(process.env.MAX_FAILURES ?? "5");

mkdirSync(LOG_DIR, { recursive: true });

// --- Logging ---
function log(msg: string) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// --- Supabase helpers ---
async function supabaseGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function supabasePatch<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// --- Ticket functions ---
interface Ticket {
  number: number;
  title: string;
  body: string | null;
  priority: string;
  tags: string[] | null;
}

async function checkConnectivity(): Promise<boolean> {
  const result = await supabaseGet("/rest/v1/");
  return result !== null;
}

async function getNextTicket(): Promise<Ticket | null> {
  const tickets = await supabaseGet<Ticket[]>(
    `/rest/v1/tickets?status=eq.ready_to_develop&project_id=eq.${SUPABASE_PROJECT_ID}&pipeline_status=is.null&order=priority.asc,created_at.asc&limit=1&select=number,title,body,priority,tags`
  );
  return tickets?.[0] ?? null;
}

async function claimTicket(number: number): Promise<boolean> {
  const result = await supabasePatch<Ticket[]>(
    `/rest/v1/tickets?number=eq.${number}&pipeline_status=is.null`,
    { pipeline_status: "running", status: "in_progress" }
  );
  return (result?.length ?? 0) > 0;
}

async function failTicket(number: number, reason: string): Promise<void> {
  await supabasePatch(
    `/rest/v1/tickets?number=eq.${number}`,
    { pipeline_status: "failed", status: "ready_to_develop", summary: reason }
  );
}

// --- Pipeline execution (uses run.ts directly, no shell-out) ---
// AbortController for graceful cancellation on shutdown
const abortController = new AbortController();

async function runTicketPipeline(ticket: Ticket): Promise<void> {
  log(`Starting pipeline: T--${ticket.number} — ${ticket.title}`);

  const labels = Array.isArray(ticket.tags) ? ticket.tags.join(",") : "";

  const result = await executePipeline({
    projectDir: PROJECT_DIR,
    ticket: {
      ticketId: String(ticket.number),
      title: ticket.title,
      description: ticket.body ?? "No description provided",
      labels,
    },
    abortSignal: abortController.signal,
  });

  if (result.status === "failed") {
    throw new Error(`Pipeline failed (exit code: ${result.exitCode})`);
  }

  log(`Pipeline completed: T--${ticket.number} → ${result.branch}`);
}

// --- Graceful shutdown ---
let running = true;
process.on("SIGINT", () => {
  log("SIGINT received, cancelling pipeline and stopping...");
  running = false;
  abortController.abort();
});
process.on("SIGTERM", () => {
  log("SIGTERM received, cancelling pipeline and stopping...");
  running = false;
  abortController.abort();
});

// --- Main loop ---
log("==========================================");
log("  Agentic Dev Pipeline Worker (SDK)");
log(`  Project: ${PROJECT_DIR.split("/").pop()}`);
log(`  Supabase-Project: ${SUPABASE_PROJECT_ID}`);
log(`  Poll-Interval: ${POLL_INTERVAL / 1000}s`);
log("==========================================");

let consecutiveFailures = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

while (running) {
  // 1. Connectivity check
  if (!(await checkConnectivity())) {
    log("WARN: Supabase not reachable, waiting...");
    await sleep(POLL_INTERVAL);
    continue;
  }

  // 2. Find next ticket
  const ticket = await getNextTicket();
  if (!ticket) {
    await sleep(POLL_INTERVAL);
    continue;
  }

  log(`Ticket found: T--${ticket.number} — ${ticket.title}`);

  // 3. Atomic claim
  const claimed = await claimTicket(ticket.number);
  if (!claimed) {
    log(`Ticket T--${ticket.number} claimed by another worker. Skip.`);
    await sleep(5000);
    continue;
  }

  log(`Ticket T--${ticket.number} claimed.`);

  // 4. Run pipeline (calls executePipeline from run.ts directly)
  try {
    await runTicketPipeline(ticket);
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures++;
    const reason = error instanceof Error ? error.message : "Unknown error";
    log(`Pipeline failed (${consecutiveFailures}/${MAX_FAILURES} consecutive)`);

    await failTicket(ticket.number, `Pipeline error: ${reason}`);

    if (consecutiveFailures >= MAX_FAILURES) {
      log(`CRITICAL: ${MAX_FAILURES} consecutive failures. Worker stopping.`);
      log(`Check logs: ${LOG_DIR}`);
      process.exit(1);
    }

    // 5-minute cooldown after failure
    log("Waiting 5 minutes after failure...");
    await sleep(300_000);
    continue;
  }

  // Short pause between tickets
  await sleep(5000);
}

log("Worker stopped gracefully.");
```

- [ ] **Step 2: Verify it compiles and validates env vars**

Run: `cd pipeline && npx tsx worker.ts 2>&1 || true`
Expected: Prints `ERROR: ANTHROPIC_API_KEY must be set` and exits

- [ ] **Step 3: Commit**

```bash
git add pipeline/worker.ts
git commit -m "feat: add worker.ts as TypeScript replacement for vps/worker.sh"
```

---

### Task 12: Update setup.sh

**Files:**
- Modify: `setup.sh`

- [ ] **Step 1: Add npm install step to update mode**

After the "Updating pipeline..." section (around line 315-320), add npm install:

Replace the current pipeline update block:
```bash
echo "Updating pipeline..."
cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
cp "$FRAMEWORK_DIR/pipeline/send-event.sh" "$PROJECT_DIR/.pipeline/send-event.sh"
chmod +x "$PROJECT_DIR/.pipeline/"*.sh
echo "  ✓ .pipeline/run.sh"
echo "  ✓ .pipeline/send-event.sh"
```

With:
```bash
echo "Updating pipeline..."
# Copy all pipeline files
cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
cp "$FRAMEWORK_DIR/pipeline/run.ts" "$PROJECT_DIR/.pipeline/run.ts"
cp "$FRAMEWORK_DIR/pipeline/worker.ts" "$PROJECT_DIR/.pipeline/worker.ts"
cp "$FRAMEWORK_DIR/pipeline/package.json" "$PROJECT_DIR/.pipeline/package.json"
cp "$FRAMEWORK_DIR/pipeline/tsconfig.json" "$PROJECT_DIR/.pipeline/tsconfig.json"
mkdir -p "$PROJECT_DIR/.pipeline/lib"
cp "$FRAMEWORK_DIR/pipeline/lib/"*.ts "$PROJECT_DIR/.pipeline/lib/"
chmod +x "$PROJECT_DIR/.pipeline/"*.sh 2>/dev/null || true
# Cleanup removed files
rm -f "$PROJECT_DIR/.pipeline/send-event.sh"
rm -f "$PROJECT_DIR/.claude/scripts/devboard-hook.sh"
# Install dependencies
if [ -f "$PROJECT_DIR/.pipeline/package.json" ]; then
  echo "  Installing pipeline dependencies..."
  (cd "$PROJECT_DIR/.pipeline" && npm install --production 2>/dev/null)
fi
echo "  ✓ .pipeline/ (SDK pipeline)"
```

- [ ] **Step 2: Update the diff_file checks in update mode**

Replace the pipeline diff section (around line 198-199):
```bash
diff_file "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh" ".pipeline/run.sh"
diff_file "$FRAMEWORK_DIR/pipeline/send-event.sh" "$PROJECT_DIR/.pipeline/send-event.sh" ".pipeline/send-event.sh"
```

With:
```bash
diff_file "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh" ".pipeline/run.sh"
diff_file "$FRAMEWORK_DIR/pipeline/run.ts" "$PROJECT_DIR/.pipeline/run.ts" ".pipeline/run.ts"
diff_file "$FRAMEWORK_DIR/pipeline/worker.ts" "$PROJECT_DIR/.pipeline/worker.ts" ".pipeline/worker.ts"
diff_file "$FRAMEWORK_DIR/pipeline/package.json" "$PROJECT_DIR/.pipeline/package.json" ".pipeline/package.json"
for f in "$FRAMEWORK_DIR/pipeline/lib/"*.ts; do
  fname=$(basename "$f")
  diff_file "$f" "$PROJECT_DIR/.pipeline/lib/$fname" ".pipeline/lib/$fname"
done
# Check for removed files
if [ -f "$PROJECT_DIR/.pipeline/send-event.sh" ]; then
  echo "  - .pipeline/send-event.sh (replaced by SDK hooks)"
  CHANGES=$((CHANGES + 1))
fi
if [ -f "$PROJECT_DIR/.claude/scripts/devboard-hook.sh" ]; then
  echo "  - .claude/scripts/devboard-hook.sh (replaced by SDK hooks)"
  CHANGES=$((CHANGES + 1))
fi
```

- [ ] **Step 3: Update setup mode (initial install)**

Replace the pipeline install section (around line 410-416):
```bash
echo "Installing pipeline..."
mkdir -p "$PROJECT_DIR/.pipeline"
cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
cp "$FRAMEWORK_DIR/pipeline/send-event.sh" "$PROJECT_DIR/.pipeline/send-event.sh"
chmod +x "$PROJECT_DIR/.pipeline/"*.sh
echo "  ✓ .pipeline/run.sh"
echo "  ✓ .pipeline/send-event.sh"
```

With:
```bash
echo "Installing pipeline..."
mkdir -p "$PROJECT_DIR/.pipeline/lib"
cp "$FRAMEWORK_DIR/pipeline/run.sh" "$PROJECT_DIR/.pipeline/run.sh"
cp "$FRAMEWORK_DIR/pipeline/run.ts" "$PROJECT_DIR/.pipeline/run.ts"
cp "$FRAMEWORK_DIR/pipeline/worker.ts" "$PROJECT_DIR/.pipeline/worker.ts"
cp "$FRAMEWORK_DIR/pipeline/package.json" "$PROJECT_DIR/.pipeline/package.json"
cp "$FRAMEWORK_DIR/pipeline/tsconfig.json" "$PROJECT_DIR/.pipeline/tsconfig.json"
cp "$FRAMEWORK_DIR/pipeline/lib/"*.ts "$PROJECT_DIR/.pipeline/lib/"
chmod +x "$PROJECT_DIR/.pipeline/"*.sh 2>/dev/null || true
echo "  Installing pipeline dependencies..."
(cd "$PROJECT_DIR/.pipeline" && npm install --production 2>/dev/null)
echo "  ✓ .pipeline/ (SDK pipeline)"
```

- [ ] **Step 4: Update prerequisites check**

Replace the python3 optional line (around line 111):
```bash
check_prereq "python3" || echo "  ~ python3 optional (config parsing in run.sh)"
```

With:
```bash
check_prereq "node" || MISSING=1
```

Node.js is now required (not optional). Python3 is no longer needed.

- [ ] **Step 5: Commit**

```bash
git add setup.sh
git commit -m "feat: update setup.sh for SDK pipeline (npm install, cleanup, node prereq)"
```

---

### Task 13: Update VPS systemd service

**Files:**
- Modify: `vps/agentic-dev-pipeline@.service`

- [ ] **Step 1: Read current service file**

Read `vps/agentic-dev-pipeline@.service`.

- [ ] **Step 2: Update ExecStart**

Change the `ExecStart` line to use the TypeScript worker:

```ini
ExecStart=/usr/bin/npx tsx /home/claude-dev/%i/.pipeline/worker.ts
```

- [ ] **Step 3: Remove vps/worker.sh**

```bash
git rm vps/worker.sh
```

- [ ] **Step 4: Commit**

```bash
git add vps/
git commit -m "feat: update systemd service for TypeScript worker, remove worker.sh"
```

---

## Chunk 4 Checkpoint

At this point, all three stages from the spec are complete:
- Stage 1: `run.ts` + hooks (Tasks 1-5)
- Stage 2: Updated existing files (Tasks 6-10)
- Stage 3: Worker + VPS + setup (Tasks 11-13)

**End-to-end test checklist:**
1. `npx tsx .pipeline/run.ts 999 "Test ticket" "Test description" "test"` creates branch and runs orchestrator
2. Events appear in Dev Board (if configured)
3. `setup.sh --update` copies all new files and runs `npm install`
4. `setup.sh` (fresh install) sets up everything including pipeline dependencies
5. `npx tsx .pipeline/worker.ts` validates env vars and starts polling
