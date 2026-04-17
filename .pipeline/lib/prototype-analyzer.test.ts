import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { analyzePrototype } from "./prototype-analyzer.ts";

// Mock execSync to avoid running actual builds/greps in tests
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
}));

const fixturesDir = join(import.meta.dirname!, "__test-fixtures__");

describe("analyzePrototype", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects Next.js + Supabase + Tailwind stack", async () => {
    const result = await analyzePrototype(
      join(fixturesDir, "nextjs-supabase"),
    );

    expect(result.stack.framework).toBe("next");
    expect(result.stack.database).toBe("supabase");
    expect(result.stack.styling).toBe("tailwind");
  });

  it("detects missing tests when no test files exist", async () => {
    const result = await analyzePrototype(
      join(fixturesDir, "nextjs-supabase"),
    );

    expect(result.gaps.needsTests).toBe(true);
  });

  it("detects existing tests when test files are present", async () => {
    const result = await analyzePrototype(join(fixturesDir, "with-tests"));

    expect(result.gaps.needsTests).toBe(false);
  });

  it("detects TypeScript when tsconfig.json exists", async () => {
    const result = await analyzePrototype(
      join(fixturesDir, "nextjs-supabase"),
    );

    expect(result.stack.language).toBe("typescript");
  });

  it("detects JavaScript when no tsconfig.json exists", async () => {
    const result = await analyzePrototype(join(fixturesDir, "minimal-repo"));

    expect(result.stack.language).toBe("javascript");
  });

  it("detects bun package manager from bun.lockb", async () => {
    const result = await analyzePrototype(join(fixturesDir, "bun-project"));

    expect(result.stack.packageManager).toBe("bun");
  });

  it("extracts ENV keys from .env.example", async () => {
    const result = await analyzePrototype(join(fixturesDir, "with-env"));

    expect(result.envKeys).toContain("SUPABASE_URL");
    expect(result.envKeys).toContain("SUPABASE_ANON_KEY");
    expect(result.envKeys).toContain("NEXT_PUBLIC_APP_URL");
    expect(result.envKeys).toHaveLength(3);
  });

  it("returns correct steps based on gaps", async () => {
    const result = await analyzePrototype(
      join(fixturesDir, "nextjs-supabase"),
    );

    const stepIds = result.steps.map((s) => s.id);

    // Always present
    expect(stepIds).toContain("analyze");
    expect(stepIds).toContain("deploy");

    // Next.js without error boundaries -> error-handling step
    expect(stepIds).toContain("error-handling");

    // No test files -> tests step
    expect(stepIds).toContain("tests");
  });

  it("includes env-input step when env keys are found", async () => {
    const result = await analyzePrototype(join(fixturesDir, "with-env"));

    const envStep = result.steps.find((s) => s.id === "env-input");
    expect(envStep).toBeDefined();
    expect(envStep!.label).toContain("3 variables");
  });

  it("handles empty/minimal repo gracefully", async () => {
    const result = await analyzePrototype(join(fixturesDir, "minimal-repo"));

    expect(result.stack.framework).toBeNull();
    expect(result.stack.database).toBeNull();
    expect(result.stack.styling).toBeNull();
    expect(result.stack.language).toBe("javascript");
    expect(result.stack.packageManager).toBe("npm");
    expect(result.gaps.needsTests).toBe(true);
    expect(result.gaps.needsLockfile).toBe(true);
    expect(result.envKeys).toHaveLength(0);
  });

  it("marks all steps as pending", async () => {
    const result = await analyzePrototype(
      join(fixturesDir, "nextjs-supabase"),
    );

    for (const step of result.steps) {
      expect(step.status).toBe("pending");
    }
  });

  it("sets parallel flag on parallelizable steps", async () => {
    const result = await analyzePrototype(
      join(fixturesDir, "nextjs-supabase"),
    );

    const errorStep = result.steps.find((s) => s.id === "error-handling");
    const testsStep = result.steps.find((s) => s.id === "tests");
    expect(errorStep?.parallel).toBe(true);
    expect(testsStep?.parallel).toBe(true);
  });
});
