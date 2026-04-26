---
applies_to: audit-runtime-only
---

Audit agents spawned via `run_expert_audit` are read-only specialists. They analyze the scope they are given, report structured findings, and return control to the Sidekick. They never write, never create tickets, never call board APIs — if something needs to change, the Sidekick decides what to do with the finding.

The runtime in `pipeline/lib/audit-runtime.ts` enforces these constraints in code (`allowedTools` whitelist + `canUseTool` callback). This rule documents the constraints so anyone reading the code, reviewing a PR, or writing a new audit flow understands why the runtime looks the way it does — and which shortcuts are off-limits.

## Scope of the rule

Applies to every code path that spawns an audit agent:

- `pipeline/lib/audit-runtime.ts` — the runtime itself.
- `pipeline/lib/sidekick-reasoning-tools.ts` — the `run_expert_audit` tool handler that delegates to the runtime.
- Any future caller that invokes `runExpertAudit` (direct) or `run_expert_audit` (via the tool registry).

Does **not** apply to other specialists spawned through `/develop` or the orchestrator — those have different guarantees (they may write code, they are part of the ticket pipeline). The audit agent is a separate construct and the constraints here are specific to it.

## The rules

### 1. Read-only tool surface

Audit agents have exactly four tools:

| Tool | What it does | Why it's allowed |
|---|---|---|
| `Read` | Read a file | No state change |
| `Grep` | Search file contents | No state change |
| `Glob` | List files by pattern | No state change |
| `Bash` | Shell commands — **but only the read-only allow-list** | Auditors sometimes need `git log`, `git diff`, `ls`, etc. |

No `Write`, no `Edit`, no `NotebookEdit`, no `Agent` (no sub-sub-agents), no MCP write tools, no board API wrappers. The SDK call in `runExpertAudit` passes `allowedTools: ["Read", "Grep", "Glob", "Bash"]` — anything outside that list fails at the SDK layer before it reaches `canUseTool`.

### 2. Bash is narrowed further

The SDK's `allowedTools` cannot express "Bash but only read-only", so the runtime installs a `canUseTool` callback that inspects every Bash invocation. The callback approves commands only when the first non-assignment token is on the read-only binary allow-list **and** no per-binary write flags are present.

Current allow-list (binaries): `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat`, `pwd`, `echo`, `printf`, `basename`, `dirname`, `realpath`, `readlink`, `tree`, `find`, `git`, `jq`, `grep`, `rg`, `sort`, `uniq`, `cut`, `awk`, `sed`, `column`, `diff`, `tr`, `date`, `which`, `true`, `false`, `test`, `[`.

Narrowing rules layered on top:

- `find` rejects `-exec`, `-execdir`, `-delete`, `-ok`, `-okdir`, and the GNU `-fprint`, `-fprint0`, `-fprintf`, `-fls` flags (the `-fprint*` family writes filesystem listings to a named file).
- `sed` rejects `-i` / `--in-place` / `--in-place=...` / attached `-iSUFFIX` (edits files) and `-f` (external script file). Scripts containing the `e` command (execute via shell — GNU extension), `w`/`W` commands (write pattern space to file), or the `s///e` / `s///w` substitution flags are rejected. Plain substitution (`s/from/to/g`, `s/a/b/`) is still allowed.
- `awk` rejects `-i inplace` (gawk in-place rewrite), `-f` (external script file), and any script containing `system(`, `| getline`, pipes to a command (`print ... | "cmd"`), or output redirection (`print > file`). Pure data-transform scripts (`awk '{print $1}'`) are still allowed.
- `git` accepts only read sub-commands (`log`, `diff`, `show`, `status`, `blame`, `ls-files`, `ls-tree`, `rev-parse`, …). Write flags on otherwise-read sub-commands (`git branch -d`, `git tag --delete`, `git remote add`, `git worktree add`, `git stash push`, `git config --add`) are rejected. In addition: `git diff|show|log|shortlog --output=FILE` / `-o FILE` (writes patch/log to a file), `git grep -O<cmd>` / `--open-files-in-pager=<cmd>` (runs an arbitrary binary as the "pager"), top-level `git -c <k>=<v>` config overrides, and `git --exec-path=<path>` are all rejected.
- Separator layer: every occurrence of a bare `&` (background job starter), a literal newline / CR, or a NUL / control byte is rejected before segment splitting — these are the easy splitter-bypass primitives that let an attacker hide a second command inside what looks like a single allowed invocation.
- Output redirection (`>`, `>>`), `tee`, process substitution (`<(...)`, `>(...)`), command substitution (`` ` ``, `$(...)`), heredocs (`<<`), and absolute-path binaries (`/usr/bin/foo`, `./script.sh`) are rejected universally.

The logic lives in `classifyBashCommand()` in `pipeline/lib/audit-runtime.ts`. It's conservative on purpose — false positives are better than false negatives, because `Read`/`Grep`/`Glob` are always available as a fallback.

### 3. No board API access

The audit agent has no pipeline key, no Board URL, no ticket-creation primitive. The runtime deliberately does not pass any such context into the prompt. Even if the agent tried to `curl` the board API, `curl` isn't on the Bash allow-list — the call would be rejected before it leaves the process.

This is the load-bearing constraint: **an audit must not be able to turn itself into a ticket**. The Sidekick, not the audit agent, decides whether a finding becomes a board artifact.

### 4. Time-box

- Target: 30s – 2 min. Communicated to the agent in the prompt so it paces itself.
- Hard cap: 5 min, enforced by an `AbortController` in the runtime. On abort, the runtime returns `{ ok: false, code: "audit_timeout", ... }` and the tool caller sees a clean error.

If an audit genuinely needs longer, the right answer is to narrow the scope or split into multiple audits — not to raise the cap. A 5-minute ceiling keeps the Sidekick responsive.

### 5. Report contract

The audit agent's final message must be a JSON object matching the `AuditReport` Zod schema in `audit-runtime.ts`. The runtime parses and validates before returning to the tool caller. If validation fails, the runtime returns `{ ok: false, code: "audit_validation_error", ... }` rather than pretending the audit succeeded.

Critical findings must carry a `suggested_fix`. That's a hint for the Sidekick, not a mandate — the Sidekick (with the CEO) decides whether to act.

### 6. Read-only applies to everything, not just files

"Read-only" here means:

- No file writes (covered by tool whitelist).
- No ticket creation (covered by no-board-access).
- No network mutations (no `curl`, no `wget`, no `gh` — none are on the allow-list).
- No process state changes (no `kill`, no `systemctl`, no `pkill`).
- No shell state changes that persist (no `export X=Y >> .bashrc` — redirection is blocked).

If something new needs to be added to the allow-list, the question is always: **does this mutate any state that another session would observe?** If yes, it belongs elsewhere. If no, it can be considered.

## Anti-patterns

❌ **Adding tools to the whitelist to "unblock" an audit.** The audit either fits read-only or it's the wrong mechanism. If a specialist genuinely needs to modify something, that's a `/develop` ticket with the full review pipeline, not an audit.

❌ **Letting the audit agent call board APIs "just to write its report".** The runtime returns the report to the Sidekick; the Sidekick decides what to do with it. The audit agent itself must not touch the board.

❌ **Raising the hard cap to "buy time for larger audits".** Longer audits are a scoping problem, not a timeout problem. Split the scope.

❌ **Trusting the model's JSON unchecked.** The runtime validates with Zod before returning. If the model produces malformed JSON, the runtime emits a `validation_error` — it does not silently reshape the output.

✅ **If a finding demands immediate action:** the agent marks it `critical` with a `suggested_fix`. The Sidekick, seeing a critical finding, can choose to create a ticket, open a sparring thread, or escalate to the CEO. The audit agent itself stays in its lane.

## Self-check before modifying the runtime

When you're about to change `audit-runtime.ts`, ask:

1. Does this change keep the agent read-only for **all** observable state (files, board, network, process)?
2. Does the time cap still fire on runaway loops?
3. Does the report contract still match plan section 3.2 and the `AuditReport` type?
4. If you added a binary to the Bash allow-list: is there a concrete auditor workflow that needs it, and is it genuinely read-only?

If any answer is "not sure", stop and consult `product-cto`. The audit-agent guarantee is part of the Sidekick's trust contract with the user — eroding it quietly is worse than erroring loudly.

## Related

- Plan: `docs/superpowers/plans/2026-04-23-sidekick-reasoning-architecture.md` §3.2 defines the contract.
- Tool layer: `pipeline/lib/sidekick-reasoning-tools.ts` defines the `run_expert_audit` tool that calls this runtime.
- Runtime: `pipeline/lib/audit-runtime.ts`.
- Companion rules: `.claude/rules/audit-completeness.md` (quality gate for what an audit must report) and `.claude/rules/decision-authority-enforcement.md` (why the Sidekick, not the audit agent, owns artifact decisions).
