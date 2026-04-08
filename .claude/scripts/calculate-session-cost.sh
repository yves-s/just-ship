#!/bin/bash
# calculate-session-cost.sh — Calculate token usage and cost from a Claude Code session
# Usage: bash .claude/scripts/calculate-session-cost.sh <session_id> <cwd>
# Output: JSON on stdout: {"input_tokens": N, "output_tokens": N, "total_tokens": N, "estimated_cost_usd": N.NNNN}
# Exit 0 on success, exit 0 with empty output on any error (silent fail)

set -euo pipefail

SESSION_ID="${1:-}"
CWD="${2:-}"

[ -z "$SESSION_ID" ] || [ -z "$CWD" ] && exit 0

# Validate CWD: must be absolute path without .. traversal
if [[ ! "$CWD" =~ ^/ ]] || [[ "$CWD" =~ \.\. ]]; then
  exit 0
fi

# Build the JSONL path from cwd
# Claude Code stores sessions at: ~/.claude/projects/-{cwd-with-slashes-replaced-by-dashes}/{session_id}.jsonl
# Example: /Users/yschleich/Developer/just-ship -> -Users-yschleich-Developer-just-ship
SAFE_CWD=$(echo "$CWD" | sed 's|^/||' | sed 's|/|-|g')
SESSION_FILE="$HOME/.claude/projects/-${SAFE_CWD}/${SESSION_ID}.jsonl"

[ ! -f "$SESSION_FILE" ] && exit 0

# Parse all usage entries and calculate totals using node (available in all just-ship projects)
node -e "
const fs = require('fs');
const lines = fs.readFileSync('${SESSION_FILE}', 'utf-8').split('\n').filter(Boolean);

let inputTokens = 0;
let outputTokens = 0;
let detectedModel = null;

// Model pricing (must match pipeline/lib/cost.ts)
const modelPricing = {
  'claude-opus-4-20250514':       { input: 0.015, output: 0.075 },
  'claude-sonnet-4-20250514':     { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001':    { input: 0.0008, output: 0.004 },
};

for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    const usage = obj?.message?.usage;
    if (usage && typeof usage.input_tokens === 'number') {
      // input_tokens = direct input + cache creation + cache read
      inputTokens += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      outputTokens += (usage.output_tokens || 0);
    }
    // Detect model from first message with valid pricing (typically consistent within a session)
    if (!detectedModel && obj?.message?.model) {
      const model = obj.message.model;
      if (modelPricing[model]) {
        detectedModel = model;
      }
    }
  } catch {}
}

if (inputTokens === 0 && outputTokens === 0) {
  process.exit(0); // No usage data — silent exit
}

// Use detected model pricing, fall back to Opus if unknown
const finalModel = detectedModel || 'claude-opus-4-20250514';
const pricing = modelPricing[finalModel];
const costUsd = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;

process.stdout.write(JSON.stringify({
  input_tokens: inputTokens,
  output_tokens: outputTokens,
  total_tokens: inputTokens + outputTokens,
  estimated_cost_usd: parseFloat(costUsd.toFixed(4))
}));
" 2>/dev/null || exit 0
