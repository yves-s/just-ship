NEVER use Bash (echo, printf, cat, >) to write the `.active-ticket` file. ALWAYS use the Write tool.

Bash writes to `.claude/.active-ticket` trigger permission prompts that interrupt autonomous workflows. The Write tool is pre-authorized and completes silently.

Wrong:
```bash
printf "506" > .claude/.active-ticket
echo "506" > .claude/.active-ticket
```

Correct:
```
Write(file_path=".claude/.active-ticket", content="506")
```

This applies to ALL commands and workflows that set the active ticket: /develop, /recover, and any other context.
