import type { HookCallback, SubagentStartHookInput, SubagentStopHookInput, PostToolUseHookInput, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";

export interface EventConfig {
  apiUrl: string;
  apiKey: string;
  ticketNumber: string;
}

async function postEvent(config: EventConfig, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${config.apiUrl}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": config.apiKey,
      },
      body: JSON.stringify({
        ticket_number: Number(config.ticketNumber),
        ...payload,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Silent fail — pipeline continues regardless of Dev Board availability
  }
}

export function createEventHooks(config: EventConfig): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const onAgentStarted: HookCallback = async (input) => {
    const hookInput = input as SubagentStartHookInput;
    await postEvent(config, {
      agent_type: hookInput.agent_type,
      event_type: "agent_started",
    });
    return { async: true as const };
  };

  const onAgentCompleted: HookCallback = async (input) => {
    const hookInput = input as SubagentStopHookInput;
    await postEvent(config, {
      agent_type: hookInput.agent_type,
      event_type: "completed",
    });
    return { async: true as const };
  };

  const onSubagentDispatchCompleted: HookCallback = async (input) => {
    const hookInput = input as PostToolUseHookInput;
    const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
    const agentType = (toolInput.subagent_type ?? toolInput.name ?? "unknown") as string;
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

  return {
    SubagentStart: [{ matcher: ".*", hooks: [onAgentStarted] }],
    SubagentStop: [{ matcher: ".*", hooks: [onAgentCompleted] }],
    PostToolUse: [
      { matcher: "Write|Edit", hooks: [onFileChanged] },
      { matcher: "Agent", hooks: [onSubagentDispatchCompleted] },
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
