import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import { makeSpawn } from "./lib/spawn.ts";
import { estimateCost } from "./lib/cost.ts";
import { checkLevel1Exists } from "./lib/artifact-verifier.ts";
import { resolveVerifyCommands, runVerifyCommands } from "./lib/verify-commands.ts";
import { detectScopeReduction } from "./lib/scope-guard.ts";

// --- Exported pipeline function (used by worker.ts) ---
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
  sanitizeBranchName(branchName);

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
    console.error(`[Pipeline] Warning: could not write .active-ticket`);
  }

  // --- Load agents + orchestrator prompt ---
  const agents = loadAgents(workDir);
  const loadedSkills = loadSkills(projectDir, config);
  if (loadedSkills.skillNames.length > 0) {
    console.error(`[Pipeline] Skills loaded: ${loadedSkills.skillNames.join(", ")}`);
  }

  // Filter agents by skipAgents config
  const skipAgents = config.pipeline.skipAgents ?? [];
  const filteredAgents = Object.fromEntries(
    Object.entries(agents).filter(([name]) => !skipAgents.includes(name))
  );
  if (skipAgents.length > 0) {
    console.error(`[Pipeline] Skipping agents: ${skipAgents.join(", ")}`);
  }

  // Inject skills into agent prompts
  for (const [name, def] of Object.entries(filteredAgents)) {
    const roleSkills = loadedSkills.byRole.get(name as AgentRole);
    if (roleSkills && def.prompt) {
      def.prompt += `\n\n${roleSkills}`;
    }
  }

  // Build orchestrator prompt with skills
  let orchestratorPrompt = loadOrchestratorPrompt(workDir);
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
  const eventHooks = hasPipeline ? createEventHooks(eventConfig, {
    onPause: (reason, questionText) => {
      pauseReason = reason;
      pauseQuestion = questionText;
    },
    getLastAssistantText: () => lastAssistantText,
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
  const triagePrompt = loadTriagePrompt(workDir);
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
      const enrichmentPrompt = loadEnrichmentPrompt(workDir);
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
          console.error(`[Enrichment] Done — ${triageResult.affectedFiles?.length ?? 0} files, ${triageResult.addedACs?.length ?? 0} ACs added`);
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
      console.error(`[Enrichment] Skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Shopify env check (VPS path — develop.md handles local path)
  if (config.stack?.platform === "shopify") {
    try {
      execSync(`bash "${workDir}/.claude/scripts/shopify-env-check.sh"`, {
        timeout: 30_000,
        stdio: "pipe",
      });
      console.error("[Shopify] Environment check passed");
    } catch (e) {
      console.error(`[Shopify] Environment check failed: ${e instanceof Error ? e.message : String(e)}`);
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
  let sdkUsage: { input_tokens?: number; output_tokens?: number } | undefined;
  try {
    if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "orchestrator");

    // --- Diagnostic logging ---
    const agentNames = Object.keys(filteredAgents);
    const skillNames = loadedSkills.skillNames;
    console.error(`[Pipeline] Starting orchestrator query:`);
    console.error(`[Pipeline]   workDir: ${workDir}`);
    console.error(`[Pipeline]   model: opus`);
    console.error(`[Pipeline]   agents: ${agentNames.join(", ") || "none"}`);
    console.error(`[Pipeline]   skills: ${skillNames.join(", ") || "none"}`);
    console.error(`[Pipeline]   prompt length: ${prompt.length} chars`);
    console.error(`[Pipeline]   branch: ${branchName}`);
    console.error(`[Pipeline]   timeout: ${timeoutMs / 60_000} min`);

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
          console.error("[SDK Result]", resultMsg.subtype);
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
          console.error("[Pipeline] Warning: could not store question in ticket");
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
          console.error(`[Verifier] WARN: ${level1.message}`);
          if (hasPipeline) {
            await postPipelineEvent(eventConfig, "verification_warning", "orchestrator", {
              level: 1,
              message: level1.message,
            });
          }
        } else {
          console.error(`[Verifier] Level 1 OK: ${level1.message}`);
        }
      } catch {
        console.error("[Verifier] Could not run artifact verification — continuing");
      }
    }

    // --- Scope Reduction Guard ---
    if (exitCode === 0 && lastAssistantText) {
      const scopeCheck = detectScopeReduction(lastAssistantText);
      if (scopeCheck.detected) {
        console.error(`[ScopeGuard] WARNING: ${scopeCheck.message}`);
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
    if (exitCode !== 0) {
      console.error(`[Pipeline] Final state: exitCode=${exitCode}, reason=${failureReason ?? "unknown"}, timedOut=${timedOut}`);
    }
  }

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
    });

    if (verifyCommands.length > 0) {
      const verifyResults = runVerifyCommands({ workDir, commands: verifyCommands });
      for (const vr of verifyResults) {
        if (vr.passed) {
          console.error(`[Verify] OK: ${vr.cmd} (${vr.attempts} attempt(s))`);
        } else if (vr.blocking) {
          console.error(`[Verify] FAILED: ${vr.cmd} after ${vr.attempts} attempt(s)`);
          qaContext.verifyOutput = vr.output;
          qaContext.verifyFailed = true;
        } else {
          console.error(`[Verify] WARN: ${vr.cmd} failed (advisory)`);
        }
      }
    }

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
  sanitizeBranchName(branchName);

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
    console.error(`[Pipeline] Warning: could not write .active-ticket`);
  }

  const agents = loadAgents(workDir);
  const loadedSkills = loadSkills(projectDir, config);

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

  const eventHooks = hasPipeline ? createEventHooks(eventConfig, {
    onPause: (reason, questionText) => {
      pauseReason = reason;
      pauseQuestion = questionText;
    },
    getLastAssistantText: () => lastAssistantText,
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
          console.error("[SDK Result]", resultMsg.subtype);
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
          console.error("[Pipeline] Warning: could not store question in ticket");
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
    if (exitCode !== 0) {
      console.error(`[Pipeline] Final state: exitCode=${exitCode}, reason=${failureReason ?? "unknown"}, timedOut=${timedOut}`);
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
  };
}

// --- CLI entry point (only runs when executed directly) ---
// Wrapped in async IIFE to avoid top-level await (breaks CJS imports from worker.ts)
const isMain = process.argv[1]?.endsWith("run.ts");
if (isMain) {
  (async () => {
    const projectDir = process.cwd();
    let ticket: TicketArgs;
    try {
      ticket = parseCliArgs(process.argv.slice(2));
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
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
