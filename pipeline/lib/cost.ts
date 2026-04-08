/** Token pricing per 1K tokens (input/output) in USD */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6":              { input: 0.015, output: 0.075 },
  "claude-opus-4-20250514":       { input: 0.015, output: 0.075 },
  "claude-sonnet-4-6":            { input: 0.003, output: 0.015 },
  "claude-sonnet-4-20250514":     { input: 0.003, output: 0.015 },
  "claude-haiku-4-5-20251001":    { input: 0.0008, output: 0.004 },
};

const MODEL_ALIASES: Record<string, string> = {
  opus:   "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5-20251001",
};

/**
 * Estimate cost in USD for a given model and token count.
 * Falls back to Sonnet pricing if model is unknown.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const resolvedModel = MODEL_ALIASES[model] ?? model;
  const pricing = MODEL_PRICING[resolvedModel] ?? MODEL_PRICING["claude-sonnet-4-6"];
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
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
