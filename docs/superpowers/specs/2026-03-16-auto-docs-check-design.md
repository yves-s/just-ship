# Design: Automatic Documentation Check

**Date:** 2026-03-16
**Status:** Approved

---

## Problem

After implementing features, documentation (README.md, CLAUDE.md) can become outdated — e.g., a new command is added but the Commands table in README.md is not updated. This currently requires manual follow-up.

## Goal

Add an automatic documentation check step to `/implement` and `/develop` that runs after the QA agent and before the final commit, so doc updates are always bundled into the same PR as the feature.

---

## Where It Lives

New step in both `commands/implement.md` and `commands/develop.md`:
- **Position:** After QA agent (current step 6 in `/implement`, step 7 in `/develop`), before the final commit
- **Executor:** Claude itself (orchestrator) — no extra agent

---

## Trigger Logic

After QA, Claude runs:
```bash
git diff --name-only HEAD
```

Based on changed files, Claude determines which docs to check:

| Changed files | Docs to check |
|---|---|
| `commands/*.md` (new or modified) | README.md → Commands table |
| `agents/*.md` (new or modified) | README.md → Agents table |
| `commands/*.md`, `pipeline/`, workflow-relevant | README.md → Workflow diagram |
| `CLAUDE.md`-relevant structures (pipeline, architecture) | CLAUDE.md |
| No relevant changes | Skip entirely |

**Scope:** Only `README.md` and `CLAUDE.md`. Internal docs (`docs/ARCHITECTURE.md`, etc.) are out of scope.

---

## Execution

1. Run `git diff --name-only HEAD` to get changed file list
2. Determine which doc sections are affected (see trigger logic above)
3. Read affected doc files
4. Check if entries are present, accurate, and complete
5. If update needed: apply directly with Edit tool
6. If no update needed: skip, output `✓ docs — keine Änderungen nötig`
7. If update applied: output `✓ docs — README.md aktualisiert` (or CLAUDE.md)

Updated doc files are staged and included in the final commit automatically (no separate commit needed).

---

## Output Format

```
▶ docs — Dokumentation prüfen
✓ docs — README.md aktualisiert        ← if changes made
✓ docs — keine Änderungen nötig       ← if nothing to update
```

---

## What NOT to Do

- Do not spawn an extra agent for this step
- Do not create a separate commit for doc changes
- Do not check docs outside `README.md` and `CLAUDE.md`
- Do not update docs that are unrelated to the current changes

---

## Files to Modify

- `commands/implement.md` — add docs-check step between QA (step 6) and Abschließen (step 7)
- `commands/develop.md` — add docs-check step between Review (step 7) and Ship (step 8)
