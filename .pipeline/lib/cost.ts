// Pricing last verified: 2026-04-16 — https://platform.claude.com/docs/en/about-claude/pricing
// Per MTok (million tokens). Cache: 5min write = 1.25x input, read/hit = 0.1x input.
// Note: Opus 4.7 uses a new tokenizer that may consume up to 35% more tokens for the same text.
interface ModelPricing {
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
}

const COST_PER_MTOK: Record<string, ModelPricing> = {
  "claude-opus-4-7":              { input: 5, cacheRead: 0.50, cacheCreate: 6.25, output: 25 },
  "claude-opus-4-6":              { input: 5, cacheRead: 0.50, cacheCreate: 6.25, output: 25 },
  "claude-opus-4-20250514":       { input: 5, cacheRead: 0.50, cacheCreate: 6.25, output: 25 },
  "claude-sonnet-4-6":            { input: 3, cacheRead: 0.30, cacheCreate: 3.75, output: 15 },
  "claude-sonnet-4-20250514":     { input: 3, cacheRead: 0.30, cacheCreate: 3.75, output: 15 },
  "claude-haiku-4-5-20251001":    { input: 1, cacheRead: 0.10, cacheCreate: 1.25, output: 5 },
};

const MODEL_ALIASES: Record<string, string> = {
  opus:   "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5-20251001",
};

/**
 * Estimate cost in USD for a given model and token count.
 * When cacheReadTokens/cacheCreateTokens are provided, uses tiered pricing.
 * Without cache splits, treats all inputTokens at full input price (backward compatible).
 * Falls back to Sonnet pricing if model is unknown.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreateTokens = 0,
): number {
  const resolvedModel = MODEL_ALIASES[model] ?? model;
  const p = COST_PER_MTOK[resolvedModel] ?? COST_PER_MTOK["claude-sonnet-4-6"];
  return (inputTokens / 1_000_000) * p.input
    + (cacheReadTokens / 1_000_000) * p.cacheRead
    + (cacheCreateTokens / 1_000_000) * p.cacheCreate
    + (outputTokens / 1_000_000) * p.output;
}

/**
 * Parse token usage from Claude Agent SDK response text.
 * The SDK response includes: total_tokens: N
 */
export function parseTokenUsage(responseText: string): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const totalMatch = responseText.match(/total_tokens:\s*(\d+)/);
  const totalTokens = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  // SDK doesn't always split input/output — estimate 75% input, 25% output
  const inputTokens = Math.round(totalTokens * 0.75);
  const outputTokens = totalTokens - inputTokens;
  return { inputTokens, outputTokens, totalTokens };
}
