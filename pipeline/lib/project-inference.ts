/**
 * T-903 — Per-child project inference for cross-project epics.
 *
 * When a pitch is split into an Epic + children, each child is stamped with
 * a concrete `project_id` (see design spec at
 * docs/superpowers/specs/2026-04-19-cross-project-epics-design.md). The
 * project is inferred from the child's body signals — never asked of the
 * user (Decision Authority / CLAUDE.md).
 *
 * The inference is **deterministic and signal-based**:
 *   1. Build a per-project score by scanning the child body for signal
 *      keywords bound to each project.
 *   2. If one project's score dominates (≥ 1 and strictly greater than the
 *      runner-up), pick it.
 *   3. Otherwise fall back to the parent-request's default project.
 *   4. If the default is also null (standalone workspace-scoped epic with no
 *      hint), the inference is undefined — the caller decides how to surface
 *      that (typically: reject the split).
 *
 * Signals are intentionally small and human-auditable. The heuristic is
 * exposed so tests can assert behavior without stubbing a model call.
 */

/**
 * A project scoped to the inference run. `id` is the board's project UUID;
 * `signals` is a list of case-insensitive substrings / word stems that, when
 * present in a child's body, push the score toward this project.
 *
 * Design: signals are matched as whole words where reasonable, not raw
 * substrings, so "Boardroom" doesn't trigger the "board" project's signal.
 */
export interface ProjectSignals {
  id: string;
  /** Human-readable project slug/name, used in logs. */
  name: string;
  /** Case-insensitive tokens — checked with word-boundary regex. */
  signals: string[];
}

export interface InferenceInput {
  /** The child ticket body (markdown). */
  body: string;
  /** Optional: the child title — scanned with extra weight. */
  title?: string;
  /**
   * Registered projects, each with its signal tokens. Order doesn't affect
   * ranking — ties fall back to the default.
   */
  projects: ProjectSignals[];
  /**
   * Fallback project when no signal dominates. May be null (workspace-scoped
   * epic with no hint). Callers treat "null return" as "could not infer".
   */
  defaultProjectId?: string | null;
}

export interface InferenceResult {
  projectId: string | null;
  /** The reason the decision was made — useful for logs and ticket footers. */
  reason:
    | "signal"
    | "default"
    | "tie-broken-by-default"
    | "no-signal-no-default";
  /** Per-project match counts, keyed by project_id. */
  scores: Record<string, number>;
  /** The project that would have won on signals alone (may differ from
   *  projectId when a tie was broken by the default). */
  topProjectId: string | null;
}

/**
 * Build a word-boundary regex for a signal token.
 *
 * Plain `new RegExp(token, "gi")` is dangerous — a token like "UI" would
 * match inside "guide" or "build". We anchor both sides with a non-word
 * boundary unless the token starts/ends with an already-anchored character.
 */
function buildSignalRegex(token: string): RegExp {
  // Escape regex metacharacters so an accidental "." or "(" in a signal
  // doesn't blow up the caller.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w])${escaped}(?:$|[^\\w])`, "gi");
}

/**
 * Count how many times any of the signal tokens appear in the text. Each
 * token contributes at most once per occurrence in the text — titles are
 * included with a 2x multiplier so a "Widget settings page" titled child
 * wins over a "build-related tooling" body mention.
 */
function countSignals(text: string, signals: string[]): number {
  if (!text || signals.length === 0) return 0;
  let total = 0;
  for (const token of signals) {
    const re = buildSignalRegex(token);
    const matches = text.match(re);
    if (matches) total += matches.length;
  }
  return total;
}

/**
 * Infer the child's project from body/title signals.
 *
 * Returns a structured result so callers can log the decision and expose it
 * in the ticket body ("Project inferred from: {signal} → {project_name}").
 */
export function inferChildProject(input: InferenceInput): InferenceResult {
  const scores: Record<string, number> = {};
  for (const p of input.projects) {
    const body = input.body ?? "";
    const title = input.title ?? "";
    // Title matches count 2x — short titles are noisier per character but
    // also more deliberate, and "Engine API" in the title is a much stronger
    // signal than "engine" buried in a paragraph.
    scores[p.id] = countSignals(body, p.signals) + 2 * countSignals(title, p.signals);
  }

  // Find top and runner-up.
  let topId: string | null = null;
  let topScore = 0;
  let runnerUpScore = 0;
  for (const p of input.projects) {
    const s = scores[p.id] ?? 0;
    if (s > topScore) {
      runnerUpScore = topScore;
      topScore = s;
      topId = p.id;
    } else if (s > runnerUpScore) {
      runnerUpScore = s;
    }
  }

  const defaultProjectId = input.defaultProjectId ?? null;

  if (topScore > 0 && topScore > runnerUpScore) {
    return { projectId: topId, reason: "signal", scores, topProjectId: topId };
  }

  // Tie or no signal.
  if (defaultProjectId) {
    return {
      projectId: defaultProjectId,
      reason: topScore === 0 ? "default" : "tie-broken-by-default",
      scores,
      topProjectId: topId,
    };
  }

  return {
    projectId: null,
    reason: "no-signal-no-default",
    scores,
    topProjectId: topId,
  };
}

/**
 * Classify the set of children's inferred projects into a single bucket so
 * the caller can decide the epic's project_id without re-scanning.
 *
 * - `single-project`: all children resolve to the same project → epic stays
 *   project-bound (set epic project_id = that project).
 * - `cross-project`: children span ≥ 2 projects → epic becomes workspace-
 *   scoped (set epic project_id = null).
 * - `unresolved`: at least one child could not be inferred and no default
 *   exists — caller must reject or ask for help before creating.
 */
export function classifyEpicScope(
  childProjectIds: Array<string | null>,
): "single-project" | "cross-project" | "unresolved" {
  if (childProjectIds.some((p) => p === null)) return "unresolved";
  const distinct = new Set(childProjectIds);
  if (distinct.size <= 1) return "single-project";
  return "cross-project";
}

/**
 * Sensible default signal tokens for the Just Ship workspace. Projects
 * consuming this module in other workspaces should pass their own `signals`
 * arrays — these are baked as the reference implementation, not hardcoded
 * into the inference call.
 *
 * Tokens are intentionally minimal: common false-positives like "app" or
 * "code" are excluded; specific surface names ("Widget", "Swimlane", "API
 * endpoint") are included.
 */
export const DEFAULT_JUST_SHIP_SIGNALS = {
  engine: [
    "engine",
    "pipeline",
    "orchestrator",
    "worker",
    "classifier",
    "classify",
    "develop command",
    "ship command",
    "agent",
    "skill",
    "board-api.sh",
    "server.ts",
    "API endpoint",
    "Engine API",
    "/api/sidekick",
  ],
  board: [
    "Board UI",
    "board-ui",
    "Swimlane",
    "swimlanes",
    "Widget",
    "kanban",
    "ticket card",
    "Epic-Detail",
    "ticket detail",
    "board page",
    "sidebar",
    "shadcn",
    "TanStack",
    "Next.js",
    "React component",
    "src/app",
    "src/components",
  ],
} as const;
