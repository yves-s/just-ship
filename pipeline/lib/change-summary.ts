import { execSync } from "node:child_process";

export interface ChangeSummaryOptions {
  workDir: string;
  baseBranch?: string;  // defaults to "main"
  prUrl?: string;
}

export function generateChangeSummary(opts: ChangeSummaryOptions): string {
  const { workDir, baseBranch = "main", prUrl } = opts;

  // Get the merge base to compare against
  let mergeBase: string;
  try {
    mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, { cwd: workDir, encoding: "utf-8" }).trim();
  } catch {
    // If merge-base fails (e.g. no common ancestor), fall back to comparing against baseBranch directly
    mergeBase = baseBranch;
  }

  // Get changed files with status (A=added, M=modified, D=deleted, R=renamed)
  let diffStat: string;
  try {
    diffStat = execSync(`git diff --stat ${mergeBase}..HEAD`, { cwd: workDir, encoding: "utf-8" }).trim();
  } catch {
    diffStat = "";
  }

  let nameStatus: string;
  try {
    nameStatus = execSync(`git diff --name-status ${mergeBase}..HEAD`, { cwd: workDir, encoding: "utf-8" }).trim();
  } catch {
    nameStatus = "";
  }

  // Get commit messages on this branch
  let commitLog: string;
  try {
    commitLog = execSync(`git log --oneline ${mergeBase}..HEAD`, { cwd: workDir, encoding: "utf-8" }).trim();
  } catch {
    commitLog = "";
  }

  if (!nameStatus && !commitLog) {
    return "No changes detected on this branch.";
  }

  // Parse file changes
  const files: Array<{ status: string; path: string }> = [];
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const match = line.match(/^([AMDRC]\d*)\t(.+?)(?:\t(.+))?$/);
    if (match) {
      const statusChar = match[1][0];
      const statusLabel = statusChar === "A" ? "added"
        : statusChar === "M" ? "modified"
        : statusChar === "D" ? "deleted"
        : statusChar === "R" ? "renamed"
        : statusChar === "C" ? "copied"
        : "changed";
      const filePath = match[3] ?? match[2]; // For renames, use the new name
      files.push({ status: statusLabel, path: filePath });
    }
  }

  // Group files by status
  const added = files.filter(f => f.status === "added");
  const modified = files.filter(f => f.status === "modified");
  const deleted = files.filter(f => f.status === "deleted");
  const renamed = files.filter(f => f.status === "renamed");

  // Build markdown summary
  const parts: string[] = [];
  parts.push("## Changes Summary\n");

  // File changes section
  if (files.length > 0) {
    parts.push(`**${files.length} file(s) changed**\n`);

    if (added.length > 0) {
      parts.push(`**Added (${added.length}):**`);
      for (const f of added) parts.push(`- \`${f.path}\``);
      parts.push("");
    }
    if (modified.length > 0) {
      parts.push(`**Modified (${modified.length}):**`);
      for (const f of modified) parts.push(`- \`${f.path}\``);
      parts.push("");
    }
    if (deleted.length > 0) {
      parts.push(`**Deleted (${deleted.length}):**`);
      for (const f of deleted) parts.push(`- \`${f.path}\``);
      parts.push("");
    }
    if (renamed.length > 0) {
      parts.push(`**Renamed (${renamed.length}):**`);
      for (const f of renamed) parts.push(`- \`${f.path}\``);
      parts.push("");
    }
  }

  // Commits section
  if (commitLog) {
    const commits = commitLog.split("\n").filter(Boolean);
    parts.push(`**Commits (${commits.length}):**`);
    for (const c of commits) parts.push(`- ${c}`);
    parts.push("");
  }

  // Diff stat (compact summary)
  if (diffStat) {
    const lastLine = diffStat.split("\n").pop()?.trim();
    if (lastLine) {
      parts.push(`**Diff:** ${lastLine}`);
      parts.push("");
    }
  }

  // PR link
  if (prUrl) {
    parts.push(`**Pull Request:** ${prUrl}`);
  }

  return parts.join("\n");
}
