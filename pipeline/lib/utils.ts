/**
 * Shared pipeline utilities — extracted from worker.ts, run.ts, server.ts,
 * qa-fix-loop.ts, and vercel-preview.ts to eliminate duplication.
 */

import { sanitizeBranchName } from "./sanitize.ts";

/**
 * Generate a git branch name from a prefix, ticket ID, and title.
 *
 * The title is slugified (lowercased, non-alphanumeric chars replaced with
 * dashes, consecutive dashes collapsed, trimmed to 40 chars). The result is
 * passed through `sanitizeBranchName` to reject unsafe characters before any
 * shell interpolation.
 */
export function toBranchName(prefix: string, ticketId: string | number, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
  const name = `${prefix}${ticketId}-${slug}`;
  return sanitizeBranchName(name);
}

/**
 * Promise-based sleep.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Timestamped log to stdout (format: `[YYYY-MM-DD HH:MM:SS] message`).
 */
export function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}
