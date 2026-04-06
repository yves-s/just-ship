/**
 * Shared spawn wrapper for Claude Code SDK subprocesses.
 *
 * Captures stderr and prefixes each line with `logPrefix [stderr]` so pipeline
 * logs stay readable. Used by run.ts (orchestrator, triage, enrichment) and
 * qa-fix-loop.ts (fix sessions).
 */

import { spawn } from "node:child_process";
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.ts";

export function makeSpawn(logPrefix: string) {
  return (spawnOptions: SpawnOptions): SpawnedProcess => {
    const { command, args, cwd, env, signal } = spawnOptions;
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], signal } as Parameters<typeof spawn>[2]);
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) logger.debug({ logPrefix, line }, "stderr");
      }
    });
    // stdio: ["pipe", "pipe", "pipe"] guarantees stdin/stdout are non-null
    return child as unknown as SpawnedProcess;
  };
}
