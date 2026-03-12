import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import { loadProjectConfig, parseCliArgs, type TicketArgs } from "./lib/config.ts";
import { loadAgents, loadOrchestratorPrompt } from "./lib/load-agents.ts";
import { loadMcpTools } from "./lib/mcp-tools.ts";
import { createEventHooks, postPipelineEvent, type EventConfig } from "./lib/event-hooks.ts";

// --- Exported pipeline function (used by worker.ts) ---
export interface PipelineOptions {
  projectDir: string;
  ticket: TicketArgs;
  abortSignal?: AbortSignal;
}

export interface PipelineResult {
  status: "completed" | "failed";
  exitCode: number;
  branch: string;
  project: string;
}

export async function executePipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { projectDir, ticket, abortSignal } = opts;
  const config = loadProjectConfig(projectDir);

  // --- Git: create feature branch ---
  const branchSlug = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  const branchName = `${config.conventions.branch_prefix}${ticket.ticketId}-${branchSlug}`;

  try {
    execSync("git checkout main", { cwd: projectDir, stdio: "pipe" });
    execSync("git pull origin main", { cwd: projectDir, stdio: "pipe" });
  } catch { /* continue */ }

  try {
    execSync(`git checkout -b ${branchName}`, { cwd: projectDir, stdio: "pipe" });
  } catch {
    execSync(`git checkout ${branchName}`, { cwd: projectDir, stdio: "pipe" });
  }

  // --- Load agents + orchestrator prompt ---
  const agents = loadAgents(projectDir);
  const orchestratorPrompt = loadOrchestratorPrompt(projectDir);

  // --- Event hooks ---
  const hasPipeline = !!(config.pipeline.apiUrl && config.pipeline.apiKey);
  const eventConfig: EventConfig = {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
    ticketNumber: ticket.ticketId,
  };
  const hooks = hasPipeline ? createEventHooks(eventConfig) : {};

  // --- Build prompt ---
  const prompt = `${orchestratorPrompt}

Implementiere folgendes Ticket end-to-end:

Ticket-ID: ${ticket.ticketId}
Titel: ${ticket.title}
Beschreibung: ${ticket.description}
Labels: ${ticket.labels}

Folge deinem Workflow:
1. Lies project.json und CLAUDE.md für Projekt-Kontext
2. Plane die Implementierung (Phase 1)
3. Spawne die nötigen Experten-Agents (Phase 2: Implementierung)
4. Build-Check + QA Review (Phase 3-4)
5. Ship: Commit, Push, PR erstellen (Phase 5) — KEIN Merge

Branch ist bereits erstellt: ${branchName}`;

  // --- Prepare abort controller ---
  let abortController: AbortController | undefined;
  if (abortSignal) {
    abortController = new AbortController();
    abortSignal.addEventListener("abort", () => abortController!.abort(), { once: true });
  }

  // --- Run orchestrator ---
  let exitCode = 0;
  try {
    if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "orchestrator");

    for await (const message of query({
      prompt,
      options: {
        cwd: projectDir,
        model: "opus",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent", ...loadMcpTools(projectDir)],
        agents,
        hooks,
        maxTurns: 200,
        settingSources: ["project"],
        persistSession: false,
        abortController,
      },
    })) {
      if (message.type === "result") {
        const resultMsg = message as SDKMessage & { type: "result"; subtype: string };
        if (resultMsg.subtype !== "success") {
          console.error("[SDK Result]", resultMsg.subtype);
          exitCode = 1;
        }
      }
    }

    if (hasPipeline) await postPipelineEvent(eventConfig, "completed", "orchestrator");
  } catch (error) {
    console.error("Pipeline error:", error);
    exitCode = 1;
    if (hasPipeline) await postPipelineEvent(eventConfig, "pipeline_failed", "orchestrator");
  }

  return {
    status: exitCode === 0 ? "completed" : "failed",
    exitCode,
    branch: branchName,
    project: config.name,
  };
}

// --- CLI entry point (only runs when executed directly) ---
// Wrapped in async IIFE to avoid top-level await (breaks CJS imports from worker.ts)
const isMain = process.argv[1]?.endsWith("run.ts");
if (isMain) {
  (async () => {
    const projectDir = process.cwd();
    const ticket = parseCliArgs(process.argv.slice(2));
    const config = loadProjectConfig(projectDir);

    // --- Banner ---
    console.error("================================================");
    console.error(`  ${config.name} — Autonomous Pipeline (SDK)`);
    console.error(`  Ticket: ${ticket.ticketId} — ${ticket.title}`);
    console.error("================================================\n");

    const result = await executePipeline({ projectDir, ticket });

    // --- JSON output (stdout, for n8n / worker) ---
    console.error("\n================================================");
    console.error(`  Pipeline ${result.status}`);
    console.error("================================================");

    console.log(JSON.stringify({
      status: result.status,
      ...(result.status === "failed" ? { exit_code: result.exitCode } : {}),
      ticket_id: ticket.ticketId,
      ticket_title: ticket.title,
      branch: result.branch,
      project: result.project,
    }));

    if (result.status === "failed") process.exit(result.exitCode);
  })();
}
