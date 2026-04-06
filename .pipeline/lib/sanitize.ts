/**
 * Validates that a branch name contains only safe characters for shell usage.
 *
 * Branch names derived from ticket titles are interpolated into execSync / _git()
 * calls. Without validation, a crafted title like `foo; rm -rf /` would execute
 * arbitrary commands. This function rejects anything outside the safe character set.
 *
 * Allowed: alphanumeric, `/`, `_`, `.`, `-`
 */
export function sanitizeBranchName(name: string): string {
  if (!/^[a-zA-Z0-9\/_.\-]+$/.test(name)) {
    throw new Error(`Invalid branch name contains unsafe characters: ${name}`);
  }
  return name;
}
