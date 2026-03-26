import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import { loadProjectConfig, parseCliArgs, type TicketArgs } from "./lib/config.ts";
import { loadAgents, loadOrchestratorPrompt, loadTriagePrompt } from "./lib/load-agents.ts";
import { createEventHooks, postPipelineEvent, type EventConfig } from "./lib/event-hooks.ts";
import { runQaWithFixLoop } from "./lib/qa-fix-loop.ts";
import type { QaContext } from "./lib/qa-runner.ts";
import { generateChangeSummary } from "./lib/change-summary.ts";

// --- Exported pipeline function (used by worker.ts) ---
export interface PipelineOptions {
  projectDir: string;
  workDir?: string;      // Worktree directory — if set, skip git checkout and use this as cwd
  branchName?: string;   // Pre-computed branch name — if set, skip slug generation
  ticket: TicketArgs;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export interface PipelineResult {
  status: "completed" | "failed" | "paused";
  exitCode: number;
  branch: string;
  project: string;
  failureReason?: string;
  sessionId?: string;
}

// --- Triage: analyze ticket quality before orchestrator ---
interface TriageResult {
  description: string;
  verdict: string;
  analysis: string;
  qaTier: "full" | "light" | "skip";
  qaPages: string[];
  qaFlows: string[];
}

async function runTriage(
  workDir: string,
  ticket: TicketArgs,
  triagePrompt: string,
  eventConfig: EventConfig,
  hasPipeline: boolean,
): Promise<TriageResult> {
  if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "triage");

  const prompt = `${triagePrompt}

Analysiere folgendes Ticket:

Ticket-ID: ${ticket.ticketId}
Titel: ${ticket.title}
Beschreibung:
${ticket.description}
Labels: ${ticket.labels}`;

  const result: TriageResult = {
    description: ticket.description,
    verdict: "sufficient",
    analysis: "",
    qaTier: "light",
    qaPages: [],
    qaFlows: [],
  };

  try {
    let responseText = "";

    for await (const message of query({
      prompt,
      options: {
        cwd: workDir,
        model: "haiku",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: [],
        maxTurns: 1,
      },
    })) {
      if (message.type === "assistant") {
        const msg = message as SDKMessage & { content?: Array<{ type: string; text?: string }> };
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text" && block.text) {
              responseText += block.text;
            }
          }
        }
      }
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result.verdict = parsed.verdict ?? "sufficient";
      result.analysis = parsed.analysis ?? "";
      result.qaTier = parsed.qa_tier ?? "light";
      result.qaPages = Array.isArray(parsed.qa_pages) ? parsed.qa_pages : [];
      result.qaFlows = Array.isArray(parsed.qa_flows) ? parsed.qa_flows : [];

      if (parsed.verdict === "enriched" && parsed.enriched_body) {
        result.description = parsed.enriched_body;
        console.error(`[Triage] Enriched — ${result.analysis}`);
      } else {
        console.error(`[Triage] Sufficient — ${result.analysis}`);
      }
      console.error(`[Triage] QA tier: ${result.qaTier}`);
    }
  } catch (error) {
    console.error(`[Triage] Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (hasPipeline) {
    await postPipelineEvent(eventConfig, "completed", "triage", {
      verdict: result.verdict,
      analysis: result.analysis,
    });
  }

  return result;
}

export async function executePipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { projectDir, ticket, abortSignal } = opts;
  const config = loadProjectConfig(projectDir);

  let pauseReason: string | undefined;
  let sessionId: string | undefined;

  // --- Branch name: use pre-computed value if provided, otherwise derive (CLI mode) ---
  let branchName: string;
  if (opts.branchName) {
    branchName = opts.branchName;
  } else {
    const branchSlug = ticket.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);
    branchName = `${config.conventions.branch_prefix}${ticket.ticketId}-${branchSlug}`;
  }

  // workDir: use provided worktree directory, or fall back to projectDir (CLI mode)
  const workDir = opts.workDir ?? projectDir;

  if (!opts.workDir) {
    // CLI mode — no worktree manager, do git checkout as before
    try {
      execSync("git checkout main", { cwd: projectDir, stdio: "pipe" });
      execSync("git pull origin main", { cwd: projectDir, stdio: "pipe" });
    } catch { /* continue */ }

    try {
      execSync(`git checkout -b ${branchName}`, { cwd: projectDir, stdio: "pipe" });
    } catch {
      execSync(`git checkout ${branchName}`, { cwd: projectDir, stdio: "pipe" });
    }
  }

  // --- Load agents + orchestrator prompt ---
  const agents = loadAgents(workDir);
  const orchestratorPrompt = loadOrchestratorPrompt(workDir);

  // --- Event hooks ---
  const hasPipeline = !!(config.pipeline.apiUrl && config.pipeline.apiKey);
  const eventConfig: EventConfig = {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
    ticketNumber: ticket.ticketId,
  };
  const hooks = hasPipeline ? createEventHooks(eventConfig, {
    onPause: (reason) => { pauseReason = reason; },
  }) : {};

  // --- Triage: analyze ticket quality before orchestrator ---
  let ticketDescription = ticket.description;
  let triageResult: TriageResult | undefined;
  const triagePrompt = loadTriagePrompt(workDir);
  if (triagePrompt) {
    triageResult = await runTriage(workDir, ticket, triagePrompt, eventConfig, hasPipeline);
    ticketDescription = triageResult.description;
  }

  // --- Build prompt ---
  const prompt = `${orchestratorPrompt}

Implementiere folgendes Ticket end-to-end:

Ticket-ID: ${ticket.ticketId}
Titel: ${ticket.title}
Beschreibung: ${ticketDescription}
Labels: ${ticket.labels}

Folge deinem Workflow:
1. Lies project.json und CLAUDE.md für Projekt-Kontext
2. Plane die Implementierung (Phase 1)
3. Spawne die nötigen Experten-Agents (Phase 2: Implementierung)
4. Build-Check + QA Review (Phase 3-4)
5. Ship: Commit, Push, PR erstellen (Phase 5) — KEIN Merge

Branch ist bereits erstellt: ${branchName}`;

  // --- Timeout configuration ---
  const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 minutes
  const MIN_TIMEOUT_MS = 60_000; // 1 minute minimum
  const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours max

  let timeoutMs = opts.timeoutMs ?? (Number(process.env.PIPELINE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

  // SECURITY: Validate timeout value bounds
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    console.warn(`Invalid timeout ${timeoutMs}ms, using default ${DEFAULT_TIMEOUT_MS}ms`);
    timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  const timeoutMinutes = Math.round(timeoutMs / 60_000);

  // --- Abort controller: combines external signal + wall-clock timeout ---
  const queryAbortController = new AbortController();
  let timedOut = false;

  // Forward external abort signal (graceful shutdown)
  if (abortSignal) {
    if (abortSignal.aborted) {
      queryAbortController.abort();
    } else {
      abortSignal.addEventListener("abort", () => queryAbortController.abort(), { once: true });
    }
  }

  // Wall-clock timeout
  const timeoutId = setTimeout(() => {
    timedOut = true;
    queryAbortController.abort();
  }, timeoutMs);

  // --- Run orchestrator ---
  let exitCode = 0;
  let failureReason: string | undefined;
  try {
    if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "orchestrator");

    for await (const message of query({
      prompt,
      options: {
        cwd: workDir,
        model: "opus",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
        agents,
        hooks,
        maxTurns: 200,
        settingSources: ["project"],
        persistSession: true,
        abortController: queryAbortController,
        env: {
          ...process.env,
          ...(opts.env ?? {}),
          TICKET_NUMBER: ticket.ticketId,
          BOARD_API_URL: config.pipeline.apiUrl,
          PIPELINE_KEY: config.pipeline.apiKey,
        },
      },
    })) {
      if (message.type === "result") {
        const resultMsg = message as SDKMessage & { type: "result"; subtype: string };
        if (resultMsg.subtype !== "success") {
          console.error("[SDK Result]", resultMsg.subtype);
          exitCode = 1;
        }
      }
      // Extract session ID from any message that has it
      if ('session_id' in message && typeof (message as Record<string, unknown>).session_id === 'string') {
        sessionId = (message as Record<string, unknown>).session_id as string;
      }
    }

    // Check if pipeline was paused for human input
    if (pauseReason === 'human_in_the_loop') {
      return {
        status: "paused",
        exitCode: 0,
        branch: branchName,
        project: config.name,
        sessionId,
      };
    }

    if (hasPipeline) await postPipelineEvent(eventConfig, "completed", "orchestrator");

    // --- Generate and send change summary to ticket ---
    if (hasPipeline) {
      try {
        const summary = generateChangeSummary({ workDir, baseBranch: "main" });
        if (summary) {
          await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticket.ticketId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-Pipeline-Key": config.pipeline.apiKey,
            },
            body: JSON.stringify({ summary }),
            signal: AbortSignal.timeout(8000),
          });
        }
      } catch {
        // Summary is best-effort — don't fail the pipeline
        console.error("[Summary] Failed to generate or send change summary");
      }
    }
  } catch (error) {
    exitCode = 1;
    if (timedOut) {
      failureReason = `Timeout nach ${timeoutMinutes} Minuten`;
    } else {
      failureReason = error instanceof Error ? error.message : String(error);
    }
    console.error(`Pipeline error: ${failureReason}`);
    if (hasPipeline) await postPipelineEvent(eventConfig, "pipeline_failed", "orchestrator");
  } finally {
    clearTimeout(timeoutId);
  }

  // --- Phase 3: QA with Fix Loops ---
  if (exitCode === 0 && !timedOut) {
    if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "qa");

    const qaContext: QaContext = {
      workDir,
      branchName,
      ticketId: ticket.ticketId,
      qaTier: triageResult?.qaTier ?? "light",
      qaPages: triageResult?.qaPages ?? [],
      qaFlows: triageResult?.qaFlows ?? [],
      qaConfig: config.qa,
      packageManager: config.stack.packageManager,
    };

    const { finalReport, iterations } = await runQaWithFixLoop(qaContext);
    console.error(`[QA] ${finalReport.tier} tier — ${finalReport.status} (${iterations} fix loops)`);

    if (hasPipeline) {
      await postPipelineEvent(eventConfig, "completed", "qa", {
        tier: finalReport.tier,
        status: finalReport.status,
        fix_iterations: iterations,
        checks_passed: finalReport.checks.filter((c) => c.passed).length,
        checks_total: finalReport.checks.length,
      });
    }
  }

  return {
    status: exitCode === 0 ? "completed" : "failed",
    exitCode,
    branch: branchName,
    project: config.name,
    failureReason,
    sessionId,
  };
}

// --- Resume a paused pipeline session ---
export interface ResumeOptions {
  projectDir: string;
  workDir?: string;
  branchName?: string;
  ticket: TicketArgs;
  sessionId: string;
  answer: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export async function resumePipeline(opts: ResumeOptions): Promise<PipelineResult> {
  const { projectDir, ticket, sessionId: resumeSessionId, answer, abortSignal } = opts;
  const config = loadProjectConfig(projectDir);

  // Branch name: use pre-computed value if provided, otherwise derive (CLI mode)
  let branchName: string;
  if (opts.branchName) {
    branchName = opts.branchName;
  } else {
    const branchSlug = ticket.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);
    branchName = `${config.conventions.branch_prefix}${ticket.ticketId}-${branchSlug}`;
  }

  // workDir: use provided worktree directory, or fall back to projectDir (CLI mode)
  const workDir = opts.workDir ?? projectDir;

  if (!opts.workDir) {
    // CLI mode — no worktree manager, do git checkout as before
    try {
      execSync(`git checkout ${branchName}`, { cwd: projectDir, stdio: "pipe" });
    } catch { /* branch may already be checked out */ }
  }

  const agents = loadAgents(workDir);
  const hasPipeline = !!(config.pipeline.apiUrl && config.pipeline.apiKey);
  const eventConfig: EventConfig = {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
    ticketNumber: ticket.ticketId,
  };

  let pauseReason: string | undefined;
  let newSessionId: string | undefined;

  const hooks = hasPipeline ? createEventHooks(eventConfig, {
    onPause: (reason) => { pauseReason = reason; },
  }) : {};

  // Timeout
  const DEFAULT_TIMEOUT_MS = 1_800_000;
  const MIN_TIMEOUT_MS = 60_000;
  const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
  let timeoutMs = opts.timeoutMs ?? (Number(process.env.PIPELINE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  const queryAbortController = new AbortController();
  let timedOut = false;

  if (abortSignal) {
    if (abortSignal.aborted) {
      queryAbortController.abort();
    } else {
      abortSignal.addEventListener("abort", () => queryAbortController.abort(), { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    queryAbortController.abort();
  }, timeoutMs);

  let exitCode = 0;
  let failureReason: string | undefined;

  try {
    if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "orchestrator");

    for await (const message of query({
      prompt: `Antwort auf deine Frage: ${answer}\n\nMach weiter wo du aufgehört hast.`,
      options: {
        cwd: workDir,
        model: "opus",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
        agents,
        hooks,
        maxTurns: 200,
        settingSources: ["project"],
        persistSession: true,
        resume: resumeSessionId,
        abortController: queryAbortController,
        env: {
          ...process.env,
          ...(opts.env ?? {}),
          TICKET_NUMBER: ticket.ticketId,
          BOARD_API_URL: config.pipeline.apiUrl,
          PIPELINE_KEY: config.pipeline.apiKey,
        },
      },
    })) {
      if (message.type === "result") {
        const resultMsg = message as SDKMessage & { type: "result"; subtype: string };
        if (resultMsg.subtype !== "success") {
          console.error("[SDK Result]", resultMsg.subtype);
          exitCode = 1;
        }
      }
      if ('session_id' in message && typeof (message as Record<string, unknown>).session_id === 'string') {
        newSessionId = (message as Record<string, unknown>).session_id as string;
      }
    }

    if (pauseReason === 'human_in_the_loop') {
      return {
        status: "paused",
        exitCode: 0,
        branch: branchName,
        project: config.name,
        sessionId: newSessionId ?? resumeSessionId,
      };
    }

    if (hasPipeline) await postPipelineEvent(eventConfig, "completed", "orchestrator");

    // --- Generate and send change summary to ticket ---
    if (hasPipeline) {
      try {
        const summary = generateChangeSummary({ workDir, baseBranch: "main" });
        if (summary) {
          await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticket.ticketId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-Pipeline-Key": config.pipeline.apiKey,
            },
            body: JSON.stringify({ summary }),
            signal: AbortSignal.timeout(8000),
          });
        }
      } catch {
        // Summary is best-effort — don't fail the pipeline
        console.error("[Summary] Failed to generate or send change summary");
      }
    }
  } catch (error) {
    exitCode = 1;
    if (timedOut) {
      failureReason = `Timeout nach ${Math.round(timeoutMs / 60_000)} Minuten`;
    } else {
      failureReason = error instanceof Error ? error.message : String(error);
    }
    console.error(`Resume pipeline error: ${failureReason}`);
    if (hasPipeline) await postPipelineEvent(eventConfig, "pipeline_failed", "orchestrator");
  } finally {
    clearTimeout(timeoutId);
  }

  return {
    status: exitCode === 0 ? "completed" : "failed",
    exitCode,
    branch: branchName,
    project: config.name,
    failureReason,
    sessionId: newSessionId ?? resumeSessionId,
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
