---
applies_to: top-level-only
---

At the start of each session, on your first interaction with the user, check for stuck pipeline tickets.

**IMPORTANT: This rule is READ-ONLY. Do NOT run any bash commands (no `rm`, no `curl`, no cleanup). Only use the Read and Glob tools to check files, then report findings as text.**

1. Use Glob to check if `.worktrees/T-*/` directories exist. If none exist, stop here silently.

2. Use Read to check `.claude/.active-ticket` (if it exists) to see which ticket is currently being worked on.

3. Use Read to check `project.json` for `pipeline.workspace_id`. If no pipeline config exists, stop here silently.

4. For each worktree where the ticket number does NOT match `.active-ticket`:
   - Note the ticket number but do NOT query the Board API (no curl, no network calls at session start)
   - Simply inform the user that an orphaned worktree exists

5. If orphaned worktrees are found, inform the user:
   > T-{N} has an orphaned worktree in `.worktrees/`. Run `/recover T-{N}` to resume or clean up.

6. Do NOT automatically run recovery. Do NOT delete files. Do NOT run any cleanup commands. Only inform the user.
