/**
 * Validates that a branch name contains only safe characters for shell usage.
 *
 * Branch names derived from ticket titles are interpolated into execSync / _git()
 * calls. Without validation, a crafted title like `foo; rm -rf /` would execute
 * arbitrary commands. This function rejects anything outside the safe character set.
 *
 * Allowed: alphanumeric, `/`, `_`, `.`, `-`
 * Must start and end with an alphanumeric character (single-char names also valid).
 * Explicitly rejects: empty strings, `..` (git traversal), shell metacharacters.
 */
export function sanitizeBranchName(branchName: string): string {
  if (!branchName) {
    throw new Error("Branch name must not be empty");
  }

  // Reject git traversal sequence
  if (branchName.includes("..")) {
    throw new Error(
      `Invalid branch name contains git traversal sequence "..": ${branchName}`
    );
  }

  // Reject shell metacharacters and unsafe characters
  const shellMetachars = /[;$`()|&><!\~{}\[\]*?'"\\\ \t\n]/;
  if (shellMetachars.test(branchName)) {
    throw new Error(
      `Invalid branch name contains shell metacharacters: ${branchName}`
    );
  }

  // Strict allowlist: letters, digits, dots, underscores, slashes, hyphens.
  // Single-char names must be alphanumeric.
  // Multi-char names must start and end with alphanumeric.
  const singleChar = /^[a-zA-Z0-9]$/;
  const multiChar = /^[a-zA-Z0-9][a-zA-Z0-9._/\-]*[a-zA-Z0-9]$/;

  if (!singleChar.test(branchName) && !multiChar.test(branchName)) {
    throw new Error(
      `Invalid branch name "${branchName}": must start and end with alphanumeric and contain only letters, digits, dots, underscores, slashes, or hyphens`
    );
  }

  return branchName;
}
