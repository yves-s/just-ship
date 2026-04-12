import { describe, it, expect } from "vitest";
import { resolveVerifyCommands } from "./verify-commands.ts";
import type { VerifyConfig } from "./verify-commands.ts";

describe("resolveVerifyCommands", () => {
  it("returns configured verify command as blocking", () => {
    const config: VerifyConfig = {
      verifyCommand: "npm run typecheck && npm run lint",
      packageJsonScripts: {},
    };

    const commands = resolveVerifyCommands(config);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      cmd: "npm run typecheck && npm run lint",
      source: "project.json",
      blocking: true,
    });
  });

  it("adds shopify theme check for liquid projects when CLI available", () => {
    const config: VerifyConfig = {
      platform: "shopify",
      variant: "liquid",
      shopifyCliAvailable: true,
      packageJsonScripts: {},
    };

    const commands = resolveVerifyCommands(config);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      cmd: "shopify theme check --fail-level error",
      source: "shopify-default",
      blocking: true,
    });
  });

  it("does NOT add shopify theme check when CLI not available", () => {
    const config: VerifyConfig = {
      platform: "shopify",
      variant: "liquid",
      shopifyCliAvailable: false,
      packageJsonScripts: {},
    };

    const commands = resolveVerifyCommands(config);

    expect(commands).toHaveLength(0);
  });

  it("discovers lint, test, typecheck from package.json as non-blocking", () => {
    const config: VerifyConfig = {
      packageJsonScripts: {
        lint: "eslint .",
        test: "vitest run",
        typecheck: "tsc --noEmit",
        build: "next build", // should be ignored — not in discoverable list
      },
    };

    const commands = resolveVerifyCommands(config);

    expect(commands).toHaveLength(3);
    expect(commands.every((c) => c.blocking === false)).toBe(true);
    expect(commands.every((c) => c.source === "package.json")).toBe(true);
    expect(commands.map((c) => c.cmd)).toEqual([
      "npm run lint",
      "npm run test",
      "npm run typecheck",
    ]);
  });

  it("does not duplicate configured command in auto-discovery", () => {
    const config: VerifyConfig = {
      verifyCommand: "npm run typecheck",
      packageJsonScripts: {
        lint: "eslint .",
        typecheck: "tsc --noEmit",
      },
    };

    const commands = resolveVerifyCommands(config);

    // Should have: configured "npm run typecheck" (blocking) + discovered "lint" (advisory)
    // Should NOT have: discovered "typecheck" again
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({
      cmd: "npm run typecheck",
      source: "project.json",
      blocking: true,
    });
    expect(commands[1]).toEqual({
      cmd: "npm run lint",
      source: "package.json",
      blocking: false,
    });
  });

  it("returns empty array when nothing configured", () => {
    const config: VerifyConfig = {
      packageJsonScripts: {},
    };

    const commands = resolveVerifyCommands(config);

    expect(commands).toEqual([]);
  });

  it("adds npm run build for shopify remix apps", () => {
    const config: VerifyConfig = {
      platform: "shopify",
      variant: "remix",
      packageJsonScripts: { build: "remix build" },
    };

    const commands = resolveVerifyCommands(config);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      cmd: "npm run build",
      source: "shopify-default",
      blocking: true,
    });
  });

  it("does not add shopify remix defaults when verify command is configured", () => {
    const config: VerifyConfig = {
      verifyCommand: "npm run build && npm run lint",
      platform: "shopify",
      variant: "remix",
      packageJsonScripts: {},
    };

    const commands = resolveVerifyCommands(config);

    expect(commands).toHaveLength(1);
    expect(commands[0].source).toBe("project.json");
  });

  it("adds eslint and tsc for remix when config files exist", () => {
    const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const os = require("node:os");

    const tmpDir = mkdtempSync(join(os.tmpdir(), "verify-test-"));
    try {
      writeFileSync(join(tmpDir, "eslint.config.js"), "export default [];");
      writeFileSync(join(tmpDir, "tsconfig.json"), "{}");

      const config: VerifyConfig = {
        platform: "shopify",
        variant: "remix",
        workDir: tmpDir,
        packageJsonScripts: {},
      };

      const commands = resolveVerifyCommands(config);

      expect(commands).toHaveLength(3);
      expect(commands[0].cmd).toBe("npm run build");
      expect(commands[0].blocking).toBe(true);
      expect(commands[1].cmd).toBe("npx eslint .");
      expect(commands[1].blocking).toBe(false);
      expect(commands[2].cmd).toBe("npx tsc --noEmit");
      expect(commands[2].blocking).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
