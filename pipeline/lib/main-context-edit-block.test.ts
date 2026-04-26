import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve repo root (pipeline/lib/ → repo root). The hook script lives at
// .claude/hooks/main-context-edit-block.sh in the repo root.
const REPO_ROOT = resolve(__dirname, "..", "..");
const HOOK = join(REPO_ROOT, ".claude", "hooks", "main-context-edit-block.sh");

type HookResult = { exitCode: number; stderr: string; stdout: string };

function runHook(payload: unknown, opts: { env?: NodeJS.ProcessEnv } = {}): HookResult {
  const env = { ...process.env, ...(opts.env ?? {}) };
  delete env.CLAUDE_AGENT_DEPTH; // ensure clean slate unless caller sets it
  if (opts.env?.CLAUDE_AGENT_DEPTH !== undefined) {
    env.CLAUDE_AGENT_DEPTH = opts.env.CLAUDE_AGENT_DEPTH;
  }
  const r = spawnSync("bash", [HOOK], {
    input: JSON.stringify(payload),
    env,
    encoding: "utf8",
  });
  return {
    exitCode: r.status ?? -1,
    stderr: r.stderr ?? "",
    stdout: r.stdout ?? "",
  };
}

describe("main-context-edit-block hook", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mceb-"));
    mkdirSync(join(tmp, ".claude"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // ───────── Subagent-allow signals ─────────

  describe("subagent detection — allow signals", () => {
    it("allows when payload contains agent_id (primary signal)", () => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
      const r = runHook({
        cwd: tmp,
        agent_id: "abc123",
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, "pipeline/run.ts") },
      });
      expect(r.exitCode).toBe(0);
    });

    it("allows when CLAUDE_AGENT_DEPTH is set and > 0", () => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
      const r = runHook(
        {
          cwd: tmp,
          tool_name: "Edit",
          tool_input: { file_path: join(tmp, "pipeline/run.ts") },
        },
        { env: { CLAUDE_AGENT_DEPTH: "1" } },
      );
      expect(r.exitCode).toBe(0);
    });

    it("allows when .agent-map/ has live entries", () => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
      const mapDir = join(tmp, ".claude", ".agent-map");
      mkdirSync(mapDir, { recursive: true });
      writeFileSync(join(mapDir, "agent_xyz"), "frontend");
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, "pipeline/run.ts") },
      });
      expect(r.exitCode).toBe(0);
    });

    it("blocks when .agent-map/ exists but is empty (no live subagent)", () => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
      mkdirSync(join(tmp, ".claude", ".agent-map"), { recursive: true });
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, "pipeline/run.ts") },
      });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("T-1024");
    });
  });

  // ───────── Block trigger ─────────

  describe("block trigger — main context + active ticket + project file", () => {
    beforeEach(() => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
    });

    it("blocks Edit on a project file from main context", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, "pipeline/run.ts") },
      });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("T-1024");
      expect(r.stderr).toContain("/develop");
    });

    it("blocks Write on a project file from main context", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Write",
        tool_input: { file_path: join(tmp, "src/foo.ts") },
      });
      expect(r.exitCode).toBe(2);
    });

    it("error message names the active ticket and the workflow", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, "pipeline/run.ts") },
      });
      expect(r.stderr).toMatch(/T-1024/);
      expect(r.stderr).toMatch(/\/develop/);
      expect(r.stderr).toMatch(/Subagent/i);
    });
  });

  // ───────── Allow when no active ticket ─────────

  describe("active-ticket signal", () => {
    it("allows when .active-ticket is absent", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, "pipeline/run.ts") },
      });
      expect(r.exitCode).toBe(0);
    });

    it("allows when .active-ticket exists but is empty", () => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "");
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, "pipeline/run.ts") },
      });
      expect(r.exitCode).toBe(0);
    });

    it("allows when .active-ticket contains only whitespace", () => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "   \n");
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, "pipeline/run.ts") },
      });
      expect(r.exitCode).toBe(0);
    });
  });

  // ───────── Framework-governance allow-list ─────────

  describe("file-path allow-list (framework governance + ephemeral state)", () => {
    beforeEach(() => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
    });

    const allowedRelPaths = [
      ".claude/rules/new-rule.md",
      ".claude/scripts/helper.sh",
      ".claude/hooks/another-hook.sh",
      ".worktrees/T-1024/src/foo.ts",
      ".worktrees/T-9999/pipeline/lib/bar.ts",
      ".claude/.active-ticket",
      ".claude/.agent-map/abc",
      ".claude/.token-snapshot-T-1024.json",
      ".claude/.reporter-team-roster.json",
      ".claude/.sidekick-thread",
      ".claude/.quality-gate-cache",
    ];

    for (const rel of allowedRelPaths) {
      it(`allows ${rel}`, () => {
        const r = runHook({
          cwd: tmp,
          tool_name: "Edit",
          tool_input: { file_path: join(tmp, rel) },
        });
        expect(r.exitCode).toBe(0);
      });
    }

    it("allows paths outside CWD (e.g. /tmp, ~/.claude)", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Write",
        tool_input: { file_path: "/tmp/scratch.txt" },
      });
      expect(r.exitCode).toBe(0);
    });

    it("blocks .claude/agents/ (not on the allow-list)", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, ".claude/agents/orchestrator.md") },
      });
      expect(r.exitCode).toBe(2);
    });

    it("blocks .claude/skills/ (not on the allow-list)", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, ".claude/skills/frontend-design.md") },
      });
      expect(r.exitCode).toBe(2);
    });

    it("blocks .claude/commands/ (not on the allow-list)", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: join(tmp, ".claude/commands/develop.md") },
      });
      expect(r.exitCode).toBe(2);
    });
  });

  // ───────── Read-only-defensive default ─────────

  describe("read-only-defensive default (false negatives over false positives)", () => {
    it("allows when cwd is missing", () => {
      const r = runHook({
        tool_name: "Edit",
        tool_input: { file_path: "/some/path/foo.ts" },
      });
      expect(r.exitCode).toBe(0);
    });

    it("allows when file_path is missing", () => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: {},
      });
      expect(r.exitCode).toBe(0);
    });

    it("allows when stdin is empty/garbage", () => {
      const r = spawnSync("bash", [HOOK], {
        input: "not json at all",
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
    });
  });

  // ───────── Relative path resolution ─────────

  describe("relative file_path resolution", () => {
    beforeEach(() => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
    });

    it("resolves relative paths against cwd and blocks correctly", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: "pipeline/run.ts" },
      });
      expect(r.exitCode).toBe(2);
    });

    it("resolves relative allow-list paths against cwd", () => {
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: ".claude/rules/foo.md" },
      });
      expect(r.exitCode).toBe(0);
    });
  });

  // ───────── Path traversal via allow-list anchors ─────────

  describe("path traversal via allow-list anchors", () => {
    beforeEach(() => {
      writeFileSync(join(tmp, ".claude", ".active-ticket"), "1024");
    });

    it("blocks .worktrees/T-*/../../pipeline/run.ts (traversal stays inside CWD)", () => {
      // Normalizes to $CWD/pipeline/run.ts — a real project file, must be blocked.
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: ".worktrees/T-9999/../../pipeline/run.ts" },
      });
      expect(r.exitCode).toBe(2);
    });

    it("blocks .claude/rules/../../pipeline/run.ts (traversal stays inside CWD)", () => {
      // Normalizes to $CWD/pipeline/run.ts — must be blocked.
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: ".claude/rules/../../pipeline/run.ts" },
      });
      expect(r.exitCode).toBe(2);
    });

    it("allows traversal that resolves outside CWD (not a project file)", () => {
      // .worktrees/T-9999/../../../etc/passwd goes up 3 levels from CWD,
      // resolving outside the project directory. Not a project file — allow.
      const r = runHook({
        cwd: tmp,
        tool_name: "Edit",
        tool_input: { file_path: ".worktrees/T-9999/../../../etc/passwd" },
      });
      expect(r.exitCode).toBe(0);
    });
  });
});
