/** Token pricing per 1K tokens in USD */
interface ModelPricing {
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6":              { input: 0.015, cacheRead: 0.0015, cacheCreate: 0.01875, output: 0.075 },
  "claude-opus-4-20250514":       { input: 0.015, cacheRead: 0.0015, cacheCreate: 0.01875, output: 0.075 },
  "claude-sonnet-4-6":            { input: 0.003, cacheRead: 0.0003, cacheCreate: 0.00375, output: 0.015 },
  "claude-sonnet-4-20250514":     { input: 0.003, cacheRead: 0.0003, cacheCreate: 0.00375, output: 0.015 },
  "claude-haiku-4-5-20251001":    { input: 0.0008, cacheRead: 0.00008, cacheCreate: 0.001, output: 0.004 },
};

const MODEL_ALIASES: Record<string, string> = {
  opus:   "claude-opus-4-6",
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
  const p = MODEL_PRICING[resolvedModel] ?? MODEL_PRICING["claude-sonnet-4-6"];
  return (inputTokens / 1000) * p.input
    + (cacheReadTokens / 1000) * p.cacheRead
    + (cacheCreateTokens / 1000) * p.cacheCreate
    + (outputTokens / 1000) * p.output;
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
