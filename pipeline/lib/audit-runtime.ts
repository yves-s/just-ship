import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { logger } from "./logger.ts";
import { Sentry } from "./sentry.ts";
import { loadSkillByName } from "./load-skills.ts";
import type {
  ExpertSkill,
  AuditReport,
  AuditFinding,
  ToolResult,
} from "./sidekick-reasoning-tools.ts";

// The set of valid expert skills. Kept in lockstep with EXPERT_SKILLS in
// `sidekick-reasoning-tools.ts` but duplicated here to break the circular
// value-level dependency: `sidekick-reasoning-tools.ts` imports the tool
// handler from this file, so importing the enum back at value time triggers
// a module-init race under ESM (the consumer module sees `undefined` because
// the exporting module hasn't finished initializing yet). Types are
// compile-time only and don't cause the race.
const EXPERT_SKILL_VALUES = [
  "design-lead",
  "product-cto",
  "backend",
  "frontend-design",
  "creative-design",
  "data-engineer",
  "ux-planning",
  "ticket-writer",
] as const satisfies readonly ExpertSkill[];

// Compile-time lockstep guard: forces `EXPERT_SKILL_VALUES` to cover every
// member of `ExpertSkill`. `satisfies readonly ExpertSkill[]` above only
// checks the subset direction (every listed value is a valid ExpertSkill);
// it does NOT catch the case where `sidekick-reasoning-tools.ts` adds a new
// expert and this file forgets to mirror it. The check below forces the
// superset direction at compile time: if an `ExpertSkill` member is missing
// from the tuple, `Exclude<ExpertSkill, (typeof EXPERT_SKILL_VALUES)[number]>`
// evaluates to a non-`never` type and the assignment errors out.
//
// If you add a skill to `EXPERT_SKILLS` in `sidekick-reasoning-tools.ts`,
// typecheck will fail here until you add it to `EXPERT_SKILL_VALUES` too.
type _ExpertSkillLockstep = [Exclude<ExpertSkill, (typeof EXPERT_SKILL_VALUES)[number]>] extends [never]
  ? true
  : "EXPERT_SKILL_VALUES is missing ExpertSkill members — keep in lockstep with sidekick-reasoning-tools.ts";
const _expertSkillLockstepCheck: _ExpertSkillLockstep = true;
void _expertSkillLockstepCheck;

/**
 * Audit agent runtime — T-985 (child of Epic T-978).
 *
 * Spawns a read-only specialist agent (via the Claude Agent SDK) that analyzes
 * a user-supplied `scope` through the lens of an `expert_skill`, then returns
 * a structured `AuditReport` matching the contract in plan section 3.2.
 *
 * Read-only by construction:
 *   - `allowedTools` names only the four read-oriented tools (Read, Grep, Glob, Bash).
 *   - `canUseTool` inspects every `Bash` invocation and denies anything that is
 *     not on a conservative read-only allow-list.
 *   - No Write/Edit/NotebookEdit, no Agent (no sub-sub-agents), no board calls.
 *   - The agent cannot create tickets — the Sidekick is the only caller with
 *     access to the board API; this module never forwards findings anywhere.
 *
 * Time-boxed:
 *   - Target 30s–2min; hard cap 5min via AbortController.
 *   - On abort the runtime returns a `timeout` failure so the tool caller
 *     (sidekick-reasoning-tools) sees a clean error.
 *
 * Sentry instrumentation:
 *   - `sidekick.audit.started`  — breadcrumb at invocation
 *   - `sidekick.audit.completed` — message with duration, finding count, severity breakdown
 *   - `sidekick.audit.failed`   — exception + message on any error path
 *
 * Plan: docs/superpowers/plans/2026-04-23-sidekick-reasoning-architecture.md §3.2
 * Rule: .claude/rules/expert-audit-scope.md
 */

// ---------------------------------------------------------------------------
// Time budget
// ---------------------------------------------------------------------------

/** Hard cap — past this the runtime aborts the SDK call and returns a timeout failure. */
export const AUDIT_HARD_CAP_MS = 5 * 60 * 1000;
/** Target ceiling — soft guidance communicated to the model via the prompt. */
export const AUDIT_TARGET_MS = 2 * 60 * 1000;
/** Target floor — same, communicated in the prompt. */
export const AUDIT_TARGET_FLOOR_MS = 30 * 1000;

// ---------------------------------------------------------------------------
// Read-only Bash allow-list
//
// The SDK's `allowedTools` cannot express "Bash but only read-only". We add a
// `canUseTool` callback that approves the four read-oriented tools unchanged
// and inspects every Bash `command` against a conservative allow-list. Any
// token that writes, deletes, modifies state, or executes arbitrary binaries
// is rejected — including obvious escape hatches like `> file`, `rm`, `curl`,
// shell metacharacters that could chain to a destructive command, etc.
//
// The allow-list is intentionally narrow. An auditor rarely needs to run
// anything more than `git log`, `git diff`, `ls`, `cat`, `wc`, `find` (with
// read-only flags). If a legitimate read command is rejected, the agent can
// fall back to Read/Grep/Glob — those always work.
// ---------------------------------------------------------------------------

/**
 * Commands the audit agent may invoke via Bash. Matched against the first
 * token of the user-supplied `command` (after leading whitespace and
 * environment-variable assignments are stripped).
 */
const READ_ONLY_BASH_BINARIES = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "file",
  "stat",
  "pwd",
  "echo",
  "printf",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "tree",
  "find",       // read-only modes only (see FIND_WRITE_FLAGS below)
  "git",        // read-only sub-commands only (see GIT_READ_SUBCOMMANDS below)
  "jq",
  "grep",
  "rg",
  "sort",
  "uniq",
  "cut",
  "awk",
  "sed",        // sed with no `-i` is read-only (see SED_WRITE_FLAGS below)
  "column",
  "diff",
  "tr",
  "date",
  "which",
  "true",
  "false",
  "test",       // read-only by nature
  "[",
]);

/** Sub-commands of `git` that never mutate state. */
const GIT_READ_SUBCOMMANDS = new Set([
  "log",
  "diff",
  "show",
  "status",
  "blame",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "cat-file",
  "config",     // read-only when no `--set`/`--unset`/`--add` flags; we check below
  "branch",     // `--list`/`--show-current` read-only; writes blocked below
  "tag",        // same
  "remote",     // same
  "describe",
  "for-each-ref",
  "name-rev",
  "merge-base",
  "shortlog",
  "grep",
  "worktree",   // `list` only; writes blocked below
  "stash",      // `list`/`show` only; writes blocked below
  "reflog",     // read-only in its common forms
]);

/** Tokens that indicate a write operation regardless of binary. */
const UNIVERSAL_WRITE_FLAGS = new Set([
  ">",
  ">>",
  "<<",
  "|tee",
  "tee",
]);

/**
 * `find` flags that can execute commands, delete files, or write to arbitrary
 * paths. Covers GNU find's `-fprint*` / `-fls` family, which write
 * filesystem listings to a named file — a classic exfiltration / overwrite
 * primitive that is easy to miss because it looks like a read-only option.
 */
const FIND_WRITE_FLAGS = new Set([
  "-exec",
  "-execdir",
  "-delete",
  "-ok",
  "-okdir",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
]);

/**
 * `sed` flags that write output or execute commands. `--in-place`/`-i` edit
 * files on disk. `-e`/`--expression` may carry a script that uses sed's `e`
 * command (execute-via-shell) or `w`/`W` commands (write to file) — we block
 * any `e` / `w` script usage unconditionally via the segment-level script
 * inspection below.
 */
const SED_WRITE_FLAGS = new Set(["-i", "--in-place"]);

/** `git branch`/`tag`/`remote`/`worktree`/`stash`/`config` sub-flags that write. */
const GIT_SUBCOMMAND_WRITE_FLAGS: Record<string, Set<string>> = {
  branch: new Set(["-d", "-D", "-m", "-M", "--delete", "--move", "--rename"]),
  tag: new Set(["-d", "--delete"]),
  remote: new Set(["add", "remove", "rename", "set-url", "set-head", "prune", "update"]),
  worktree: new Set(["add", "remove", "move", "prune", "lock", "unlock", "repair"]),
  stash: new Set(["push", "save", "pop", "apply", "drop", "clear", "create", "store"]),
  config: new Set(["--add", "--unset", "--unset-all", "--replace-all", "--rename-section", "--remove-section"]),
};

/**
 * Classify a Bash command as read-only-safe or not. Returns `{ allowed }` on
 * success, `{ allowed: false, reason }` on rejection. Exported for tests.
 *
 * The logic is conservative — when in doubt, reject. The agent can always
 * fall back to Read/Grep/Glob for file inspection. False positives are
 * better than false negatives here.
 */
export function classifyBashCommand(raw: string): { allowed: true } | { allowed: false; reason: string } {
  if (typeof raw !== "string") {
    return { allowed: false, reason: "Bash command must be a string" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { allowed: false, reason: "empty Bash command" };
  }

  // Reject newlines and carriage returns outright. They act as command
  // separators in bash and would let a caller smuggle a second command past
  // the segment splitter (`ls\nrm foo` tokenizes to `["ls","rm","foo"]` after
  // a naive whitespace split, so the `ls` binary check would pass and `rm`
  // would still execute).
  if (/[\r\n]/.test(trimmed)) {
    return { allowed: false, reason: "Bash: newlines are not allowed in the command" };
  }

  // NUL bytes and other C0 control characters are likewise rejected — they
  // cause surprising tokenizer behavior and have no legitimate use in an
  // auditor workflow.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) {
    return { allowed: false, reason: "Bash: control characters are not allowed in the command" };
  }

  // Reject any metacharacters that open the door to chained writes.
  // `|` is allowed (read pipelines), `&&`/`||` also allowed (short-circuits).
  //
  // Backticks ALWAYS execute arbitrary commands — reject outright. $(…)
  // likewise. <(…) and >(…) are process substitution (can write).
  if (trimmed.includes("`")) {
    return { allowed: false, reason: "Bash: backtick command substitution is not allowed" };
  }
  if (/\$\(/.test(trimmed)) {
    return { allowed: false, reason: "Bash: `$(…)` command substitution is not allowed" };
  }
  if (/<\(/.test(trimmed) || />\(/.test(trimmed)) {
    return { allowed: false, reason: "Bash: process substitution is not allowed" };
  }

  // Reject output redirection (`>`, `>>`) and `tee` — these write to the filesystem.
  // We allow heredocs (`<<`) only in read-only contexts, but it's simpler to
  // reject them too since the binary being fed stdin is what matters and
  // auditors don't need stdin.
  if (/(?:^|\s)>>?(?:\s|$)/.test(trimmed) || /(?:^|\s)<</.test(trimmed)) {
    return { allowed: false, reason: "Bash: redirection is not allowed" };
  }

  // Reject `&` (background job separator) unless it's part of `&&`. A single
  // `&` between two commands runs both: `ls & rm foo` would pass the binary
  // check (`ls`) while still executing `rm`. Detect a bare `&` that is NOT
  // preceded or followed by another `&`.
  if (/(?:^|[^&])&(?:[^&]|$)/.test(trimmed)) {
    return { allowed: false, reason: "Bash: background '&' is not allowed" };
  }

  // Split on ; && || | to handle chained commands. Each segment must pass.
  const segments = trimmed.split(/(?:\s*(?:;|&&|\|\||\|)\s*)/).filter(Boolean);

  for (const segment of segments) {
    const check = classifyBashSegment(segment);
    if (!check.allowed) return check;
  }

  return { allowed: true };
}

function classifyBashSegment(segment: string): { allowed: true } | { allowed: false; reason: string } {
  // Tokenize on whitespace — rough, but the allow-list is narrow so we don't
  // need full shell parsing. The first non-assignment token is the binary.
  const tokens = segment.trim().split(/\s+/);
  if (tokens.length === 0) {
    return { allowed: false, reason: "empty segment" };
  }

  // Skip leading env var assignments (e.g. `FOO=bar grep …`).
  let i = 0;
  while (i < tokens.length && /^[A-Z_][A-Z0-9_]*=/i.test(tokens[i]!)) {
    i++;
  }
  if (i >= tokens.length) {
    return { allowed: false, reason: "segment has no binary" };
  }

  const binary = tokens[i]!;
  const args = tokens.slice(i + 1);

  if (UNIVERSAL_WRITE_FLAGS.has(binary)) {
    return { allowed: false, reason: `Bash: '${binary}' is a write operation` };
  }

  // Also reject binaries via absolute path. Auditors don't need arbitrary binaries.
  if (binary.startsWith("/") || binary.startsWith("./")) {
    return { allowed: false, reason: `Bash: invoking '${binary}' by path is not allowed` };
  }

  if (!READ_ONLY_BASH_BINARIES.has(binary)) {
    return { allowed: false, reason: `Bash: '${binary}' is not on the read-only allow-list` };
  }

  if (binary === "find") {
    for (const a of args) {
      if (FIND_WRITE_FLAGS.has(a)) {
        return { allowed: false, reason: `Bash: find '${a}' can execute, delete, or write` };
      }
    }
  }

  if (binary === "sed") {
    // Any `-i`/`--in-place` variant (GNU's `-iSUFFIX` attached form and
    // BSD's `--in-place=BACKUP` included).
    for (const a of args) {
      if (SED_WRITE_FLAGS.has(a) || a.startsWith("-i") || a.startsWith("--in-place")) {
        return { allowed: false, reason: "Bash: sed -i / --in-place writes in place" };
      }
    }
    // sed scripts can carry the `e` command (execute via shell — GNU
    // extension), `w`/`W` (write pattern space to a file), or the `s///e`
    // flag (execute replacement via shell — GNU extension). `-f SCRIPT`
    // points at an external script file we can't vet.
    //
    // Conservative heuristic: strip the leading `sed` token from the raw
    // segment, then scan the remainder for any of the dangerous forms.
    // Using the raw (un-tokenized) text avoids a correctness bug the naive
    // whitespace tokenizer introduces around quoted script arguments:
    // `sed 'e rm foo' file` tokenizes to `["'e", "rm", "foo'", "file"]`,
    // which loses the script boundary. Scanning the raw segment catches the
    // dangerous patterns regardless of quoting.
    //
    // Heuristic rules (all applied to script content only — not to sed's
    // own flag forms like `-e`, which is a flag, not a script `e` command):
    //   - `s/.../.../[flags][ewW]` — substitution flag containing e/w/W.
    //   - A bare `e`, `w`, or `W` command — optionally prefixed by an
    //     address (`1e`, `$e`, `/regex/e`) — that sits standalone.
    //   - Any `-f`/`--file` pointing at an external script file.
    for (let j = 0; j < args.length; j++) {
      const a = args[j]!;
      if (a === "-f" || a === "--file") {
        return { allowed: false, reason: "Bash: sed -f (external script file) is not allowed" };
      }
    }
    // Strip the leading `sed` token and the `-e`/`--expression` flag tokens
    // themselves (not their payload) from the segment, then strip every
    // unescaped single/double quote character. That last step is the one
    // that matters: the naive whitespace tokenizer breaks quoted scripts
    // across spaces (`sed 'e rm foo' file` → tokens `["'e","rm","foo'",…]`),
    // so we intentionally work on the raw segment text and just remove the
    // quote characters before pattern-matching. False positives from this
    // are fine — auditors can always fall back to `Read`/`Grep`/`Glob`.
    const unquoted = segment
      .replace(/^\s*sed\b\s*/, "")
      .replace(/(^|\s)(-e|--expression)(?=\s)/g, " ")
      // Remove all unescaped single/double quote characters.
      .replace(/(?<!\\)['"]/g, "");
    const dangerousSed =
      // `s/…/…/…[ewW]` flag — the replacement flag block contains e/w/W.
      /s[^a-zA-Z0-9\s\\]\S*?[^\\][^a-zA-Z0-9\s\\]\S*?[^\\][^a-zA-Z0-9\s\\][a-zA-Z]*[ewW]/.source;
    // A bare `e`, `w`, or `W` command, optionally address-prefixed, at
    // script start / after a `;` / after whitespace that follows an
    // address. We accept both `^` and whitespace/`;` as starts.
    const bareEwW = /(?:^|[;\s])(?:\d+|\$|\/(?:[^/\\]|\\.)*\/)?\s*[ewW](?:\s|$)/.source;
    const sedDangerRe = new RegExp(`${dangerousSed}|${bareEwW}`);
    if (sedDangerRe.test(unquoted)) {
      return { allowed: false, reason: "Bash: sed script uses `e`/`w`/`W` (execute-shell or write-to-file)" };
    }
  }

  if (binary === "awk") {
    // awk scripts can call `system()`, pipe to a command (`print | "cmd"`),
    // read from a command (`"cmd" | getline`), or redirect (`print > file`).
    // GNU awk's `-i inplace` rewrites files. `-f SCRIPT_FILE` points at a
    // script we can't vet. Reject all of these.
    for (let j = 0; j < args.length; j++) {
      const a = args[j]!;
      if (a === "-i" || a === "--include") {
        const next = args[j + 1];
        if (next === "inplace") {
          return { allowed: false, reason: "Bash: awk -i inplace rewrites files" };
        }
      }
      if (a === "-f" || a === "--file") {
        return { allowed: false, reason: "Bash: awk -f (external script file) is not allowed" };
      }
    }
    // Scan the raw segment (minus the leading `awk` token) for dangerous
    // script constructs. Strip unescaped quotes so the naive whitespace
    // tokenizer boundary doesn't hide script patterns — `awk 'BEGIN{system("x")}'`
    // without the unquote step looks like `BEGIN{system(` in one token and
    // `"x")}` in another; scanning the raw text is simpler and correct.
    const awkHaystack = segment
      .replace(/^\s*awk\b\s*/, "")
      .replace(/(?<!\\)['"`]/g, "");
    if (/\bsystem\s*\(/.test(awkHaystack)) {
      return { allowed: false, reason: "Bash: awk system() executes shell commands" };
    }
    // `print|getline …` / `"cmd"|getline` — command-pipe into getline runs
    // the left side as a shell command. After quote-stripping we detect any
    // `|` followed by `getline`.
    if (/\|\s*getline\b/.test(awkHaystack)) {
      return { allowed: false, reason: "Bash: awk getline-from-command executes shell" };
    }
    // `print x | "cmd"` / `printf ... | "cmd"` — pipe to a command string.
    if (/\|\s*\S/.test(awkHaystack) && /\b(?:print(?:f)?)\b[^|]*\|/.test(awkHaystack)) {
      return { allowed: false, reason: "Bash: awk pipe-to-command executes shell" };
    }
    // `print > file` / `print >> file` — redirect into a file.
    if (/\b(?:print(?:f)?)\b[^>]*>>?\s*\S/.test(awkHaystack)) {
      return { allowed: false, reason: "Bash: awk redirect-to-file writes state" };
    }
  }

  if (binary === "git") {
    const sub = args[0];
    if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) {
      return { allowed: false, reason: `Bash: git '${sub ?? ""}' is not a read-only sub-command` };
    }
    const subWriteFlags = GIT_SUBCOMMAND_WRITE_FLAGS[sub];
    if (subWriteFlags) {
      for (const a of args.slice(1)) {
        if (subWriteFlags.has(a)) {
          return { allowed: false, reason: `Bash: git ${sub} ${a} writes state` };
        }
      }
    }
    // `git diff --output=FILE` / `-o FILE` writes the patch to a file.
    if (sub === "diff" || sub === "show" || sub === "log" || sub === "shortlog") {
      for (let j = 1; j < args.length; j++) {
        const a = args[j]!;
        if (a === "-o" || a === "--output" || a.startsWith("--output=")) {
          return { allowed: false, reason: `Bash: git ${sub} --output writes to a file` };
        }
      }
    }
    // `git grep -O<cmd>` / `--open-files-in-pager=<cmd>` executes an
    // arbitrary binary as the "pager". Block both attached and separate
    // forms.
    if (sub === "grep") {
      for (let j = 1; j < args.length; j++) {
        const a = args[j]!;
        if (
          a === "-O" ||
          a.startsWith("-O") ||
          a === "--open-files-in-pager" ||
          a.startsWith("--open-files-in-pager")
        ) {
          return { allowed: false, reason: "Bash: git grep -O / --open-files-in-pager runs an external command" };
        }
      }
    }
    // `-c core.pager=<cmd>` / `-c <key>=<cmd>` and `--exec-path=<path>` can
    // redirect git's behavior to an external binary. Block top-level `-c`
    // overrides and `--exec-path` in all sub-commands.
    for (const a of args.slice(1)) {
      if (a === "-c" || a.startsWith("--exec-path")) {
        return { allowed: false, reason: `Bash: git '${a}' can override config and execute external binaries` };
      }
    }
    // `--upload-pack` on git fetch/ls-remote runs an arbitrary binary;
    // fetch/ls-remote aren't in the read allow-list anyway. Leave as-is.
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Tool whitelist for the SDK
// ---------------------------------------------------------------------------

/** The only tools an audit agent may call. Bash is narrowed further by canUseTool. */
export const AUDIT_ALLOWED_TOOLS: readonly string[] = ["Read", "Grep", "Glob", "Bash"];

/**
 * Build the `canUseTool` callback enforcing the read-only contract. Approves
 * Read/Grep/Glob unconditionally and runs `classifyBashCommand` on every Bash
 * invocation. Anything not on the allow-list or any attempt to use a tool
 * outside AUDIT_ALLOWED_TOOLS is denied with a clear message.
 *
 * Exported so tests can invoke it directly without spinning up the SDK.
 */
export function buildAuditCanUseTool(): CanUseTool {
  return async (toolName, input): Promise<PermissionResult> => {
    if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") {
      return { behavior: "allow", updatedInput: input };
    }
    if (toolName === "Bash") {
      const command = (input as Record<string, unknown>).command;
      const check = classifyBashCommand(typeof command === "string" ? command : "");
      if (check.allowed) {
        return { behavior: "allow", updatedInput: input };
      }
      return { behavior: "deny", message: check.reason };
    }
    return { behavior: "deny", message: `audit agent may not use '${toolName}'` };
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the prompt sent to the audit agent. The prompt embeds:
 *   - the expert skill content (the "how to think" layer)
 *   - the audit scope
 *   - the output contract (AuditReport JSON shape)
 *   - the read-only constraint reminder
 *
 * Pure function, exported for testability.
 */
export function buildAuditPrompt(params: {
  scope: string;
  expertSkill: ExpertSkill;
  expertSkillContent: string | null;
  projectId: string;
}): string {
  const skillBlock = params.expertSkillContent
    ? `## Expert skill: ${params.expertSkill}\n\n${params.expertSkillContent}`
    : `## Expert skill: ${params.expertSkill}\n\n(Skill file not found — apply general senior-${params.expertSkill} judgment.)`;

  return `You are a senior ${params.expertSkill} performing a read-only audit on behalf of the Sidekick.

${skillBlock}

## Audit scope

${params.scope}

## Constraints

- READ-ONLY. You may call Read, Grep, Glob, and Bash with read-only commands only.
- You MAY NOT edit files, create tickets, or call any board/network API.
- Target runtime: 30s–2min. Hard cap: 5min.
- If you believe something must be fixed immediately, report it as a "critical" finding with a clear "suggested_fix" — the Sidekick (not you) decides whether to act.
- Project ID: ${params.projectId} (for context only; do not attempt to query the board).

## Output contract

Your final message must be a JSON object, exactly matching this TypeScript shape:

{
  "scope": string,          // restate the audit scope in user-readable form
  "expert": "${params.expertSkill}",
  "findings": [
    {
      "title": string,                    // short, scannable
      "description": string,              // one or two sentences
      "severity": "low" | "medium" | "high" | "critical",
      "evidence": {                       // optional
        "files": [string],                // paths touched
        "lines": string,                  // e.g. "42-51"
        "quote": string                   // relevant excerpt
      },
      "suggested_fix": string             // optional, non-binding hint
    }
  ],
  "summary": string                       // one-paragraph executive summary
}

Emit ONLY the JSON object — no prose, no markdown fences, no commentary before or after.
If you find no issues, return an empty \`findings\` array and explain in \`summary\`.
Findings must be specific, evidence-backed, and actionable. If you cite a file, include the path.

Begin the audit now.`;
}

// ---------------------------------------------------------------------------
// Response parsing + validation
// ---------------------------------------------------------------------------

const FindingSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  evidence: z
    .object({
      files: z.array(z.string()).optional(),
      lines: z.string().optional(),
      quote: z.string().optional(),
    })
    .optional(),
  suggested_fix: z.string().optional(),
});

const AuditReportSchema = z.object({
  scope: z.string().min(1),
  expert: z.enum(EXPERT_SKILL_VALUES),
  findings: z.array(FindingSchema),
  summary: z.string().min(1),
});

/**
 * Parse the model's final message into a validated AuditReport. Tolerates
 * code-fence wrapping and stray prose around the JSON object. Throws on
 * unrecoverable parse/validation errors.
 *
 * Pure function, exported for testability.
 */
export function parseAuditReport(raw: string): AuditReport {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("audit response did not contain a JSON object");
  }
  const slice = trimmed.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch (err) {
    throw new Error(`audit response was not valid JSON: ${(err as Error).message}`);
  }

  const result = AuditReportSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    throw new Error(`audit response failed validation at ${path}: ${issue.message}`);
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface RunAuditOptions {
  /** Free-form description of what to audit. */
  scope: string;
  /** Which expert skill to load. */
  expertSkill: ExpertSkill;
  /** Project uuid — passed to the prompt only, not used for board lookups. */
  projectId: string;
  /** Working directory the skill loader and SDK operate in. Defaults to process.cwd(). */
  projectDir?: string;
  /** Override the hard time cap (ms). Defaults to AUDIT_HARD_CAP_MS. */
  timeoutMs?: number;
  /**
   * Injected for tests — when present, the runtime skips the SDK call and uses
   * this function to produce the raw model output. Signature mirrors the
   * minimal slice of the SDK we rely on.
   */
  queryFn?: (prompt: string, signal: AbortSignal) => Promise<string>;
}

export interface AuditRuntimeSuccess {
  ok: true;
  result: AuditReport;
  /** Wall time from invocation to report in ms. */
  durationMs: number;
}

export interface AuditRuntimeFailure {
  ok: false;
  error: string;
  code:
    | "skill_not_found"
    | "timeout"
    | "sdk_error"
    | "no_output"
    | "parse_error"
    | "validation_error"
    | "runtime_error";
  durationMs: number;
}

export type AuditRuntimeResult = AuditRuntimeSuccess | AuditRuntimeFailure;

/**
 * Execute one read-only audit. Returns a structured result — never throws.
 *
 * Control flow:
 *   1. Load expert skill content (warn + continue if missing; the agent still
 *      has its role in the prompt).
 *   2. Build prompt.
 *   3. Run the SDK query with tool whitelist + canUseTool enforcement, under
 *      an AbortController capped at AUDIT_HARD_CAP_MS.
 *   4. Collect the final "result" message; parse into AuditReport.
 *   5. Emit Sentry instrumentation (started → completed|failed).
 */
export async function runExpertAudit(opts: RunAuditOptions): Promise<AuditRuntimeResult> {
  const startedAt = Date.now();
  const hardCap = opts.timeoutMs ?? AUDIT_HARD_CAP_MS;
  const projectDir = opts.projectDir ?? process.cwd();

  // --- Sentry: started breadcrumb ---------------------------------------
  Sentry.addBreadcrumb({
    category: "sidekick.audit",
    message: "sidekick.audit.started",
    level: "info",
    data: {
      expert: opts.expertSkill,
      scopePreview: opts.scope.slice(0, 200),
      projectId: opts.projectId,
      hardCapMs: hardCap,
    },
  });
  logger.info(
    {
      expert: opts.expertSkill,
      scopePreview: opts.scope.slice(0, 200),
      projectId: opts.projectId,
    },
    "sidekick.audit.started",
  );

  // --- Load expert skill -----------------------------------------------
  const expertSkillContent = loadSkillByName(projectDir, opts.expertSkill);
  if (expertSkillContent === null) {
    // Not fatal — the agent still has its role in the prompt. But log it so
    // we notice if a skill goes missing.
    logger.warn(
      { expert: opts.expertSkill, projectDir },
      "sidekick.audit: expert skill file not found — continuing with role-only prompt",
    );
  }

  const prompt = buildAuditPrompt({
    scope: opts.scope,
    expertSkill: opts.expertSkill,
    expertSkillContent,
    projectId: opts.projectId,
  });

  // --- Run under time cap -----------------------------------------------
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), hardCap);

  let modelOutput = "";
  try {
    if (opts.queryFn) {
      // Test path — caller supplies a canned answer.
      modelOutput = await opts.queryFn(prompt, abortController.signal);
    } else {
      for await (const message of query({
        prompt,
        options: {
          model: "sonnet",
          maxTurns: 20,
          allowedTools: [...AUDIT_ALLOWED_TOOLS],
          permissionMode: "default",
          canUseTool: buildAuditCanUseTool(),
          abortController,
          cwd: projectDir,
        },
      })) {
        if (message.type === "result" && message.subtype === "success") {
          modelOutput = message.result;
        }
      }
    }
  } catch (err) {
    clearTimeout(timeoutHandle);
    const durationMs = Date.now() - startedAt;
    const aborted = abortController.signal.aborted;
    const code = aborted ? "timeout" : "sdk_error";
    const reason = err instanceof Error ? err.message : String(err);
    return failAudit({
      code,
      error: aborted ? `audit aborted after ${hardCap}ms` : `audit SDK call failed: ${reason}`,
      durationMs,
      opts,
      cause: err,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!modelOutput) {
    const durationMs = Date.now() - startedAt;
    return failAudit({
      code: "no_output",
      error: "audit agent returned no final message",
      durationMs,
      opts,
    });
  }

  let report: AuditReport;
  try {
    report = parseAuditReport(modelOutput);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const reason = err instanceof Error ? err.message : String(err);
    const code = reason.includes("failed validation") ? "validation_error" : "parse_error";
    return failAudit({
      code,
      error: reason,
      durationMs,
      opts,
      extra: { modelOutputPreview: modelOutput.slice(0, 500) },
    });
  }

  // Pin the expert in the returned report to what we invoked — guards against
  // a model that writes a different value into the JSON.
  if (report.expert !== opts.expertSkill) {
    report.expert = opts.expertSkill;
  }

  const durationMs = Date.now() - startedAt;

  // --- Sentry: completed message ---------------------------------------
  const severityBreakdown = countBySeverity(report.findings);
  Sentry.captureMessage("sidekick.audit.completed", {
    level: "info",
    tags: { expert: opts.expertSkill, area: "sidekick-audit" },
    extra: {
      durationMs,
      findingCount: report.findings.length,
      severity: severityBreakdown,
      projectId: opts.projectId,
      scopePreview: opts.scope.slice(0, 200),
    },
  });
  logger.info(
    {
      expert: opts.expertSkill,
      durationMs,
      findingCount: report.findings.length,
      severity: severityBreakdown,
      projectId: opts.projectId,
    },
    "sidekick.audit.completed",
  );

  return { ok: true, result: report, durationMs };
}

// ---------------------------------------------------------------------------
// Error-path helper — single exit point for all failures so instrumentation
// stays consistent.
// ---------------------------------------------------------------------------

interface FailInput {
  code: AuditRuntimeFailure["code"];
  error: string;
  durationMs: number;
  opts: RunAuditOptions;
  cause?: unknown;
  extra?: Record<string, unknown>;
}

function failAudit(input: FailInput): AuditRuntimeFailure {
  const extra = {
    durationMs: input.durationMs,
    expert: input.opts.expertSkill,
    projectId: input.opts.projectId,
    scopePreview: input.opts.scope.slice(0, 200),
    code: input.code,
    ...(input.extra ?? {}),
  };

  if (input.cause !== undefined) {
    Sentry.captureException(input.cause, {
      tags: { expert: input.opts.expertSkill, area: "sidekick-audit", code: input.code },
      extra,
    });
  } else {
    Sentry.captureMessage("sidekick.audit.failed", {
      level: "error",
      tags: { expert: input.opts.expertSkill, area: "sidekick-audit", code: input.code },
      extra: { ...extra, error: input.error },
    });
  }

  logger.error(extra, `sidekick.audit.failed: ${input.error}`);

  return {
    ok: false,
    error: input.error,
    code: input.code,
    durationMs: input.durationMs,
  };
}

function countBySeverity(findings: AuditFinding[]): Record<AuditFinding["severity"], number> {
  const acc: Record<AuditFinding["severity"], number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) {
    acc[f.severity] += 1;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Tool handler — called by sidekick-reasoning-tools.ts
//
// Translates a RunAuditOptions-style input into the ToolResult<AuditReport>
// shape the reasoning-tools registry expects. Keeps sidekick-reasoning-tools
// thin: its execRunExpertAudit is a two-line delegation to this function.
// ---------------------------------------------------------------------------

export async function runAuditAsTool(opts: RunAuditOptions): Promise<ToolResult<AuditReport>> {
  const res = await runExpertAudit(opts);
  if (res.ok) {
    return { ok: true, result: res.result };
  }
  return { ok: false, error: res.error, code: `audit_${res.code}` };
}
