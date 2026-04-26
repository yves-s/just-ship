import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger.ts";

/**
 * The 10 valid `applies_to:` scope markers. Every artifact (rule, skill, agent
 * definition) carries one of these to declare WHERE it applies — top-level
 * Claude Code, subagents, the audit runtime, the pipeline orchestrator, the
 * engine source repo, an installed customer project, or human readers only.
 *
 * The loader validates this against the current runtime context and throws
 * when an artifact is loaded into a context it does not apply to.
 */
export const APPLIES_TO_VALUES = [
  "all-agents",
  "top-level-only",
  "subagents-only",
  "audit-runtime-only",
  "pipeline-runtime-only",
  "engine-repo-only",
  "customer-projects-only",
  "source-repo-only",
  "install-repo-only",
  "human-readable-only",
] as const;

export type AppliesTo = (typeof APPLIES_TO_VALUES)[number];

export function isAppliesToValue(v: string): v is AppliesTo {
  return (APPLIES_TO_VALUES as readonly string[]).includes(v);
}

/**
 * The runtime context an artifact is being loaded INTO. Pipeline orchestrator,
 * audit runtime, top-level CC session, or a spawned subagent. Repo flavour
 * (engine vs customer) is detected from the project directory layout.
 */
export interface RuntimeContext {
  /** Where the load is happening */
  runtime: "pipeline" | "audit" | "top-level" | "subagent";
  /** Repo flavour detected from filesystem */
  repo: "engine" | "customer";
}

/**
 * Detect the repo flavour from the project directory.
 * - engine: source `pipeline/` AND installed `.pipeline/` both present
 *           (this is the just-ship engine repo bootstrapping itself).
 * - customer: only installed `.pipeline/` present (or only source — a fresh
 *             clone before setup.sh — also treated as engine for safety).
 *
 * The signature mirrors `.githooks/pre-commit` so behaviour stays consistent.
 */
export function detectRepoFlavour(projectDir: string): "engine" | "customer" {
  const hasSource = existsSync(resolve(projectDir, "pipeline", "package.json"));
  const hasInstall = existsSync(resolve(projectDir, ".pipeline", "package.json"));
  if (hasSource) return "engine";
  if (hasInstall) return "customer";
  // Neither — treat as engine so the strictest checks apply during dev.
  return "engine";
}

/**
 * Validate an `applies_to:` value against the current runtime context.
 * Returns null if compatible, or a string describing the mismatch.
 */
export function validateAppliesTo(
  appliesTo: AppliesTo,
  context: RuntimeContext,
): string | null {
  switch (appliesTo) {
    case "all-agents":
      return null;
    case "human-readable-only":
      // Documentation-only artifacts must never be loaded by any runtime.
      return `artifact is marked human-readable-only and must not be loaded by any runtime`;
    case "top-level-only":
      if (context.runtime !== "top-level") {
        return `artifact is top-level-only but loaded into ${context.runtime} runtime`;
      }
      return null;
    case "subagents-only":
      if (context.runtime !== "subagent") {
        return `artifact is subagents-only but loaded into ${context.runtime} runtime`;
      }
      return null;
    case "audit-runtime-only":
      if (context.runtime !== "audit") {
        return `artifact is audit-runtime-only but loaded into ${context.runtime} runtime`;
      }
      return null;
    case "pipeline-runtime-only":
      if (context.runtime !== "pipeline") {
        return `artifact is pipeline-runtime-only but loaded into ${context.runtime} runtime`;
      }
      return null;
    case "engine-repo-only":
      if (context.repo !== "engine") {
        return `artifact is engine-repo-only but loaded into ${context.repo} repo`;
      }
      return null;
    case "customer-projects-only":
      if (context.repo !== "customer") {
        return `artifact is customer-projects-only but loaded into ${context.repo} repo`;
      }
      return null;
    case "source-repo-only":
      // source-repo-only documents source files that don't ship to install.
      // Loading is allowed in engine-repo (source is present); blocked otherwise.
      if (context.repo !== "engine") {
        return `artifact is source-repo-only but loaded into ${context.repo} repo`;
      }
      return null;
    case "install-repo-only":
      // install-repo-only documents files that exist post-install (e.g. .pipeline/).
      // Allowed in any repo flavour — they exist whenever .pipeline/ exists.
      return null;
  }
}

/**
 * Loader enforcement modes. Default is `fail` in the engine repo (we control
 * all artifacts) and `warn` elsewhere. Override via env `JS_APPLIES_TO_MODE`.
 *
 * - `fail`: throw on missing or mismatched `applies_to:`
 * - `warn`: log a warning, allow the load to proceed
 * - `off`:  skip validation entirely (escape hatch for CI smoke runs)
 */
export type AppliesToMode = "fail" | "warn" | "off";

export function resolveMode(repoFlavour: "engine" | "customer"): AppliesToMode {
  const env = process.env.JS_APPLIES_TO_MODE?.toLowerCase();
  if (env === "fail" || env === "warn" || env === "off") return env;
  return repoFlavour === "engine" ? "fail" : "warn";
}

/**
 * Parse a single scalar field from YAML frontmatter content (no leading/trailing
 * `---` delimiters required — pass the inner block).
 *
 * Supports inline values with optional quotes:
 *   applies_to: all-agents
 *   applies_to: "top-level-only"
 *   applies_to: 'subagents-only'
 *
 * Returns null when the field is absent.
 */
export function parseScalarField(frontmatter: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}:\\s*["']?([^\\n"']+)["']?\\s*$`, "m");
  const match = frontmatter.match(re);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Extract the inner frontmatter block (between `---` delimiters) from a file's
 * full content. Returns null if no frontmatter is present.
 */
export function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

export interface AppliesToCheck {
  /** Path of the file being checked, for error messages */
  filePath: string;
  /** Full file content (frontmatter is extracted internally) */
  content: string;
  /** The runtime context to validate against */
  context: RuntimeContext;
  /** Override mode (defaults to env / repo-flavour resolution) */
  mode?: AppliesToMode;
}

/**
 * Verify a single artifact's `applies_to:` declaration against the runtime
 * context. Returns true when the artifact is compatible or the mode allows
 * proceeding. Throws when mode is `fail` and the artifact is missing or
 * mismatched.
 */
export function checkAppliesTo({
  filePath,
  content,
  context,
  mode,
}: AppliesToCheck): boolean {
  const effectiveMode = mode ?? resolveMode(context.repo);
  if (effectiveMode === "off") return true;

  const fm = extractFrontmatter(content);
  if (!fm) {
    return reportFailure(
      `applies_to_missing: artifact ${filePath} has no frontmatter (expected applies_to:)`,
      effectiveMode,
    );
  }

  const value = parseScalarField(fm, "applies_to");
  if (!value) {
    return reportFailure(
      `applies_to_missing: artifact ${filePath} has no applies_to: field`,
      effectiveMode,
    );
  }

  if (!isAppliesToValue(value)) {
    return reportFailure(
      `applies_to_invalid: artifact ${filePath} has applies_to: ${value} — not in vocabulary [${APPLIES_TO_VALUES.join(", ")}]`,
      effectiveMode,
    );
  }

  const mismatch = validateAppliesTo(value, context);
  if (mismatch) {
    return reportFailure(
      `applies_to_mismatch: ${filePath} — ${mismatch}`,
      effectiveMode,
    );
  }

  return true;
}

function reportFailure(message: string, mode: AppliesToMode): boolean {
  if (mode === "fail") {
    throw new Error(message);
  }
  logger.warn({ message }, "applies_to validation");
  return false;
}
