# P0 — Shopify Skills & Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Shopify-aware pipeline execution — skills loaded per project, agents filtered by role, verification commands in QA, token usage tracked in events.

**Architecture:** Extend `ProjectConfig` with platform/skills/skip_agents fields. New `load-skills.ts` module reads project config and maps skills to agent roles. Pipeline injects skills into agent system prompts. Event hooks extended with token usage fields. Verification commands run in QA phase.

**Tech Stack:** TypeScript (pipeline SDK), Supabase (DB migration), Claude Agent SDK hooks

**Spec:** `docs/specs/p0-shopify-skills.md`

**Scope note:** This plan covers the `just-ship` repo only (T-1, T-2, T-3, T-5, T-6 from the spec). The Sidekick Shopify-Kontext (T-4) lives in `just-ship-board` and needs a separate plan.

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `pipeline/lib/load-skills.ts` | Read project config, resolve skill files, filter by agent role |
| `pipeline/lib/cost.ts` | Token cost estimation per model |

### Modified Files

| File | Changes |
|---|---|
| `pipeline/lib/config.ts` | Extend `ProjectConfig` with platform, variant, skills, skipAgents, verifyCommand |
| `pipeline/lib/event-hooks.ts` | Add input_tokens, output_tokens, model, estimated_cost_usd to events |
| `pipeline/run.ts` | Call loadSkills(), inject into agents, skip agents per config, run verify command |
| `templates/project.json` | Add new fields with documented examples |

### Reference Files (read-only)

| File | Why |
|---|---|
| `pipeline/lib/load-agents.ts` | Pattern for loading markdown files with frontmatter |
| `skills/shopify-liquid.md` | Example skill format |
| `agents/orchestrator.md` | Agent definition format |
| `docs/specs/p0-shopify-skills.md` | Full spec with acceptance criteria |

---

## Task 1: Extend project.json Schema

**Files:**
- Modify: `pipeline/lib/config.ts:22-30` (ProjectConfig interface)
- Modify: `pipeline/lib/config.ts:73-187` (loadProjectConfig function)
- Modify: `templates/project.json`

- [ ] **Step 1: Extend ProjectConfig interface**

In `pipeline/lib/config.ts`, update the interface:

```typescript
export interface ProjectConfig {
  name: string;
  description: string;
  conventions: { branch_prefix: string };
  pipeline: PipelineConfig & {
    skipAgents?: string[];
  };
  maxWorkers: number;
  qa: QaConfig;
  stack: {
    packageManager: string;
    buildCommand?: string;
    testCommand?: string;
    verifyCommand?: string;
    platform?: string;
    variant?: string;
  };
  skills?: {
    domain?: string[];
    custom?: string[];
  };
}
```

- [ ] **Step 2: Update loadProjectConfig to read new fields**

In `pipeline/lib/config.ts`, extend the return object (around line 174-186):

```typescript
return {
  name: raw.name ?? "project",
  description: raw.description ?? "",
  conventions: { branch_prefix: raw.conventions?.branch_prefix ?? "feature/" },
  pipeline: {
    ...pipeline,
    skipAgents: (rawPipeline.skip_agents as string[]) ?? [],
  },
  maxWorkers: Number(rawPipeline.max_workers ?? 1),
  qa,
  stack: {
    packageManager: raw.stack?.package_manager ?? "npm",
    buildCommand: raw.build?.web as string | undefined,
    testCommand: raw.build?.test as string | undefined,
    verifyCommand: raw.build?.verify as string | undefined,
    platform: raw.stack?.platform as string | undefined,
    variant: raw.stack?.variant as string | undefined,
  },
  skills: raw.skills as { domain?: string[]; custom?: string[] } | undefined,
};
```

- [ ] **Step 3: Update templates/project.json**

**Important:** Do NOT replace the entire file. Only ADD the new fields to the existing template. The template has existing fields (`stack.language`, `stack.framework`, `hosting`, `shopify`, `paths`, `supabase`, etc.) that must be preserved.

Add these fields to the existing template:

- `stack.platform` (empty string, after `stack.package_manager`)
- `stack.variant` (empty string, after `stack.platform`)
- `build.verify` (empty string, after `build.test`)
- `skills` object with `domain: []` and `custom: []` (new top-level key)
- `pipeline.skip_agents` (empty array, after `pipeline.workspace_id`)

Use the Edit tool to add fields, not Write to replace the whole file.

- [ ] **Step 4: Verify existing project.json still loads correctly**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsx -e "const {loadProjectConfig} = require('./pipeline/lib/config'); const c = loadProjectConfig('.'); console.log(JSON.stringify(c.stack, null, 2)); console.log('skipAgents:', c.pipeline.skipAgents); console.log('skills:', c.skills);"`

Expected: Current project.json loads without errors. New fields show as undefined/empty (backward-compatible).

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/config.ts templates/project.json
git commit -m "feat: extend project.json schema with platform, skills, skip_agents"
```

---

## Task 2: Skill Loader

**Files:**
- Create: `pipeline/lib/load-skills.ts`
- Modify: `pipeline/run.ts` (import and call loadSkills)

- [ ] **Step 1: Create load-skills.ts**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectConfig } from "./config.js";

/** Agent roles that can receive skills */
export type AgentRole =
  | "orchestrator"
  | "frontend"
  | "backend"
  | "data-engineer"
  | "qa"
  | "devops"
  | "security"
  | "triage";

/** Which skills each agent role receives */
const SKILL_AGENT_MAP: Record<string, AgentRole[]> = {
  "shopify-liquid":         ["frontend", "orchestrator"],
  "shopify-theme":          ["frontend", "qa", "devops", "orchestrator"],
  "shopify-metafields":     ["data-engineer", "backend", "orchestrator"],
  "shopify-storefront-api": ["backend", "frontend", "orchestrator"],
  "shopify-hydrogen":       ["frontend", "backend", "orchestrator"],
  "shopify-admin-api":      ["backend", "data-engineer", "orchestrator"],
  "shopify-checkout":       ["frontend", "backend", "orchestrator"],
  "shopify-apps":           ["backend", "frontend", "orchestrator"],
};

/** Default skills per platform+variant when skills.domain is not set */
const VARIANT_DEFAULTS: Record<string, string[]> = {
  liquid:   ["shopify-liquid", "shopify-theme"],
  hydrogen: ["shopify-hydrogen", "shopify-storefront-api"],
};

export interface LoadedSkills {
  /** All skill names that were resolved */
  skillNames: string[];
  /** Skill content filtered per agent role */
  byRole: Map<AgentRole, string>;
}

/**
 * Load domain and custom skills based on project config.
 * Returns skill content mapped per agent role.
 */
export function loadSkills(projectDir: string, config: ProjectConfig): LoadedSkills {
  const skillNames = resolveSkillNames(config);
  const skillContents = new Map<string, string>();

  // Load domain skills from framework skills/ directory
  const frameworkSkillsDir = resolve(projectDir, "skills");
  // Also check .claude/skills/ (installed via setup.sh)
  const installedSkillsDir = resolve(projectDir, ".claude", "skills");

  for (const name of skillNames) {
    const content = loadSkillFile(name, frameworkSkillsDir, installedSkillsDir);
    if (content) {
      skillContents.set(name, content);
    } else {
      console.warn(`⚠ Skill '${name}' not found — skipping.`);
    }
  }

  // Load custom skills from project's .claude/skills/
  const customSkills = config.skills?.custom ?? [];
  for (const name of customSkills) {
    const customPath = resolve(projectDir, ".claude", "skills", `${name}.md`);
    if (existsSync(customPath)) {
      skillContents.set(name, readFileSync(customPath, "utf-8"));
    } else {
      console.warn(`⚠ Custom skill '${name}' not found in .claude/skills/ — skipping.`);
    }
  }

  // Build per-role skill content
  const byRole = new Map<AgentRole, string>();
  const roles: AgentRole[] = [
    "orchestrator", "frontend", "backend", "data-engineer",
    "qa", "devops", "security", "triage",
  ];

  for (const role of roles) {
    const parts: string[] = [];
    for (const [name, content] of skillContents) {
      const allowedRoles = SKILL_AGENT_MAP[name];
      // Domain skills: only if role is in the map. Custom skills: all agents get them.
      if (!allowedRoles || allowedRoles.includes(role)) {
        parts.push(`\n## Skill: ${name}\n\n${content}`);
      }
    }
    if (parts.length > 0) {
      byRole.set(role, `\n# Domain Skills\n${parts.join("\n")}`);
    }
  }

  return { skillNames: [...skillContents.keys()], byRole };
}

function resolveSkillNames(config: ProjectConfig): string[] {
  // Explicit skills.domain takes precedence
  if (config.skills?.domain && config.skills.domain.length > 0) {
    return config.skills.domain;
  }
  // Auto-resolve from platform + variant
  if (config.stack.platform === "shopify" && config.stack.variant) {
    return VARIANT_DEFAULTS[config.stack.variant] ?? [];
  }
  return [];
}

function loadSkillFile(
  name: string,
  frameworkDir: string,
  installedDir: string,
): string | null {
  // Try framework skills/ first (just-ship repo itself)
  const frameworkPath = resolve(frameworkDir, `${name}.md`);
  if (existsSync(frameworkPath)) {
    return readFileSync(frameworkPath, "utf-8");
  }
  // Try installed .claude/skills/ (target project)
  const installedPath = resolve(installedDir, `${name}.md`);
  if (existsSync(installedPath)) {
    return readFileSync(installedPath, "utf-8");
  }
  return null;
}
```

- [ ] **Step 2: Verify load-skills.ts compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsx -e "const {loadSkills} = require('./pipeline/lib/load-skills'); const {loadProjectConfig} = require('./pipeline/lib/config'); const c = loadProjectConfig('.'); const s = loadSkills('.', c); console.log('Skills loaded:', s.skillNames); console.log('Roles with skills:', [...s.byRole.keys()]);"`

Expected: Shows loaded skill names (may be empty if current project.json has no platform set). No errors.

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/load-skills.ts
git commit -m "feat: add skill loader with agent-role filtering"
```

---

## Task 3: Integrate Skills + skip_agents into Pipeline

**Files:**
- Modify: `pipeline/run.ts` (import loadSkills, inject into agents, apply skipAgents)

- [ ] **Step 1: Read current run.ts to identify exact integration points**

Read `pipeline/run.ts` fully. Identify:
1. Where `loadAgents()` is called — add `loadSkills()` call nearby
2. Where agent system prompts are composed — inject skill content
3. Where agents are dispatched — filter by `skipAgents`

- [ ] **Step 2: Add imports and load skills after loadAgents**

Near the top of the pipeline execution function, after `loadAgents()`:

```typescript
import { loadSkills, type AgentRole } from "./lib/load-skills.js";

// After loadAgents() call:
const loadedSkills = loadSkills(projectDir, config);
if (loadedSkills.skillNames.length > 0) {
  console.log(`Loaded skills: ${loadedSkills.skillNames.join(", ")}`);
}
```

- [ ] **Step 3: Filter agents by skipAgents**

`loadAgents()` returns `Record<string, AgentDefinition>` (a dictionary, NOT an array). Filter using Object.entries:

```typescript
const skipAgents = config.pipeline.skipAgents ?? [];
const filteredAgents = Object.fromEntries(
  Object.entries(agents).filter(([name]) => !skipAgents.includes(name))
);
if (skipAgents.length > 0) {
  console.log(`Skipping agents: ${skipAgents.join(", ")}`);
}
// Use filteredAgents instead of agents when passing to query()
```

- [ ] **Step 4: Inject skill content into agent prompts**

The orchestrator prompt is loaded via `loadOrchestratorPrompt(workDir)` into a `const`. Change to `let` to allow mutation:

```typescript
let orchestratorPrompt = loadOrchestratorPrompt(workDir);
const orchestratorSkills = loadedSkills.byRole.get("orchestrator");
if (orchestratorSkills) {
  orchestratorPrompt += `\n\n${orchestratorSkills}`;
}
```

For sub-agents, mutate each `AgentDefinition.prompt` in the agents record BEFORE passing to `query()` (around line 283):

```typescript
// Inject skills into each agent's prompt
for (const [name, def] of Object.entries(filteredAgents)) {
  const roleSkills = loadedSkills.byRole.get(name as AgentRole);
  if (roleSkills) {
    def.prompt += `\n\n${roleSkills}`;
  }
}
```

**Also apply to `resumePipeline()`** (around line 412) — it independently loads agents and builds the query. Skills and skipAgents must be applied there too, otherwise a resumed pipeline loses all skill context.

- [ ] **Step 5: Test with a Shopify project.json**

Create a temporary test: set `stack.platform: "shopify"`, `stack.variant: "liquid"` in project.json, run the pipeline in dry-run mode (or just the config+skills loading), verify skills appear in orchestrator prompt.

- [ ] **Step 6: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat: integrate skill loader and skip_agents into pipeline"
```

---

## Task 4: Verification Commands in QA

**Files:**
- Modify: `pipeline/run.ts` (QA phase, around lines 359-388)

- [ ] **Step 1: Read QA phase in run.ts**

Identify where the QA step runs. Look for `runQaWithFixLoop` or the QA agent dispatch.

- [ ] **Step 2: Extend QaContext interface**

In `pipeline/lib/qa-runner.ts`, find the `QaContext` interface and add:

```typescript
verifyOutput?: string;
verifyFailed?: boolean;
```

- [ ] **Step 3: Add verify command execution before runQaWithFixLoop**

In `run.ts`, the QA phase constructs a `qaContext` object (around lines 362-374) and then calls `runQaWithFixLoop()`. Add verify command execution AFTER constructing `qaContext` but BEFORE calling `runQaWithFixLoop()`:

```typescript
// Run verify command if configured (after qaContext is built, before QA fix loop)
const verifyCommand = config.stack.verifyCommand;
// Auto-detect Shopify verify command if platform is set but verify is not
const effectiveVerify = verifyCommand
  ?? (config.stack.platform === "shopify" && config.stack.variant === "liquid"
    ? "shopify theme check --fail-level error"
    : undefined);

if (effectiveVerify) {
  console.log(`Running verify command: ${effectiveVerify}`);
  try {
    const { execSync } = await import("node:child_process");
    const verifyOutput = execSync(effectiveVerify, {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 60000,
    });
    console.log("Verify passed.");
    qaContext.verifyOutput = verifyOutput;
  } catch (error: any) {
    console.warn("Verify command failed — passing error to QA agent.");
    qaContext.verifyOutput = error.stdout ?? error.message;
    qaContext.verifyFailed = true;
  }
}
```

**Note:** The verify command runs before the QA fix loop. Build/test commands are executed inside `runQa()` (called by `runQaWithFixLoop`), not in `run.ts` directly. The verify command is a pre-QA check, not a post-build check.

- [ ] **Step 4: Pass verify output to QA agent prompt**

In the QA runner, when constructing the QA agent's prompt, include the verify output if present:

```typescript
if (qaContext.verifyOutput) {
  qaPrompt += `\n\nVerification command output${qaContext.verifyFailed ? " (FAILED)" : " (passed)"}:\n\`\`\`\n${qaContext.verifyOutput}\n\`\`\``;
}
```

- [ ] **Step 5: Test with shopify theme check**

If `shopify` CLI is not available, verify the fallback behavior: warning logged, no pipeline crash. Test with a dummy verify command like `echo "verify ok"` to confirm the flow works.

- [ ] **Step 5: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat: add verification commands to QA phase"
```

---

## Task 5: Token Cost Estimation Module

**Files:**
- Create: `pipeline/lib/cost.ts`

- [ ] **Step 1: Create cost.ts**

```typescript
/** Token pricing per 1K tokens (input/output) in USD */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-20250514":       { input: 0.015, output: 0.075 },
  "claude-sonnet-4-20250514":     { input: 0.003, output: 0.015 },
  "claude-haiku-4-5-20251001":    { input: 0.0008, output: 0.004 },
};

// Fallback aliases (short names → full model IDs)
const MODEL_ALIASES: Record<string, string> = {
  opus:   "claude-opus-4-20250514",
  sonnet: "claude-sonnet-4-20250514",
  haiku:  "claude-haiku-4-5-20251001",
};

/**
 * Estimate cost in USD for a given model and token count.
 * Falls back to Sonnet pricing if model is unknown.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const resolvedModel = MODEL_ALIASES[model] ?? model;
  const pricing = MODEL_PRICING[resolvedModel] ?? MODEL_PRICING["claude-sonnet-4-20250514"];
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

/**
 * Parse token usage from Claude Agent SDK response text.
 * The SDK includes usage info like: <usage>total_tokens: 1234\ntool_uses: 5</usage>
 */
export function parseTokenUsage(responseText: string): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const totalMatch = responseText.match(/total_tokens:\s*(\d+)/);
  const totalTokens = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  // SDK doesn't always split input/output — estimate 75% input, 25% output
  // This is a rough heuristic; replace when SDK provides breakdown
  const inputTokens = Math.round(totalTokens * 0.75);
  const outputTokens = totalTokens - inputTokens;
  return { inputTokens, outputTokens, totalTokens };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/yschleich/Developer/just-ship && npx tsx -e "const {estimateCost, parseTokenUsage} = require('./pipeline/lib/cost'); console.log('Opus 10K in/2K out:', estimateCost('opus', 10000, 2000)); console.log('Parse:', parseTokenUsage('total_tokens: 5000'));"`

Expected: Prints cost estimate and parsed tokens.

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/cost.ts
git commit -m "feat: add token cost estimation module"
```

---

## Task 6: Token Usage Reporting in Events

**Files:**
- Modify: `pipeline/lib/event-hooks.ts` (extend events with token fields)
- Modify: `pipeline/run.ts` (post pipeline_completed summary event)

- [ ] **Step 1: Import cost module in event-hooks.ts**

```typescript
import { estimateCost, parseTokenUsage } from "./cost.js";
```

- [ ] **Step 2: Extend onSubagentDispatchCompleted with token fields**

In `event-hooks.ts`, update the `onSubagentDispatchCompleted` handler (around line 78-105):

```typescript
const onSubagentDispatchCompleted: HookCallback = async (input) => {
  const hookInput = input as PostToolUseHookInput;
  const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
  const agentType = (toolInput.subagent_type ?? toolInput.name ?? "unknown") as string;
  const model = (toolInput.model ?? "sonnet") as string;

  const responseText = String(hookInput.tool_response ?? "");
  const { inputTokens, outputTokens, totalTokens } = parseTokenUsage(responseText);

  if (totalTokens > 0) {
    const costUsd = estimateCost(model, inputTokens, outputTokens);
    await postEvent(config, {
      agent_type: agentType,
      event_type: "completed",
      metadata: { tokens_used: totalTokens },
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model,
      estimated_cost_usd: costUsd,
    });
  }

  // Clean up cache
  const agentId = responseText.match(/agentId:\s*(\S+)/)?.[1];
  if (agentId) {
    agentTypeByIdMap.delete(agentId);
    completedAgentIds.delete(agentId);
  }
  return { async: true as const };
};
```

- [ ] **Step 3: Add postPipelineSummary function**

Add a helper to post a pipeline_completed event with aggregated costs:

```typescript
export async function postPipelineSummary(
  config: EventConfig,
  totals: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  },
): Promise<void> {
  await postEvent(config, {
    agent_type: "orchestrator",
    event_type: "pipeline_completed",
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    estimated_cost_usd: totals.estimatedCostUsd,
  });
}
```

- [ ] **Step 4: Add token accumulator to createEventHooks**

Extend `createEventHooks` to track cumulative token usage. Add a `totals` object alongside the hooks:

```typescript
// In createEventHooks, add at the top:
const totals = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };

// In onSubagentDispatchCompleted, after computing costs:
totals.inputTokens += inputTokens;
totals.outputTokens += outputTokens;
totals.estimatedCostUsd += costUsd;
```

Return the totals alongside the hooks (change the return type or export a getter):

```typescript
return {
  hooks: { SubagentStart: [...], SubagentStop: [...], PostToolUse: [...] },
  getTotals: () => ({ ...totals }),
};
```

Update `run.ts` to destructure: `const { hooks, getTotals } = createEventHooks(config)`.

- [ ] **Step 5: Call postPipelineSummary at end of pipeline in run.ts**

At the end of the pipeline run (after PR creation or completion), post the summary:

```typescript
const totals = getTotals();
if (totals.inputTokens > 0) {
  await postPipelineSummary(eventConfig, totals);
}
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/event-hooks.ts pipeline/lib/cost.ts pipeline/run.ts
git commit -m "feat: add token usage and cost tracking to pipeline events"
```

---

## Task 7: DB Migration for task_events Token Fields

**Files:**
- Create: Supabase migration file

- [ ] **Step 1: Create migration**

This runs against the Pipeline-DB (`wsmnutkobalfrceavpxs`). Create migration via Supabase MCP or manually:

```sql
-- Add token usage columns to task_events
ALTER TABLE task_events
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(10,6);

-- All columns are nullable — existing events remain unchanged
COMMENT ON COLUMN task_events.input_tokens IS 'Input tokens consumed by this agent call';
COMMENT ON COLUMN task_events.output_tokens IS 'Output tokens consumed by this agent call';
COMMENT ON COLUMN task_events.model IS 'Claude model used (e.g. claude-sonnet-4-20250514)';
COMMENT ON COLUMN task_events.estimated_cost_usd IS 'Estimated cost in USD based on model pricing';
```

- [ ] **Step 2: Verify migration applied**

Query the table to confirm new columns exist:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'task_events'
  AND column_name IN ('input_tokens', 'output_tokens', 'model', 'estimated_cost_usd');
```

Expected: 4 rows, all nullable.

- [ ] **Step 3: Update Board API to accept new fields**

The Board's `/api/events` endpoint (in `just-ship-board` repo) receives the POST body and inserts into `task_events`. Check if it whitelists fields or passes through:

- If it destructures specific fields → add `input_tokens`, `output_tokens`, `model`, `estimated_cost_usd` to the destructuring and insert
- If it passes `req.body` directly to Supabase insert → new columns will be populated automatically

This is a cross-repo change (Board repo). Create a minimal PR in `just-ship-board` to update the events API endpoint. The migration (Step 1) must be applied first.

- [ ] **Step 4: Commit migration file (if local)**

```bash
git add supabase/migrations/
git commit -m "feat: add token usage columns to task_events"
```

---

## Task Summary & Dependencies

```
Task 1: project.json Schema          ← no dependencies
  │
  ├──→ Task 2: Skill Loader          ← depends on Task 1
  │      │
  │      └──→ Task 3: Pipeline Integration (skills + skip_agents)
  │             │
  │             └──→ Task 4: Verification Commands
  │
  └──→ Task 5: Cost Module           ← depends on Task 1 (for model info)
         │
         └──→ Task 6: Token Reporting ← depends on Task 5
                │
                └──→ Task 7: DB Migration ← depends on Task 6 (fields must match)
```

**Parallel opportunities:**
- Tasks 2+5 can run in parallel (both depend only on Task 1)
- Task 7 (DB migration) can run as soon as the field names are agreed (even before Task 6)

**Total commits:** 7 (one per task)

**Not in this plan (separate plan needed):**
- T-4: Sidekick Shopify-Kontext (just-ship-board repo)
