# Pipeline Quality Gates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline provably reliable — every feature must demonstrate it works before "done", and infrastructure changes are gated by CI.

**Architecture:** Build quality gates bottom-up: first wire tests + CI (so we can prove things work), then add verification mechanisms to the pipeline itself (artifact verifier, verify commands, scope guard), then harden execution (supervisor loop, fresh context, resume logic). Each layer depends on the previous.

**Tech Stack:** Vitest (already in devDeps), GitHub Actions CI, TypeScript, pipeline/lib modules

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `pipeline/package.json` | Add `test` + `test:ci` scripts |
| Modify | `.github/workflows/build-pipeline.yml` | Add test step before Docker build |
| Create | `pipeline/vitest.config.ts` | Vitest configuration |
| Create | `pipeline/lib/artifact-verifier.ts` | 4-level artifact verification after each agent |
| Create | `pipeline/lib/artifact-verifier.test.ts` | Tests for artifact verifier |
| Create | `pipeline/lib/verify-commands.ts` | Execute verify commands with retry logic |
| Create | `pipeline/lib/verify-commands.test.ts` | Tests for verify commands |
| Create | `pipeline/lib/scope-guard.ts` | Scan agent output for scope reduction patterns |
| Create | `pipeline/lib/scope-guard.test.ts` | Tests for scope guard |
| Create | `pipeline/lib/supervisor.ts` | Agent timeout with retry/skip logic |
| Create | `pipeline/lib/supervisor.test.ts` | Tests for supervisor |
| Modify | `pipeline/run.ts` | Integrate verifier, verify commands, scope guard, supervisor, fresh context |
| Modify | `pipeline/server.ts` | Integrate resume logic using checkpoints |
| Create | `pipeline/lib/resume.ts` | Resume decision logic (which phase to restart from) |
| Create | `pipeline/lib/resume.test.ts` | Tests for resume logic |
| Modify | `pipeline/lib/load-skills.ts` | No changes needed (already complete) — verify only |

---

## Task 1: Test Infrastructure + CI Gate (OPT-E1)

**Files:**
- Create: `pipeline/vitest.config.ts`
- Modify: `pipeline/package.json`
- Modify: `.github/workflows/build-pipeline.yml`

- [ ] **Step 1: Create vitest config**

```typescript
// pipeline/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    globals: false,
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 2: Add test scripts to package.json**

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:ci": "vitest run --reporter=verbose"
```

- [ ] **Step 3: Verify existing tests pass**

Run: `cd pipeline && npm run test`
Expected: 3 test files pass (budget, checkpoint, error-handler)

- [ ] **Step 4: Add test step to CI workflow**

In `.github/workflows/build-pipeline.yml`, add after the "Type check pipeline" step:

```yaml
      - name: Run tests
        run: cd pipeline && npm run test:ci
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/vitest.config.ts pipeline/package.json .github/workflows/build-pipeline.yml
git commit -m "feat(pipeline): add test infrastructure and CI gate (OPT-E1)"
```

---

## Task 2: Artifact Verifier — 4-Level Verification (OPT-E2a)

**Files:**
- Create: `pipeline/lib/artifact-verifier.ts`
- Create: `pipeline/lib/artifact-verifier.test.ts`

The artifact verifier runs after each agent completes. It checks 4 levels:
1. **Exists** — Did the agent create/modify files? (git diff not empty)
2. **Substantive** — No stubs (TODO, FIXME, placeholder, hardcoded dummy values)
3. **Wired** — New exports are imported somewhere, new routes have callers
4. **Data flows** — If agent was supposed to write DB/API code, trace the data path

For the pipeline, we focus on levels 1-3 (level 4 requires runtime and is tracked separately via verify commands in Task 3).

- [ ] **Step 1: Write failing tests for artifact verifier**

```typescript
// pipeline/lib/artifact-verifier.test.ts
import { describe, it, expect } from "vitest";
import {
  checkLevel1Exists,
  checkLevel2Substantive,
  checkLevel3Wired,
  type VerificationResult,
} from "./artifact-verifier.ts";

describe("artifact-verifier", () => {
  describe("checkLevel1Exists", () => {
    it("fails when git diff is empty", () => {
      const result = checkLevel1Exists("");
      expect(result.passed).toBe(false);
      expect(result.level).toBe(1);
    });

    it("passes when git diff has content", () => {
      const result = checkLevel1Exists("M src/index.ts\nA src/new-file.ts");
      expect(result.passed).toBe(true);
      expect(result.files).toEqual(["src/index.ts", "src/new-file.ts"]);
    });
  });

  describe("checkLevel2Substantive", () => {
    it("fails when file contains TODO markers", () => {
      const files = new Map([["src/handler.ts", "export function handle() {\n  // TODO: implement\n  return null;\n}"]]);
      const result = checkLevel2Substantive(files);
      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        file: "src/handler.ts",
        pattern: expect.stringContaining("TODO"),
      }));
    });

    it("fails when file contains placeholder/hardcoded markers", () => {
      const files = new Map([["src/config.ts", 'const API_URL = "https://example.com"; // placeholder']]);
      const result = checkLevel2Substantive(files);
      expect(result.passed).toBe(false);
    });

    it("passes when file has real implementation", () => {
      const files = new Map([["src/handler.ts", "export function handle(req: Request) {\n  const data = parseBody(req);\n  return Response.json(data);\n}"]]);
      const result = checkLevel2Substantive(files);
      expect(result.passed).toBe(true);
    });

    it("ignores TODO in test files", () => {
      const files = new Map([["src/handler.test.ts", "// TODO: add more edge cases\nit('works', () => { expect(true).toBe(true); });"]]);
      const result = checkLevel2Substantive(files);
      expect(result.passed).toBe(true);
    });
  });

  describe("checkLevel3Wired", () => {
    it("fails when exported function has no importer", () => {
      const newExports = [{ file: "src/utils/format.ts", name: "formatDate" }];
      const allFiles = new Map([
        ["src/utils/format.ts", "export function formatDate(d: Date) { return d.toISOString(); }"],
        ["src/index.ts", "import { something } from './other';"],
      ]);
      const result = checkLevel3Wired(newExports, allFiles);
      expect(result.passed).toBe(false);
      expect(result.orphans).toContainEqual(expect.objectContaining({ name: "formatDate" }));
    });

    it("passes when exported function is imported", () => {
      const newExports = [{ file: "src/utils/format.ts", name: "formatDate" }];
      const allFiles = new Map([
        ["src/utils/format.ts", "export function formatDate(d: Date) { return d.toISOString(); }"],
        ["src/index.ts", "import { formatDate } from './utils/format';"],
      ]);
      const result = checkLevel3Wired(newExports, allFiles);
      expect(result.passed).toBe(true);
    });

    it("passes when no new exports (modification only)", () => {
      const result = checkLevel3Wired([], new Map());
      expect(result.passed).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pipeline && npm test -- --reporter=verbose`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Implement artifact verifier**

```typescript
// pipeline/lib/artifact-verifier.ts

export interface VerificationResult {
  level: 1 | 2 | 3;
  passed: boolean;
  files?: string[];
  issues?: Array<{ file: string; pattern: string; line?: number }>;
  orphans?: Array<{ file: string; name: string }>;
  message: string;
}

// --- Level 1: Files were actually changed ---

export function checkLevel1Exists(gitDiffOutput: string): VerificationResult {
  const lines = gitDiffOutput.trim().split("\n").filter(Boolean);
  const files = lines
    .map((l) => l.replace(/^[MADRC]\s+/, "").trim())
    .filter(Boolean);

  if (files.length === 0) {
    return {
      level: 1,
      passed: false,
      files: [],
      message: "Agent completed with 0 file changes — no artifacts produced",
    };
  }

  return {
    level: 1,
    passed: true,
    files,
    message: `${files.length} file(s) changed`,
  };
}

// --- Level 2: No stubs, placeholders, or dummy values ---

const STUB_PATTERNS = [
  { regex: /\bTODO\b/i, label: "TODO marker" },
  { regex: /\bFIXME\b/i, label: "FIXME marker" },
  { regex: /\bplaceholder\b/i, label: "placeholder" },
  { regex: /\bhardcoded\b/i, label: "hardcoded value" },
  { regex: /\bwill be wired later\b/i, label: "deferred wiring" },
  { regex: /\bnot implemented\b/i, label: "not implemented" },
  { regex: /\breturn null;?\s*\/\//, label: "stub return with comment" },
  { regex: /throw new Error\(["']not implemented["']\)/i, label: "not-implemented throw" },
];

export function checkLevel2Substantive(
  files: Map<string, string>,
): VerificationResult {
  const issues: Array<{ file: string; pattern: string; line?: number }> = [];

  for (const [filePath, content] of files) {
    // Skip test files — TODOs in tests are acceptable
    if (filePath.includes(".test.") || filePath.includes(".spec.")) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { regex, label } of STUB_PATTERNS) {
        if (regex.test(lines[i])) {
          issues.push({ file: filePath, pattern: label, line: i + 1 });
        }
      }
    }
  }

  if (issues.length > 0) {
    return {
      level: 2,
      passed: false,
      issues,
      message: `${issues.length} stub/placeholder issue(s) found: ${issues.map((i) => `${i.file}:${i.line} (${i.pattern})`).join(", ")}`,
    };
  }

  return { level: 2, passed: true, message: "No stubs or placeholders detected" };
}

// --- Level 3: New exports are imported somewhere ---

export function checkLevel3Wired(
  newExports: Array<{ file: string; name: string }>,
  allFiles: Map<string, string>,
): VerificationResult {
  if (newExports.length === 0) {
    return { level: 3, passed: true, message: "No new exports to verify" };
  }

  const orphans: Array<{ file: string; name: string }> = [];

  for (const exp of newExports) {
    let found = false;
    for (const [filePath, content] of allFiles) {
      if (filePath === exp.file) continue; // Don't count self-reference
      // Check if the export name appears in an import statement or is referenced
      if (content.includes(exp.name)) {
        found = true;
        break;
      }
    }
    if (!found) {
      orphans.push(exp);
    }
  }

  if (orphans.length > 0) {
    return {
      level: 3,
      passed: false,
      orphans,
      message: `${orphans.length} orphaned export(s): ${orphans.map((o) => `${o.name} in ${o.file}`).join(", ")}`,
    };
  }

  return { level: 3, passed: true, message: "All new exports are wired" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pipeline && npm test -- --reporter=verbose`
Expected: All artifact-verifier tests PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/artifact-verifier.ts pipeline/lib/artifact-verifier.test.ts
git commit -m "feat(pipeline): add 4-level artifact verifier (OPT-E2a)"
```

---

## Task 3: Verify Commands with Retry Logic (OPT-E2b)

**Files:**
- Create: `pipeline/lib/verify-commands.ts`
- Create: `pipeline/lib/verify-commands.test.ts`

This replaces the inline verify command execution in `run.ts:618-644` with a proper module that supports:
- Executing verify commands from `project.json` (`build.verify`)
- Auto-discovered checks from `package.json` (`lint`, `test`, `typecheck`)
- Retry on failure (max 2 retries with error context for auto-fix)
- Structured result reporting

- [ ] **Step 1: Write failing tests**

```typescript
// pipeline/lib/verify-commands.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveVerifyCommands,
  type VerifyCommandResult,
  type VerifyConfig,
} from "./verify-commands.ts";

describe("resolveVerifyCommands", () => {
  it("returns configured verify command", () => {
    const config: VerifyConfig = {
      verifyCommand: "npm run typecheck",
      platform: undefined,
      variant: undefined,
      packageJsonScripts: {},
    };
    const commands = resolveVerifyCommands(config);
    expect(commands).toContainEqual({ cmd: "npm run typecheck", source: "project.json", blocking: true });
  });

  it("adds shopify theme check for liquid projects", () => {
    const config: VerifyConfig = {
      verifyCommand: undefined,
      platform: "shopify",
      variant: "liquid",
      packageJsonScripts: {},
      shopifyCliAvailable: true,
    };
    const commands = resolveVerifyCommands(config);
    expect(commands).toContainEqual(expect.objectContaining({
      cmd: "shopify theme check --fail-level error",
      source: "shopify-default",
    }));
  });

  it("discovers lint and test from package.json", () => {
    const config: VerifyConfig = {
      verifyCommand: undefined,
      platform: undefined,
      variant: undefined,
      packageJsonScripts: { lint: "eslint .", test: "vitest run", typecheck: "tsc --noEmit" },
    };
    const commands = resolveVerifyCommands(config);
    expect(commands).toHaveLength(3);
    expect(commands.every((c) => c.blocking === false)).toBe(true); // advisory
  });

  it("does not duplicate configured command in auto-discovery", () => {
    const config: VerifyConfig = {
      verifyCommand: "npm run typecheck",
      platform: undefined,
      variant: undefined,
      packageJsonScripts: { typecheck: "tsc --noEmit" },
    };
    const commands = resolveVerifyCommands(config);
    // Should have the configured one (blocking) but not a duplicate advisory one
    const typecheckCommands = commands.filter((c) => c.cmd.includes("typecheck"));
    expect(typecheckCommands).toHaveLength(1);
    expect(typecheckCommands[0].blocking).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pipeline && npm test`
Expected: FAIL

- [ ] **Step 3: Implement verify commands module**

```typescript
// pipeline/lib/verify-commands.ts
import { execSync } from "node:child_process";

export interface VerifyCommand {
  cmd: string;
  source: "project.json" | "shopify-default" | "package.json";
  blocking: boolean; // true = fail stops pipeline, false = advisory warning
}

export interface VerifyConfig {
  verifyCommand?: string;
  platform?: string;
  variant?: string;
  packageJsonScripts: Record<string, string>;
  shopifyCliAvailable?: boolean;
}

export interface VerifyCommandResult {
  cmd: string;
  passed: boolean;
  output: string;
  attempts: number;
  blocking: boolean;
}

const DISCOVERABLE_SCRIPTS = ["lint", "test", "typecheck"] as const;

export function resolveVerifyCommands(config: VerifyConfig): VerifyCommand[] {
  const commands: VerifyCommand[] = [];
  const seenCmds = new Set<string>();

  // 1. Configured verify command (blocking)
  if (config.verifyCommand) {
    commands.push({ cmd: config.verifyCommand, source: "project.json", blocking: true });
    seenCmds.add(config.verifyCommand);
  }

  // 2. Shopify default (blocking)
  if (
    !config.verifyCommand &&
    config.platform === "shopify" &&
    config.variant === "liquid" &&
    config.shopifyCliAvailable
  ) {
    const cmd = "shopify theme check --fail-level error";
    commands.push({ cmd, source: "shopify-default", blocking: true });
    seenCmds.add(cmd);
  }

  // 3. Auto-discovered from package.json (advisory)
  for (const script of DISCOVERABLE_SCRIPTS) {
    if (config.packageJsonScripts[script]) {
      const cmd = `npm run ${script}`;
      // Don't duplicate if already configured
      if (!seenCmds.has(cmd) && !Array.from(seenCmds).some((s) => s.includes(script))) {
        commands.push({ cmd, source: "package.json", blocking: false });
        seenCmds.add(cmd);
      }
    }
  }

  return commands;
}

export interface RunVerifyOptions {
  workDir: string;
  commands: VerifyCommand[];
  maxRetries?: number; // default 2
  timeoutMs?: number;  // default 60_000
}

export function runVerifyCommands(opts: RunVerifyOptions): VerifyCommandResult[] {
  const maxRetries = opts.maxRetries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const results: VerifyCommandResult[] = [];

  for (const command of opts.commands) {
    let passed = false;
    let output = "";
    let attempts = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attempts = attempt + 1;
      try {
        output = execSync(command.cmd, {
          cwd: opts.workDir,
          encoding: "utf-8",
          timeout: timeoutMs,
          stdio: ["pipe", "pipe", "pipe"],
        });
        passed = true;
        break;
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        output = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n");
        // Only retry blocking commands
        if (!command.blocking || attempt >= maxRetries) break;
      }
    }

    results.push({
      cmd: command.cmd,
      passed,
      output,
      attempts,
      blocking: command.blocking,
    });
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pipeline && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/verify-commands.ts pipeline/lib/verify-commands.test.ts
git commit -m "feat(pipeline): add verify commands with retry logic (OPT-E2b)"
```

---

## Task 4: Scope Reduction Guard (OPT-E2c)

**Files:**
- Create: `pipeline/lib/scope-guard.ts`
- Create: `pipeline/lib/scope-guard.test.ts`

Scans agent output text for scope reduction patterns. If found, the output is flagged for retry with a stricter prompt.

- [ ] **Step 1: Write failing tests**

```typescript
// pipeline/lib/scope-guard.test.ts
import { describe, it, expect } from "vitest";
import { detectScopeReduction, type ScopeReductionResult } from "./scope-guard.ts";

describe("detectScopeReduction", () => {
  it("detects 'placeholder' in agent output", () => {
    const result = detectScopeReduction("I've added a placeholder implementation that you can fill in later.");
    expect(result.detected).toBe(true);
    expect(result.markers).toContainEqual(expect.objectContaining({ pattern: "placeholder" }));
  });

  it("detects 'simplified version'", () => {
    const result = detectScopeReduction("Here's a simplified version of the feature for now.");
    expect(result.detected).toBe(true);
  });

  it("detects 'will be wired later'", () => {
    const result = detectScopeReduction("The handler exists but will be wired later when the API is ready.");
    expect(result.detected).toBe(true);
  });

  it("detects 'hardcoded' values", () => {
    const result = detectScopeReduction("I've hardcoded the URL for now, you can make it configurable later.");
    expect(result.detected).toBe(true);
  });

  it("detects 'v1' / 'basic version' scope reduction", () => {
    const result = detectScopeReduction("This is a v1 implementation. We can add more features in v2.");
    expect(result.detected).toBe(true);
  });

  it("detects 'not wired to'", () => {
    const result = detectScopeReduction("The component is created but not wired to the main layout yet.");
    expect(result.detected).toBe(true);
  });

  it("passes clean agent output", () => {
    const result = detectScopeReduction(
      "I've implemented the feature as specified. The handler validates input, queries the database, and returns the formatted response. All acceptance criteria are covered."
    );
    expect(result.detected).toBe(false);
  });

  it("ignores scope markers in quoted/code blocks", () => {
    const result = detectScopeReduction(
      'I removed the old `// TODO: placeholder` comment and replaced it with the real implementation.'
    );
    expect(result.detected).toBe(false);
  });

  it("detects 'future enhancement'", () => {
    const result = detectScopeReduction("Error handling is a future enhancement.");
    expect(result.detected).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pipeline && npm test`
Expected: FAIL

- [ ] **Step 3: Implement scope guard**

```typescript
// pipeline/lib/scope-guard.ts

export interface ScopeMarker {
  pattern: string;
  line: string;
  index: number;
}

export interface ScopeReductionResult {
  detected: boolean;
  markers: ScopeMarker[];
  message: string;
}

const SCOPE_REDUCTION_PATTERNS = [
  /\bplaceholder\b/i,
  /\bsimplified\s+(version|implementation|approach)\b/i,
  /\bwill be wired (later|soon|in)\b/i,
  /\bhardcoded\b/i,
  /\bnot wired to\b/i,
  /\bbasic version\b/i,
  /\bv1\b\s+(implementation|version|approach)/i,
  /\bfuture enhancement\b/i,
  /\bfill in later\b/i,
  /\bstub(bed)?\s+(out|implementation|for now)\b/i,
  /\bnot (yet )?(implemented|connected|integrated)\b/i,
  /\bcan (add|make|implement) .{0,30} later\b/i,
  /\bfor now\b.{0,40}\b(later|eventually|v2)\b/i,
];

// Lines that look like they're discussing removal of old code are OK
const FALSE_POSITIVE_PATTERNS = [
  /removed the.{0,30}(placeholder|todo|hardcoded)/i,
  /replaced.{0,30}(placeholder|stub|hardcoded)/i,
  /deleted.{0,30}(placeholder|todo)/i,
];

export function detectScopeReduction(agentOutput: string): ScopeReductionResult {
  const markers: ScopeMarker[] = [];
  const lines = agentOutput.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip code blocks (lines starting with ``` or indented code)
    if (line.trim().startsWith("```") || line.startsWith("    ")) continue;

    // Skip lines inside backtick-quoted inline code
    // Simple heuristic: if the match is between backticks, skip
    for (const pattern of SCOPE_REDUCTION_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;

      // Check if match is inside backticks
      const beforeMatch = line.slice(0, match.index);
      const backtickCount = (beforeMatch.match(/`/g) ?? []).length;
      if (backtickCount % 2 === 1) continue; // Inside inline code

      // Check for false positives (discussing removal of old stubs)
      if (FALSE_POSITIVE_PATTERNS.some((fp) => fp.test(line))) continue;

      markers.push({
        pattern: match[0],
        line: line.trim(),
        index: i + 1,
      });
      break; // One match per line is enough
    }
  }

  if (markers.length > 0) {
    return {
      detected: true,
      markers,
      message: `Scope reduction detected (${markers.length} marker(s)): ${markers.map((m) => `"${m.pattern}" on line ${m.index}`).join(", ")}`,
    };
  }

  return { detected: false, markers: [], message: "No scope reduction detected" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pipeline && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/scope-guard.ts pipeline/lib/scope-guard.test.ts
git commit -m "feat(pipeline): add scope reduction guard (OPT-E2c)"
```

---

## Task 5: Supervisor Loop — Agent Timeout with Retry/Skip (OPT-002)

**Files:**
- Create: `pipeline/lib/supervisor.ts`
- Create: `pipeline/lib/supervisor.test.ts`

Wraps agent execution with timeout, retry, and skip logic. Replaces the current fire-and-forget model where a stuck agent blocks the entire pipeline.

- [ ] **Step 1: Write failing tests**

```typescript
// pipeline/lib/supervisor.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  superviseAgent,
  type SuperviseResult,
} from "./supervisor.ts";

describe("superviseAgent", () => {
  it("returns result on success within timeout", async () => {
    const agentFn = vi.fn().mockResolvedValue({ output: "done", toolCalls: 5 });
    const result = await superviseAgent({
      agentName: "backend",
      execute: agentFn,
      timeoutMs: 5000,
      maxRetries: 3,
    });
    expect(result.status).toBe("completed");
    expect(result.attempts).toBe(1);
  });

  it("retries on timeout up to maxRetries", async () => {
    const agentFn = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ output: "done", toolCalls: 3 });

    const result = await superviseAgent({
      agentName: "frontend",
      execute: agentFn,
      timeoutMs: 100,
      maxRetries: 3,
    });
    expect(result.status).toBe("completed");
    expect(result.attempts).toBe(3);
  });

  it("skips agent after maxRetries exhausted", async () => {
    const agentFn = vi.fn().mockRejectedValue(new Error("timeout"));

    const result = await superviseAgent({
      agentName: "security",
      execute: agentFn,
      timeoutMs: 100,
      maxRetries: 3,
    });
    expect(result.status).toBe("skipped");
    expect(result.attempts).toBe(3);
    expect(result.reason).toContain("3 attempts");
  });

  it("does not retry on non-timeout errors", async () => {
    const agentFn = vi.fn().mockRejectedValue(new Error("SyntaxError: unexpected token"));

    const result = await superviseAgent({
      agentName: "backend",
      execute: agentFn,
      timeoutMs: 5000,
      maxRetries: 3,
    });
    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pipeline && npm test`
Expected: FAIL

- [ ] **Step 3: Implement supervisor module**

```typescript
// pipeline/lib/supervisor.ts

export interface SuperviseOptions<T> {
  agentName: string;
  execute: () => Promise<T>;
  timeoutMs: number;
  maxRetries: number;
  onTimeout?: (attempt: number) => void;
  onSkip?: () => void;
}

export interface SuperviseResult<T> {
  status: "completed" | "skipped" | "failed";
  result?: T;
  attempts: number;
  reason?: string;
  agentName: string;
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("timeout") || msg.includes("aborted") || msg.includes("timed out");
  }
  return false;
}

export async function superviseAgent<T>(
  opts: SuperviseOptions<T>,
): Promise<SuperviseResult<T>> {
  const { agentName, execute, maxRetries, onTimeout, onSkip } = opts;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await execute();
      return { status: "completed", result, attempts: attempt, agentName };
    } catch (error) {
      if (!isTimeoutError(error)) {
        // Non-timeout error — don't retry, fail immediately
        return {
          status: "failed",
          attempts: attempt,
          reason: error instanceof Error ? error.message : String(error),
          agentName,
        };
      }

      onTimeout?.(attempt);

      if (attempt >= maxRetries) {
        onSkip?.();
        return {
          status: "skipped",
          attempts: maxRetries,
          reason: `Agent ${agentName} timed out after ${maxRetries} attempts — skipped`,
          agentName,
        };
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  return { status: "skipped", attempts: maxRetries, reason: "exhausted retries", agentName };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pipeline && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/supervisor.ts pipeline/lib/supervisor.test.ts
git commit -m "feat(pipeline): add supervisor loop with retry/skip (OPT-002)"
```

---

## Task 6: Resume Logic Module (OPT-003)

**Files:**
- Create: `pipeline/lib/resume.ts`
- Create: `pipeline/lib/resume.test.ts`

Extracts resume decision logic from server.ts into a testable module. Given a checkpoint, determines whether to resume or restart, and which phase to resume from.

- [ ] **Step 1: Write failing tests**

```typescript
// pipeline/lib/resume.test.ts
import { describe, it, expect } from "vitest";
import { decideResume, type ResumeDecision } from "./resume.ts";
import type { PipelineCheckpoint } from "./checkpoint.ts";

describe("decideResume", () => {
  it("returns restart when no checkpoint exists", () => {
    const result = decideResume(null);
    expect(result.action).toBe("restart");
  });

  it("returns restart when checkpoint phase is pr_created (already done)", () => {
    const checkpoint: PipelineCheckpoint = {
      phase: "pr_created",
      completed_agents: ["backend", "frontend"],
      pending_agents: [],
      branch_name: "feature/T-100-test",
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      attempt: 1,
    };
    const result = decideResume(checkpoint);
    expect(result.action).toBe("restart");
    expect(result.reason).toContain("already completed");
  });

  it("resumes from triage phase", () => {
    const checkpoint: PipelineCheckpoint = {
      phase: "triage",
      completed_agents: [],
      pending_agents: [],
      branch_name: "feature/T-100-test",
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      attempt: 1,
    };
    const result = decideResume(checkpoint);
    expect(result.action).toBe("resume");
    expect(result.resumeFrom).toBe("triage");
  });

  it("resumes agents_dispatched and skips completed agents", () => {
    const checkpoint: PipelineCheckpoint = {
      phase: "agents_dispatched",
      completed_agents: ["backend", "data-engineer"],
      pending_agents: ["frontend", "qa"],
      branch_name: "feature/T-100-test",
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      attempt: 1,
    };
    const result = decideResume(checkpoint);
    expect(result.action).toBe("resume");
    expect(result.resumeFrom).toBe("agents_dispatched");
    expect(result.skipAgents).toEqual(["backend", "data-engineer"]);
    expect(result.pendingAgents).toEqual(["frontend", "qa"]);
  });

  it("increments attempt count on resume", () => {
    const checkpoint: PipelineCheckpoint = {
      phase: "planning",
      completed_agents: [],
      pending_agents: [],
      branch_name: "feature/T-100-test",
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      attempt: 2,
    };
    const result = decideResume(checkpoint);
    expect(result.attempt).toBe(3);
  });

  it("restarts when max attempts exceeded", () => {
    const checkpoint: PipelineCheckpoint = {
      phase: "planning",
      completed_agents: [],
      pending_agents: [],
      branch_name: "feature/T-100-test",
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      attempt: 3,
    };
    const result = decideResume(checkpoint, { maxAttempts: 3 });
    expect(result.action).toBe("restart");
    expect(result.reason).toContain("max attempts");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pipeline && npm test`
Expected: FAIL

- [ ] **Step 3: Implement resume logic**

```typescript
// pipeline/lib/resume.ts
import type { PipelineCheckpoint } from "./checkpoint.ts";

export interface ResumeDecision {
  action: "resume" | "restart";
  resumeFrom?: PipelineCheckpoint["phase"];
  skipAgents?: string[];
  pendingAgents?: string[];
  attempt: number;
  reason?: string;
  branchName?: string;
  worktreePath?: string;
}

interface ResumeOptions {
  maxAttempts?: number; // default 3
}

export function decideResume(
  checkpoint: PipelineCheckpoint | null,
  options?: ResumeOptions,
): ResumeDecision {
  const maxAttempts = options?.maxAttempts ?? 3;

  // No checkpoint — fresh start
  if (!checkpoint) {
    return { action: "restart", attempt: 1, reason: "no checkpoint" };
  }

  // Already completed — fresh start
  if (checkpoint.phase === "pr_created") {
    return { action: "restart", attempt: 1, reason: "checkpoint phase is pr_created — already completed" };
  }

  // Max attempts exceeded — fresh start with reset
  if (checkpoint.attempt >= maxAttempts) {
    return {
      action: "restart",
      attempt: 1,
      reason: `checkpoint has ${checkpoint.attempt} attempts (max attempts: ${maxAttempts}) — restarting fresh`,
    };
  }

  const nextAttempt = checkpoint.attempt + 1;

  // Resume from agents_dispatched — skip completed agents
  if (checkpoint.phase === "agents_dispatched") {
    return {
      action: "resume",
      resumeFrom: "agents_dispatched",
      skipAgents: checkpoint.completed_agents,
      pendingAgents: checkpoint.pending_agents,
      attempt: nextAttempt,
      branchName: checkpoint.branch_name,
      worktreePath: checkpoint.worktree_path,
    };
  }

  // Resume from any other phase — re-run that phase
  return {
    action: "resume",
    resumeFrom: checkpoint.phase,
    attempt: nextAttempt,
    branchName: checkpoint.branch_name,
    worktreePath: checkpoint.worktree_path,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pipeline && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/resume.ts pipeline/lib/resume.test.ts
git commit -m "feat(pipeline): add resume decision logic (OPT-003)"
```

---

## Task 7: Integration — Wire Quality Gates into Pipeline (OPT-001 + integration)

**Files:**
- Modify: `pipeline/run.ts`

This is the integration task where we wire all new modules into the actual pipeline execution. Changes to `run.ts`:

1. **Fresh Context (OPT-001):** Already partially implemented — skills are loaded and injected per agent. What's missing: ensure no state bleeds between agent calls. Add explicit context reset between agent dispatches.

2. **Artifact Verifier:** After the orchestrator completes (line ~506), before QA, verify artifacts.

3. **Verify Commands:** Replace inline verify logic (lines 618-644) with the new `verify-commands.ts` module.

4. **Scope Guard:** After orchestrator completion, scan `lastAssistantText` for scope reduction.

5. **Supervisor:** This requires changes to how the orchestrator invokes sub-agents. Since sub-agents are dispatched by the orchestrator (via Claude Code SDK `agents` parameter), the supervisor wraps the entire orchestrator call — not individual sub-agents. The orchestrator itself manages sub-agents internally.

- [ ] **Step 1: Import new modules at top of run.ts**

Add after existing imports (around line 18):

```typescript
import { checkLevel1Exists, checkLevel2Substantive } from "./lib/artifact-verifier.ts";
import { resolveVerifyCommands, runVerifyCommands } from "./lib/verify-commands.ts";
import { detectScopeReduction } from "./lib/scope-guard.ts";
```

Also add `readFileSync` to the existing `node:fs` import on line 4:

```typescript
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
```

(Note: `readFileSync` is needed by the verify commands integration in Step 4 to read `package.json` scripts.)

- [ ] **Step 2: Add artifact verification after orchestrator completes**

After the orchestrator `for await` loop (around line 506, after `if (hasPipeline) await postPipelineEvent(eventConfig, "completed", "orchestrator");`), before the QA section:

```typescript
    // --- Artifact Verification ---
    if (exitCode === 0) {
      try {
        const diffOutput = execSync("git diff --name-status main HEAD", {
          cwd: workDir,
          encoding: "utf-8",
          timeout: 10_000,
        }).trim();

        const level1 = checkLevel1Exists(diffOutput);
        if (!level1.passed) {
          console.error(`[Verifier] WARN: ${level1.message}`);
          if (hasPipeline) {
            await postPipelineEvent(eventConfig, "verification_warning", "orchestrator", {
              level: 1,
              message: level1.message,
            });
          }
        }
      } catch {
        console.error("[Verifier] Could not run artifact verification — continuing");
      }
    }
```

- [ ] **Step 3: Add scope reduction check on orchestrator output**

After artifact verification, before QA:

```typescript
    // --- Scope Reduction Guard ---
    if (exitCode === 0 && lastAssistantText) {
      const scopeCheck = detectScopeReduction(lastAssistantText);
      if (scopeCheck.detected) {
        console.error(`[ScopeGuard] WARNING: ${scopeCheck.message}`);
        if (hasPipeline) {
          await postPipelineEvent(eventConfig, "scope_reduction_warning", "orchestrator", {
            markers: scopeCheck.markers.map((m) => m.pattern),
            message: scopeCheck.message,
          });
        }
      }
    }
```

- [ ] **Step 4: Replace inline verify logic with verify-commands module**

Replace lines 618-644 (the inline verify command section) with:

```typescript
    // Run verification commands
    const packageJsonPath = join(workDir, "package.json");
    let packageJsonScripts: Record<string, string> = {};
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      packageJsonScripts = pkg.scripts ?? {};
    } catch { /* no package.json */ }

    let shopifyCliAvailable = false;
    if (config.stack.platform === "shopify" && config.stack.variant === "liquid") {
      try {
        execSync("which shopify", { stdio: "pipe" });
        shopifyCliAvailable = true;
      } catch { /* not available */ }
    }

    const verifyCommands = resolveVerifyCommands({
      verifyCommand: config.stack.verifyCommand,
      platform: config.stack.platform,
      variant: config.stack.variant,
      packageJsonScripts,
      shopifyCliAvailable,
    });

    if (verifyCommands.length > 0) {
      const verifyResults = runVerifyCommands({ workDir, commands: verifyCommands });
      for (const vr of verifyResults) {
        if (vr.passed) {
          console.error(`[Verify] ✓ ${vr.cmd} (${vr.attempts} attempt(s))`);
        } else if (vr.blocking) {
          console.error(`[Verify] ✗ ${vr.cmd} FAILED after ${vr.attempts} attempt(s)`);
          qaContext.verifyOutput = vr.output;
          qaContext.verifyFailed = true;
        } else {
          console.error(`[Verify] ⚠ ${vr.cmd} failed (advisory)`);
        }
      }
    }
```

- [ ] **Step 5: Verify the full pipeline still compiles**

Run: `cd pipeline && npm run typecheck`
Expected: No type errors

- [ ] **Step 6: Run all tests**

Run: `cd pipeline && npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat(pipeline): integrate quality gates into pipeline execution (OPT-001, E2a-c, 002)"
```

---

## Task 8: Integration — Wire Resume Logic into Server (OPT-003)

**Files:**
- Modify: `pipeline/server.ts`

Wire `decideResume()` into `handleLaunch()` so the server automatically uses checkpoint data when re-launching a ticket.

**Note:** This task wires resume as advisory logging (decision is logged, skipAgents are identified). Actually passing `skipAgents` to `executePipeline()` requires changes to how the orchestrator handles partial agent completion — that's a follow-up once the resume module is proven in production.

- [ ] **Step 1: Import resume module**

Add at top of server.ts:

```typescript
import { decideResume } from "./lib/resume.ts";
```

- [ ] **Step 2: Add resume decision after checkpoint retrieval**

In `handleLaunch()`, after line 445 (`const checkpoint = ticket?.pipeline_checkpoint as PipelineCheckpoint | null;`), add resume decision logic:

```typescript
    // --- Resume decision ---
    const resumeDecision = decideResume(checkpoint);
    if (resumeDecision.action === "resume") {
      log(`T-${ticketNumber}: resuming from phase '${resumeDecision.resumeFrom}' (attempt ${resumeDecision.attempt})`);
      if (resumeDecision.skipAgents?.length) {
        log(`T-${ticketNumber}: skipping completed agents: ${resumeDecision.skipAgents.join(", ")}`);
      }
    } else if (checkpoint) {
      log(`T-${ticketNumber}: checkpoint exists but restarting — ${resumeDecision.reason}`);
    }
```

- [ ] **Step 3: Verify server still compiles**

Run: `cd pipeline && npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add pipeline/server.ts
git commit -m "feat(pipeline): wire resume logic into server launch (OPT-003)"
```

---

## Task 9: Verify Skill-Loader (OPT-006)

**Files:**
- Read-only verification of: `pipeline/lib/load-skills.ts`

OPT-006 is already fully implemented. This task verifies the implementation matches expectations.

- [ ] **Step 1: Verify skill-loader is complete**

Read `pipeline/lib/load-skills.ts` and confirm:
- ✓ `loadSkills()` reads `stack.platform` + `stack.variant` + `skills.domain`
- ✓ Variant defaults map `liquid` → shopify-liquid + shopify-theme
- ✓ Skills are filtered per agent role via `SKILL_AGENT_MAP`
- ✓ Custom skills from `.claude/skills/` are loaded
- ✓ Path traversal protection via `isValidSkillName()`
- ✓ Missing skills produce warnings, not crashes

- [ ] **Step 2: Verify skill injection in run.ts**

Read `pipeline/run.ts` lines 210-238 and confirm:
- ✓ `loadSkills(projectDir, config)` is called
- ✓ `skipAgents` config is respected
- ✓ Skills are injected per agent role into `filteredAgents`
- ✓ Orchestrator gets its own skill injection

Result: OPT-006 is **DONE**. No implementation needed.

- [ ] **Step 3: Commit verification note**

No code changes. Mark OPT-006 as verified in commit message of final task.

---

## Task 10: Final — Run Full Test Suite + Verify CI

- [ ] **Step 1: Run full test suite locally**

Run: `cd pipeline && npm test -- --reporter=verbose`
Expected: All test files pass:
- `lib/budget.test.ts`
- `lib/checkpoint.test.ts`
- `lib/error-handler.test.ts`
- `lib/artifact-verifier.test.ts`
- `lib/verify-commands.test.ts`
- `lib/scope-guard.test.ts`
- `lib/supervisor.test.ts`
- `lib/resume.test.ts`

- [ ] **Step 2: Run typecheck**

Run: `cd pipeline && npm run typecheck`
Expected: No errors

- [ ] **Step 3: Verify CI config is correct**

Read `.github/workflows/build-pipeline.yml` and confirm the test step exists between typecheck and Docker build.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(pipeline): verify all quality gates pass (OPT-E1 through OPT-006)"
```

---

## Summary

| Task | Ticket(s) | What it does |
|------|-----------|--------------|
| 1 | OPT-E1 | Test infra + CI gate — vitest wired, CI blocks on red |
| 2 | OPT-E2a | Artifact verifier — 3 levels: exists, substantive, wired |
| 3 | OPT-E2b | Verify commands — auto-discovered, with retry logic |
| 4 | OPT-E2c | Scope reduction guard — scans agent output for "placeholder", "v1", etc. |
| 5 | OPT-002 | Supervisor — agent timeout with retry/skip |
| 6 | OPT-003 | Resume logic — checkpoint-based restart decisions |
| 7 | Integration | Wire verifier, verify commands, scope guard into run.ts |
| 8 | Integration | Wire resume logic into server.ts |
| 9 | OPT-006 | Verify skill-loader (already complete) |
| 10 | All | Full test suite + CI verification |
