import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProjectConfig, parseCliArgs, type TicketArgs } from "./lib/config.ts";
import { loadAgents, loadOrchestratorPrompt, loadTriagePrompt, loadEnrichmentPrompt } from "./lib/load-agents.ts";
import { createEventHooks, postPipelineEvent, postPipelineSummary, type EventConfig } from "./lib/event-hooks.ts";
import { runQaWithFixLoop } from "./lib/qa-fix-loop.ts";
import type { QaContext } from "./lib/qa-runner.ts";
import { generateChangeSummary } from "./lib/change-summary.ts";
import { loadSkills, type AgentRole } from "./lib/load-skills.ts";
import { Sentry } from "./lib/sentry.ts";
import { updateCheckpoint, clearCheckpoint, type PipelineCheckpoint } from "./lib/checkpoint.ts";
import { sanitizeBranchName } from "./lib/sanitize.ts";
import { toBranchName, log } from "./lib/utils.ts";
import { logger } from "./lib/logger.ts";
import { makeSpawn } from "./lib/spawn.ts";
import { estimateCost } from "./lib/cost.ts";
import { checkLevel1Exists } from "./lib/artifact-verifier.ts";
import { resolveVerifyCommands, runVerifyCommands } from "./lib/verify-commands.ts";
import { detectScopeReduction } from "./lib/scope-guard.ts";
import { createModelRouter } from "./lib/model-router.ts";

// --- Exported pipeline function (called by server.ts after a Board trigger) ---
export interface PipelineOptions {
  projectDir: string;
  workDir?: string;      // Worktree directory — if set, skip git checkout and use this as cwd
  branchName?: string;   // Pre-computed branch name — if set, skip slug generation
  ticket: TicketArgs;
  env?: Record<string, string>;
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
  tokens?: { input: number; output: number; estimatedCostUsd: number };
  prUrl?: string;
}

// --- Triage: analyze ticket quality before orchestrator ---
interface TriageResult {
  description: string;
  verdict: string;
  analysis: string;
  qaTier: "full" | "light" | "skip";
  qaPages: string[];
  qaFlows: string[];
  scaffoldType?: string;
  enrichedDescription?: string;
  affectedFiles?: string[];
  addedACs?: string[];
}

function formatEnrichmentComment(triage: TriageResult): string {
  const lines = ["**Triage Enrichment**\n"];
  if (triage.affectedFiles?.length) {
    lines.push("**Betroffene Dateien:**");
    triage.affectedFiles.forEach(f => lines.push(`- ${f}`));
    lines.push("");
  }
  if (triage.addedACs?.length) {
    lines.push("**Ergaenzte Acceptance Criteria:**");
    triage.addedACs.forEach(ac => lines.push(`- [ ] ${ac}`));
    lines.push("");
  }
  lines.push(`**QA-Tier:** ${triage.qaTier}`);
  return lines.join("\n");
}

// Pre-Develop step: persist the loaded team to .claude/.reporter-team-roster.json
// so the Reporter (develop-summary.sh, /just-ship-status, etc.) can render the
// Team block in develop-complete.md without re-discovering which agents ran.
// AC for T-999: Reporter reads the roster, never invents rows.
function writeTeamRoster(
  workDir: string,
  agentNames: string[],
  agentModelMap: Record<string, string>,
): void {
  const team = agentNames.map(role => ({
    icon: "▸",
    role,
    tokens: 0,
    model: agentModelMap[role] ?? null,
  }));
  const roster = { team, written_at: new Date().toISOString() };
  const claudeDir = join(workDir, ".claude");
  try {
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, ".reporter-team-roster.json"), JSON.stringify(roster, null, 2));
  } catch (err) {
    // Best-effort: roster is decorative — pipeline must not fail if it can't be written.
    logger.warn({ err }, "Could not write reporter team roster");
  }
}

async function runTriage(
  workDir: string,
  ticket: TicketArgs,
  triagePrompt: string,
  eventConfig: EventConfig,
  hasPipeline: boolean,
  env?: Record<string, string>,
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
        permissionMode: "default",
        allowedTools: [],
        maxTurns: 1,
        env: { ...process.env, ...(env ?? {}) },
        spawnClaudeCodeProcess: makeSpawn("[Triage]"),
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
      result.scaffoldType = parsed.scaffold_type || undefined;

      if (parsed.verdict === "enriched" && parsed.enriched_body) {
        result.description = parsed.enriched_body;
        logger.info({ analysis: result.analysis }, "Triage: enriched");
      } else {
        logger.info({ analysis: result.analysis }, "Triage: sufficient");
      }
      logger.info({ qaTier: result.qaTier }, "Triage QA tier");
    }
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Triage error");
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
  let pauseQuestion: string | undefined;
  let lastAssistantText = "";
  let sessionId: string | undefined;

  // --- Branch name: use pre-computed value if provided, otherwise derive (CLI mode) ---
  let branchName: string;
  if (opts.branchName) {
    branchName = opts.branchName;
  } else {
    branchName = toBranchName(config.conventions.branch_prefix, ticket.ticketId, ticket.title);
  }

  // Validate branch name before any shell interpolation (toBranchName already validates,
  // but branchName may come from opts.branchName which is external input)
  try {
    sanitizeBranchName(branchName);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ reason, branch: branchName }, "Invalid branch name");
    return {
      status: "failed",
      prUrl: undefined,
      branch: branchName,
      project: config.name,
      failureReason: `Invalid branch name: ${reason}`,
      exitCode: 1,
    };
  }

  // workDir: use provided worktree directory, or fall back to projectDir (CLI mode)
  const workDir = opts.workDir ?? projectDir;

  if (!opts.workDir) {
    // CLI mode — no worktree manager, do git checkout as before
    // Force-checkout to discard any leftover uncommitted changes from a previous run
    try {
      execSync("git checkout -f main", { cwd: projectDir, stdio: "pipe" });
      execSync("git pull origin main", { cwd: projectDir, stdio: "pipe" });
    } catch { /* Best-effort: git checkout/pull may fail on dirty state — continue with branch creation */ }

    try {
      execSync(`git checkout -b "${branchName}"`, { cwd: projectDir, stdio: "pipe" });
    } catch {
      // Branch already exists — switch to it instead
      execSync(`git checkout "${branchName}"`, { cwd: projectDir, stdio: "pipe" });
    }
  }

  // --- Write .active-ticket so Claude Code hooks can send events ---
  try {
    const claudeDir = join(workDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, ".active-ticket"), ticket.ticketId);
  } catch {
    // Best-effort: .active-ticket enables event hooks but is not required for pipeline execution
    logger.warn("Could not write .active-ticket");
  }

  // --- Load agents + orchestrator prompt ---
  const agents = loadAgents(projectDir);
  const loadedSkills = loadSkills(projectDir, config);
  if (loadedSkills.skillNames.length > 0) {
    logger.info({
      skills: loadedSkills.skillNames,
      frontmatterTokens: loadedSkills.totalFrontmatterTokens,
      fullTokens: loadedSkills.totalFullTokens,
      savedTokens: loadedSkills.totalFullTokens - loadedSkills.totalFrontmatterTokens,
    }, "Skills loaded (progressive disclosure)");
  }

  // Filter agents by skipAgents config
  const skipAgents = config.pipeline.skipAgents ?? [];
  const filteredAgents = Object.fromEntries(
    Object.entries(agents).filter(([name]) => !skipAgents.includes(name))
  );
  if (skipAgents.length > 0) {
    logger.info({ skipAgents }, "Skipping agents");
  }

  // Inject skills into agent prompts
  for (const [name, def] of Object.entries(filteredAgents)) {
    const roleSkills = loadedSkills.byRole.get(name as AgentRole);
    if (roleSkills && def.prompt) {
      def.prompt += `\n\n${roleSkills}`;
    }
  }

  // --- Smart Model Routing: assign optimal model per agent phase ---
  const modelRouter = createModelRouter(config.pipeline.modelRouting);
  const routedCount = modelRouter.applyToAgents(filteredAgents);
  if (routedCount > 0) {
    logger.info({ routedCount }, "Model routing applied to agents");
  }

  // Build orchestrator prompt with skills
  let orchestratorPrompt = loadOrchestratorPrompt(projectDir);
  const orchestratorSkills = loadedSkills.byRole.get("orchestrator");
  if (orchestratorSkills) {
    orchestratorPrompt += `\n\n${orchestratorSkills}`;
  }

  // --- Event hooks ---
  const hasPipeline = !!(config.pipeline.apiUrl && config.pipeline.apiKey);
  const eventConfig: EventConfig = {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
    ticketNumber: ticket.ticketId,
  };
  // Build agent → model map for event tracking
  const agentModelMap: Record<string, string> = {};
  for (const [name, def] of Object.entries(filteredAgents)) {
    if (def.model) agentModelMap[name] = def.model;
  }

  // Pre-Develop: write team roster for the Reporter (T-999 AC).
  writeTeamRoster(workDir, Object.keys(filteredAgents), agentModelMap);

  const eventHooks = hasPipeline ? createEventHooks(eventConfig, {
    onPause: (reason, questionText) => {
      pauseReason = reason;
      pauseQuestion = questionText;
    },
    getLastAssistantText: () => lastAssistantText,
    agentModelMap,
  }) : null;
  const hooks = eventHooks?.hooks ?? {};

  const checkpointConfig = hasPipeline ? {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
    ticketNumber: ticket.ticketId,
  } : null;
  let currentCheckpoint: PipelineCheckpoint | null = null;

  // --- Triage: analyze ticket quality before orchestrator ---
  let ticketDescription = ticket.description;
  let triageResult: TriageResult | undefined;
  const triagePrompt = loadTriagePrompt(projectDir);
  if (triagePrompt) {
    triageResult = await runTriage(workDir, ticket, triagePrompt, eventConfig, hasPipeline, opts.env);
    ticketDescription = triageResult.description;
    Sentry.addBreadcrumb({ category: "pipeline", message: "triage_done", data: { verdict: triageResult?.verdict, qaTier: triageResult?.qaTier } });
  }

  // --- Phase 2: Enrichment (Sonnet with tools) ---
  const needsEnrichment =
    triageResult?.verdict !== "sufficient" ||
    config.stack?.platform === "shopify";

  if (needsEnrichment && triageResult) {
    try {
      const enrichmentPrompt = loadEnrichmentPrompt(projectDir);
      if (enrichmentPrompt) {
        const enrichmentInput = JSON.stringify({
          title: ticket.title,
          body: ticketDescription,
          phase1: { verdict: triageResult.verdict, qa_tier: triageResult.qaTier, analysis: triageResult.analysis },
          platform: config.stack?.platform || "",
          variant: config.stack?.variant || "",
        });

        let enrichmentText = "";
        const enrichController = new AbortController();
        const enrichTimeout = setTimeout(() => enrichController.abort(), 60_000);

        try {
          for await (const message of query({
            prompt: `${enrichmentPrompt}\n\n## Ticket\n\n${enrichmentInput}`,
            options: {
              cwd: workDir,
              model: "sonnet",
              permissionMode: "default",
              allowedTools: ["Grep", "Glob", "Read"],
              maxTurns: 3,
              env: { ...process.env, ...(opts.env ?? {}) },
              spawnClaudeCodeProcess: makeSpawn("[Enrichment]"),
              abortController: enrichController,
            },
          })) {
            if (message.type === "assistant") {
              const msg = message as SDKMessage & { content?: Array<{ type: string; text?: string }> };
              if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === "text" && block.text) {
                    enrichmentText += block.text;
                  }
                }
              }
            }
          }
        } finally {
          clearTimeout(enrichTimeout);
        }

        const enrichJsonMatch = enrichmentText.match(/\{[\s\S]*\}/);
        if (enrichJsonMatch) {
          const enriched = JSON.parse(enrichJsonMatch[0]);
          triageResult.enrichedDescription = enriched.enriched_description;
          triageResult.affectedFiles = enriched.affected_files;
          triageResult.addedACs = enriched.added_acceptance_criteria;
          if (enriched.enriched_description) {
            ticketDescription = enriched.enriched_description;
          }
          logger.info({ filesCount: triageResult.affectedFiles?.length ?? 0, acsCount: triageResult.addedACs?.length ?? 0 }, "Enrichment done");
        }

        // Post enrichment as Board comment (non-blocking)
        if (hasPipeline && triageResult.enrichedDescription) {
          const commentBody = formatEnrichmentComment(triageResult);
          try {
            execSync(
              `bash "${workDir}/.claude/scripts/post-comment.sh" "${ticket.ticketId}" "" "triage"`,
              {
                timeout: 5_000,
                stdio: "ignore",
                env: { ...process.env, COMMENT_BODY: commentBody },
              }
            );
          } catch { /* Best-effort: enrichment comment posting is non-critical */ }
        }
      }
    } catch (e) {
      logger.debug({ err: e instanceof Error ? e.message : String(e) }, "Enrichment skipped");
    }
  }

  // Shopify env check (VPS path — develop.md handles local path)
  if (config.stack?.platform === "shopify") {
    try {
      execSync(`bash "${workDir}/.claude/scripts/shopify-env-check.sh"`, {
        timeout: 30_000,
        stdio: "pipe",
      });
      logger.info("Shopify environment check passed");
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "Shopify environment check failed");
    }
  }

  if (checkpointConfig) {
    currentCheckpoint = {
      phase: "triage",
      completed_agents: [],
      pending_agents: [],
      branch_name: branchName,
      worktree_path: workDir !== projectDir ? workDir : undefined,
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      attempt: 1,
    };
    await updateCheckpoint(checkpointConfig, null, currentCheckpoint);
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
5. Commit: Gezielt stagen und committen (Phase 5) — KEIN Push, KEIN PR, KEIN Status-Update

Branch ist bereits erstellt: ${branchName}
WICHTIG: Push, PR-Erstellung und Status-Updates werden automatisch von der Pipeline-Infrastruktur übernommen. Du machst NUR den lokalen Commit.`;

  // --- Timeout configuration ---
  const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 minutes
  const MIN_TIMEOUT_MS = 60_000; // 1 minute minimum
  const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours max

  let timeoutMs = opts.timeoutMs ?? (Number(process.env.PIPELINE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

  // SECURITY: Validate timeout value bounds
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    logger.warn({ timeoutMs, defaultMs: DEFAULT_TIMEOUT_MS }, "Invalid timeout value, using default");
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
  let sdkUsage: { input_tokens?: number; output_tokens?: number } | undefined;
  try {
    if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "orchestrator");

    // --- Diagnostic logging ---
    const agentNames = Object.keys(filteredAgents);
    const skillNames = loadedSkills.skillNames;
    logger.info({
      workDir,
      model: "opus",
      agents: agentNames,
      skills: skillNames,
      promptLength: prompt.length,
      branch: branchName,
      timeoutMinutes: timeoutMs / 60_000,
    }, "Starting orchestrator query");

    Sentry.addBreadcrumb({ category: "pipeline", message: "orchestrator_start", data: { ticketId: ticket.ticketId, branch: branchName } });

    if (checkpointConfig) {
      await updateCheckpoint(checkpointConfig, currentCheckpoint, { phase: "planning" });
    }

    for await (const message of query({
      prompt,
      options: {
        cwd: workDir,
        model: "opus",
        permissionMode: "auto",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
        agents: filteredAgents,
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
        spawnClaudeCodeProcess: makeSpawn(`[T-${ticket.ticketId}]`),
      },
    })) {
      if (message.type === "assistant") {
        const msg = message as SDKMessage & { content?: Array<{ type: string; text?: string }> };
        if (Array.isArray(msg.content)) {
          const texts = msg.content.filter(b => b.type === "text" && b.text).map(b => b.text!);
          if (texts.length > 0) lastAssistantText = texts.join("\n");
        }
      }
      if (message.type === "result") {
        const resultMsg = message as SDKMessage & { type: "result"; subtype: string; usage?: { input_tokens?: number; output_tokens?: number } };
        // Extract usage data from SDK result
        if (resultMsg.usage) {
          sdkUsage = resultMsg.usage;
        }
        if (resultMsg.subtype !== "success") {
          logger.warn({ subtype: resultMsg.subtype }, "SDK result non-success");
          exitCode = 1;
          throw new Error(`Pipeline exited with status: ${resultMsg.subtype}`);
        }
      }
      // Extract session ID from any message that has it
      if ('session_id' in message && typeof (message as Record<string, unknown>).session_id === 'string') {
        sessionId = (message as Record<string, unknown>).session_id as string;
      }
    }

    // Check if pipeline was paused for human input
    if (pauseReason === 'human_in_the_loop') {
      // Store question via Board API
      if (hasPipeline && pauseQuestion) {
        try {
          await fetch(`${config.pipeline.apiUrl}/api/events`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Pipeline-Key": config.pipeline.apiKey,
            },
            body: JSON.stringify({
              ticket_number: Number(ticket.ticketId),
              agent_type: "orchestrator",
              event_type: "question",
              metadata: { question: pauseQuestion },
            }),
            signal: AbortSignal.timeout(8000),
          });
          // Also store as denormalized field for quick widget display
          await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticket.ticketId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-Pipeline-Key": config.pipeline.apiKey,
            },
            body: JSON.stringify({ pending_question: pauseQuestion, pipeline_status: "paused" }),
            signal: AbortSignal.timeout(8000),
          });
        } catch {
          // Best-effort: question storage enables human-in-the-loop UI but pipeline can pause without it
          logger.warn("Could not store question in ticket");
        }
      }
      return {
        status: "paused",
        exitCode: 0,
        branch: branchName,
        project: config.name,
        sessionId,
      };
    }

    if (hasPipeline) await postPipelineEvent(eventConfig, "completed", "orchestrator");

    if (checkpointConfig) {
      await updateCheckpoint(checkpointConfig, currentCheckpoint, { phase: "agents_done" });
    }

    // --- Artifact Verification ---
    if (exitCode === 0) {
      try {
        const diffOutput = execSync("git diff --name-status main HEAD", {
          cwd: workDir,
          encoding: "utf-8",
          timeout: 10_000,
        }).trim();

        const level1 = checkLevel1Exists(diffOutput);
        if (!level1.passed) {
          logger.warn({ message: level1.message }, "Artifact verification warning");
          if (hasPipeline) {
            await postPipelineEvent(eventConfig, "verification_warning", "orchestrator", {
              level: 1,
              message: level1.message,
            });
          }
        } else {
          logger.info({ message: level1.message }, "Artifact verification level 1 OK");
        }
      } catch {
        logger.debug("Could not run artifact verification — continuing");
      }
    }

    // --- Scope Reduction Guard ---
    if (exitCode === 0 && lastAssistantText) {
      const scopeCheck = detectScopeReduction(lastAssistantText);
      if (scopeCheck.detected) {
        logger.warn({ message: scopeCheck.message }, "Scope reduction detected");
        if (hasPipeline) {
          await postPipelineEvent(eventConfig, "scope_reduction_warning", "orchestrator", {
            markers: scopeCheck.markers.map((m) => m.pattern),
            message: scopeCheck.message,
          });
        }
      }
    }

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
        logger.info("Failed to generate or send change summary");
      }
    }
  } catch (error) {
    exitCode = 1;
    if (timedOut) {
      failureReason = `Timeout nach ${timeoutMinutes} Minuten`;
    } else {
      failureReason = error instanceof Error ? error.message : String(error);
    }
    logger.error({ failureReason }, "Pipeline error");
    if (hasPipeline) await postPipelineEvent(eventConfig, "pipeline_failed", "orchestrator");
  } finally {
    clearTimeout(timeoutId);
    if (exitCode !== 0) {
      logger.error({ exitCode, reason: failureReason ?? "unknown", timedOut }, "Pipeline final state");
    }
  }

  // Captured from QA phase — used in Ship phase to patch ticket
  let qaPreviewUrl: string | null = null;

  // --- Phase 3: QA with Fix Loops ---
  if (exitCode === 0 && !timedOut) {
    if (checkpointConfig) {
      await updateCheckpoint(checkpointConfig, currentCheckpoint, { phase: "qa" });
    }

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
      buildCommand: config.stack.buildCommand,
      testCommand: config.stack.testCommand,
      env: opts.env,
      enrichedACs: triageResult?.addedACs?.join("\n") || undefined,
      triageFindings: triageResult?.affectedFiles || undefined,
    };

    // Run verification commands (configured + auto-discovered)
    const packageJsonPath = join(workDir, "package.json");
    let packageJsonScripts: Record<string, string> = {};
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      packageJsonScripts = pkg.scripts ?? {};
    } catch { /* no package.json */ }

    let shopifyCliAvailable = false;
    if (config.stack.platform === "shopify" && config.stack.variant === "liquid") {
      try {
        execSync("which shopify", { stdio: "pipe" });
        shopifyCliAvailable = true;
      } catch { /* not available */ }
    }

    const verifyCommands = resolveVerifyCommands({
      verifyCommand: config.stack.verifyCommand,
      platform: config.stack.platform,
      variant: config.stack.variant,
      packageJsonScripts,
      shopifyCliAvailable,
      workDir,
    });

    if (verifyCommands.length > 0) {
      const verifyResults = runVerifyCommands({ workDir, commands: verifyCommands });
      for (const vr of verifyResults) {
        if (vr.passed) {
          logger.info({ cmd: vr.cmd, attempts: vr.attempts }, "Verify command OK");
        } else if (vr.blocking) {
          logger.warn({ cmd: vr.cmd, attempts: vr.attempts }, "Verify command FAILED");
          qaContext.verifyOutput = vr.output;
          qaContext.verifyFailed = true;
        } else {
          logger.warn({ cmd: vr.cmd }, "Verify command failed (advisory)");
        }
      }
    }

    const { finalReport, iterations } = await runQaWithFixLoop(qaContext);
    logger.info({ tier: finalReport.tier, status: finalReport.status, fixLoops: iterations }, "QA complete");

    // Capture preview URL for ticket patch in Ship phase
    if (finalReport.previewUrl) {
      qaPreviewUrl = finalReport.previewUrl;
    }

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

  // --- Phase 4: Ship (infrastructure-managed push + PR) ---
  let prUrl: string | undefined;
  if (exitCode === 0 && !timedOut) {
    try {
      // Ensure there are commits to push (orchestrator should have committed)
      const hasCommits = execSync(`git log main..HEAD --oneline`, {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();

      if (!hasCommits) {
        logger.error("No commits on branch — nothing to push");
        exitCode = 1;
        failureReason = "No commits produced by orchestrator";
      } else {
        // Push branch — with rebase recovery for non-fast-forward rejection
        logger.info({ branch: branchName }, "Pushing branch");
        try {
          execSync(`git push -u origin "${branchName}"`, {
            cwd: workDir,
            encoding: "utf-8",
            timeout: 60_000,
            stdio: "pipe",
          });
        } catch (pushErr) {
          const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
          if (pushMsg.includes("non-fast-forward") || pushMsg.includes("rejected")) {
            logger.warn({ branch: branchName }, "Push rejected — attempting rebase recovery");
            execSync(`git pull --rebase origin "${branchName}"`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 60_000,
              stdio: "pipe",
            });
            execSync(`git push -u origin "${branchName}"`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 60_000,
              stdio: "pipe",
            });
            logger.info("Rebase recovery successful");
          } else {
            throw pushErr; // Re-throw non-push errors
          }
        }

        // Verify branch exists on remote
        const remoteRef = execSync(`git ls-remote --heads origin "${branchName}"`, {
          cwd: workDir,
          encoding: "utf-8",
          timeout: 10_000,
        }).trim();

        if (!remoteRef) {
          logger.error({ branch: branchName }, "Branch not found on remote after push");
          exitCode = 1;
          failureReason = "Branch push failed — not found on remote";
        } else {
          logger.info("Branch pushed successfully");

          // Create PR (or get existing one)
          try {
            prUrl = execSync(`gh pr view --json url -q .url`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 15_000,
            }).trim();
            logger.info({ prUrl }, "Existing PR found");
          } catch {
            // No PR exists yet — create one
            const commitMessages = execSync(`git log main..HEAD --pretty=format:"- %s"`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 10_000,
            }).trim();

            const prTitle = execSync(`git log -1 --pretty=format:"%s"`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 5_000,
            }).trim();

            const bodyFile = join(tmpdir(), `pr-body-${Date.now()}.md`);
            try {
              writeFileSync(bodyFile, `## Summary\n${commitMessages}\n\n🤖 Generated by just-ship pipeline`);
              prUrl = execSync(
                `gh pr create --title "${prTitle.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\`/g, '\\`')}" --body-file "${bodyFile}"`,
                {
                  cwd: workDir,
                  encoding: "utf-8",
                  timeout: 30_000,
                },
              ).trim();
            } finally {
              try { unlinkSync(bodyFile); } catch { /* ignore */ }
            }
            logger.info({ prUrl }, "PR created");
          }

          // Patch ticket with preview_url if available from QA phase
          if (hasPipeline && qaPreviewUrl) {
            try {
              await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticket.ticketId}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  "X-Pipeline-Key": config.pipeline.apiKey,
                },
                body: JSON.stringify({ preview_url: qaPreviewUrl }),
                signal: AbortSignal.timeout(8000),
              });
              logger.info({ previewUrl: qaPreviewUrl }, "preview_url patched to ticket");
            } catch {
              // Best-effort: preview_url patch is non-critical
              logger.warn("Could not patch preview_url to ticket");
            }
          }
        }
      }
    } catch (shipErr) {
      const reason = shipErr instanceof Error ? shipErr.message : String(shipErr);
      logger.error({ reason }, "Ship failed");
      exitCode = 1;
      failureReason = `Ship failed: ${reason}`;
    }
  }

  // Collect token totals — prefer SDK result usage over hook-based totals
  const hookTotals = eventHooks?.getTotals();
  let finalTokens: { input: number; output: number; estimatedCostUsd: number } | undefined;

  if (sdkUsage && (sdkUsage.input_tokens ?? 0) > 0) {
    // SDK provides total session usage including all subagents
    const input = sdkUsage.input_tokens ?? 0;
    const output = sdkUsage.output_tokens ?? 0;
    const costUsd = estimateCost("opus", input, output);
    finalTokens = { input, output, estimatedCostUsd: costUsd };
    log(`[Tokens] SDK usage: ${input} in / ${output} out = $${costUsd.toFixed(4)}`);
  } else if (hookTotals && hookTotals.inputTokens > 0) {
    finalTokens = { input: hookTotals.inputTokens, output: hookTotals.outputTokens, estimatedCostUsd: hookTotals.estimatedCostUsd };
  }

  // Post pipeline summary with token costs
  if (hasPipeline && eventConfig && finalTokens) {
    await postPipelineSummary(eventConfig, {
      inputTokens: finalTokens.input,
      outputTokens: finalTokens.output,
      estimatedCostUsd: finalTokens.estimatedCostUsd,
    });
  }

  // Clear checkpoint on successful completion
  if (checkpointConfig && exitCode === 0) {
    await clearCheckpoint(checkpointConfig);
  }

  return {
    status: exitCode === 0 ? "completed" : "failed",
    exitCode,
    branch: branchName,
    project: config.name,
    failureReason,
    sessionId,
    tokens: finalTokens,
    prUrl,
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
  env?: Record<string, string>;
}

export async function resumePipeline(opts: ResumeOptions): Promise<PipelineResult> {
  const { projectDir, ticket, sessionId: resumeSessionId, answer, abortSignal } = opts;
  const config = loadProjectConfig(projectDir);

  // Branch name: use pre-computed value if provided, otherwise derive (CLI mode)
  let branchName: string;
  if (opts.branchName) {
    branchName = opts.branchName;
  } else {
    branchName = toBranchName(config.conventions.branch_prefix, ticket.ticketId, ticket.title);
  }

  // Validate branch name before any shell interpolation (toBranchName already validates,
  // but branchName may come from opts.branchName which is external input)
  try {
    sanitizeBranchName(branchName);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ reason, branch: branchName }, "Invalid branch name in resumePipeline");
    return {
      status: "failed",
      prUrl: undefined,
      branch: branchName,
      project: config.name,
      failureReason: `Invalid branch name: ${reason}`,
      exitCode: 1,
    };
  }

  // workDir: use provided worktree directory, or fall back to projectDir (CLI mode)
  const workDir = opts.workDir ?? projectDir;

  if (!opts.workDir) {
    // CLI mode — no worktree manager, do git checkout as before
    try {
      execSync(`git checkout "${branchName}"`, { cwd: projectDir, stdio: "pipe" });
    } catch { /* Best-effort: branch may already be checked out in CLI resume mode */ }
  }

  // --- Write .active-ticket so Claude Code hooks can send events ---
  try {
    const claudeDir = join(workDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, ".active-ticket"), ticket.ticketId);
  } catch {
    // Best-effort: .active-ticket enables event hooks but is not required for pipeline execution
    logger.warn("Could not write .active-ticket");
  }

  const agents = loadAgents(projectDir);
  const loadedSkills = loadSkills(projectDir, config);
  if (loadedSkills.skillNames.length > 0) {
    logger.info({
      skills: loadedSkills.skillNames,
      frontmatterTokens: loadedSkills.totalFrontmatterTokens,
      fullTokens: loadedSkills.totalFullTokens,
      savedTokens: loadedSkills.totalFullTokens - loadedSkills.totalFrontmatterTokens,
    }, "Skills loaded (progressive disclosure)");
  }

  // Filter agents by skipAgents config
  const skipAgents = config.pipeline.skipAgents ?? [];
  const filteredAgents = Object.fromEntries(
    Object.entries(agents).filter(([name]) => !skipAgents.includes(name))
  );

  // Inject skills into agent prompts
  for (const [name, def] of Object.entries(filteredAgents)) {
    const roleSkills = loadedSkills.byRole.get(name as AgentRole);
    if (roleSkills && def.prompt) {
      def.prompt += `\n\n${roleSkills}`;
    }
  }

  // Apply model routing to resume agents
  const resumeModelRouter = createModelRouter(config.pipeline.modelRouting);
  resumeModelRouter.applyToAgents(filteredAgents);

  const hasPipeline = !!(config.pipeline.apiUrl && config.pipeline.apiKey);
  const eventConfig: EventConfig = {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
    ticketNumber: ticket.ticketId,
  };

  let pauseReason: string | undefined;
  let pauseQuestion: string | undefined;
  let lastAssistantText = "";
  let newSessionId: string | undefined;

  // Build agent → model map for event tracking
  const resumeAgentModelMap: Record<string, string> = {};
  for (const [name, def] of Object.entries(filteredAgents)) {
    if (def.model) resumeAgentModelMap[name] = def.model;
  }

  // Pre-Develop (resume): refresh the Reporter team roster (T-999 AC).
  writeTeamRoster(workDir, Object.keys(filteredAgents), resumeAgentModelMap);

  const eventHooks = hasPipeline ? createEventHooks(eventConfig, {
    onPause: (reason, questionText) => {
      pauseReason = reason;
      pauseQuestion = questionText;
    },
    getLastAssistantText: () => lastAssistantText,
    agentModelMap: resumeAgentModelMap,
  }) : null;
  const hooks = eventHooks?.hooks ?? {};

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
  let sdkUsage: { input_tokens?: number; output_tokens?: number } | undefined;

  try {
    if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "orchestrator");

    for await (const message of query({
      prompt: `Antwort auf deine Frage: ${answer}\n\nMach weiter wo du aufgehört hast.`,
      options: {
        cwd: workDir,
        model: "opus",
        permissionMode: "auto",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
        agents: filteredAgents,
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
        spawnClaudeCodeProcess: makeSpawn(`[T-${ticket.ticketId}]`),
      },
    })) {
      if (message.type === "assistant") {
        const msg = message as SDKMessage & { content?: Array<{ type: string; text?: string }> };
        if (Array.isArray(msg.content)) {
          const texts = msg.content.filter(b => b.type === "text" && b.text).map(b => b.text!);
          if (texts.length > 0) lastAssistantText = texts.join("\n");
        }
      }
      if (message.type === "result") {
        const resultMsg = message as SDKMessage & { type: "result"; subtype: string; usage?: { input_tokens?: number; output_tokens?: number } };
        // Extract usage data from SDK result
        if (resultMsg.usage) {
          sdkUsage = resultMsg.usage;
        }
        if (resultMsg.subtype !== "success") {
          logger.warn({ subtype: resultMsg.subtype }, "SDK result non-success");
          exitCode = 1;
          throw new Error(`Pipeline exited with status: ${resultMsg.subtype}`);
        }
      }
      if ('session_id' in message && typeof (message as Record<string, unknown>).session_id === 'string') {
        newSessionId = (message as Record<string, unknown>).session_id as string;
      }
    }

    if (pauseReason === 'human_in_the_loop') {
      // Store question via Board API
      if (hasPipeline && pauseQuestion) {
        try {
          await fetch(`${config.pipeline.apiUrl}/api/events`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Pipeline-Key": config.pipeline.apiKey,
            },
            body: JSON.stringify({
              ticket_number: Number(ticket.ticketId),
              agent_type: "orchestrator",
              event_type: "question",
              metadata: { question: pauseQuestion },
            }),
            signal: AbortSignal.timeout(8000),
          });
          // Also store as denormalized field for quick widget display
          await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticket.ticketId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-Pipeline-Key": config.pipeline.apiKey,
            },
            body: JSON.stringify({ pending_question: pauseQuestion, pipeline_status: "paused" }),
            signal: AbortSignal.timeout(8000),
          });
        } catch {
          // Best-effort: question storage enables human-in-the-loop UI but pipeline can pause without it
          logger.warn("Could not store question in ticket");
        }
      }
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
        logger.info("Failed to generate or send change summary");
      }
    }
  } catch (error) {
    exitCode = 1;
    if (timedOut) {
      failureReason = `Timeout nach ${Math.round(timeoutMs / 60_000)} Minuten`;
    } else {
      failureReason = error instanceof Error ? error.message : String(error);
    }
    logger.error({ failureReason }, "Resume pipeline error");
    if (hasPipeline) await postPipelineEvent(eventConfig, "pipeline_failed", "orchestrator");
  } finally {
    clearTimeout(timeoutId);
    if (exitCode !== 0) {
      logger.error({ exitCode, reason: failureReason ?? "unknown", timedOut }, "Resume pipeline final state");
    }
  }

  // --- Ship phase (push + PR) for resumed pipelines ---
  let prUrl: string | undefined;
  if (exitCode === 0 && !timedOut) {
    try {
      const hasCommits = execSync(`git log main..HEAD --oneline`, {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();

      if (!hasCommits) {
        logger.error("No commits on branch — nothing to push");
        exitCode = 1;
        failureReason = "No commits produced by orchestrator";
      } else {
        // Push branch — with rebase recovery for non-fast-forward rejection
        logger.info({ branch: branchName }, "Pushing branch");
        try {
          execSync(`git push -u origin "${branchName}"`, {
            cwd: workDir,
            encoding: "utf-8",
            timeout: 60_000,
            stdio: "pipe",
          });
        } catch (pushErr) {
          const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
          if (pushMsg.includes("non-fast-forward") || pushMsg.includes("rejected")) {
            logger.warn({ branch: branchName }, "Push rejected — attempting rebase recovery");
            execSync(`git pull --rebase origin "${branchName}"`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 60_000,
              stdio: "pipe",
            });
            execSync(`git push -u origin "${branchName}"`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 60_000,
              stdio: "pipe",
            });
            logger.info("Rebase recovery successful");
          } else {
            throw pushErr; // Re-throw non-push errors
          }
        }

        const remoteRef = execSync(`git ls-remote --heads origin "${branchName}"`, {
          cwd: workDir,
          encoding: "utf-8",
          timeout: 10_000,
        }).trim();

        if (!remoteRef) {
          logger.error({ branch: branchName }, "Branch not found on remote after push");
          exitCode = 1;
          failureReason = "Branch push failed — not found on remote";
        } else {
          try {
            prUrl = execSync(`gh pr view --json url -q .url`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 15_000,
            }).trim();
          } catch {
            const commitMessages = execSync(`git log main..HEAD --pretty=format:"- %s"`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 10_000,
            }).trim();
            const prTitle = execSync(`git log -1 --pretty=format:"%s"`, {
              cwd: workDir,
              encoding: "utf-8",
              timeout: 5_000,
            }).trim();
            const bodyFile = join(tmpdir(), `pr-body-${Date.now()}.md`);
            try {
              writeFileSync(bodyFile, `## Summary\n${commitMessages}\n\n🤖 Generated by just-ship pipeline`);
              prUrl = execSync(
                `gh pr create --title "${prTitle.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\`/g, '\\`')}" --body-file "${bodyFile}"`,
                { cwd: workDir, encoding: "utf-8", timeout: 30_000 },
              ).trim();
            } finally {
              try { unlinkSync(bodyFile); } catch { /* ignore */ }
            }
          }
          logger.info({ prUrl }, "Ship complete");
        }
      }
    } catch (shipErr) {
      const reason = shipErr instanceof Error ? shipErr.message : String(shipErr);
      logger.error({ reason }, "Ship failed");
      exitCode = 1;
      failureReason = `Ship failed: ${reason}`;
    }
  }

  // Collect token totals — prefer SDK result usage over hook-based totals
  const hookTotals = eventHooks?.getTotals();
  let finalTokens: { input: number; output: number; estimatedCostUsd: number } | undefined;

  if (sdkUsage && (sdkUsage.input_tokens ?? 0) > 0) {
    const input = sdkUsage.input_tokens ?? 0;
    const output = sdkUsage.output_tokens ?? 0;
    const costUsd = estimateCost("opus", input, output);
    finalTokens = { input, output, estimatedCostUsd: costUsd };
    log(`[Tokens] SDK usage: ${input} in / ${output} out = $${costUsd.toFixed(4)}`);
  } else if (hookTotals && hookTotals.inputTokens > 0) {
    finalTokens = { input: hookTotals.inputTokens, output: hookTotals.outputTokens, estimatedCostUsd: hookTotals.estimatedCostUsd };
  }

  // Post pipeline summary with token costs
  if (hasPipeline && eventConfig && finalTokens) {
    await postPipelineSummary(eventConfig, {
      inputTokens: finalTokens.input,
      outputTokens: finalTokens.output,
      estimatedCostUsd: finalTokens.estimatedCostUsd,
    });
  }

  return {
    status: exitCode === 0 ? "completed" : "failed",
    exitCode,
    branch: branchName,
    project: config.name,
    failureReason,
    sessionId: newSessionId ?? resumeSessionId,
    tokens: finalTokens,
    prUrl,
  };
}

// --- CLI entry point (only runs when executed directly) ---
// Wrapped in async IIFE to avoid top-level await (breaks CJS imports from server.ts)
const isMain = process.argv[1]?.endsWith("run.ts");
if (isMain) {
  (async () => {
    const projectDir = process.cwd();
    let ticket: TicketArgs;
    try {
      ticket = parseCliArgs(process.argv.slice(2));
    } catch (e) {
      logger.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    const config = loadProjectConfig(projectDir);

    // --- Banner ---
    logger.info({ project: config.name, ticketId: ticket.ticketId, title: ticket.title }, "Autonomous Pipeline (SDK) starting");

    const result = await executePipeline({ projectDir, ticket });

    // --- JSON output (stdout, for n8n / worker) ---
    logger.info({ status: result.status }, "Pipeline finished");

    const cliResult = {
      status: result.status,
      ...(result.status === "failed" ? { exit_code: result.exitCode } : {}),
      ticket_id: ticket.ticketId,
      ticket_title: ticket.title,
      branch: result.branch,
      project: result.project,
    };
    // Keep stdout JSON output for CLI consumers (n8n, worker)
    // Also emit through logger for log aggregation
    logger.info(cliResult, "Pipeline result");
    console.log(JSON.stringify(cliResult));

    if (result.status === "failed") process.exit(result.exitCode);
  })();
}
