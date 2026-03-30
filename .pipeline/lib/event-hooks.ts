import type { HookCallback, SubagentStartHookInput, SubagentStopHookInput, PostToolUseHookInput, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";

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
  onPause?: (reason: string) => void;
}

export function createEventHooks(
  config: EventConfig,
  options?: EventHookOptions,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  // Cache agent_id → agent_type mapping (SubagentStop doesn't include agent_type)
  const agentTypeByIdMap = new Map<string, string>();
  // Track agents that already received a "completed" event (prevent duplicates)
  const completedAgentIds = new Set<string>();

  const onAgentStarted: HookCallback = async (input) => {
    const hookInput = input as SubagentStartHookInput;
    agentTypeByIdMap.set(hookInput.agent_id, hookInput.agent_type);
    await postEvent(config, {
      agent_type: hookInput.agent_type,
      event_type: "agent_started",
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

    // Extract token usage from agent response (<usage>total_tokens: N</usage>)
    const responseText = String(hookInput.tool_response ?? "");
    const tokensMatch = responseText.match(/total_tokens:\s*(\d+)/);
    const tokensUsed = tokensMatch ? parseInt(tokensMatch[1], 10) : 0;

    // Send token data if available (SubagentStop already sent the "completed" event,
    // but the Board accumulates tokens from completed events with metadata.tokens_used)
    if (tokensUsed > 0) {
      await postEvent(config, {
        agent_type: agentType,
        event_type: "completed",
        metadata: { tokens_used: tokensUsed },
      });
    }

    // Clean up the agent_id → agent_type cache (deferred from SubagentStop)
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
      options?.onPause?.("human_in_the_loop");
      return { continue: false, stopReason: "human_in_the_loop" };
    }
    return { async: true as const };
  };

  return {
    SubagentStart: [{ matcher: ".*", hooks: [onAgentStarted] }],
    SubagentStop: [{ matcher: ".*", hooks: [onAgentCompleted] }],
    PostToolUse: [
      { matcher: "Write|Edit", hooks: [onFileChanged] },
      { matcher: "Agent", hooks: [onSubagentDispatchCompleted] },
      { matcher: "Bash", hooks: [onBashResult] },
    ],
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
