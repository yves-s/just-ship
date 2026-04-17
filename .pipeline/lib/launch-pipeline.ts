import { execSync } from "node:child_process";
import { analyzePrototype, type LaunchPlan } from "./prototype-analyzer.ts";
import {
  type EventConfig,
  postAnalyzeComplete,
  postStepUpdate,
  postEnvInputRequired,
  postLaunchComplete,
} from "./event-hooks.ts";
import {
  createCoolifyApp,
  setCoolifyEnvVars,
  triggerCoolifyBuild,
  waitForCoolifyDeployment,
} from "./coolify-preview.ts";

export interface LaunchOptions {
  projectId: string;
  repoUrl: string;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  githubDefaultBranch: string;
  coolifyBaseUrl: string;
  coolifyServerId?: string;
  eventConfig: EventConfig;
  /** Called when ENV input is needed. Resolves with user-provided values. */
  waitForEnvInput: (envKeys: Array<{ key: string; hint?: string }>) => Promise<Record<string, string>>;
}

export interface LaunchResult {
  status: "live" | "failed";
  previewUrl?: string;
  prUrl?: string;
  error?: string;
  plan?: LaunchPlan;
}

/**
 * Execute the full prototype-to-production pipeline.
 *
 * 1. Clone repo
 * 2. Analyze (detect stack, gaps)
 * 3. Build-fix (if needed)
 * 4. Parallel: error handling, tests, security
 * 5. ENV input (pause for user)
 * 6. Deploy to Coolify
 * 7. Create PR
 */
export async function executeLaunchPipeline(opts: LaunchOptions): Promise<LaunchResult> {
  const { eventConfig } = opts;
  const tempDir = `/tmp/launch-${opts.projectId}-${Date.now()}`;
  const launchBranch = "just-ship/launch";

  try {
    // --- Phase 1: Clone ---
    console.error(`[launch] Cloning ${opts.githubOwner}/${opts.githubRepo}...`);
    const cloneUrl = `https://x-access-token:${opts.githubToken}@github.com/${opts.githubOwner}/${opts.githubRepo}.git`;
    execSync(`git clone "${cloneUrl}" "${tempDir}"`, {
      stdio: "pipe",
      timeout: 120_000,
    });

    // Create launch branch
    execSync(`git checkout -b "${launchBranch}"`, {
      cwd: tempDir,
      stdio: "pipe",
    });

    // --- Phase 2: Analyze ---
    await postStepUpdate(eventConfig, "analyze", "started");
    const plan = await analyzePrototype(tempDir);
    await postAnalyzeComplete(eventConfig, plan.stack, plan.steps);
    await postStepUpdate(eventConfig, "analyze", "completed");

    console.error(`[launch] Stack: ${plan.stack.framework ?? "unknown"} + ${plan.stack.database ?? "no-db"} + ${plan.stack.styling ?? "no-styling"}`);
    console.error(`[launch] Gaps: buildFix=${plan.gaps.needsBuildFix} errorHandling=${plan.gaps.needsErrorHandling} tests=${plan.gaps.needsTests} security=${plan.gaps.needsSecurity}`);

    // --- Phase 3: Build Fix (sequential, must be first) ---
    if (plan.gaps.needsBuildFix) {
      await postStepUpdate(eventConfig, "build-fix", "started");
      try {
        await runBuildFix(tempDir, plan);
        await postStepUpdate(eventConfig, "build-fix", "completed");
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await postStepUpdate(eventConfig, "build-fix", "failed", error);
        // Build fix failure is critical -- continue anyway, deploy might still work
        console.error(`[launch] Build fix failed: ${error}`);
      }
    }

    // --- Phase 4: Parallel steps ---
    const parallelSteps = plan.steps.filter(s => s.parallel);
    if (parallelSteps.length > 0) {
      await Promise.allSettled(
        parallelSteps.map(async (step) => {
          await postStepUpdate(eventConfig, step.id, "started");
          try {
            await runStep(tempDir, step.id, plan);
            await postStepUpdate(eventConfig, step.id, "completed");
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            await postStepUpdate(eventConfig, step.id, "failed", error);
            console.error(`[launch] Step ${step.id} failed: ${error}`);
          }
        })
      );
    }

    // Commit all changes
    try {
      execSync('git add -A && git diff --cached --quiet || git commit -m "feat: make project production-ready (Just Ship Launch)"', {
        cwd: tempDir,
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // No changes to commit -- that's fine
    }

    // --- Phase 5: ENV Input ---
    const envKeyInfos = plan.envKeys.map(key => ({
      key,
      hint: getEnvKeyHint(key),
    }));

    let envValues: Record<string, string> = {};
    if (plan.envKeys.length > 0) {
      await postEnvInputRequired(eventConfig, envKeyInfos);
      await postStepUpdate(eventConfig, "env-input", "started");

      // Wait for user to provide ENV values (blocking)
      envValues = await opts.waitForEnvInput(envKeyInfos);
      await postStepUpdate(eventConfig, "env-input", "completed");
    }

    // --- Phase 6: Deploy ---
    await postStepUpdate(eventConfig, "deploy", "started");

    // Push launch branch
    execSync(`git push origin "${launchBranch}"`, {
      cwd: tempDir,
      stdio: "pipe",
      timeout: 60_000,
    });

    // Create Coolify app
    const buildCmd = plan.stack.packageManager === "bun" ? "bun run build" : `${plan.stack.packageManager} run build`;
    const installCmd = plan.stack.packageManager === "bun" ? "bun install" : `${plan.stack.packageManager} install`;
    const startCmd = getStartCommand(plan);
    const port = getPort(plan);

    const { uuid: appUuid } = await createCoolifyApp({
      name: `${opts.githubOwner}-${opts.githubRepo}`,
      repoUrl: opts.repoUrl,
      branch: launchBranch,
      buildCommand: buildCmd,
      installCommand: installCmd,
      startCommand: startCmd,
      port,
      baseUrl: opts.coolifyBaseUrl,
      serverId: opts.coolifyServerId,
    });

    // Set ENV vars (if any)
    if (Object.keys(envValues).length > 0) {
      await setCoolifyEnvVars(appUuid, envValues, opts.coolifyBaseUrl);
    }

    // Trigger build
    await triggerCoolifyBuild(appUuid, opts.coolifyBaseUrl);

    // Wait for deployment
    const previewUrl = await waitForCoolifyDeployment(appUuid, opts.coolifyBaseUrl);

    await postStepUpdate(eventConfig, "deploy", "completed");

    // --- Phase 7: Create PR ---
    let prUrl: string | undefined;
    try {
      const prOutput = execSync(
        `GH_TOKEN="${opts.githubToken}" gh pr create --title "feat: make production-ready (Just Ship Launch)" --body "Automated by Just Ship Launch Pipeline" --base "${opts.githubDefaultBranch}" --head "${launchBranch}"`,
        { cwd: tempDir, encoding: "utf-8", stdio: "pipe", timeout: 30_000 }
      ).trim();
      prUrl = prOutput;
    } catch (err) {
      console.error(`[launch] PR creation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await postLaunchComplete(eventConfig, previewUrl, prUrl);

    return { status: "live", previewUrl, prUrl, plan };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[launch] Pipeline failed: ${error}`);
    return { status: "failed", error };
  } finally {
    // Cleanup
    try {
      execSync(`rm -rf "${tempDir}"`, { stdio: "pipe", timeout: 10_000 });
    } catch { /* best-effort */ }
  }
}

// --- Step implementations (placeholder -- actual agent-based impl in v2) ---

async function runBuildFix(repoDir: string, plan: LaunchPlan): Promise<void> {
  const pm = plan.stack.packageManager;
  const installCmd = pm === "bun" ? "bun install" : `${pm} install`;
  execSync(installCmd, { cwd: repoDir, stdio: "pipe", timeout: 120_000 });

  // If lockfile is missing, generate it (install already does this)
  if (plan.gaps.needsLockfile) {
    execSync(installCmd, { cwd: repoDir, stdio: "pipe", timeout: 120_000 });
  }

  const buildCmd = pm === "bun" ? "bun run build" : `${pm} run build`;
  execSync(buildCmd, { cwd: repoDir, stdio: "pipe", timeout: 120_000 });
}

async function runStep(repoDir: string, stepId: string, _plan: LaunchPlan): Promise<void> {
  // v1: These are placeholder implementations.
  // In v2, each step dispatches a Claude agent with specific instructions.
  switch (stepId) {
    case "error-handling":
      console.error(`[launch] Step ${stepId}: would add error handling (v2: agent-based)`);
      break;
    case "tests":
      console.error(`[launch] Step ${stepId}: would write tests (v2: agent-based)`);
      break;
    case "security":
      console.error(`[launch] Step ${stepId}: would harden security (v2: agent-based)`);
      break;
    default:
      console.error(`[launch] Unknown step: ${stepId}`);
  }
}

function getEnvKeyHint(key: string): string {
  const hints: Record<string, string> = {
    SUPABASE_URL: "Your Supabase project URL (e.g. https://xxx.supabase.co)",
    SUPABASE_ANON_KEY: "Your Supabase anon/public key",
    SUPABASE_SERVICE_ROLE_KEY: "Your Supabase service role key (keep secret)",
    DATABASE_URL: "PostgreSQL connection string",
    NEXT_PUBLIC_SUPABASE_URL: "Your Supabase project URL (public)",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "Your Supabase anon key (public)",
    OPENAI_API_KEY: "Your OpenAI API key",
    ANTHROPIC_API_KEY: "Your Anthropic API key",
    STRIPE_SECRET_KEY: "Your Stripe secret key",
    STRIPE_PUBLISHABLE_KEY: "Your Stripe publishable key",
    NEXTAUTH_SECRET: "Random string for NextAuth session encryption",
    NEXTAUTH_URL: "Your app's URL (e.g. https://your-app.com)",
  };
  return hints[key] ?? `Value for ${key}`;
}

function getStartCommand(plan: LaunchPlan): string {
  if (plan.stack.framework === "next") return "npm start";
  if (plan.stack.framework === "express") return "node dist/index.js";
  return "npm start";
}

function getPort(plan: LaunchPlan): number {
  if (plan.stack.framework === "next") return 3000;
  if (plan.stack.framework === "astro") return 4321;
  if (plan.stack.framework === "svelte") return 5173;
  if (plan.stack.framework === "vue") return 5173;
  if (plan.stack.framework === "express") return 3000;
  return 3000;
}
