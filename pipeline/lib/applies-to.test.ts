import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  APPLIES_TO_VALUES,
  isAppliesToValue,
  validateAppliesTo,
  resolveMode,
  parseScalarField,
  extractFrontmatter,
  checkAppliesTo,
  detectRepoFlavour,
  type RuntimeContext,
} from "./applies-to.js";

const ENGINE_TOP_LEVEL: RuntimeContext = { runtime: "top-level", repo: "engine" };
const ENGINE_SUBAGENT: RuntimeContext = { runtime: "subagent", repo: "engine" };
const ENGINE_AUDIT: RuntimeContext = { runtime: "audit", repo: "engine" };
const ENGINE_PIPELINE: RuntimeContext = { runtime: "pipeline", repo: "engine" };
const CUSTOMER_TOP_LEVEL: RuntimeContext = { runtime: "top-level", repo: "customer" };
const CUSTOMER_PIPELINE: RuntimeContext = { runtime: "pipeline", repo: "customer" };

describe("APPLIES_TO_VALUES", () => {
  it("contains exactly the 10 documented vocabulary values", () => {
    expect(APPLIES_TO_VALUES).toHaveLength(10);
    expect(APPLIES_TO_VALUES).toContain("all-agents");
    expect(APPLIES_TO_VALUES).toContain("top-level-only");
    expect(APPLIES_TO_VALUES).toContain("subagents-only");
    expect(APPLIES_TO_VALUES).toContain("audit-runtime-only");
    expect(APPLIES_TO_VALUES).toContain("pipeline-runtime-only");
    expect(APPLIES_TO_VALUES).toContain("engine-repo-only");
    expect(APPLIES_TO_VALUES).toContain("customer-projects-only");
    expect(APPLIES_TO_VALUES).toContain("source-repo-only");
    expect(APPLIES_TO_VALUES).toContain("install-repo-only");
    expect(APPLIES_TO_VALUES).toContain("human-readable-only");
  });
});

describe("isAppliesToValue", () => {
  it("recognises every vocabulary value", () => {
    for (const v of APPLIES_TO_VALUES) {
      expect(isAppliesToValue(v)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isAppliesToValue("everywhere")).toBe(false);
    expect(isAppliesToValue("ALL-AGENTS")).toBe(false);
    expect(isAppliesToValue("")).toBe(false);
  });
});

describe("validateAppliesTo", () => {
  it("all-agents accepts every runtime context", () => {
    expect(validateAppliesTo("all-agents", ENGINE_TOP_LEVEL)).toBeNull();
    expect(validateAppliesTo("all-agents", ENGINE_SUBAGENT)).toBeNull();
    expect(validateAppliesTo("all-agents", ENGINE_AUDIT)).toBeNull();
    expect(validateAppliesTo("all-agents", ENGINE_PIPELINE)).toBeNull();
    expect(validateAppliesTo("all-agents", CUSTOMER_TOP_LEVEL)).toBeNull();
  });

  it("human-readable-only rejects every runtime", () => {
    expect(validateAppliesTo("human-readable-only", ENGINE_TOP_LEVEL)).toContain(
      "must not be loaded",
    );
    expect(validateAppliesTo("human-readable-only", ENGINE_SUBAGENT)).toContain(
      "must not be loaded",
    );
  });

  it("top-level-only rejects subagent / audit / pipeline runtimes", () => {
    expect(validateAppliesTo("top-level-only", ENGINE_TOP_LEVEL)).toBeNull();
    expect(validateAppliesTo("top-level-only", ENGINE_SUBAGENT)).toContain(
      "top-level-only but loaded into subagent",
    );
    expect(validateAppliesTo("top-level-only", ENGINE_AUDIT)).toContain(
      "loaded into audit",
    );
    expect(validateAppliesTo("top-level-only", ENGINE_PIPELINE)).toContain(
      "loaded into pipeline",
    );
  });

  it("subagents-only rejects everything except subagent runtime", () => {
    expect(validateAppliesTo("subagents-only", ENGINE_SUBAGENT)).toBeNull();
    expect(validateAppliesTo("subagents-only", ENGINE_TOP_LEVEL)).toContain(
      "loaded into top-level",
    );
    expect(validateAppliesTo("subagents-only", ENGINE_AUDIT)).toContain(
      "loaded into audit",
    );
  });

  it("audit-runtime-only rejects non-audit runtimes — this is the T-1014 / CTO Audit Lauf 1 fix", () => {
    expect(validateAppliesTo("audit-runtime-only", ENGINE_AUDIT)).toBeNull();
    expect(validateAppliesTo("audit-runtime-only", ENGINE_SUBAGENT)).toContain(
      "audit-runtime-only but loaded into subagent",
    );
    expect(validateAppliesTo("audit-runtime-only", ENGINE_TOP_LEVEL)).toContain(
      "loaded into top-level",
    );
  });

  it("pipeline-runtime-only rejects non-pipeline runtimes", () => {
    expect(validateAppliesTo("pipeline-runtime-only", ENGINE_PIPELINE)).toBeNull();
    expect(validateAppliesTo("pipeline-runtime-only", ENGINE_TOP_LEVEL)).toContain(
      "loaded into top-level",
    );
  });

  it("engine-repo-only rejects customer repos", () => {
    expect(validateAppliesTo("engine-repo-only", ENGINE_TOP_LEVEL)).toBeNull();
    expect(validateAppliesTo("engine-repo-only", ENGINE_PIPELINE)).toBeNull();
    expect(validateAppliesTo("engine-repo-only", CUSTOMER_TOP_LEVEL)).toContain(
      "engine-repo-only but loaded into customer",
    );
  });

  it("customer-projects-only rejects engine repos", () => {
    expect(validateAppliesTo("customer-projects-only", CUSTOMER_TOP_LEVEL)).toBeNull();
    expect(validateAppliesTo("customer-projects-only", ENGINE_TOP_LEVEL)).toContain(
      "customer-projects-only but loaded into engine",
    );
  });

  it("source-repo-only is allowed only in engine repo", () => {
    expect(validateAppliesTo("source-repo-only", ENGINE_TOP_LEVEL)).toBeNull();
    expect(validateAppliesTo("source-repo-only", CUSTOMER_TOP_LEVEL)).toContain(
      "source-repo-only but loaded into customer",
    );
  });

  it("install-repo-only is allowed in any repo flavour", () => {
    expect(validateAppliesTo("install-repo-only", ENGINE_TOP_LEVEL)).toBeNull();
    expect(validateAppliesTo("install-repo-only", CUSTOMER_TOP_LEVEL)).toBeNull();
  });
});

describe("resolveMode", () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.JS_APPLIES_TO_MODE;
    delete process.env.JS_APPLIES_TO_MODE;
  });
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.JS_APPLIES_TO_MODE;
    } else {
      process.env.JS_APPLIES_TO_MODE = originalEnv;
    }
  });

  it("defaults to fail in engine repo", () => {
    expect(resolveMode("engine")).toBe("fail");
  });

  it("defaults to warn in customer repo (so customer migrations don't break their pipeline)", () => {
    expect(resolveMode("customer")).toBe("warn");
  });

  it("respects JS_APPLIES_TO_MODE env override", () => {
    process.env.JS_APPLIES_TO_MODE = "warn";
    expect(resolveMode("engine")).toBe("warn");
    process.env.JS_APPLIES_TO_MODE = "off";
    expect(resolveMode("engine")).toBe("off");
    process.env.JS_APPLIES_TO_MODE = "fail";
    expect(resolveMode("customer")).toBe("fail");
  });

  it("ignores invalid env values and falls back to flavour default", () => {
    process.env.JS_APPLIES_TO_MODE = "loud";
    expect(resolveMode("engine")).toBe("fail");
  });
});

describe("parseScalarField", () => {
  it("reads an unquoted value", () => {
    expect(parseScalarField("applies_to: all-agents", "applies_to")).toBe("all-agents");
  });

  it("reads a double-quoted value", () => {
    expect(parseScalarField('applies_to: "top-level-only"', "applies_to")).toBe(
      "top-level-only",
    );
  });

  it("reads a single-quoted value", () => {
    expect(parseScalarField("applies_to: 'subagents-only'", "applies_to")).toBe(
      "subagents-only",
    );
  });

  it("returns null when field is missing", () => {
    expect(parseScalarField("name: foo\ndescription: bar", "applies_to")).toBeNull();
  });

  it("does not match a similarly-named field", () => {
    expect(parseScalarField("applies_to_legacy: all", "applies_to")).toBeNull();
  });

  it("ignores trailing whitespace", () => {
    expect(parseScalarField("applies_to: all-agents   ", "applies_to")).toBe(
      "all-agents",
    );
  });
});

describe("extractFrontmatter", () => {
  it("extracts the inner block between --- delimiters", () => {
    const content = "---\nname: foo\napplies_to: all-agents\n---\n\nbody";
    expect(extractFrontmatter(content)).toBe("name: foo\napplies_to: all-agents");
  });

  it("returns null for files without frontmatter", () => {
    expect(extractFrontmatter("# Just a heading\n\nNo frontmatter.")).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\napplies_to: all-agents\r\n---\r\n\r\nbody";
    expect(extractFrontmatter(content)).toBe("applies_to: all-agents");
  });
});

describe("checkAppliesTo", () => {
  it("passes when frontmatter declares a compatible scope", () => {
    const content = "---\napplies_to: all-agents\n---\n\nbody";
    const ok = checkAppliesTo({
      filePath: "/repo/skills/foo.md",
      content,
      context: ENGINE_SUBAGENT,
    });
    expect(ok).toBe(true);
  });

  it("throws in fail mode when applies_to is missing", () => {
    const content = "---\nname: foo\n---\n\nbody";
    expect(() =>
      checkAppliesTo({
        filePath: "/repo/skills/foo.md",
        content,
        context: ENGINE_SUBAGENT,
        mode: "fail",
      }),
    ).toThrow(/applies_to_missing/);
  });

  it("throws in fail mode when frontmatter is entirely absent", () => {
    expect(() =>
      checkAppliesTo({
        filePath: "/repo/.claude/rules/foo.md",
        content: "Just plain markdown without frontmatter.",
        context: ENGINE_TOP_LEVEL,
        mode: "fail",
      }),
    ).toThrow(/applies_to_missing.*has no frontmatter/);
  });

  it("throws in fail mode when applies_to value is outside the vocabulary", () => {
    const content = "---\napplies_to: everywhere\n---\n\nbody";
    expect(() =>
      checkAppliesTo({
        filePath: "/repo/skills/foo.md",
        content,
        context: ENGINE_SUBAGENT,
        mode: "fail",
      }),
    ).toThrow(/applies_to_invalid/);
  });

  it("throws in fail mode on runtime mismatch — the audit-runtime-only / general-purpose-agent bug", () => {
    const content = "---\napplies_to: audit-runtime-only\n---\n\nbody";
    expect(() =>
      checkAppliesTo({
        filePath: "/repo/.claude/rules/expert-audit-scope.md",
        content,
        context: ENGINE_SUBAGENT,
        mode: "fail",
      }),
    ).toThrow(/applies_to_mismatch/);
  });

  it("returns false (not throws) in warn mode on missing field", () => {
    const content = "---\nname: foo\n---\n\nbody";
    const ok = checkAppliesTo({
      filePath: "/repo/skills/foo.md",
      content,
      context: ENGINE_SUBAGENT,
      mode: "warn",
    });
    expect(ok).toBe(false);
  });

  it("short-circuits in off mode", () => {
    const ok = checkAppliesTo({
      filePath: "/repo/skills/foo.md",
      content: "no frontmatter at all",
      context: ENGINE_SUBAGENT,
      mode: "off",
    });
    expect(ok).toBe(true);
  });

  it("rejects human-readable-only artifacts in any runtime", () => {
    const content = "---\napplies_to: human-readable-only\n---\n\ndocs only";
    expect(() =>
      checkAppliesTo({
        filePath: "/repo/docs/operating-model.md",
        content,
        context: ENGINE_TOP_LEVEL,
        mode: "fail",
      }),
    ).toThrow(/human-readable-only/);
  });
});

describe("detectRepoFlavour", () => {
  // Hardcoded paths in vi.mock can't share fixtures with the cwd runner, so
  // we mock node:fs's existsSync per scenario.
  it("returns engine when both pipeline/ source and .pipeline/ install are present", async () => {
    vi.resetModules();
    vi.doMock("node:fs", () => ({
      existsSync: (p: string) =>
        p.endsWith("/pipeline/package.json") || p.endsWith("/.pipeline/package.json"),
    }));
    const { detectRepoFlavour: fn } = await import("./applies-to.ts");
    expect(fn("/some/repo")).toBe("engine");
    vi.doUnmock("node:fs");
  });

  it("returns customer when only .pipeline/ install is present", async () => {
    vi.resetModules();
    vi.doMock("node:fs", () => ({
      existsSync: (p: string) => p.endsWith("/.pipeline/package.json"),
    }));
    const { detectRepoFlavour: fn } = await import("./applies-to.ts");
    expect(fn("/customer/repo")).toBe("customer");
    vi.doUnmock("node:fs");
  });

  it("returns engine when neither is present (safest default during dev)", async () => {
    vi.resetModules();
    vi.doMock("node:fs", () => ({
      existsSync: () => false,
    }));
    const { detectRepoFlavour: fn } = await import("./applies-to.ts");
    expect(fn("/empty")).toBe("engine");
    vi.doUnmock("node:fs");
  });
});
