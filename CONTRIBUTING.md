# Contributing

Thanks for your interest in contributing to Just Ship!

## Ways to contribute

- **Bug reports** — open an issue describing what happened and how to reproduce it
- **Feature requests** — open an issue describing the use case
- **Pull requests** — see below

## Development setup

```bash
git clone https://github.com/yves-s/just-ship.git
cd just-ship
```

No build step needed — the framework is plain bash scripts and markdown files.

To test changes, install the framework into a test project:

```bash
cd /path/to/test-project
just-ship setup
```

## Submitting a pull request

1. Fork the repository
2. Create a branch: `git checkout -b fix/short-description` or `feat/short-description`
3. Make your changes
4. If you touched anything under `agents/`, `commands/`, `skills/`, `pipeline/`, `templates/`, or `.claude/{rules,scripts,hooks}/`, run `bash setup.sh --update` and commit the regenerated install paths under `.claude/{skills,scripts,hooks,rules,settings.json}` and `.pipeline/`. The CI **Setup Drift Check** workflow blocks PRs that miss this step.
5. Test by installing into a project and running `/ticket` end-to-end
6. Open a PR with a clear description of what and why

## Setup Drift Check (CI)

The repo is self-installing: source files (e.g. `skills/<name>/SKILL.md`) generate installed copies (`.claude/skills/<name>.md`) via `setup.sh --update`. When source files change without `setup.sh --update` being run, the runtime drifts behind the source — see `.claude/rules/self-install-topology.md` for why this matters.

Every PR runs the **Setup Drift Check** workflow (`.github/workflows/setup-drift-check.yml`), which executes `setup.sh --update` and fails if any install path differs from the committed state. The PR comment lists the drifting files and the standard fix.

**Standard fix** (from the repo root):

```bash
bash setup.sh --update
git add -A
git commit -m "chore: setup.sh --update"
git push
```

**Bypass** (documented emergencies only): include `[skip-drift-check]` in the head commit message of the PR. The workflow logs the bypass via a CI warning, and the next non-bypassed PR will re-surface the drift.

## Guidelines

- **Agents/skills**: Keep them generic — they must work across any tech stack. Project-specific logic belongs in the user's `CLAUDE.md`, not here.
- **Bash scripts**: Keep `setup.sh` and `run.sh` POSIX-compatible where possible. Avoid exotic dependencies.
- **Markdown files**: Clear, concise instructions. Agents read these at runtime — every word counts towards token cost.
- **No breaking changes** without discussion — projects rely on the update mechanism to stay in sync.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) instead.
