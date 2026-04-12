import type { HookCallback, SubagentStartHookInput, SubagentStopHookInput, PostToolUseHookInput, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { estimateCost, parseTokenUsage } from "./cost.js";

export interface EventConfig {
  apiUrl: string;
  apiKey: string;
  ticketNumber: string;
}

async function postEvent(config: EventConfig, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({
    ticket_number: Number(config.ticketNumber),
    ...payload,
  });
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${config.apiUrl}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pipeline-Key": config.apiKey,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return;
      // Server error — retry
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    } catch {
      // Network/timeout error — retry
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  // All attempts failed — pipeline continues regardless
}

interface EventHookOptions {
  onPause?: (reason: string, questionText?: string) => void;
  getLastAssistantText?: () => string;
  /** Agent name → model mapping for model routing. Included in agent_started events. */
  agentModelMap?: Record<string, string>;
}

export function createEventHooks(
  config: EventConfig,
  options?: EventHookOptions,
): { hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>; getTotals: () => { inputTokens: number; outputTokens: number; estimatedCostUsd: number } } {
  const tokenTotals = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  // Cache agent_id → agent_type mapping (SubagentStop doesn't include agent_type)
  const agentTypeByIdMap = new Map<string, string>();
  // Track agents that already received a "completed" event (prevent duplicates)
  const completedAgentIds = new Set<string>();

  const agentModelMap = options?.agentModelMap ?? {};

  const onAgentStarted: HookCallback = async (input) => {
    const hookInput = input as SubagentStartHookInput;
    agentTypeByIdMap.set(hookInput.agent_id, hookInput.agent_type);
    const model = agentModelMap[hookInput.agent_type];
    await postEvent(config, {
      agent_type: hookInput.agent_type,
      event_type: "agent_started",
      ...(model ? { model } : {}),
    });
    return { async: true as const };
  };

  const onAgentCompleted: HookCallback = async (input) => {
    const hookInput = input as SubagentStopHookInput;
    // Send completed event here — this hook fires reliably for ALL agent types
    // (registered custom agents AND built-in subagent_type agents).
    // PostToolUse(Agent) only fires for built-in Agent tool calls, NOT for
    // registered agents dispatched via the agents config.
    const agentType = agentTypeByIdMap.get(hookInput.agent_id);
    if (agentType && !completedAgentIds.has(hookInput.agent_id)) {
      completedAgentIds.add(hookInput.agent_id);
      await postEvent(config, {
        agent_type: agentType,
        event_type: "completed",
      });
    }
    // Don't delete from map yet — PostToolUse may still need it for token data
    return { async: true as const };
  };

  const onSubagentDispatchCompleted: HookCallback = async (input) => {
    const hookInput = input as PostToolUseHookInput;
    const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
    const agentType = (toolInput.subagent_type ?? toolInput.name ?? "unknown") as string;
    const model = (toolInput.model ?? "sonnet") as string;

    const responseText = String(hookInput.tool_response ?? "");
    const { inputTokens, outputTokens, totalTokens } = parseTokenUsage(responseText);

    if (totalTokens > 0) {
      const costUsd = estimateCost(model, inputTokens, outputTokens);
      tokenTotals.inputTokens += inputTokens;
      tokenTotals.outputTokens += outputTokens;
      tokenTotals.estimatedCostUsd += costUsd;

      await postEvent(config, {
        agent_type: agentType,
        event_type: "completed",
        metadata: { tokens_used: totalTokens },
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        model,
        estimated_cost_usd: costUsd,
      });
    }

    const agentId = responseText.match(/agentId:\s*(\S+)/)?.[1];
    if (agentId) {
      agentTypeByIdMap.delete(agentId);
      completedAgentIds.delete(agentId);
    }
    return { async: true as const };
  };

  const onFileChanged: HookCallback = async (input) => {
    const hookInput = input as PostToolUseHookInput;
    const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
    await postEvent(config, {
      agent_type: hookInput.agent_type ?? "orchestrator",
      event_type: "tool_use",
      metadata: {
        tool_name: hookInput.tool_name ?? "unknown",
        file_path: toolInput.file_path ?? "",
      },
    });
    return { async: true as const };
  };

  const onBashResult: HookCallback = async (input) => {
    const hookInput = input as PostToolUseHookInput;
    const toolResponse = String(hookInput.tool_response ?? "");
    if (toolResponse.includes("__WAITING_FOR_INPUT__")) {
      options?.onPause?.("human_in_the_loop", options?.getLastAssistantText?.());
      return { continue: false, stopReason: "human_in_the_loop" };
    }
    return { async: true as const };
  };

  return {
    hooks: {
      SubagentStart: [{ matcher: ".*", hooks: [onAgentStarted] }],
      SubagentStop: [{ matcher: ".*", hooks: [onAgentCompleted] }],
      PostToolUse: [
        { matcher: "Write|Edit", hooks: [onFileChanged] },
        { matcher: "Agent", hooks: [onSubagentDispatchCompleted] },
        { matcher: "Bash", hooks: [onBashResult] },
      ],
    },
    getTotals: () => ({ ...tokenTotals }),
  };
}

export async function postPipelineEvent(
  config: EventConfig,
  eventType: string,
  agentType = "orchestrator",
  metadata?: Record<string, unknown>,
): Promise<void> {
  await postEvent(config, {
    agent_type: agentType,
    event_type: eventType,
    ...(metadata ? { metadata } : {}),
  });
}

export async function postPipelineSummary(
  config: EventConfig,
  totals: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  },
): Promise<void> {
  await postEvent(config, {
    agent_type: "orchestrator",
    event_type: "pipeline_completed",
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    estimated_cost_usd: totals.estimatedCostUsd,
    metadata: { tokens_used: totals.inputTokens + totals.outputTokens },
  });
}
