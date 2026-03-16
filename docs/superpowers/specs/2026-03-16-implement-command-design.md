# Design: `/implement` Command

**Date:** 2026-03-16
**Status:** Approved

---

## Problem

`/develop` requires a board ticket as entry point. Users who want to brainstorm in chat and immediately implement — or develop initial concepts for new projects — have no way to trigger the full agent pipeline (Backend/Frontend/QA agents) without the ticket ceremony.

## Goal

A `/implement` command that:
- Works without a ticket or board configuration
- Accepts either an explicit description or derives the spec from the current chat context
- Runs the same agent pipeline as `/develop` (planning → specialized agents → build check → QA → commit + PR)
- Is deliberately lightweight — no board events, no status updates

---

## Trigger & Input

```
/implement                          → derives spec from current conversation
/implement Dark Mode hinzufügen     → uses the argument text as spec basis
```

Both forms always work regardless of whether a pipeline is configured.

---

## Spec Extraction

**Without arguments:**
Claude reads the current conversation and distills a compact spec:
- What is being built?
- Which files/areas are affected?
- What is the desired behavior / acceptance criteria?

**With arguments:**
The argument text is used directly as the spec basis.

In both cases, the extracted spec is printed before agents are spawned so the user can see what Claude understood.

---

## Agent Pipeline

Runs identically to `/develop` steps 4–8, but without board events:

| Step | Action |
|---|---|
| Feature branch | `feature/{slug}` derived from spec title |
| Planning | Claude reads affected files directly (Read/Glob/Grep) |
| Agents | `data-engineer` / `backend` / `frontend` as needed |
| Build check | Commands from `project.json` |
| QA agent | Acceptance criteria + security quick-check |
| Finish | Commit + Push + PR — no board status update |

**Board events are explicitly suppressed** even if a pipeline is configured. This command is intentionally standalone.

---

## Branch Naming

Without a ticket number, the branch name is derived from the spec:
- Tags/title contain "bug", "fix", "fehler" → `fix/{slug}`
- Tags/title contain "chore", "refactor", "cleanup" → `chore/{slug}`
- Everything else → `feature/{slug}`

`{slug}` is a short kebab-case summary of the spec (max 5 words).

---

## Integration with Board Workflow

If the user later wants to create a ticket from this work (e.g., for follow-up tasks on the board), they can run `/ticket` on the finished branch. This is optional and not triggered automatically.

---

## File to Create

`commands/implement.md` — a new slash command following the same structure as `commands/develop.md`.

---

## Out of Scope

- Automatic ticket creation from chat context
- Board status updates
- Pipeline event sending
