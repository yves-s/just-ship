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
/path/to/just-ship/setup.sh
```

## Submitting a pull request

1. Fork the repository
2. Create a branch: `git checkout -b fix/short-description` or `feat/short-description`
3. Make your changes
4. Test by installing into a project and running `/ticket` end-to-end
5. Open a PR with a clear description of what and why

## Guidelines

- **Agents/skills**: Keep them generic — they must work across any tech stack. Project-specific logic belongs in the user's `CLAUDE.md`, not here.
- **Bash scripts**: Keep `setup.sh` and `run.sh` POSIX-compatible where possible. Avoid exotic dependencies.
- **Markdown files**: Clear, concise instructions. Agents read these at runtime — every word counts towards token cost.
- **No breaking changes** without discussion — projects rely on the update mechanism to stay in sync.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) instead.
