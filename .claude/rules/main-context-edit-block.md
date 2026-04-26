When a ticket is active, the main Claude Code context cannot mutate project files. Edits must flow through a subagent so `pipeline/lib/load-skills.ts` injects the matching domain skill into the subagent's system prompt. The PreToolUse hook `.claude/hooks/main-context-edit-block.sh` enforces this in code.

`branch-check-before-edit.md` blocks the wrong **branch**. This rule blocks the wrong **caller**. They are siblings — both protect the ticket workflow, but they fire on different signals.

## Why the hook exists

The framework relies on subagents to do real work because only subagents go through the skill loader. `frontend-design`, `backend`, `data-engineer`, `qa`, `code-reviewer` are all only useful when the loader injects them. If the main context implements directly:

- The `applies_to:`-frontmatter (T-1014) is never consulted.
- `SKILL_AGENT_MAP` (T-1020) is bypassed.
- `project.json.skills.domain` (T-1021) is bypassed.
- The CI drift gate (T-1022) catches nothing because there's no skill ⇄ agent contract being violated visibly.
- No `⚡ {Role} joined` line lands in the transcript.

T-982 is the canonical incident: the main context implemented a frontend ticket without spawning the `frontend` subagent. All four prior fixes were wired correctly — they just weren't reached. The hook closes the door before the loader can be bypassed.

## Detection contract

The hook reads PreToolUse JSON from stdin and decides allow vs. block by combining three signals.

### Subagent-allow signals (any one passes — exit 0)

1. **`agent_id` in the hook payload.** Claude Code emits this field only inside subagent contexts. Primary signal.
2. **`CLAUDE_AGENT_DEPTH` env var > 0.** Secondary signal — picks up SDK-launched subagents that don't carry `agent_id` for some reason.
3. **`.claude/.agent-map/` has at least one entry.** A subagent is currently running (marker written by `on-agent-start.sh`, removed by `on-agent-stop.sh`). Tertiary signal — covers cases where the PreToolUse payload is parsed before the subagent runtime sets its own envelope.

### Block trigger (all three must hold — exit 2)

1. **No subagent-allow signal fires** (caller is the main context).
2. **`.claude/.active-ticket` exists and is non-empty** (a ticket is actively being implemented).
3. **The target file is a project file** outside the framework-governance allow-list.

If any of the three fails, the hook exits 0 and the tool call passes through.

### Read-only-defensive default

When `cwd` or `file_path` cannot be parsed from the JSON payload, the hook exits 0. False positives are more expensive than false negatives — a stalled session annoys the user, a missed block leaks a single edit. The mismatch is intentional and matches the wording in AC #8 of T-1024.

## File-path allow-list

The block never fires for these paths, even when signals 1 and 2 hold:

| Path | Why allowed |
|---|---|
| `.claude/rules/**` | Source = install (per `self-install-topology.md`); hand-edited governance |
| `.claude/scripts/**` | Source = install; hand-edited governance |
| `.claude/hooks/**` | Source = install; this hook lives here too |
| `.worktrees/T-*/**` | Subagent's actual workspace — the work happens here |
| `.claude/.active-ticket` | Written by `/develop`, `/recover`, `detect-ticket.sh` |
| `.claude/.agent-map/**` | Ephemeral subagent ledger written by `on-agent-start.sh` |
| `.claude/.token-snapshot-*.json` | Per-ticket token snapshot written by `/develop` Step 3e |
| `.claude/.reporter-team-roster.json` | Pre-Develop team list written by `pipeline/run.ts` |
| `.claude/.sidekick-thread` | Sidekick thread persistence (Engine-Chat flow) |
| `.claude/.quality-gate-cache` | Tool-detection cache used by `quality-gate.sh` |
| Anything outside `$CWD` | `/tmp/`, `~/.claude/`, etc. — not project state |

The allow-list is intentionally conservative: every entry has a documented reason it must be writable from the main context. Adding to it requires the same justification.

## Anti-patterns

❌ **Disabling the hook to "unblock a quick test".** If you genuinely need to edit a project file from the main context, either close the ticket (`.claude/.active-ticket` empty) or spawn an Agent. The hook is read-only-defensive — it errs toward letting work through. If it fires, you really are in the bypass scenario it exists to catch.

❌ **Adding broad path patterns to the allow-list.** Each new entry weakens the contract. If a path needs to be writable from the main context regularly, that's a workflow problem, not a hook problem — fix it upstream (e.g. by routing the write through `/develop` or making it a setup.sh job).

❌ **Editing the installed copy instead of the source.** This rule, the hook, and the test live in `.claude/{rules,hooks}/` and `pipeline/lib/` respectively — these are the source paths. `.claude/rules/` and `.claude/hooks/` have source = install per `self-install-topology.md`, so the edits stick. `pipeline/lib/` is the source for `.pipeline/lib/`; `setup.sh --update` regenerates the installed copy.

❌ **Treating "Read works fine" as proof the hook isn't firing.** The hook is registered only for `Edit | Write | NotebookEdit`. `Read`, `Grep`, `Glob`, `Bash` are never in scope. If you suspect the hook is mis-firing on a read, look elsewhere.

✅ **Closing the ticket before manual cleanup.** If you need to fix something post-merge from the main context, mark the ticket done (or remove `.claude/.active-ticket`) before editing.

✅ **Spawning a subagent for the edit.** The intended workflow: `/develop T-{N}` → orchestrator → subagent. The hook's error message names this path explicitly so the user sees the right next step.

## Self-check before modifying the hook

When you change `.claude/hooks/main-context-edit-block.sh`:

1. Does it still allow all three subagent-detection paths (`agent_id`, `CLAUDE_AGENT_DEPTH`, `.agent-map/`)?
2. Does it still exit 0 on missing `cwd` or `file_path` (read-only-defensive)?
3. Does the allow-list still match this rule's table? If you added an entry, document it here.
4. Does the error message still name the active ticket and the correct workflow (`/develop T-{N}`)?

If any answer is "not sure", run the unit tests in `pipeline/lib/main-context-edit-block.test.ts` — they cover all three signals, the allow-list, and the read-only-defensive default. New behavior must come with new test cases.

## Related rules

- `branch-check-before-edit.md` — blocks the wrong branch (main when a ticket is active). Siblings.
- `self-install-topology.md` — explains why `.claude/hooks/` is a source-path that survives `setup.sh --update`.
- `decision-authority-enforcement.md` — documents the ticket-bypass anti-pattern in prose; this hook makes it executable.
- `expert-audit-scope.md` — same pattern at a different scope (audit agents are read-only by code, not by hook).

## Override

There is intentionally no override flag. If the block fires, the right answer is always one of:
- Close the ticket (or clear `.claude/.active-ticket`).
- Edit a path on the framework-governance allow-list.
- Spawn a subagent.

Adding an env-var override would create an unprincipled escape hatch — exactly the kind of "ich teste mal schnell was" hole T-1024 was filed to close.
