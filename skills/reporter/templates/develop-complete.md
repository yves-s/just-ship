---
template: develop-complete
purpose: Final user-facing block after `/develop` has run — ticket, title, team, build, tests, QA, diff, PR, preview. The one block the CEO reads when a feature branch is ready for review.
fires_at: End of `/develop` flow, after the PR exists and the ticket is in `in_review`. Currently rendered by `.claude/scripts/session-summary.sh` (step 11 of `skills/develop/SKILL.md`).
---

# Template — develop-complete

## Variables

| Name | Type | Example | Notes |
|---|---|---|---|
| `{ticket_number}` | int | `998` | Always rendered as `T-{ticket_number}` |
| `{title}` | string | `Reporter-Skill + 5 Core-Templates` | Ticket title, single line |
| `{summary_text}` | string | `Introduces skills/reporter/ with voice rules and 5 core templates.` | 1–2 sentence summary of what the branch does |
| `{team_rows}` | string (multi-line) | (see body) | One line per agent that ran, pre-formatted as `{icon} {role} · {token_count}` |
| `{build_status}` | string | `passed` or `failed` | Build-check result |
| `{tests_passed}` | int | `12` | Tests passed |
| `{tests_total}` | int | `12` | Total tests |
| `{qa_result}` | string | `passed`, `needs-review`, `skipped` | QA tier result from step 10 |
| `{qa_icon}` | string | `✓`, `⚠`, `—` | Selected by the caller from `{qa_result}` (see mapping table below) |
| `{files_changed}` | int | `6` | Number of changed files |
| `{insertions}` | int | `412` | `git diff --stat` insertions |
| `{deletions}` | int | `87` | `git diff --stat` deletions |
| `{commit_count}` | int | `3` | Commits on branch since `main` |
| `{branch}` | string | `feature/998-reporter-skill` | Current branch name |
| `{pr_url}` | string | `https://github.com/…/pull/257` | PR URL (optional — elide `PR:` line if empty) |
| `{preview_url}` | string | `https://…vercel.app` | Preview URL (optional — elide `Preview:` line if empty) |
| `{total_tokens}` | string | `243k` | Total tokens used in session, humanized by the caller (`243k`, `1.2M`). Raw integers are not rendered — the goal is a scannable line, not exact accounting. |
| `{cost_usd}` | float | `1.42` | Estimated session cost in USD, two-decimal float |
| `{model}` | string | `claude-opus-4-7` | Model that ran the session |

## Template body

```
✓ T-{ticket_number} · {title}

{summary_text}

Team
────
{team_rows}

Build   ✓ {build_status}
Tests   ✓ {tests_passed}/{tests_total}
QA      {qa_icon} {qa_result}
Diff    {files_changed} files · +{insertions} / −{deletions} · {commit_count} commits
Branch  {branch}
PR      {pr_url}
Preview {preview_url}

Session · {total_tokens} tokens · ${cost_usd} · {model}
```

`{qa_icon}` is selected by the caller:

| `qa_result` | Icon |
|---|---|
| `passed` | `✓` |
| `needs-review` | `⚠` |
| `skipped` | `—` |

`{team_rows}` format (one line per agent, pre-formatted by the caller):

```
✓ planner    · 12.3k tokens
✓ backend    · 41.2k tokens
✓ qa         · 8.7k tokens
✓ docs       · 2.1k tokens
```

## Optional-row rules

- `PR` — elide the whole line if `{pr_url}` is empty.
- `Preview` — elide the whole line if `{preview_url}` is empty.
- `Session` — elide the whole line if `{total_tokens}` is 0 or unknown.

## Voice checks

- Rule 1 (Result-first): the first line is the outcome (`✓ T-{ticket_number} · {title}`), not a narration of what happened.
- Rule 2 (Tables): the Team block and the metrics block both render as aligned columns, not prose.
- Rule 3 (Icons): only `✓`, `⚠`, `—` appear. No `✅`, `❌`, no emoji.
- Rule 6 (Specific numbers): tests, files, insertions, deletions, commits, cost all render as integers or floats. Tokens render as humanized counts (`243k`, `1.2M`) — concrete numbers, never adjectives like "many" or "several".

## Example — fully rendered

```
✓ T-998 · Reporter-Skill + 5 Core-Templates

Introduces skills/reporter/ with voice rules and 5 core templates.

Team
────
✓ planner    · 12.3k tokens
✓ backend    · 41.2k tokens
✓ qa         · 8.7k tokens
✓ docs       · 2.1k tokens

Build   ✓ passed
Tests   ✓ 12/12
QA      ✓ passed
Diff    6 files · +412 / −87 · 3 commits
Branch  feature/998-reporter-skill
PR      https://github.com/yves-s/just-ship/pull/260
Preview https://just-ship-git-feature-998-reporter-skill.vercel.app

Session · 243k tokens · $1.42 · claude-opus-4-7
```
