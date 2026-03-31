At the start of each session, on your first interaction with the user, check for stuck pipeline tickets:

1. Check if `.worktrees/` directory exists and contains subdirectories:
   ```bash
   ls -d .worktrees/T-*/ 2>/dev/null
   ```

2. If worktrees exist, check if each one has an active agent process:
   ```bash
   ACTIVE_TICKET=$(cat .claude/.active-ticket 2>/dev/null || echo "")
   ```

3. For each worktree where the ticket number does NOT match `.active-ticket` (no agent actively working on it):
   - Extract ticket number from directory name (`.worktrees/T-{N}` -> `{N}`)
   - Resolve Board API credentials (workspace_id from project.json -> write-config.sh)
   - Query ticket status with 3-second timeout:
     ```bash
     curl -s --max-time 3 -H "X-Pipeline-Key: {api_key}" "{board_url}/api/tickets/{N}"
     ```
   - Check both `status` and `pipeline_status` fields

4. A ticket is "stuck" when:
   - `status` is `in_progress` AND
   - `pipeline_status` is `running`, `crashed`, or `null` AND
   - No active agent is working on it (not in `.active-ticket`)

5. If stuck tickets are found, inform the user:
   > T-{N} appears stuck on `in_progress` with an orphaned worktree. Run `/recover T-{N}` to resume or restart.

6. If `pipeline_status` is `paused`: do NOT flag as stuck. Instead:
   > T-{N} is paused waiting for input.

7. If the Board is unreachable (curl timeout or no pipeline config): skip detection silently.

Do NOT automatically run recovery. Only inform the user.
