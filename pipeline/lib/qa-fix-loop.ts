/**
 * QA Fix Loop — Autonomous fix attempts after QA failures
 *
 * Orchestrates a loop: run QA -> if failed, ask Claude to fix -> re-run QA.
 * Stops when QA passes or max iterations reached.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import { runQa, postQaReport, type QaContext, type QaReport } from "./qa-runner.js";
import { makeSpawn } from "./spawn.ts";
import { sleep } from "./utils.ts";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface FixLoopResult {
  finalReport: QaReport;
  iterations: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLastCommitMessage(workDir: string): string {
  try {
    return execSync("git log -1 --pretty=format:%s", {
      cwd: workDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "(could not read last commit)";
  }
}

// sleep() imported from ./utils.ts

// ---------------------------------------------------------------------------
// Fix Prompt Builder
// ---------------------------------------------------------------------------

function buildFixPrompt(
  ticketId: string,
  report: QaReport,
  iteration: number,
): string {
  const failedBlocking = report.checks.filter((c) => c.blocking && !c.passed);

  const failureList = failedBlocking
    .map((c) => `- **${c.name}**: ${c.details}`)
    .join("\n");

  // Add Shopify-specific fix guidance if shopify-qa check failed
  const shopifyFailures = failedBlocking.filter(c => c.name === "shopify-qa");
  const shopifyGuidance = shopifyFailures.length > 0
    ? `\n\n## Shopify-Specific Guidance\nFix these Shopify QA issues:\n${shopifyFailures.map(c => c.details).join("\n")}\n- Use CSS custom properties instead of hardcoded color values\n- Ensure changes propagate to all affected sections/snippets\n- Use section settings instead of hardcoded values where appropriate`
    : "";

  return `The QA checks for ticket T-${ticketId} have failed. Fix the issues and push.

## Failed Checks
${failureList}${shopifyGuidance}

## Instructions
1. Read the relevant source files
2. Fix the issues causing the failures
3. Run the build to verify your fix
4. Commit your fix with message: "fix(qa): address QA failures (attempt ${iteration})"
5. Push with: \`git push\`

Do NOT create a new branch. You are already on the correct branch.
Do NOT modify test expectations to make them pass — fix the actual code.`;
}

// ---------------------------------------------------------------------------
// Claude Fix Session
// ---------------------------------------------------------------------------

async function runClaudeFix(
  workDir: string,
  prompt: string,
  env?: Record<string, string>,
  ticketId?: string,
): Promise<void> {
  for await (const _message of query({
    prompt,
    options: {
      cwd: workDir,
      model: "sonnet",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      maxTurns: 30,
      env: { ...process.env, ...(env ?? {}) },
      spawnClaudeCodeProcess: makeSpawn(`[QA-Fix${ticketId ? ` T-${ticketId}` : ""}]`),
    },
  })) {
    // Consume the stream — we only care that it completes
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export async function runQaWithFixLoop(ctx: QaContext): Promise<FixLoopResult> {
  const maxIterations = ctx.qaConfig.maxFixIterations;
  const isFullWithVercel = ctx.qaTier === "full" && ctx.qaConfig.previewProvider === "vercel";

  console.error(`[qa-fix-loop] Running initial QA (tier: ${ctx.qaTier}) for T-${ctx.ticketId}`);

  let report = await runQa(ctx);
  let iteration = 0;
  const fixHistory: string[] = [];

  while (report.status === "failed" && iteration < maxIterations) {
    iteration++;
    console.error(
      `[qa-fix-loop] QA failed — starting fix attempt ${iteration}/${maxIterations} for T-${ctx.ticketId}`,
    );

    // a. Build fix prompt from failed blocking checks
    const fixPrompt = buildFixPrompt(ctx.ticketId, report, iteration);

    // b+c. Run Claude Sonnet to fix the issues
    try {
      await runClaudeFix(ctx.workDir, fixPrompt, ctx.env, ctx.ticketId);

      // d. Record what was committed
      const commitMsg = getLastCommitMessage(ctx.workDir);
      fixHistory.push(`Attempt ${iteration}: ${commitMsg}`);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[qa-fix-loop] Fix session failed: ${errorMsg}`);
      fixHistory.push(`Attempt ${iteration}: Failed — ${errorMsg}`);
    }

    // e. Carry over any existing fix history from the previous report
    if (report.fixHistory.length > 0) {
      for (const entry of report.fixHistory) {
        if (!fixHistory.includes(entry)) {
          fixHistory.unshift(entry);
        }
      }
    }

    // f. For full-tier with Vercel, wait for redeployment
    if (isFullWithVercel) {
      console.error("[qa-fix-loop] Waiting 5s for Vercel redeployment...");
      await sleep(5000);
    }

    // g. Re-run QA
    console.error(`[qa-fix-loop] Re-running QA after fix attempt ${iteration}`);
    const newReport = await runQa(ctx);

    // h. Attach accumulated fix history
    newReport.fixHistory = [...fixHistory];

    // i. Replace report
    report = newReport;
  }

  if (report.status === "passed") {
    console.error(
      `[qa-fix-loop] QA passed after ${iteration} fix iteration(s) for T-${ctx.ticketId}`,
    );
  } else if (iteration >= maxIterations) {
    console.error(
      `[qa-fix-loop] QA still failing after ${iteration} fix iteration(s) for T-${ctx.ticketId}`,
    );
  }

  // Post the final report to the PR
  postQaReport(ctx.workDir, ctx.branchName, report, ctx.ticketId);

  return { finalReport: report, iterations: iteration };
}
