# Just Ship VPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push-based pipeline server on a Docker VPS — Board triggers pipeline via HTTPS, server runs Claude Agent SDK, creates PRs.

**Architecture:** Multi-project HTTP server behind Caddy reverse proxy in Docker. Server loads `server-config.json` for project routing, authenticates via `X-Pipeline-Key`, runs one pipeline at a time. Local Claude Code sets up VPS remotely via SSH.

**Tech Stack:** Node.js 20, Docker, Caddy, Claude Agent SDK, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-22-just-ship-vps-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `pipeline/lib/server-config.ts` | **Create** | Load & parse `server-config.json`, parse per-project `.env` files |
| `pipeline/run.ts` | **Modify** | Add `env` field to `PipelineOptions`, pass to `query()` |
| `pipeline/server.ts` | **Modify** | Multi-project routing, server-config mode, 429 concurrency gating |
| `vps/Dockerfile` | **Create** | Docker image: Node.js 20, git, gh, Claude Code |
| `vps/entrypoint.sh` | **Create** | Container startup: git config, gh auth |
| `vps/docker-compose.yml` | **Create** | Caddy + pipeline-server containers |
| `vps/Caddyfile.template` | **Create** | Template with `{{DOMAIN}}` placeholder |
| `commands/just-ship-vps.md` | **Create** | Slash command definition |
| `vps/setup-vps.sh` | **Modify** | Add deprecation notice at top |
| `vps/README.md` | **Rewrite** | Docker/Caddy architecture docs |

---

### Task 1: Server Config Module

**Files:**
- Create: `pipeline/lib/server-config.ts`

This module loads and parses `server-config.json` and per-project `.env` files. It's used by the refactored `server.ts` in multi-project mode.

- [ ] **Step 1: Create `server-config.ts` with interfaces and loader**

```typescript
// pipeline/lib/server-config.ts
import { readFileSync, existsSync } from "node:fs";

export interface ServerProjectEntry {
  project_id: string;
  repo_url: string;
  project_dir: string;
  env_file: string;
}

export interface ServerConfig {
  server: {
    port: number;
    pipeline_key: string;
  };
  workspace: {
    workspace_id: string;
    board_url: string;
    api_key: string;
  };
  projects: Record<string, ServerProjectEntry>;
}

export function loadServerConfig(configPath: string): ServerConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Server config not found: ${configPath}`);
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));

  if (!raw.server?.pipeline_key) throw new Error("server.pipeline_key is required");
  if (!raw.workspace?.api_key) throw new Error("workspace.api_key is required");
  if (!raw.projects || Object.keys(raw.projects).length === 0) {
    throw new Error("At least one project must be configured");
  }

  return raw as ServerConfig;
}

export function findProjectByProjectId(
  config: ServerConfig,
  projectId: string,
): { slug: string; project: ServerProjectEntry } | null {
  for (const [slug, project] of Object.entries(config.projects)) {
    if (project.project_id === projectId) {
      return { slug, project };
    }
  }
  return null;
}

export function loadProjectEnv(envFilePath: string): Record<string, string> {
  if (!existsSync(envFilePath)) return {};
  const content = readFileSync(envFilePath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}
```

- [ ] **Step 2: Verify module compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsc --noEmit pipeline/lib/server-config.ts 2>&1 || echo "Check imports"`

Expected: No errors (or only import-related since it's a standalone module)

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/server-config.ts
git commit -m "feat: add server-config module for multi-project VPS server"
```

---

### Task 2: Add `env` to PipelineOptions and ResumeOptions

**Files:**
- Modify: `pipeline/run.ts:11-18` (PipelineOptions interface)
- Modify: `pipeline/run.ts:258-262` (executePipeline query() env block)
- Modify: `pipeline/run.ts:343-352` (ResumeOptions interface)
- Modify: `pipeline/run.ts:442-446` (resumePipeline query() env block)

The pipeline runner needs to accept per-project env vars and **merge** them with the existing ticket-related env vars in the `query()` call. The SDK `env` option passes specific key-value pairs — it is NOT a process env replacement.

- [ ] **Step 1: Add `env` field to `PipelineOptions`**

In `pipeline/run.ts`, add `env` to the PipelineOptions interface (line 17):

```typescript
export interface PipelineOptions {
  projectDir: string;
  workDir?: string;
  branchName?: string;
  ticket: TicketArgs;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  env?: Record<string, string>;  // Per-project env vars injected by server
}
```

- [ ] **Step 2: Add `env` field to `ResumeOptions`**

In `pipeline/run.ts`, add `env` to the ResumeOptions interface (line 351):

```typescript
export interface ResumeOptions {
  projectDir: string;
  workDir?: string;
  branchName?: string;
  ticket: TicketArgs;
  sessionId: string;
  answer: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  env?: Record<string, string>;  // Per-project env vars injected by server
}
```

- [ ] **Step 3: Merge env into `executePipeline` query() call**

In `pipeline/run.ts` at lines 258-262, the current `env` block in the `query()` call is:

```typescript
env: {
  TICKET_NUMBER: ticket.ticketId,
  BOARD_API_URL: config.pipeline.apiUrl,
  PIPELINE_KEY: config.pipeline.apiKey,
},
```

Replace with merged env that spreads per-project vars first, then ticket vars (ticket vars take precedence):

```typescript
env: {
  ...(opts.env ?? {}),
  TICKET_NUMBER: ticket.ticketId,
  BOARD_API_URL: config.pipeline.apiUrl,
  PIPELINE_KEY: config.pipeline.apiKey,
},
```

- [ ] **Step 4: Merge env into `resumePipeline` query() call**

Same change in `pipeline/run.ts` at lines 442-446:

```typescript
env: {
  ...(opts.env ?? {}),
  TICKET_NUMBER: ticket.ticketId,
  BOARD_API_URL: config.pipeline.apiUrl,
  PIPELINE_KEY: config.pipeline.apiKey,
},
```

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsc --noEmit pipeline/run.ts 2>&1 | head -20`

Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat: add env parameter to PipelineOptions for per-project env injection"
```

---

### Task 3: Refactor server.ts for Multi-Project Mode

**Files:**
- Modify: `pipeline/server.ts` (major refactor)

This is the core change. The server needs to support two modes:
1. **Legacy mode** (PROJECT_DIR set): Current single-project behavior, unchanged
2. **Multi-project mode** (SERVER_CONFIG_PATH set): Loads `server-config.json`, routes by `project_id`

This keeps backward compatibility while adding the new VPS functionality.

- [ ] **Step 1: Add server-config imports and dual-mode detection**

At the top of `pipeline/server.ts`, after existing imports (line 5), add:

```typescript
import {
  loadServerConfig,
  findProjectByProjectId,
  loadProjectEnv,
  type ServerConfig,
} from "./lib/server-config.ts";
```

Replace the environment validation block (lines 7-29) with dual-mode detection:

```typescript
// --- Mode detection ---
const SERVER_CONFIG_PATH = process.env.SERVER_CONFIG_PATH;
const isMultiProjectMode = !!SERVER_CONFIG_PATH;

let serverConfig: ServerConfig | null = null;
let PROJECT_DIR: string;
let PIPELINE_SERVER_KEY: string;
let config: ProjectConfig;

// Multi-project mode: NO global WorktreeManager — runs one pipeline at a time
// directly in each project's own directory. Legacy mode keeps WorktreeManager.
let worktreeManager: WorktreeManager | null = null;

if (isMultiProjectMode) {
  // Multi-project mode: load server-config.json
  serverConfig = loadServerConfig(SERVER_CONFIG_PATH);
  PIPELINE_SERVER_KEY = serverConfig.server.pipeline_key;

  // Load first project's config as default (for conventions, etc.)
  const firstSlug = Object.keys(serverConfig.projects)[0];
  PROJECT_DIR = serverConfig.projects[firstSlug].project_dir;
  config = loadProjectConfig(PROJECT_DIR);
  // No worktreeManager in multi-project mode — single concurrency, work in project dir
} else {
  // Legacy single-project mode
  const required = ["ANTHROPIC_API_KEY", "GH_TOKEN", "PROJECT_DIR", "PIPELINE_SERVER_KEY"] as const;
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`ERROR: ${key} must be set`);
      process.exit(1);
    }
  }
  PROJECT_DIR = process.env.PROJECT_DIR!;
  PIPELINE_SERVER_KEY = process.env.PIPELINE_SERVER_KEY!;
  config = loadProjectConfig(PROJECT_DIR);
  worktreeManager = new WorktreeManager(PROJECT_DIR, config.maxWorkers);
}

const PORT = Number(process.env.PORT ?? serverConfig?.server.port ?? "3001");
const MAX_WORKERS = worktreeManager ? config.maxWorkers : 1;
```

- [ ] **Step 2: Add pipeline state tracking**

After the mode detection, replace the `runningTickets` Set with a richer state:

```typescript
// --- Pipeline state ---
interface PipelineState {
  running: {
    ticketNumber: number;
    projectSlug: string;
    startedAt: Date;
  } | null;
}

const pipelineState: PipelineState = { running: null };
const runningTickets = new Set<number>(); // Keep for backward compat in legacy mode
```

- [ ] **Step 3: Add multi-project Board API helpers**

Add new helper functions that use server-config workspace credentials instead of project-level ones. Keep old ones for legacy mode:

```typescript
// --- Board API helpers (multi-project mode) ---
function getApiCredentials(projectSlug?: string): { apiUrl: string; apiKey: string } {
  if (serverConfig) {
    return {
      apiUrl: serverConfig.workspace.board_url,
      apiKey: serverConfig.workspace.api_key,
    };
  }
  return {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
  };
}
```

Then update `fetchTicket` and `patchTicket` to use `getApiCredentials()` instead of hardcoded `config.pipeline.*`:

```typescript
async function fetchTicket(ticketNumber: number): Promise<Record<string, unknown> | null> {
  const { apiUrl, apiKey } = getApiCredentials();
  try {
    const res = await fetch(`${apiUrl}/api/tickets/${ticketNumber}`, {
      headers: { "X-Pipeline-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Record<string, unknown> };
    return json.data ?? null;
  } catch { return null; }
}
```

Same pattern for `patchTicket`.

- [ ] **Step 4: Refactor handleLaunch for multi-project routing**

Modify `handleLaunch` signature to accept optional `projectId`:

```typescript
async function handleLaunch(
  ticketNumber: number,
  res: ServerResponse,
  projectId?: string,
): Promise<void> {
```

At the top of `handleLaunch`, after the existing in-memory guard, add multi-project concurrency check:

```typescript
  // Multi-project mode: only one pipeline at a time
  if (isMultiProjectMode && pipelineState.running) {
    sendJson(res, 429, {
      status: "busy",
      message: "Pipeline busy",
      running_ticket: pipelineState.running.ticketNumber,
    });
    return;
  }

  // Multi-project mode: resolve project
  let resolvedProjectDir = PROJECT_DIR;
  let resolvedProjectSlug = "default";
  let projectEnv: Record<string, string> = {};
  let projectConfig = config;

  if (isMultiProjectMode && serverConfig) {
    if (!projectId) {
      sendJson(res, 400, { status: "bad_request", message: "project_id is required in multi-project mode" });
      return;
    }
    const match = findProjectByProjectId(serverConfig, projectId);
    if (!match) {
      sendJson(res, 404, { status: "error", message: `Project not found for project_id: ${projectId}` });
      return;
    }
    resolvedProjectDir = match.project.project_dir;
    resolvedProjectSlug = match.slug;
    projectEnv = loadProjectEnv(match.project.env_file);
    projectConfig = loadProjectConfig(resolvedProjectDir);
  }
```

Then update the pipeline execution block. In multi-project mode, skip WorktreeManager and work directly in the project directory. In legacy mode, keep current worktree behavior:

```typescript
  // Use projectConfig (resolved) for branch prefix, not global config
  const branchSlug = title.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
  const branchName = `${projectConfig.conventions.branch_prefix}${ticketNumber}-${branchSlug}`;

  // Pipeline state tracking
  if (isMultiProjectMode) {
    pipelineState.running = {
      ticketNumber,
      projectSlug: resolvedProjectSlug,
      startedAt: new Date(),
    };
  }

  (async () => {
    let slotId: number | undefined;
    try {
      let workDir: string;

      if (isMultiProjectMode) {
        // Multi-project: work directly in project dir (no worktree)
        workDir = resolvedProjectDir;
      } else {
        // Legacy: use worktree manager
        const slot = await worktreeManager!.allocate(branchName);
        slotId = slot.slotId;
        workDir = slot.workDir;
      }

      const result = await executePipeline({
        projectDir: resolvedProjectDir,
        workDir: isMultiProjectMode ? undefined : workDir, // undefined = CLI mode (git checkout in run.ts)
        branchName,
        ticket: { ticketId: String(ticketNumber), title, description: body, labels: tags },
        env: Object.keys(projectEnv).length > 0 ? projectEnv : undefined,
      });

      // ... handle result (completed/paused/failed) — same as current code
      // but use projectConfig.pipeline.projectId instead of config.pipeline.projectId
      // in the patchTicket calls
```

**Important:** Update the atomic claim PATCH (line 133 in current code) to use `projectConfig.pipeline.projectId` instead of `config.pipeline.projectId`:

```typescript
  const claimed = await patchTicket(ticketNumber, {
    status: "in_progress",
    pipeline_status: "running",
    project_id: projectConfig.pipeline.projectId,  // NOT config.pipeline.projectId
  });
```

In the `finally` block:

```typescript
    } finally {
      if (slotId !== undefined) await worktreeManager!.release(slotId);
      runningTickets.delete(ticketNumber);
      if (isMultiProjectMode) pipelineState.running = null;
    }
```

- [ ] **Step 5: Refactor handleShip for multi-project mode**

`handleShip` (lines 201-278) hardcodes `PROJECT_DIR` as `cwd` for `gh pr merge`. In multi-project mode, we need to resolve the project dir from the ticket.

Modify `handleShip` to accept optional `projectId` and resolve project dir:

```typescript
async function handleShip(ticketNumber: number, res: ServerResponse, projectId?: string): Promise<void> {
  // ... existing ticket fetch + validation ...

  // Resolve project dir for gh commands
  let shipProjectDir = PROJECT_DIR;
  if (isMultiProjectMode && serverConfig && projectId) {
    const match = findProjectByProjectId(serverConfig, projectId);
    if (match) shipProjectDir = match.project.project_dir;
  }

  // ... in execSync calls, replace PROJECT_DIR with shipProjectDir:
  const prListOutput = execSync(
    `gh pr list --head "${branch}" --json number --jq '.[0].number'`,
    { cwd: shipProjectDir, encoding: "utf-8", timeout: 30000 }
  ).trim();

  execSync(
    `gh pr merge ${prNumber} --squash --delete-branch`,
    { cwd: shipProjectDir, encoding: "utf-8", timeout: 60000 }
  );
```

Update the `/api/ship` handler to extract `project_id` from request body and pass to `handleShip`:

```typescript
  const projectId = body.project_id as string | undefined;
  await handleShip(ticketNumber, res, projectId);
```

- [ ] **Step 6: Refactor /api/answer handler for multi-project mode**

The `/api/answer` handler (lines 369-479) also hardcodes `PROJECT_DIR` and `config`. Add project resolution similar to `handleLaunch`:

1. Extract `project_id` from request body
2. Resolve project dir and env from server config
3. Pass `env` to `resumePipeline` call
4. Use resolved project dir for worktree/branch operations

```typescript
  // After extracting ticket and sessionId:
  let answerProjectDir = PROJECT_DIR;
  let answerProjectEnv: Record<string, string> = {};
  let answerProjectConfig = config;

  if (isMultiProjectMode && serverConfig) {
    const projectId = body.project_id as string | undefined;
    if (projectId) {
      const match = findProjectByProjectId(serverConfig, projectId);
      if (match) {
        answerProjectDir = match.project.project_dir;
        answerProjectEnv = loadProjectEnv(match.project.env_file);
        answerProjectConfig = loadProjectConfig(answerProjectDir);
      }
    }
  }

  // Update resumePipeline call:
  const result = await resumePipeline({
    projectDir: answerProjectDir,
    workDir: isMultiProjectMode ? undefined : slot.workDir,
    branchName,
    ticket: { ... },
    sessionId,
    answer: answer.trim(),
    env: Object.keys(answerProjectEnv).length > 0 ? answerProjectEnv : undefined,
  });
```

- [ ] **Step 7: Add GET /api/status/:ticket endpoint**

Add route matching before the 404 fallback:

```typescript
  // GET /api/status/:ticket
  const statusMatch = method === "GET" && url.match(/^\/api\/status\/(\d+)$/);
  if (statusMatch) {
    const ticketNumber = Number(statusMatch[1]);

    if (isMultiProjectMode && pipelineState.running?.ticketNumber === ticketNumber) {
      sendJson(res, 200, {
        ticket_number: ticketNumber,
        status: "running",
        project: pipelineState.running.projectSlug,
        started_at: pipelineState.running.startedAt.toISOString(),
      });
    } else if (runningTickets.has(ticketNumber)) {
      sendJson(res, 200, { ticket_number: ticketNumber, status: "running" });
    } else {
      sendJson(res, 200, { ticket_number: ticketNumber, status: "idle" });
    }
    return;
  }
```

- [ ] **Step 8: Update /api/launch and /api/events to pass project_id**

In the request handler for `/api/launch` (around line 315), extract `project_id` from the body and pass to `handleLaunch`:

```typescript
  const projectId = body.project_id as string | undefined;
  await handleLaunch(ticketNumber, res, projectId);
```

Same for `/api/events` handler — extract `project_id` from body and pass to `handleLaunch`.

- [ ] **Step 9: Update /health endpoint**

Replace the health response with the new format:

```typescript
  if (method === "GET" && url === "/health") {
    if (isMultiProjectMode) {
      sendJson(res, 200, {
        status: "ok",
        mode: "multi-project",
        running: pipelineState.running ? {
          ticket_number: pipelineState.running.ticketNumber,
          project: pipelineState.running.projectSlug,
          started_at: pipelineState.running.startedAt.toISOString(),
        } : null,
      });
    } else {
      sendJson(res, 200, {
        status: "ok",
        mode: "single-project",
        running_count: runningTickets.size,
        active_slots: worktreeManager.getActiveSlots(),
        max_workers: config.maxWorkers,
      });
    }
    return;
  }
```

- [ ] **Step 10: Update startup log**

```typescript
server.listen(PORT, () => {
  log("==========================================");
  log("  Just Ship Pipeline Server");
  log(`  Port: ${PORT}`);
  if (isMultiProjectMode && serverConfig) {
    log(`  Mode: multi-project`);
    log(`  Projects: ${Object.keys(serverConfig.projects).join(", ")}`);
  } else {
    log(`  Mode: single-project`);
    log(`  Project: ${PROJECT_DIR.split("/").pop()}`);
  }
  log("==========================================");
});
```

- [ ] **Step 11: Verify compilation**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsc --noEmit pipeline/server.ts 2>&1 | head -30`

Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add pipeline/server.ts
git commit -m "feat: add multi-project mode to pipeline server for VPS deployment"
```

---

### Task 4: Docker Infrastructure

**Files:**
- Create: `vps/Dockerfile`
- Create: `vps/entrypoint.sh`
- Create: `vps/docker-compose.yml`
- Create: `vps/Caddyfile.template`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
# vps/Dockerfile
FROM node:20-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    git curl jq unzip build-essential openssh-client \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code tsx

# Pipeline SDK
COPY pipeline/ /app/pipeline/
COPY package.json /app/package.json
RUN cd /app && npm install --production 2>/dev/null || true

WORKDIR /app

# Entrypoint: configure git + gh auth, then start server
COPY vps/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["npx", "tsx", "pipeline/server.ts"]
```

- [ ] **Step 2: Create entrypoint.sh**

```bash
#!/bin/bash
set -e

# Configure git identity
git config --global user.name "Claude Dev"
git config --global user.email "claude-dev@pipeline"
git config --global init.defaultBranch main

# Authenticate GitHub CLI with GH_TOKEN (from env)
if [ -n "$GH_TOKEN" ]; then
  echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null
  gh auth setup-git
fi

# Execute CMD
exec "$@"
```

- [ ] **Step 3: Create docker-compose.yml**

```yaml
# vps/docker-compose.yml
# Start from vps/ directory: docker compose up -d
# Or from repo root: docker compose -f vps/docker-compose.yml up -d

services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - pipeline-server

  pipeline-server:
    build:
      context: ..
      dockerfile: vps/Dockerfile
    restart: unless-stopped
    expose:
      - "3001"
    volumes:
      - /home/claude-dev/projects:/home/claude-dev/projects
      - /home/claude-dev/.just-ship:/home/claude-dev/.just-ship
    env_file:
      - /home/claude-dev/.env
    environment:
      - SERVER_CONFIG_PATH=/home/claude-dev/.just-ship/server-config.json

volumes:
  caddy_data:
  caddy_config:
```

- [ ] **Step 4: Create Caddyfile template**

```
# vps/Caddyfile.template
# Replace {{DOMAIN}} with actual domain during setup
# e.g.: dev.example.com
{{DOMAIN}} {
    reverse_proxy pipeline-server:3001
}
```

- [ ] **Step 5: Commit**

```bash
git add vps/Dockerfile vps/entrypoint.sh vps/docker-compose.yml vps/Caddyfile.template
git commit -m "feat: add Docker infrastructure for VPS deployment"
```

---

### Task 5: `/just-ship-vps` Command

**Files:**
- Create: `commands/just-ship-vps.md`

- [ ] **Step 1: Create command definition**

Read existing commands for style reference: `commands/just-ship-update.md`, `commands/connect-board.md`

Write `commands/just-ship-vps.md` — the slash command that guides VPS setup from local Claude Code via SSH. The command should:

1. Tell the user exactly what 4 things are needed (with step-by-step instructions for each)
2. Collect the inputs
3. SSH into the VPS and perform all setup steps autonomously
4. Verify with a health check
5. Offer to connect the first project

Reference the spec `docs/superpowers/specs/2026-03-22-just-ship-vps-design.md` sections "Phase 1" and "Phase 2" for the exact steps.

The command language should be German (per CLAUDE.md convention: "Commands und Agent-Definitionen auf Deutsch").

- [ ] **Step 2: Symlink to .claude/commands/**

Check if commands are symlinked:

```bash
ls -la .claude/commands/ | head -5
```

If symlinked, no action needed. If not, create symlink.

- [ ] **Step 3: Commit**

```bash
git add commands/just-ship-vps.md
git commit -m "feat: add /just-ship-vps command for autonomous VPS setup"
```

---

### Task 6: Deprecation & Documentation

**Files:**
- Modify: `vps/setup-vps.sh` (add deprecation notice)
- Rewrite: `vps/README.md`

- [ ] **Step 1: Add deprecation notice to setup-vps.sh**

Add at the very top of `vps/setup-vps.sh` (after the shebang line):

```bash
echo ""
echo "⚠️  DEPRECATED: This script is replaced by the Docker-based setup."
echo "   Use '/just-ship-vps' in Claude Code for the new setup flow."
echo "   See vps/README.md for details."
echo ""
read -p "Continue anyway? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  exit 0
fi
```

- [ ] **Step 2: Rewrite README.md**

Rewrite `vps/README.md` to document:
- New Docker/Caddy architecture
- Prerequisites (4 items)
- Setup flow (via `/just-ship-vps` command)
- Manual setup steps (for reference)
- docker-compose.yml usage
- Project connection
- Update strategy
- Troubleshooting

Keep it concise. Reference the spec for details.

- [ ] **Step 3: Commit**

```bash
git add vps/setup-vps.sh vps/README.md
git commit -m "docs: update VPS docs for Docker architecture, deprecate setup-vps.sh"
```

---

### Task 7: Integration Verification

- [ ] **Step 1: Verify all files compile**

```bash
cd /Users/yschleich/Developer/just-ship
npx tsc --noEmit pipeline/server.ts pipeline/run.ts pipeline/lib/server-config.ts 2>&1 | head -30
```

Expected: No errors

- [ ] **Step 2: Verify Docker build**

```bash
cd /Users/yschleich/Developer/just-ship
docker build -f vps/Dockerfile -t just-ship-pipeline . 2>&1 | tail -10
```

Expected: Successfully built

- [ ] **Step 3: Verify legacy mode still works**

```bash
# server.ts should still work with PROJECT_DIR env var (no SERVER_CONFIG_PATH)
PROJECT_DIR=/tmp PIPELINE_SERVER_KEY=test ANTHROPIC_API_KEY=test GH_TOKEN=test \
  timeout 3 npx tsx pipeline/server.ts 2>&1 || true
```

Expected: Server starts, prints "single-project" mode, then times out

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration fixes for VPS multi-project server"
```
