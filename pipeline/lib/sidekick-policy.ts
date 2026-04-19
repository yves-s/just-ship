/**
 * Sidekick Decision Authority Policy — T-879.
 *
 * The Sidekick is the only user-facing agent in the just-ship platform. If it
 * asks the user implementation questions, the Decision Authority rule (T-871)
 * is broken at the very first touchpoint: everything downstream runs through
 * experts, but the intake leaks PM/tech questions at the user.
 *
 * This module is the single source of truth for the policy. It exports:
 *
 * - `FORBIDDEN_QUESTION_TOPICS` — patterns the Sidekick is banned from asking.
 * - `ALLOWED_QUESTION_TOPICS`   — business-level topics the Sidekick may ask.
 * - `detectImplementationLeak(text)` — runtime check used for logging/metrics.
 *
 * Both the intake classifier (T-875) and the converse flow (T-878) import
 * from here. The corpus test (`sidekick-policy.test.ts`) iterates the same
 * list, so every new forbidden pattern becomes part of the enforcement surface
 * without touching the classifier or converse implementations.
 */

// ---------------------------------------------------------------------------
// Forbidden question topics — implementation decisions the team owns
// ---------------------------------------------------------------------------

/**
 * Canonical forbidden-question patterns. Each entry is a lowercase phrase that
 * should never appear in a question the Sidekick asks the user. They describe
 * HOW something is built (stack, layout, API shape) — which is the engineering
 * team's call per T-871, not the user's.
 *
 * The list is frozen so downstream callers cannot mutate it at runtime. New
 * topics go here; tests iterate the list and assert the system prompt bans
 * each phrase.
 */
export const FORBIDDEN_QUESTION_TOPICS: ReadonlyArray<string> = Object.freeze([
  // --- Tech stack / framework ---
  "which framework",
  "which stack",
  "react or vue",
  "next or remix",
  "welches framework",
  "welcher stack",
  "react oder vue",
  // --- Database / storage / caching ---
  "which database",
  "postgres or sqlite",
  "which caching",
  "welche datenbank",
  "postgres oder sqlite",
  "welches caching",
  // --- Hosting / deployment / ops ---
  "which hosting",
  "which deployment target",
  "coolify or vercel",
  "welches hosting",
  "coolify oder vercel",
  // --- API shape / auth ---
  "which api shape",
  "rest or graphql",
  "which auth flow",
  "which endpoint",
  "rest oder graphql",
  "welcher auth-flow",
  "welcher endpoint",
  // --- Visual / typography / color ---
  "what colors",
  "which color",
  "which font",
  "which visual hierarchy",
  "welche farbe",
  "welche farben",
  "welche schrift",
  "welche visuelle hierarchie",
  // --- Component / layout / pattern ---
  "which component library",
  "modal or sheet",
  "modal or bottom-sheet",
  "modal or bottom sheet",
  "kanban or list",
  "which layout",
  "which interaction pattern",
  "sidebar or topbar",
  "how should the navigation look",
  "which navigation",
  "welche component library",
  "modal oder sheet",
  "modal oder bottom-sheet",
  "kanban oder liste",
  "welches layout",
  "welche interaktion",
  "welches interaction-pattern",
  "sidebar oder topbar",
  "welche navigation",
  "click-to-expand oder hover",
  // --- States (always yes — team decides) ---
  "do we need an empty state",
  "brauchen wir einen empty-state",
  "brauchen wir einen empty state",
]);

// ---------------------------------------------------------------------------
// Allowed question topics — business signals the Sidekick may ask about
// ---------------------------------------------------------------------------

/**
 * Business-level topics the Sidekick IS allowed to ask the user about.
 * Listed here purely for documentation and for the skill markdown; the
 * runtime does not gate on this list (anything not forbidden is fine).
 */
export const ALLOWED_QUESTION_TOPICS: ReadonlyArray<string> = Object.freeze([
  "target audience",      // Zielgruppe
  "timing / urgency",     // Timing, Dringlichkeit
  "scope",                // Scope-Boundary
  "replaces vs augments", // Ersetzt-oder-Ergaenzt
  "priority",             // Prioritaet
  "success criteria",     // Erfolgskriterien
]);

// ---------------------------------------------------------------------------
// Runtime detection — implementation-leak classifier
// ---------------------------------------------------------------------------

export interface ImplementationLeakResult {
  /** True if any forbidden topic pattern matches the input. */
  leak: boolean;
  /** Subset of `FORBIDDEN_QUESTION_TOPICS` that matched (lowercased). */
  matched: string[];
}

/**
 * Detect whether a Sidekick-produced question leaks an implementation-level
 * decision to the user. Used for post-hoc classification of every assistant
 * turn — the result is logged as a metric so we can see the leak rate over
 * time. It is not used as a hard gate (the model prompt is the primary gate);
 * this is the "measure it to fix it" layer.
 *
 * Matching is case-insensitive substring on the canonical topic phrases.
 * This is deliberately simple: the policy text itself enumerates the exact
 * patterns we consider forbidden, and loose fuzzy matching would create
 * false positives on unrelated language. The test corpus asserts the
 * canonical phrasings are caught; if a production leak sneaks by, it is
 * added to `FORBIDDEN_QUESTION_TOPICS` and automatically covered.
 */
export function detectImplementationLeak(text: string): ImplementationLeakResult {
  if (typeof text !== "string" || !text.trim()) {
    return { leak: false, matched: [] };
  }
  const lowered = text.toLowerCase();
  const matched: string[] = [];
  for (const topic of FORBIDDEN_QUESTION_TOPICS) {
    if (lowered.includes(topic)) matched.push(topic);
  }
  return { leak: matched.length > 0, matched };
}
