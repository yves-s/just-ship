---
template: phase-progress
purpose: One-line phase update during a long-running operation (`/develop`, `/ship`, `/just-ship-audit`). Rendered whenever an agent starts, finishes, or a pipeline phase transitions — so the CEO can watch progress without reading prose.
fires_at: Every agent-state-change inside a multi-phase flow. `▶` on phase start, `✓` on phase complete, `↻` on retry, `✗` on failure, `⚠` on warning-but-continue.
---

# Template — phase-progress

## Variables

| Name | Type | Example | Notes |
|---|---|---|---|
| `{icon}` | string | `▸`, `▶`, `✓`, `✗`, `⚠`, `↻` | One of the six allowed status icons |
| `{role}` | string | `qa`, `backend`, `planner`, `docs`, `code-review`, `orchestrator` | The agent, skill, or pipeline-phase name |
| `{task}` | string | `running Playwright smoke tests` | Active-voice, what is happening — no narration of intent |
| `{duration}` | string | `12.3s`, `1m 42s`, or empty | Optional — only on `✓` / `✗` lines, never on `▶` / `▸` |
| `{detail}` | string | `12/12 passed`, `3 issues fixed`, or empty | Optional tail — a single number/ratio, never a sentence |

## Template body

```
{icon} {role} · {task}{duration_suffix}{detail_suffix}
```

`{duration_suffix}` format: ` · {duration}` (leading space-dot-space). Elided when empty.

`{detail_suffix}` format: ` · {detail}` (leading space-dot-space). Elided when empty.

## Icon semantics

| Icon | Meaning | Typical `{task}` wording |
|---|---|---|
| `▶` | Phase starting (coarse-grained, top-level) | `planning`, `implementation`, `review` |
| `▸` | Agent running (fine-grained, inside a phase) | `running Playwright smoke tests` |
| `✓` | Phase / agent completed successfully | past-tense action: `build passed`, `docs updated` |
| `⚠` | Completed with warning — work continues | `qa: 3 warnings, 0 blockers` |
| `↻` | Retrying after a transient failure | `attempt 2/3 — push rejected, rebasing` |
| `✗` | Failed — operation aborting or escalating | `build failed — devops dispatching` |

Never mix icons on one line. Never invent new icons.

## Voice checks

- Rule 1 (Result-first): `✓` / `✗` / `⚠` lines lead with the outcome in `{task}`, not with "I just…".
- Rule 3 (Icons): one of the six; nothing else.
- Rule 4 (Short active): one fragment, ≤ 10 words per line counting detail.
- Rule 5 (No inner monologue): the task is *what is happening*, not *what I intend to do next*.
- Rule 6 (Specific numbers): when a detail is a count (tests, issues, attempts), render the number — never "several".

## Examples — lifecycle of a single phase

```
▶ qa · starting
▸ qa · running Playwright smoke tests
✓ qa · passed · 12.3s · 12/12 passed
```

## Examples — with retries

```
▶ ship · pushing
↻ ship · attempt 2/3 — push rejected, rebasing
✓ ship · pushed · 4.8s
```

## Examples — with warning and failure

```
▸ build · compiling
⚠ build · passed · 2.1s · 3 type warnings
```

```
▸ build · compiling
✗ build · failed · 3.4s · devops dispatching
▶ devops · fix in progress
✓ devops · build passes · 18.7s · 2 files patched
```

## Anti-patterns

| Wrong | Right |
|---|---|
| `▶ Now running the QA agent to check acceptance criteria…` | `▶ qa · acceptance criteria check` |
| `✓ qa completed successfully.` | `✓ qa · passed · 12/12 passed` |
| `⚠ Some tests had warnings.` | `⚠ qa · 3 warnings, 0 blockers` |
| `✅ docs done 🎉` | `✓ docs · updated · 2 files` |
| Two consecutive `▶` lines for the same role without an intervening `✓` / `✗` | One start, one end — if more detail is needed, use `▸` in the middle |
