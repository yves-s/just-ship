// HookCallback is a compatibility shim — @anthropic-ai/claude-agent-sdk does not export
// this type in the installed version. Update the import below if/when the SDK exposes it.
type HookCallback = (input: unknown) => Promise<{ async: boolean }>;

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

export function createEventHooks(config: EventConfig) {
  const onAgentStarted: HookCallback = async (input) => {
    const agentType = (input as Record<string, unknown>).agent_type ?? "unknown";
    await postEvent(config, {
      agent_type: agentType,
      event_type: "agent_started",
    });
    return { async: true };
  };

  const onAgentCompleted: HookCallback = async (input) => {
    const agentType = (input as Record<string, unknown>).agent_type ?? "unknown";
    await postEvent(config, {
      agent_type: agentType,
      event_type: "completed",
    });
    return { async: true };
  };

  const onFileChanged: HookCallback = async (input) => {
    const postInput = input as Record<string, unknown>;
    const toolInput = (postInput.tool_input ?? {}) as Record<string, unknown>;
    await postEvent(config, {
      agent_type: (postInput.agent_type as string) ?? "orchestrator",
      event_type: "tool_use",
      metadata: {
        tool_name: postInput.tool_name ?? "unknown",
        file_path: toolInput.file_path ?? "",
      },
    });
    return { async: true };
  };

  return {
    SubagentStart: [{ matcher: ".*", hooks: [onAgentStarted] }],
    SubagentStop: [{ matcher: ".*", hooks: [onAgentCompleted] }],
    PostToolUse: [{ matcher: "Write|Edit", hooks: [onFileChanged] }],
  };
}

export async function postPipelineEvent(
  config: EventConfig,
  eventType: string,
  agentType = "orchestrator"
): Promise<void> {
  await postEvent(config, { agent_type: agentType, event_type: eventType });
}
