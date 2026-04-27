---
applies_to: all-agents
---

Just Ship has an npm-style plugin dependency system: `project.json.plugins` declares registries and dependencies, `setup.sh` resolves them at install/update time, and plugin skills land under `.claude/skills/plugin--<plugin>--<skill>.md`. If you are wondering "how do I install a plugin?" or "does this system exist?" — it does, and the mechanics are here. The recurring hallucination of treating this as not-yet-built is addressed by this rule.

## Schema

```json
{
  "plugins": {
    "registries": ["getsentry/skills", "trailofbits/skills"],
    "dependencies": [
      { "plugin": "sentry-skills@sentry-skills", "skills": ["security-review", "find-bugs"] },
      "differential-review@trailofbits",
      "insecure-defaults@trailofbits"
    ]
  }
}
```

### Two dependency forms

**String form** — `"differential-review@trailofbits"`: installs the plugin and copies all its skills into `.claude/skills/`. Use when you want everything the plugin provides.

**Object form** — `{ "plugin": "sentry-skills@sentry-skills", "skills": ["security-review", "find-bugs"] }`: installs the plugin but copies only the listed skills into `.claude/skills/`. Use when a plugin ships many skills and you only want a subset.

## Resolution logic

Code pointer: `setup.sh:311+`, function `install_plugins_from_project`.

1. **Framework defaults win.** `setup.sh` reads plugins from both the project's `project.json` and the framework's own `project.json` (`FRAMEWORK_DIR/project.json`). Framework deps are always installed first. Project deps that are not already in the framework set are merged in. Project cannot remove or override framework-defined plugins — they are treated as a non-negotiable baseline.

2. **Registries are registered idempotently.** For each registry in the merged list: `claude plugin marketplace add <registry>` runs only if the registry is not already configured (`claude plugin marketplace list` check). No-ops on re-run.

3. **Dependencies are installed idempotently.** For each plugin id in the merged list: `claude plugin install <id> --scope project` runs only if the plugin is not already present (`claude plugin list` check). No-ops on re-run.

4. **Resolved state is persisted.** After install, `setup.sh` writes the merged `{ registries, dependencies }` back into the project's `project.json`. Framework defaults appear explicitly in the project file even if the project did not declare them — this prevents silent drift between what is installed and what is declared.

5. **Skills are copied from the plugin cache.** `setup.sh` reads each installed plugin's path from `~/.claude/plugins/installed_plugins.json` and copies `SKILL.md` files out of the plugin's `skills/<name>/` directories into `.claude/skills/plugin--<plugin_name>--<skill_name>.md`. For object-form deps with a `skills` filter, only matching skill names are copied. String-form deps copy all skills.

6. **Stale skills are cleaned before every copy.** Before any copying, all existing `.claude/skills/plugin--*.md` files are deleted. This means removing a plugin from `project.json` propagates cleanly on the next `setup.sh --update` run — no manual cleanup needed.

7. **Security gate runs after copy.** `scripts/scan-plugin-security.sh` is called against `.claude/skills/plugin--*.md`. If the scan reports critical findings, all plugin skill files are removed and `setup.sh` exits with an error. The project must fix the issue (remove or pin the offending plugin) before the skills become usable.

## Workflow: adding a new dependency

```
1. project.json → extend plugins.dependencies with a string or object form entry.
2. If the plugin comes from a new registry: add the registry to plugins.registries.
3. Run: setup.sh   OR   setup.sh --update
4. Verify:
   - claude plugin list   → plugin appears
   - .claude/skills/plugin--*.md   → copied skill files present
```

No manual `claude plugin install` required — `setup.sh` handles it idempotently.

## Fallback behavior

| Situation | Behavior |
|---|---|
| Project has no `plugins.dependencies` | Framework defaults are installed anyway (see step 1 above; `setup.sh:324` reads from `fw.plugins.dependencies` as fallback) |
| Project has its own deps | Merged with framework defaults; project deps extend, not replace |
| `claude` CLI not found | `setup.sh` warns ("install Claude Code first") but does not abort; plugin install must be repeated after CLI is available |

## File topology

| Path | Role |
|---|---|
| `project.json.plugins` | Declarative source — what is wanted |
| `~/.claude/plugins/installed_plugins.json` | Global plugin cache managed by Claude CLI |
| `.claude/skills/plugin--<plugin>--<skill>.md` | Per-project copies of plugin skills, managed by `setup.sh` |
| `setup.sh:311+` | Resolution logic (`install_plugins_from_project`) |
| `scripts/scan-plugin-security.sh` | Security gate before final copy |

## Anti-patterns

❌ Editing `.claude/skills/plugin--*.md` directly — these files are deleted and rewritten on every `setup.sh` run. Changes do not survive.

❌ Vendoring plugin skill files into the repo instead of declaring them as dependencies — this violates the npm-analogy principle in `framework-abstraction-check.md`. Framework distributes mechanisms, not vendor code.

❌ Assuming that omitting a framework plugin from `project.json.plugins.dependencies` removes it — framework plugins are merged in regardless. To change the framework baseline, edit the framework's own `project.json`, not the project's.

✅ To add a plugin: extend `project.json.plugins.dependencies`, then run `setup.sh --update`.

## Related rules

- `framework-abstraction-check.md` — npm analogy ("Copy external files into the repo" anti-pattern); this rule is the concrete mechanism behind that analogy.
- `self-install-topology.md` — `.claude/skills/` hosts both framework skills (from `skills/*/SKILL.md` via `setup.sh`) and plugin skills (from the plugin cache via the same `setup.sh` run). Framework skills survive updates; plugin skills are always regenerated from scratch — the distinction matters when reasoning about what lives in `.claude/skills/`.
