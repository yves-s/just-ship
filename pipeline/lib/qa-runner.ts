/**
 * QA Runner — Tier-based execution with Playwright smoke tests
 *
 * Dispatches QA checks based on the tier assigned by the triage agent:
 *   - skip:  Build check only
 *   - light: Build check + tests (if configured)
 *   - full:  Build + tests + Vercel preview + Playwright smoke + screenshots
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import type { QaConfig } from "./config.js";
import { waitForVercelPreview } from "./vercel-preview.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface QaContext {
  workDir: string;
  branchName: string;
  ticketId: string;
  qaTier: "full" | "light" | "skip";
  qaPages: string[];
  qaFlows: string[];
  qaConfig: QaConfig;
  packageManager: string;
  buildCommand?: string;
  testCommand?: string;
}

export interface QaCheckResult {
  name: string;
  passed: boolean;
  details: string;
  blocking: boolean; // false = best-effort
}

export interface QaReport {
  tier: string;
  status: "passed" | "failed";
  previewUrl: string | null;
  checks: QaCheckResult[];
  screenshotMarkdown: string[]; // Markdown image references for PR comment
  fixHistory: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCommand(packageManager: string): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm run build";
    case "yarn":
      return "yarn build";
    case "bun":
      return "bun run build";
    default:
      return "npm run build";
  }
}

function testCommand(packageManager: string): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm run test";
    case "yarn":
      return "yarn test";
    case "bun":
      return "bun run test";
    default:
      return "npm test";
  }
}

function exec(cmd: string, cwd: string, timeoutMs = 120_000): { stdout: string; ok: boolean } {
  try {
    const stdout = execSync(cmd, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, ok: true };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = [error.stdout ?? "", error.stderr ?? ""].filter(Boolean).join("\n");
    return { stdout: output || (error.message ?? "Unknown error"), ok: false };
  }
}

// ---------------------------------------------------------------------------
// Build Check
// ---------------------------------------------------------------------------

export function runBuildCheck(workDir: string, packageManager: string, overrideCmd?: string): QaCheckResult {
  const cmd = overrideCmd ?? buildCommand(packageManager);
  console.error(`[qa-runner] Running build: ${cmd}`);

  const { stdout, ok } = exec(cmd, workDir);
  const truncated = stdout.length > 2000 ? `...${stdout.slice(-2000)}` : stdout;

  return {
    name: "build",
    passed: ok,
    details: ok ? "Build succeeded" : `Build failed:\n\`\`\`\n${truncated}\n\`\`\``,
    blocking: true,
  };
}

// ---------------------------------------------------------------------------
// Test Check
// ---------------------------------------------------------------------------

export function runTestCheck(workDir: string, packageManager: string, overrideCmd?: string): QaCheckResult | null {
  const pkgJsonPath = join(workDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return null;
  }

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return null;
  }

  const scripts = pkgJson.scripts as Record<string, string> | undefined;
  if (!scripts?.test) {
    return null;
  }

  // Skip the default npm init stub
  if (scripts.test.includes('echo "Error: no test specified"')) {
    return null;
  }

  const cmd = overrideCmd ?? testCommand(packageManager);
  console.error(`[qa-runner] Running tests: ${cmd}`);

  const { stdout, ok } = exec(cmd, workDir, 180_000);
  const truncated = stdout.length > 2000 ? `...${stdout.slice(-2000)}` : stdout;

  return {
    name: "tests",
    passed: ok,
    details: ok ? "Tests passed" : `Tests failed:\n\`\`\`\n${truncated}\n\`\`\``,
    blocking: true,
  };
}

// ---------------------------------------------------------------------------
// Playwright Smoke Tests
// ---------------------------------------------------------------------------

interface PlaywrightPageResult {
  check: QaCheckResult;
  screenshotPath: string | null;
}

function runPlaywrightPage(
  workDir: string,
  previewUrl: string,
  page: string,
  timeoutMs: number,
): PlaywrightPageResult {
  const safeName = page.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "") || "root";
  const timestamp = Date.now();
  const screenshotPath = `/tmp/qa-screenshot-${safeName}-${timestamp}.png`;

  const fullUrl = `${previewUrl.replace(/\/$/, "")}${page.startsWith("/") ? page : `/${page}`}`;

  const script = `
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

let status = 0;
try {
  const response = await page.goto(${JSON.stringify(fullUrl)}, {
    waitUntil: 'networkidle',
    timeout: ${timeoutMs},
  });
  status = response?.status() ?? 0;
} catch (err) {
  console.error('NAVIGATION_ERROR:' + err.message);
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: ${JSON.stringify(screenshotPath)}, fullPage: false });
await browser.close();

const result = { status, consoleErrors, screenshotPath: ${JSON.stringify(screenshotPath)} };
console.log('QA_RESULT:' + JSON.stringify(result));
`;

  const scriptPath = join(tmpdir(), `qa-playwright-${safeName}-${timestamp}.mjs`);

  try {
    writeFileSync(scriptPath, script, "utf-8");

    const { stdout, ok } = exec(`node ${scriptPath}`, workDir, timeoutMs + 30_000);

    if (!ok) {
      return {
        check: {
          name: `smoke:${page}`,
          passed: false,
          details: `Playwright navigation failed for ${page}: ${stdout.slice(0, 500)}`,
          blocking: true,
        },
        screenshotPath: null,
      };
    }

    // Parse structured result from script output
    const resultMatch = stdout.match(/QA_RESULT:(.+)/);
    if (!resultMatch) {
      return {
        check: {
          name: `smoke:${page}`,
          passed: false,
          details: `Could not parse Playwright result for ${page}`,
          blocking: true,
        },
        screenshotPath: null,
      };
    }

    const result = JSON.parse(resultMatch[1]) as {
      status: number;
      consoleErrors: string[];
      screenshotPath: string;
    };

    const statusOk = result.status >= 200 && result.status < 400;
    const details = [
      `HTTP ${result.status}`,
      result.consoleErrors.length > 0
        ? `Console errors: ${result.consoleErrors.slice(0, 5).join("; ")}`
        : "No console errors",
    ].join(" | ");

    return {
      check: {
        name: `smoke:${page}`,
        passed: statusOk,
        details,
        blocking: true,
      },
      screenshotPath: existsSync(result.screenshotPath) ? result.screenshotPath : null,
    };
  } finally {
    // Clean up temp script
    try {
      unlinkSync(scriptPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

export function runPlaywrightSmoke(
  workDir: string,
  previewUrl: string,
  pages: string[],
  timeoutMs: number,
): { checks: QaCheckResult[]; screenshotPaths: string[] } {
  const effectivePages = pages.length > 0 ? pages : ["/"];

  const checks: QaCheckResult[] = [];
  const screenshotPaths: string[] = [];

  for (const page of effectivePages) {
    console.error(`[qa-runner] Playwright smoke: ${page}`);
    const result = runPlaywrightPage(workDir, previewUrl, page, timeoutMs);
    checks.push(result.check);
    if (result.screenshotPath) {
      screenshotPaths.push(result.screenshotPath);
    }
  }

  return { checks, screenshotPaths };
}

// ---------------------------------------------------------------------------
// Screenshot Upload (commits to repo + pushes)
// ---------------------------------------------------------------------------

function uploadScreenshots(
  workDir: string,
  branchName: string,
  screenshotPaths: string[],
): string[] {
  if (screenshotPaths.length === 0) return [];

  const screenshotDir = join(workDir, ".qa-screenshots");
  if (!existsSync(screenshotDir)) {
    mkdirSync(screenshotDir, { recursive: true });
  }

  const markdownRefs: string[] = [];

  for (const srcPath of screenshotPaths) {
    if (!existsSync(srcPath)) continue;

    const filename = basename(srcPath);
    const destPath = join(screenshotDir, filename);

    // Copy file into repo
    const content = readFileSync(srcPath);
    writeFileSync(destPath, content);

    // Build raw GitHub URL for markdown reference
    // Detect remote origin to build URL
    const { stdout: remoteUrl } = exec("git remote get-url origin", workDir);
    const cleaned = remoteUrl.trim();
    const ghMatch = cleaned.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (ghMatch) {
      const repo = ghMatch[1];
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${branchName}/.qa-screenshots/${filename}`;
      markdownRefs.push(`![${filename}](${rawUrl})`);
    } else {
      markdownRefs.push(`![${filename}](.qa-screenshots/${filename})`);
    }
  }

  // Stage, commit, and push
  exec("git add .qa-screenshots/", workDir);
  exec('git commit -m "chore(qa): add QA screenshots"', workDir);
  exec(`git push origin ${branchName}`, workDir);

  return markdownRefs;
}

// ---------------------------------------------------------------------------
// Functional Checks (Stub v1)
// ---------------------------------------------------------------------------

function runFunctionalChecks(flows: string[]): QaCheckResult[] {
  if (flows.length === 0) return [];

  return flows.map((flow) => ({
    name: `flow:${flow}`,
    passed: true,
    details: "Stub -- not yet implemented (v2)",
    blocking: false,
  }));
}

// ---------------------------------------------------------------------------
// Report Formatting
// ---------------------------------------------------------------------------

export function formatReport(report: QaReport, ticketId: string): string {
  const lines: string[] = [];

  lines.push(`## QA Report - ${ticketId}`);
  lines.push("");
  lines.push(`**Tier:** ${report.tier}`);
  lines.push(`**Status:** ${report.status === "passed" ? "Passed" : "Failed"}`);

  if (report.previewUrl) {
    lines.push(`**Preview:** ${report.previewUrl}`);
  }

  lines.push("");

  // Screenshots
  if (report.screenshotMarkdown.length > 0) {
    lines.push("### Screenshots");
    lines.push("");
    lines.push("| Page | Screenshot |");
    lines.push("|------|-----------|");
    for (const md of report.screenshotMarkdown) {
      // Extract filename from markdown image syntax
      const nameMatch = md.match(/!\[(.+?)\]/);
      const name = nameMatch ? nameMatch[1].replace(/^qa-screenshot-/, "").replace(/-\d+\.png$/, "") : "page";
      lines.push(`| ${name} | ${md} |`);
    }
    lines.push("");
  }

  // Blocking checks
  const blockingChecks = report.checks.filter((c) => c.blocking);
  if (blockingChecks.length > 0) {
    lines.push("### Blocking Checks");
    lines.push("");
    for (const check of blockingChecks) {
      const icon = check.passed ? "pass" : "FAIL";
      lines.push(`- **[${icon}]** ${check.name}: ${check.details}`);
    }
    lines.push("");
  }

  // Best-effort checks
  const bestEffortChecks = report.checks.filter((c) => !c.blocking);
  if (bestEffortChecks.length > 0) {
    lines.push("### Functional Checks (best-effort)");
    lines.push("");
    for (const check of bestEffortChecks) {
      const icon = check.passed ? "pass" : "FAIL";
      lines.push(`- **[${icon}]** ${check.name}: ${check.details}`);
    }
    lines.push("");
  }

  // Fix history
  if (report.fixHistory.length > 0) {
    lines.push("### Fix History");
    lines.push("");
    for (const entry of report.fixHistory) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Post QA Report to PR
// ---------------------------------------------------------------------------

export function postQaReport(
  workDir: string,
  branchName: string,
  report: QaReport,
  ticketId: string,
): void {
  // Find the PR for this branch
  const { stdout: prList, ok: prFound } = exec(
    `gh pr list --head "${branchName}" --json number --jq ".[0].number"`,
    workDir,
  );

  const prNumber = prList.trim();
  if (!prFound || !prNumber) {
    console.error(`[qa-runner] No PR found for branch "${branchName}" -- skipping report post`);
    return;
  }

  // Write report to temp file to avoid shell escaping issues
  const reportMarkdown = formatReport(report, ticketId);
  const tmpFile = join(tmpdir(), `qa-report-${Date.now()}.md`);
  writeFileSync(tmpFile, reportMarkdown, "utf-8");

  try {
    exec(`gh pr comment ${prNumber} --body-file "${tmpFile}"`, workDir);
    console.error(`[qa-runner] QA report posted to PR #${prNumber}`);
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }

  // Add label based on tier/status
  let label: string;
  if (report.tier === "skip") {
    label = "qa:skipped";
  } else if (report.status === "passed") {
    label = "qa:passed";
  } else {
    label = "qa:needs-review";
  }

  exec(`gh pr edit ${prNumber} --add-label "${label}"`, workDir);
  console.error(`[qa-runner] Label "${label}" added to PR #${prNumber}`);
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export async function runQa(ctx: QaContext): Promise<QaReport> {
  const report: QaReport = {
    tier: ctx.qaTier,
    status: "passed",
    previewUrl: null,
    checks: [],
    screenshotMarkdown: [],
    fixHistory: [],
  };

  console.error(`[qa-runner] Starting QA (tier: ${ctx.qaTier}) for ${ctx.ticketId}`);

  // --- Build check (all tiers) ---
  const buildResult = runBuildCheck(ctx.workDir, ctx.packageManager, ctx.buildCommand);
  report.checks.push(buildResult);

  if (!buildResult.passed) {
    report.status = "failed";
    // For skip tier, stop here
    if (ctx.qaTier === "skip") return report;
  }

  if (ctx.qaTier === "skip") {
    return report;
  }

  // --- Test check (light + full) ---
  const testResult = runTestCheck(ctx.workDir, ctx.packageManager, ctx.testCommand);
  if (testResult) {
    report.checks.push(testResult);
    if (!testResult.passed) {
      report.status = "failed";
    }
  }

  if (ctx.qaTier === "light") {
    return report;
  }

  // --- Full tier: Vercel preview + Playwright + functional stubs ---

  // Wait for Vercel preview deployment
  const previewUrl = await waitForVercelPreview(ctx.branchName, ctx.qaConfig);
  report.previewUrl = previewUrl;

  if (previewUrl) {
    // Playwright smoke tests
    const { checks: smokeChecks, screenshotPaths } = runPlaywrightSmoke(
      ctx.workDir,
      previewUrl,
      ctx.qaPages,
      ctx.qaConfig.playwrightTimeoutMs,
    );
    report.checks.push(...smokeChecks);

    // Check if any smoke test failed
    if (smokeChecks.some((c) => !c.passed && c.blocking)) {
      report.status = "failed";
    }

    // Upload screenshots and get markdown refs
    if (screenshotPaths.length > 0) {
      report.screenshotMarkdown = uploadScreenshots(ctx.workDir, ctx.branchName, screenshotPaths);
    }
  } else {
    report.checks.push({
      name: "preview",
      passed: false,
      details: "No Vercel preview URL available -- Playwright smoke tests skipped",
      blocking: false,
    });
  }

  // Functional checks (stub v1)
  const functionalChecks = runFunctionalChecks(ctx.qaFlows);
  report.checks.push(...functionalChecks);

  return report;
}
