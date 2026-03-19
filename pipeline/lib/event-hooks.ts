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
    const agentType = agentTypeByIdMap.get(hookInput.agent_id) ?? "unknown";
    agentTypeByIdMap.delete(hookInput.agent_id);
    await postEvent(config, {
      agent_type: agentType,
      event_type: "completed",
    });
    return { async: true as const };
  };

  const onSubagentDispatchCompleted: HookCallback = async (input) => {
    const hookInput = input as PostToolUseHookInput;
    const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
    const agentType = (toolInput.subagent_type ?? toolInput.name ?? "unknown") as string;
    // Only send if SubagentStop didn't already handle it
    if (agentTypeByIdMap.has(agentType)) return { async: true as const };
    await postEvent(config, {
      agent_type: agentType,
      event_type: "completed",
    });
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
  agentType = "orchestrator"
): Promise<void> {
  await postEvent(config, { agent_type: agentType, event_type: eventType });
}
