---
applies_to: top-level-only
---

At session start, check if the installed framework version may be outdated.

**IMPORTANT: This rule is READ-ONLY. Do NOT run any bash commands. Only use the Read tool to check files, then report findings as text.**

1. Read `project.json` and extract `framework.version` and `framework.updated_at`
2. If `framework` is not set or `updated_at` is empty, stop silently — project was installed before versioning existed
3. Compare `updated_at` to today's date. If the framework was updated within the last 14 days, stop silently
4. If older than 14 days, show once:

> ⚠ Framework zuletzt aktualisiert: {updated_at} ({version}). Run `setup.sh --check` to see if updates are available.

This check runs ONCE at session start. Do not repeat it during the session. Do not block work — it is an informational hint only.
