import { describe, it, expect } from "vitest";
import { decideResume } from "./resume.ts";
import type { PipelineCheckpoint } from "./checkpoint.ts";

function makeCheckpoint(overrides: Partial<PipelineCheckpoint> = {}): PipelineCheckpoint {
  return {
    phase: "triage",
    completed_agents: [],
    pending_agents: [],
    branch_name: "feature/42-test",
    started_at: "2024-01-01T00:00:00.000Z",
    last_updated: "2024-01-01T00:00:00.000Z",
    attempt: 1,
    ...overrides,
  };
}

describe("decideResume", () => {
  it("returns restart when no checkpoint exists", () => {
    const result = decideResume(null);

    expect(result.action).toBe("restart");
    expect(result.attempt).toBe(1);
  });

  it("returns restart when checkpoint phase is pr_created", () => {
    const checkpoint = makeCheckpoint({ phase: "pr_created" });
    const result = decideResume(checkpoint);

    expect(result.action).toBe("restart");
    expect(result.attempt).toBe(1);
    expect(result.reason).toBe("already completed");
  });

  it("resumes from triage phase", () => {
    const checkpoint = makeCheckpoint({ phase: "triage", attempt: 1 });
    const result = decideResume(checkpoint);

    expect(result.action).toBe("resume");
    expect(result.resumeFrom).toBe("triage");
    expect(result.attempt).toBe(2);
  });

  it("resumes agents_dispatched and skips completed agents", () => {
    const checkpoint = makeCheckpoint({
      phase: "agents_dispatched",
      completed_agents: ["backend", "tests"],
      pending_agents: ["frontend"],
      attempt: 1,
    });
    const result = decideResume(checkpoint);

    expect(result.action).toBe("resume");
    expect(result.resumeFrom).toBe("agents_dispatched");
    expect(result.skipAgents).toEqual(["backend", "tests"]);
    expect(result.pendingAgents).toEqual(["frontend"]);
    expect(result.attempt).toBe(2);
  });

  it("increments attempt count on resume", () => {
    const checkpoint = makeCheckpoint({ phase: "planning", attempt: 2 });
    const result = decideResume(checkpoint);

    expect(result.action).toBe("resume");
    expect(result.attempt).toBe(3);
  });

  it("restarts when max attempts exceeded", () => {
    const checkpoint = makeCheckpoint({ phase: "qa", attempt: 3 });
    const result = decideResume(checkpoint, { maxAttempts: 3 });

    expect(result.action).toBe("restart");
    expect(result.attempt).toBe(1);
    expect(result.reason).toContain("max attempts");
  });

  it("preserves branchName and worktreePath from checkpoint", () => {
    const checkpoint = makeCheckpoint({
      phase: "qa",
      attempt: 1,
      branch_name: "feature/99-quality-gates",
      worktree_path: "/tmp/worktrees/T-99",
    });
    const result = decideResume(checkpoint);

    expect(result.action).toBe("resume");
    expect(result.branchName).toBe("feature/99-quality-gates");
    expect(result.worktreePath).toBe("/tmp/worktrees/T-99");
  });
});
