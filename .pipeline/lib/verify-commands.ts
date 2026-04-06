/**
 * Verify Commands — Resolves and runs build/lint/test commands with retry logic
 *
 * Resolution order:
 *   1. Configured verify command from project.json (blocking)
 *   2. Shopify default (`shopify theme check --fail-level error`) for Liquid projects (blocking)
 *   3. Auto-discovered scripts from package.json: lint, test, typecheck (advisory)
 *   4. Deduplication — configured commands suppress matching auto-discovered ones
 */

import { execSync } from "node:child_process";
import { logger } from "./logger.ts";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

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

export interface RunVerifyOptions {
  workDir: string;
  commands: VerifyCommand[];
  maxRetries?: number;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Auto-discovery keys — package.json scripts we look for
// ---------------------------------------------------------------------------

const DISCOVERABLE_SCRIPTS = ["lint", "test", "typecheck"] as const;

// ---------------------------------------------------------------------------
// resolveVerifyCommands
// ---------------------------------------------------------------------------

/**
 * Determine which verify commands to run based on project configuration.
 *
 * Priority:
 *   1. Explicit verify command from project.json (blocking)
 *   2. Shopify theme check when platform=shopify, variant=liquid, CLI available (blocking)
 *   3. Auto-discovered package.json scripts: lint, test, typecheck (non-blocking / advisory)
 *
 * Deduplication: if the configured command string already contains a discoverable
 * script name (e.g. "npm run typecheck"), that script is not added again.
 */
export function resolveVerifyCommands(config: VerifyConfig): VerifyCommand[] {
  const commands: VerifyCommand[] = [];
  const configuredCmd = config.verifyCommand?.trim() ?? "";

  // 1. Configured verify command
  if (configuredCmd) {
    commands.push({
      cmd: configuredCmd,
      source: "project.json",
      blocking: true,
    });
  }

  // 2. Shopify default
  if (
    config.platform === "shopify" &&
    config.variant === "liquid" &&
    config.shopifyCliAvailable
  ) {
    commands.push({
      cmd: "shopify theme check --fail-level error",
      source: "shopify-default",
      blocking: true,
    });
  }

  // 3. Auto-discovered package.json scripts (advisory / non-blocking)
  for (const scriptName of DISCOVERABLE_SCRIPTS) {
    if (!config.packageJsonScripts[scriptName]) continue;

    // Skip if the configured command already covers this script
    if (configuredCmd && configuredCmd.includes(scriptName)) continue;

    commands.push({
      cmd: `npm run ${scriptName}`,
      source: "package.json",
      blocking: false,
    });
  }

  return commands;
}

// ---------------------------------------------------------------------------
// runVerifyCommands
// ---------------------------------------------------------------------------

/**
 * Execute verify commands sequentially with retry logic for blocking commands.
 *
 * - Each command gets `maxRetries` retry attempts on failure (only blocking ones retry).
 * - Total attempts per command = 1 initial + maxRetries.
 * - Non-blocking (advisory) commands run once without retry.
 */
export function runVerifyCommands(opts: RunVerifyOptions): VerifyCommandResult[] {
  const { workDir, commands, maxRetries = 2, timeoutMs = 60_000 } = opts;
  const results: VerifyCommandResult[] = [];

  for (const command of commands) {
    const totalAttempts = command.blocking ? 1 + maxRetries : 1;
    let lastOutput = "";
    let passed = false;
    let attempts = 0;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      attempts = attempt;
      logger.warn({ cmd: command.cmd, attempt, totalAttempts }, "Running verify command");

      try {
        const stdout = execSync(command.cmd, {
          cwd: workDir,
          timeout: timeoutMs,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          maxBuffer: 10 * 1024 * 1024,
        });
        lastOutput = stdout;
        passed = true;
        break;
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        lastOutput = [error.stdout ?? "", error.stderr ?? ""]
          .filter(Boolean)
          .join("\n") || (error.message ?? "Unknown error");
      }
    }

    // Truncate long output
    const truncated =
      lastOutput.length > 3000 ? `...${lastOutput.slice(-3000)}` : lastOutput;

    results.push({
      cmd: command.cmd,
      passed,
      output: truncated,
      attempts,
      blocking: command.blocking,
    });
  }

  return results;
}
