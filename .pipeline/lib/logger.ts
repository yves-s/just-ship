/**
 * Structured logger for the just-ship pipeline engine.
 *
 * Backed by Pino with built-in redaction for secrets, ISO timestamps,
 * and a stable `service: "engine"` base field on every log line.
 *
 * Usage:
 *   import { logger } from "./logger.ts";
 *   logger.info({ ticketNumber: "42" }, "Pipeline started");
 *
 *   import { createPipelineLogger } from "./logger.ts";
 *   const log = createPipelineLogger({ ticketNumber: "42", branch: "feature/T-42-..." });
 *   log.debug({ phase: "triage" }, "Triage started");
 */

import pino from "pino";

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Paths that are redacted in every log object.
 * Pino's `redact` option performs efficient in-place masking before
 * serialisation — values are never written to the log stream.
 */
const REDACT_PATHS = [
  // Top-level credential fields
  "apiKey", "api_key", "apikey",
  "token", "access_token", "refresh_token",
  "secret", "password", "authorization",
  "SUPABASE_SERVICE_KEY", "ANTHROPIC_API_KEY",
  "X-Pipeline-Key", "GH_TOKEN",
  // Nested under request headers
  "headers.authorization", "headers.x-pipeline-key",
  // Nested under process env passed as object
  "env.ANTHROPIC_API_KEY", "env.SUPABASE_SERVICE_KEY", "env.GH_TOKEN",
];

/**
 * Partially mask a secret value so it's identifiable but not fully exposed.
 * Short values (<= 8 chars) are fully masked.
 */
function censorValue(value: unknown): string {
  if (typeof value !== "string") return "[REDACTED]";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Log level
// ---------------------------------------------------------------------------

const LOG_LEVEL = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

// ---------------------------------------------------------------------------
// Root logger
// ---------------------------------------------------------------------------

const rootLogger = pino({
  level: LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: censorValue,
  },
  // ISO 8601 timestamps on every line
  timestamp: pino.stdTimeFunctions.isoTime,
  // Every log line carries service=engine for log aggregation routing
  base: {
    service: "engine",
  },
  formatters: {
    // Emit level as a string label (e.g. "info") rather than the numeric Pino default
    level: (label: string) => ({ level: label }),
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { rootLogger as logger };
export type Logger = pino.Logger;

/**
 * Create a child logger with additional persistent context fields.
 * All fields are included in every subsequent log call on the child logger.
 *
 * @example
 * const log = createChildLogger({ requestId: "req-123", component: "server" });
 * log.info("Request received");
 */
export function createChildLogger(bindings: Record<string, unknown>): pino.Logger {
  return rootLogger.child(bindings);
}

/**
 * Create a logger scoped to a specific pipeline ticket run.
 * Includes ticketNumber, optional workspaceId, branch, and requestId
 * in every log line for structured correlation.
 *
 * @example
 * const log = createPipelineLogger({ ticketNumber: "554", branch: "feature/T-554-..." });
 * log.info({ phase: "planning" }, "Orchestrator started");
 */
export function createPipelineLogger(opts: {
  ticketNumber: string | number;
  workspaceId?: string;
  branch?: string;
  requestId?: string;
}): pino.Logger {
  return rootLogger.child({
    ticketNumber: String(opts.ticketNumber),
    ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
    ...(opts.branch ? { branch: opts.branch } : {}),
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
  });
}
