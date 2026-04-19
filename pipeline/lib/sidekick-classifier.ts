import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.ts";
import { Sentry } from "./sentry.ts";

export type Category = "ticket" | "epic" | "conversation" | "project";

export interface ProjectContext {
  /** Project name shown to the user (e.g. "just-ship", "lnb"). */
  projectName?: string;
  /** Slug of the active project. */
  projectSlug?: string;
  /** Free-form project type (e.g. "framework", "saas-app", "shopify-theme"). */
  projectType?: string;
  /** Titles/numbers of recent tickets — gives the model context for "change to existing X". */
  existingTickets?: Array<{ number: number; title: string }>;
  /** Titles/numbers of existing epics — same purpose. */
  existingEpics?: Array<{ number: number; title: string }>;
}

export interface ClassificationInput {
  text: string;
  projectContext?: ProjectContext;
}

export interface ClassificationResult {
  category: Category;
  confidence: number; // 0.0 to 1.0
  reasoning: string;
  /** True if confidence < 0.7 and the result was forced to "conversation". */
  fallback_applied: boolean;
}

const CONFIDENCE_FLOOR = 0.7;
const VALID_CATEGORIES: ReadonlySet<Category> = new Set(["ticket", "epic", "conversation", "project"]);

/**
 * Build the classifier prompt. Pure function — exported for testability.
 *
 * Applies the T-871 Decision Authority rule: the model is told to weigh ONLY
 * business-level signals (what changes for users / what new product surface
 * exists) and NEVER implementation signals (which framework, which database,
 * which deployment target).
 */
export function buildPrompt(input: ClassificationInput): string {
  const ctx = input.projectContext;
  const projectLine = ctx?.projectName
    ? `Active project: "${ctx.projectName}"${ctx.projectType ? ` (${ctx.projectType})` : ""}`
    : "No active project context.";

  const ticketsBlock = ctx?.existingTickets?.length
    ? `\nExisting tickets in this project (max 20 shown):\n${
        ctx.existingTickets.slice(0, 20).map(t => `- T-${t.number}: ${t.title}`).join("\n")
      }`
    : "";

  const epicsBlock = ctx?.existingEpics?.length
    ? `\nExisting epics in this project:\n${
        ctx.existingEpics.slice(0, 10).map(e => `- T-${e.number}: ${e.title}`).join("\n")
      }`
    : "";

  return `You are the Sidekick intake classifier for the just-ship platform.
A user has typed an idea or request. Decide which of four buckets it belongs in.

## Decision Authority rule (MUST FOLLOW)

Weigh ONLY business signals — what the user wants to change for end users, what new product surface would exist, what scope feels involved.

NEVER weigh implementation signals — which framework, which database, which deployment target, how it would be built. Those are decided autonomously later. If the user mentions implementation details, ignore them when classifying.

## Categories

1. **ticket** — One concrete change to something that already exists, with a clear outcome. Bug fixes, copy tweaks, single feature additions to an existing surface, single-screen edits.
2. **epic** — Several related changes that share a feature name. "We need X in Y" where X spans multiple screens/flows. Anything that would naturally split into 3+ child tickets.
3. **conversation** — Direction is unclear. The user is exploring ("should we", "what do you think", "I'm not sure"), business context is missing, or the request needs more shape before any concrete artifact can exist.
4. **project** — A new product name, a new user audience, or "I want to build X" where X is genuinely new (not an addition to an existing project).

## Project context

${projectLine}${ticketsBlock}${epicsBlock}

## User input

"""
${input.text}
"""

## Output

Respond with ONLY a JSON object on a single line, no prose, no code fences, no surrounding text. Schema:

{"category": "ticket" | "epic" | "conversation" | "project", "confidence": <number 0.0 to 1.0>, "reasoning": "<one sentence, business-signal-based, max 200 chars>"}

If multiple categories feel plausible, pick the one with the strongest single signal and lower the confidence. If nothing is clear, pick "conversation" with confidence below 0.7.`;
}

/**
 * Parse the model's JSON response. Pure function — exported for testability.
 *
 * The model is instructed to return JSON only, but real models occasionally
 * wrap output in code fences or add stray prose. We tolerate that by
 * extracting the first {...} block.
 *
 * Throws if no valid JSON object can be extracted or required fields are missing/invalid.
 */
export function parseResponse(raw: string): {
  category: Category;
  confidence: number;
  reasoning: string;
} {
  const trimmed = raw.trim();
  // Find the first balanced {...} block. Models sometimes wrap in fences.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Classifier response did not contain a JSON object");
  }
  const jsonSlice = trimmed.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (err) {
    throw new Error(`Classifier response was not valid JSON: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Classifier response was not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const category = obj.category;
  const confidence = obj.confidence;
  const reasoning = obj.reasoning;

  if (typeof category !== "string" || !VALID_CATEGORIES.has(category as Category)) {
    throw new Error(`Classifier response had invalid category: ${JSON.stringify(category)}`);
  }
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Classifier response had invalid confidence: ${JSON.stringify(confidence)}`);
  }
  if (typeof reasoning !== "string" || reasoning.length === 0) {
    throw new Error("Classifier response had missing or empty reasoning");
  }

  return {
    category: category as Category,
    confidence,
    reasoning: reasoning.slice(0, 500), // hard cap, in case model ignored the 200 hint
  };
}

/**
 * Apply the confidence-floor fallback. Pure function — exported for testability.
 *
 * Per T-871 Decision Authority: when confidence is low we never ask the user
 * "what did you mean?" — we route to "conversation" and let the conversation
 * flow shape the request.
 */
export function applyConfidenceFallback(parsed: {
  category: Category;
  confidence: number;
  reasoning: string;
}): ClassificationResult {
  if (parsed.confidence < CONFIDENCE_FLOOR && parsed.category !== "conversation") {
    return {
      category: "conversation",
      confidence: parsed.confidence,
      reasoning: `low-confidence fallback (model said ${parsed.category}): ${parsed.reasoning}`,
      fallback_applied: true,
    };
  }
  return { ...parsed, fallback_applied: false };
}

/**
 * Classify a Sidekick input into one of four buckets.
 *
 * Wraps the SDK call with logging, error handling, and the
 * confidence-floor fallback. On any error, returns a "conversation"
 * result so the Sidekick can degrade gracefully.
 */
export async function classify(input: ClassificationInput): Promise<ClassificationResult> {
  const startedAt = Date.now();
  const text = input.text;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("classify(): text must be a non-empty string");
  }

  const prompt = buildPrompt(input);

  let modelOutput = "";
  try {
    for await (const message of query({
      prompt,
      options: {
        model: "haiku",
        maxTurns: 1,
        allowedTools: [],
        permissionMode: "auto",
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        modelOutput = message.result;
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: reason, textPreview: text.slice(0, 200), durationMs: Date.now() - startedAt },
      "Sidekick classifier SDK call failed",
    );
    Sentry.captureException(err);
    return {
      category: "conversation",
      confidence: 0,
      reasoning: `classifier failed: ${reason}`,
      fallback_applied: true,
    };
  }

  if (!modelOutput) {
    logger.error(
      { textPreview: text.slice(0, 200), durationMs: Date.now() - startedAt },
      "Sidekick classifier returned no result message",
    );
    return {
      category: "conversation",
      confidence: 0,
      reasoning: "classifier returned no output",
      fallback_applied: true,
    };
  }

  let parsed;
  try {
    parsed = parseResponse(modelOutput);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: reason, modelOutput: modelOutput.slice(0, 500), textPreview: text.slice(0, 200) },
      "Sidekick classifier response parse failed",
    );
    Sentry.captureException(err, { extra: { modelOutput: modelOutput.slice(0, 1000) } });
    return {
      category: "conversation",
      confidence: 0,
      reasoning: `parse error: ${reason}`,
      fallback_applied: true,
    };
  }

  const result = applyConfidenceFallback(parsed);

  logger.info(
    {
      textPreview: text.slice(0, 200),
      category: result.category,
      modelCategory: parsed.category,
      confidence: result.confidence,
      reasoning: result.reasoning,
      fallback_applied: result.fallback_applied,
      projectSlug: input.projectContext?.projectSlug,
      durationMs: Date.now() - startedAt,
    },
    "Sidekick classification complete",
  );

  return result;
}
