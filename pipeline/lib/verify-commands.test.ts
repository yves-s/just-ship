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
});
