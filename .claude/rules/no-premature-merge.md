Don't merge PRs or branches to main without explicit user confirmation.

- "Mach weiter" means continue the process (review, test), NOT merge
- Always keep work on feature branches until the user explicitly approves merging
- The user wants to review PRs on GitHub before merging
- Unambiguous explicit approval = `/ship`, "ship it", "merge", "mach den PR rein"
- Short confirmations ("passt", "done", "fertig", "klappt", "sieht gut aus", "ok", "gut") are context-sensitive — they only count as merge approval when all three conditions in `.claude/rules/ship-trigger-context.md` are met (non-main branch, pending work exists, last assistant message explicitly asked for review/merge approval). Otherwise they are normal acknowledgements, not a merge signal.
