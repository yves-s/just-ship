// Local-mode subcommand dispatcher.
//
// The slash commands `/develop`, `/ship`, `/recover` shell out to
// `bun run pipeline/run.ts <subcommand> --ticket=<N> --mode=local --worktree=<path>`.
// Those triggers land here. We reuse the existing `executePipeline` /
// `resumePipeline` for develop+resume, and a slimmed-down ship/recover path
// that talks to the same code we'd run on the VPS — no parallel implementation.
//
// Why this lives in a separate module rather than inside `run.ts`:
//   - keeps `run.ts` focused on the pipeline mechanics it has had since the
//     beginning (orchestrator query + ship phase),
//   - lets the local CLI helpers stay testable without spinning up the SDK,
//   - makes the lifecycle of "main repo → worktree" explicit and visible.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "./logger.ts";
import { loadProjectConfig, type TicketArgs } from "./config.ts";
import {
  fetchTicketFromBoard,
  patchTicketOnBoard,
  ticketArgsFromBoard,
} from "./board-fetch.ts";
import type { SubcommandArgs } from "./cli-args.ts";

export interface LocalModeContext {
  projectDir: string;   // The main repo root (where project.json lives)
  workDir: string;      // The actual worktree to operate in
  ticketArgs: TicketArgs;
}

export interface LocalDispatchResult {
  status: "completed" | "failed" | "paused";
  exitCode: number;
  message?: string;
  branch?: string;
  prUrl?: string;
}

/**
 * Reject worktree paths that contain shell metacharacters that would break
 * the double-quoted shell-string interpolations below (`git worktree add
 * "${workDir}"` etc.). Inside double quotes, `$`, backticks and `\` still
 * carry meaning. A path with newlines or NUL bytes is also rejected — those
 * are the classic splitter primitives.
 *
 * This is defence-in-depth: in practice the markdown triggers build the
 * worktree path from the validated ticket number, so this should never fire.
 * It exists for direct `bun run pipeline/run.ts develop --worktree=...`
 * invocations from outside the markdown.
 */
function assertSafeWorktreePath(p: string): void {
  if (/[\r\n\0`$"\\]/.test(p)) {
    throw new Error(
      `--worktree path contains unsafe characters (newlines, $, \`, ", \\, NUL). ` +
      `Pass an absolute path with only normal filename characters.`,
    );
  }
}

/**
 * Resolve the projectDir + workDir for a local-mode invocation.
 *
 * `projectDir` is always the main repo root (one level above `.worktrees/T-N`).
 * `workDir` is the worktree (where the actual edits happen). If the caller
 * passes `--worktree`, we trust it. Otherwise we derive `.worktrees/T-<N>` from
 * the cwd. We do NOT create the worktree here — that is the trigger script's
 * job before it calls bun (so the bun process starts inside the right cwd).
 */
function resolveDirs(args: SubcommandArgs, cwd: string): { projectDir: string; workDir: string } {
  if (args.worktree) assertSafeWorktreePath(args.worktree);
  const explicit = args.worktree ? resolve(args.worktree) : null;

  // If --worktree is supplied, treat it as the worktree path. The repo root
  // is two levels up (.worktrees/T-N → repo).
  if (explicit) {
    const workDir = explicit;
    // Detect repo root by looking for `.worktrees/` ancestor. Fallback: cwd.
    const idx = workDir.indexOf(`/.worktrees/`);
    const projectDir = idx > 0 ? workDir.slice(0, idx) : cwd;
    return { projectDir, workDir };
  }

  // No --worktree — assume cwd is already the worktree (the markdown trigger
  // cd's into the worktree before invoking bun) or we're at the repo root.
  const idx = cwd.indexOf(`/.worktrees/`);
  if (idx > 0) {
    return { projectDir: cwd.slice(0, idx), workDir: cwd };
  }
  // cwd is the repo root and no worktree was passed — derive .worktrees/T-N.
  return { projectDir: cwd, workDir: join(cwd, ".worktrees", `T-${args.ticketId}`) };
}

/**
 * Resolve the TicketArgs for a local invocation. In local mode we only get
 * a ticket number on the CLI — title/description/labels come from the board.
 * If the board is unreachable, we fall back to placeholders so develop can
 * still run in standalone mode.
 */
async function resolveTicketArgs(
  ticketId: string,
  projectDir: string,
): Promise<TicketArgs> {
  const config = loadProjectConfig(projectDir);
  const credentials = {
    apiUrl: config.pipeline.apiUrl,
    apiKey: config.pipeline.apiKey,
  };
  const ticket = await fetchTicketFromBoard(ticketId, credentials);
  if (ticket) {
    return ticketArgsFromBoard(ticket);
  }
  logger.warn(
    { ticketId },
    "Could not fetch ticket from board — using placeholder data",
  );
  return {
    ticketId,
    title: `Ticket T-${ticketId}`,
    description: "No description provided",
    labels: "",
  };
}

/**
 * Ensure the worktree exists and is on the right branch. If it doesn't exist,
 * create it via `git worktree add`. The trigger script in
 * `commands/develop.md` is responsible for the happy path; this is the safety
 * net for direct `bun run pipeline/run.ts develop --ticket=N --mode=local`
 * invocations from outside the markdown.
 */
function ensureWorktree(projectDir: string, workDir: string, ticketId: string, branchPrefix: string): string {
  if (existsSync(workDir)) {
    // Verify it's a worktree, not just a stray directory.
    try {
      const branch = execSync("git branch --show-current", {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 5_000,
      }).trim();
      if (branch) return branch;
    } catch {
      // Fall through — corrupt worktree, attempt to recreate.
    }
  }

  // Create a fresh worktree. Branch name = `<prefix>T-<id>-bun-trigger`.
  const branch = `${branchPrefix}T-${ticketId}`;
  mkdirSync(join(projectDir, ".worktrees"), { recursive: true });
  try {
    execSync("git fetch origin main", { cwd: projectDir, stdio: "pipe", timeout: 30_000 });
  } catch { /* offline ok */ }

  try {
    execSync(`git worktree add "${workDir}" -b "${branch}" origin/main`, {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch {
    // Branch may already exist — try without -b.
    execSync(`git worktree add "${workDir}" "${branch}"`, {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 30_000,
    });
  }
  return branch;
}

/**
 * Determine the conventional branch prefix from the project's branch_prefix
 * config plus a couple of cheap heuristics on the labels. The trigger script
 * may have already created a branch with a more specific prefix — in which
 * case ensureWorktree returns the existing branch unchanged.
 */
function deriveBranchPrefix(projectDir: string): string {
  try {
    const config = loadProjectConfig(projectDir);
    return config.conventions.branch_prefix || "feature/";
  } catch {
    return "feature/";
  }
}

/**
 * Local /develop — fetch ticket, ensure worktree, hand off to executePipeline.
 *
 * NOTE: We import executePipeline lazily to keep this file unit-testable
 * without pulling in the full SDK runtime.
 */
export async function executeLocalDevelop(args: SubcommandArgs, cwd: string): Promise<LocalDispatchResult> {
  const { projectDir, workDir } = resolveDirs(args, cwd);
  const ticketArgs = await resolveTicketArgs(args.ticketId, projectDir);
  const branchPrefix = deriveBranchPrefix(projectDir);
  const branchName = ensureWorktree(projectDir, workDir, args.ticketId, branchPrefix);

  // Lazy import so unit tests can mock this module without touching the SDK.
  const { executePipeline } = await import("../run.ts");
  const result = await executePipeline({
    projectDir,
    workDir,
    branchName,
    ticket: ticketArgs,
  });

  return {
    status: result.status,
    exitCode: result.exitCode,
    branch: result.branch,
    prUrl: result.prUrl,
    message: result.failureReason,
  };
}

/**
 * Local /resume — resume a paused pipeline session in the existing worktree.
 */
export async function executeLocalResume(args: SubcommandArgs, cwd: string): Promise<LocalDispatchResult> {
  const { projectDir, workDir } = resolveDirs(args, cwd);
  const ticketArgs = await resolveTicketArgs(args.ticketId, projectDir);

  if (!args.sessionId || !args.answer) {
    return {
      status: "failed",
      exitCode: 1,
      message: `resume requires --session-id and --answer`,
    };
  }

  const { resumePipeline } = await import("../run.ts");
  const result = await resumePipeline({
    projectDir,
    workDir,
    ticket: ticketArgs,
    sessionId: args.sessionId,
    answer: args.answer,
  });

  return {
    status: result.status,
    exitCode: result.exitCode,
    branch: result.branch,
    prUrl: result.prUrl,
    message: result.failureReason,
  };
}

/**
 * Local /ship — pre-merge checks → push → PR (if missing) → merge → cleanup
 * → board patch. All in a single TypeScript flow, no shell-script-as-program.
 *
 * The orchestrator already pushed + opened the PR at the end of /develop, so
 * /ship is mostly verification + merge + post-merge cleanup. We still re-run
 * the build and tests to be safe — that's the whole point of /ship's
 * pre-merge phase.
 */
export async function executeLocalShip(args: SubcommandArgs, cwd: string): Promise<LocalDispatchResult> {
  const { projectDir, workDir } = resolveDirs(args, cwd);
  const config = loadProjectConfig(projectDir);
  const ticketId = args.ticketId;
  const credentials = { apiUrl: config.pipeline.apiUrl, apiKey: config.pipeline.apiKey };

  let branchName: string;
  try {
    branchName = execSync("git branch --show-current", {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch (err) {
    return {
      status: "failed",
      exitCode: 1,
      message: `Could not determine current branch: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!branchName || branchName === "main" || branchName === "master") {
    return {
      status: "failed",
      exitCode: 1,
      message: `Refusing to ship from "${branchName}" — must be a feature branch.`,
    };
  }

  // Pre-merge: build-check + test-rerun + conflict-check.
  const buildCmd = config.stack.buildCommand;
  if (buildCmd && buildCmd.trim() && buildCmd !== "echo 'No build step'") {
    logger.info({ buildCmd }, "Pre-merge build check");
    try {
      execSync(buildCmd, { cwd: workDir, stdio: "inherit", timeout: 600_000 });
    } catch (err) {
      return {
        status: "failed",
        exitCode: 1,
        message: `Pre-merge build failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const testCmd = config.stack.testCommand;
  if (testCmd && testCmd.trim() && testCmd !== "echo 'No tests'") {
    logger.info({ testCmd }, "Pre-merge test rerun");
    try {
      execSync(testCmd, { cwd: workDir, stdio: "inherit", timeout: 600_000 });
    } catch (err) {
      return {
        status: "failed",
        exitCode: 1,
        message: `Pre-merge tests failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Conflict-check against origin/main.
  try {
    execSync("git fetch origin main", { cwd: workDir, stdio: "pipe", timeout: 30_000 });
    const mergeBase = execSync(`git merge-base HEAD origin/main`, {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    const tree = execSync(`git merge-tree ${mergeBase} HEAD origin/main`, {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (tree.includes("<<<<<<<")) {
      return {
        status: "failed",
        exitCode: 1,
        message: `Conflict-check: branch conflicts with origin/main — resolve before /ship`,
      };
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Conflict-check skipped",
    );
  }

  // Commit any leftover staged changes.
  try {
    const status = execSync("git status --porcelain", {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (status.trim()) {
      execSync(`git add -A`, { cwd: workDir, stdio: "pipe", timeout: 30_000 });
      execSync(
        `git commit -m "chore(T-${ticketId}): final adjustments before ship"`,
        { cwd: workDir, stdio: "pipe", timeout: 30_000 },
      );
    }
  } catch {
    // Nothing to commit or commit hook rejected — caller will see in next push.
  }

  // Push.
  try {
    execSync(`git push -u origin "${branchName}"`, {
      cwd: workDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("non-fast-forward") || msg.includes("rejected")) {
      try {
        execSync(`git pull --rebase origin "${branchName}"`, { cwd: workDir, stdio: "pipe", timeout: 60_000 });
        execSync(`git push -u origin "${branchName}"`, { cwd: workDir, stdio: "pipe", timeout: 60_000 });
      } catch (rebaseErr) {
        return {
          status: "failed",
          exitCode: 1,
          message: `Push failed even after rebase: ${rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)}`,
        };
      }
    } else {
      return { status: "failed", exitCode: 1, message: `Push failed: ${msg}` };
    }
  }

  // PR — fetch existing or create.
  let prUrl: string | undefined;
  try {
    prUrl = execSync(`gh pr view --json url -q .url`, {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 15_000,
    }).trim();
  } catch {
    try {
      const rawTitle = execSync(`git log -1 --pretty=format:"%s"`, {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 5_000,
      }).trim();
      // Defensive: escape shell metacharacters in the commit title before
      // interpolating into a shell-string. Mirrors the escaping used in
      // run.ts (`gh pr create`) — JSON.stringify alone is NOT safe inside
      // double-quoted shell strings because `$` and backticks still expand.
      const safeTitle = rawTitle
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, "\\$")
        .replace(/`/g, "\\`");
      const fallbackTitle = safeTitle || `T-${ticketId}: pipeline ship`;
      prUrl = execSync(
        `gh pr create --title "${fallbackTitle}" --body "Automated PR for T-${ticketId}"`,
        { cwd: workDir, encoding: "utf-8", timeout: 30_000 },
      ).trim();
    } catch (err) {
      return {
        status: "failed",
        exitCode: 1,
        message: `Could not view or create PR: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Merge.
  try {
    execSync(`gh pr merge --squash --delete-branch`, {
      cwd: workDir,
      stdio: "inherit",
      timeout: 60_000,
    });
  } catch (err) {
    return {
      status: "failed",
      exitCode: 1,
      message: `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Worktree cleanup — go back to the main repo, drop the worktree.
  try {
    execSync(`git worktree remove "${workDir}" --force`, {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch {
    // Best-effort.
  }

  // Board patch — status=done.
  if (credentials.apiUrl && credentials.apiKey) {
    await patchTicketOnBoard(ticketId, { status: "done" }, credentials);
  }

  return {
    status: "completed",
    exitCode: 0,
    branch: branchName,
    prUrl,
    message: "Shipped",
  };
}

/**
 * Local /recover — analyse worktree state, reset board+local artefacts to
 * `ready_to_develop`, and let the user re-run /develop. Conservative by
 * default: never deletes commits the user might still need.
 */
export async function executeLocalRecover(args: SubcommandArgs, cwd: string): Promise<LocalDispatchResult> {
  const { projectDir, workDir } = resolveDirs(args, cwd);
  const config = loadProjectConfig(projectDir);
  const ticketId = args.ticketId;
  const credentials = { apiUrl: config.pipeline.apiUrl, apiKey: config.pipeline.apiKey };

  // Step 1: figure out if there's existing work.
  // Defaults to "restart" only when the worktree is missing OR we can prove
  // there is no diff against the merge base AND no working-tree changes.
  // If we cannot determine the state (merge-base errors, status errors), we
  // treat the worktree as having potentially valuable work — restart would
  // force-delete branches, which is irreversible.
  let hasWork = false;
  let mode: "resume" | "restart" = "restart";
  if (existsSync(workDir)) {
    let determined = false;
    // Try main, then origin/main — projects may not have a local `main` ref.
    let mergeBase = "";
    for (const ref of ["main", "origin/main", "master", "origin/master"]) {
      try {
        mergeBase = execSync(`git merge-base ${ref} HEAD`, {
          cwd: workDir,
          encoding: "utf-8",
          timeout: 5_000,
        }).trim();
        if (mergeBase) break;
      } catch { /* try next ref */ }
    }
    try {
      const diff = mergeBase
        ? execSync(`git diff --stat ${mergeBase}..HEAD`, {
            cwd: workDir,
            encoding: "utf-8",
            timeout: 10_000,
          }).trim()
        : "";
      const status = execSync(`git status --porcelain`, {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();
      hasWork = !!(diff || status);
      determined = true;
      mode = hasWork ? "resume" : "restart";
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), workDir },
        "Recover: could not determine worktree state — defaulting to resume to avoid data loss",
      );
    }
    // Conservative default: if we couldn't determine state OR couldn't find a
    // merge base (so we can't reliably tell whether commits exist), prefer
    // resume. Restart only fires when we have *positive* evidence the worktree
    // is empty.
    if (!determined || (!mergeBase && existsSync(workDir))) {
      mode = "resume";
    }
  }

  if (mode === "resume") {
    // Resume = just hand off to /develop in the existing worktree. The
    // pipeline detects existing work and reuses it.
    logger.info({ ticketId, workDir }, "Recover: resume mode — re-running /develop in existing worktree");
    return executeLocalDevelop(args, cwd);
  }

  // Restart — clean up worktree + branches, reset board.
  logger.info({ ticketId, workDir }, "Recover: restart mode — cleaning up");
  if (existsSync(workDir)) {
    try {
      execSync(`git worktree remove "${workDir}" --force`, {
        cwd: projectDir,
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // Best-effort: orphan dirs get nuked next.
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  // Delete any branch that matches T-<id> on common prefixes.
  // We try `-d` first (refuses to delete unmerged work) and only escalate to
  // `-D` (force) when `-d` fails — and only because we already established
  // above that the worktree had no diff against merge-base. Belt-and-suspenders
  // against the case where mergeBase detection misses some commits.
  for (const prefix of ["feature", "fix", "chore", "docs"]) {
    try {
      const branches = execSync(
        `git branch --list "${prefix}/T-${ticketId}-*" "${prefix}/T-${ticketId}"`,
        { cwd: projectDir, encoding: "utf-8", timeout: 10_000 },
      ).trim().split("\n").map(s => s.trim().replace(/^\*\s+/, "")).filter(Boolean);
      for (const branch of branches) {
        try {
          execSync(`git branch -d "${branch}"`, { cwd: projectDir, stdio: "pipe", timeout: 10_000 });
        } catch {
          // -d refused (unmerged); only force-delete since we already verified
          // the worktree is empty (mode === "restart" path).
          try {
            execSync(`git branch -D "${branch}"`, { cwd: projectDir, stdio: "pipe", timeout: 10_000 });
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  // Clear active-ticket marker.
  const activeTicketPath = join(projectDir, ".claude", ".active-ticket");
  if (existsSync(activeTicketPath)) {
    try { rmSync(activeTicketPath); } catch { /* ignore */ }
  }

  // Reset on board.
  if (credentials.apiUrl && credentials.apiKey) {
    await patchTicketOnBoard(
      ticketId,
      { status: "ready_to_develop", pipeline_status: null },
      credentials,
    );
  }

  return {
    status: "completed",
    exitCode: 0,
    message: `T-${ticketId} restarted. Run /develop T-${ticketId} to begin again.`,
  };
}

/**
 * Top-level dispatcher used by the CLI entry in `pipeline/run.ts`. Returns the
 * exit code so the caller can `process.exit()`.
 */
export async function dispatchSubcommand(args: SubcommandArgs, cwd: string): Promise<LocalDispatchResult> {
  // We support both `--mode=local` and `--mode=vps` here for symmetry, but
  // only `local` is actually wired — VPS goes through `pipeline/server.ts`,
  // not through this dispatcher.
  if (args.mode === "vps") {
    return {
      status: "failed",
      exitCode: 1,
      message: "VPS mode dispatched via `bun run pipeline/run.ts <subcommand>` is not supported — VPS uses pipeline/server.ts directly.",
    };
  }

  // Mark the active ticket so PreToolUse hooks can detect us.
  try {
    const { workDir } = resolveDirs(args, cwd);
    if (existsSync(workDir)) {
      const claudeDir = join(workDir, ".claude");
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, ".active-ticket"), args.ticketId);
    }
  } catch { /* best-effort */ }

  switch (args.subcommand) {
    case "develop": return executeLocalDevelop(args, cwd);
    case "resume":  return executeLocalResume(args, cwd);
    case "ship":    return executeLocalShip(args, cwd);
    case "recover": return executeLocalRecover(args, cwd);
    default: {
      // Exhaustive check.
      const _exhaustive: never = args.subcommand;
      return {
        status: "failed",
        exitCode: 1,
        message: `Unknown subcommand: ${String(_exhaustive)}`,
      };
    }
  }
}
