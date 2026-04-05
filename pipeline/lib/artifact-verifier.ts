export interface VerificationResult {
  level: 1 | 2 | 3;
  passed: boolean;
  files?: string[];
  issues?: Array<{ file: string; pattern: string; line?: number }>;
  orphans?: Array<{ file: string; name: string }>;
  message: string;
}

const STUB_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\bTODO\b/i, label: "TODO" },
  { regex: /\bFIXME\b/i, label: "FIXME" },
  { regex: /\bplaceholder\b/i, label: "placeholder" },
  { regex: /\bhardcoded\b/i, label: "hardcoded" },
  { regex: /will be wired later/i, label: "will be wired later" },
  { regex: /not implemented/i, label: "not implemented" },
  { regex: /return\s+null\s*;\s*\/\//, label: "return null; //" },
  { regex: /throw\s+new\s+Error\(\s*["']not implemented["']\s*\)/i, label: 'throw new Error("not implemented")' },
];

/**
 * Level 1 — Exists: Were any files changed?
 * Parses `git diff --name-status` output and checks for at least one changed file.
 */
export function checkLevel1Exists(gitDiffOutput: string): VerificationResult {
  const lines = gitDiffOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const files: string[] = [];

  for (const line of lines) {
    // git diff --name-status format: <status>\t<path> (or <status>\t<old>\t<new> for renames/copies)
    // Status codes: M, A, D, R###, C### — strip the status prefix
    const match = line.match(/^[MADRC]\d*\s+(.+)/);
    if (match) {
      // For renames/copies, take the destination (last path)
      const paths = match[1].split("\t");
      files.push(paths[paths.length - 1]);
    }
  }

  if (files.length === 0) {
    return {
      level: 1,
      passed: false,
      files: [],
      message: "No files changed — agent produced no output",
    };
  }

  return {
    level: 1,
    passed: true,
    files,
    message: `${files.length} file(s) changed`,
  };
}

/**
 * Level 2 — Substantive: No stubs, TODOs, or placeholder code.
 * Scans file contents for known stub patterns. Skips test files.
 */
export function checkLevel2Substantive(
  files: Map<string, string>,
): VerificationResult {
  const issues: Array<{ file: string; pattern: string; line?: number }> = [];

  for (const [filePath, content] of files) {
    // Skip test files
    if (/\.(test|spec)\./.test(filePath)) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { regex, label } of STUB_PATTERNS) {
        if (regex.test(lines[i])) {
          issues.push({ file: filePath, pattern: label, line: i + 1 });
        }
      }
    }
  }

  if (issues.length > 0) {
    const summary = issues
      .map((i) => `  ${i.file}:${i.line} — ${i.pattern}`)
      .join("\n");
    return {
      level: 2,
      passed: false,
      issues,
      message: `${issues.length} stub(s) found:\n${summary}`,
    };
  }

  return {
    level: 2,
    passed: true,
    issues: [],
    message: "No stubs or placeholders detected",
  };
}

/**
 * Level 3 — Wired: New exports are imported somewhere.
 * Checks that each new export name appears in at least one other file.
 */
export function checkLevel3Wired(
  newExports: Array<{ file: string; name: string }>,
  allFiles: Map<string, string>,
): VerificationResult {
  if (newExports.length === 0) {
    return {
      level: 3,
      passed: true,
      orphans: [],
      message: "No new exports to verify",
    };
  }

  const orphans: Array<{ file: string; name: string }> = [];

  for (const exp of newExports) {
    let found = false;

    for (const [filePath, content] of allFiles) {
      // Don't count the file that defines the export
      if (filePath === exp.file) continue;

      if (content.includes(exp.name)) {
        found = true;
        break;
      }
    }

    if (!found) {
      orphans.push(exp);
    }
  }

  if (orphans.length > 0) {
    const summary = orphans
      .map((o) => `  ${o.name} (from ${o.file})`)
      .join("\n");
    return {
      level: 3,
      passed: false,
      orphans,
      message: `${orphans.length} orphaned export(s):\n${summary}`,
    };
  }

  return {
    level: 3,
    passed: true,
    orphans: [],
    message: "All new exports are imported",
  };
}
