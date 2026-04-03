/**
 * Shared spawn wrapper for Claude Code SDK subprocesses.
 *
 * Captures stderr and prefixes each line with `logPrefix [stderr]` so pipeline
 * logs stay readable. Used by run.ts (orchestrator, triage, enrichment) and
 * qa-fix-loop.ts (fix sessions).
 */

import { spawn } from "node:child_process";

export function makeSpawn(logPrefix: string) {
  return (spawnOptions: { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal }) => {
    const { command, args, cwd, env, signal } = spawnOptions;
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], signal } as Parameters<typeof spawn>[2]);
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) console.error(`${logPrefix} [stderr] ${line}`);
      }
    });
    return child;
  };
}
