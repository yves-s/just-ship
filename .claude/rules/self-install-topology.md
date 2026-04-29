---
applies_to: engine-repo-only
---

This repo is Just Ship bootstrapping itself: the framework **source** lives here, AND the framework is **installed** here so we can use `/ticket`, `/develop`, `/ship` while developing the framework. The two coexist in the filesystem — and they must not be confused. Editing the installed copy silently diverges it from the source and causes incidents like T-989 (2026-04 stash-pop conflict that blocked `git pull` for six rebase attempts).

## The topology

| Pfad (Source) | Pfad (Installiert) | Falle? | Hook-blockiert? |
|---|---|---|---|
| `pipeline/` | `.pipeline/` | **Ja** — andere Pfade, Edit auf Install wird vom nächsten `setup.sh --update` überschrieben | **Ja** |
| `.claude/.pipeline-version` | — | **Ja** — nur Install, von `setup.sh` geschriebener Stempel | **Ja** |
| `.claude/.template-hash` | — | **Ja** — nur Install, von `setup.sh` geschriebener Stempel | **Ja** |
| `agents/*.md` | `.claude/agents/*.md` | **Ja** — `setup.sh` kopiert aus `agents/`, Edit auf `.claude/agents/` wird beim Update überschrieben | **Nein** (siehe Hook-Scope unten) |
| `commands/*.md` | `.claude/commands/*.md` | **Ja** — wie agents | **Nein** |
| `skills/*/SKILL.md` | `.claude/skills/*.md` | **Ja** — wie agents (Pfade unterscheiden sich zusätzlich strukturell: Subdir mit SKILL.md → flache `.md` mit Skill-Namen) | **Nein** |
| `.claude/rules/*.md` | `.claude/rules/*.md` | **Nein** — Pfad identisch, Source-Edit IST der Install-Edit | n/a |
| `.claude/scripts/*` | `.claude/scripts/*` | **Nein** — Pfad identisch | n/a |
| `.claude/hooks/*.sh` | `.claude/hooks/*.sh` | **Nein** — Pfad identisch | n/a |

Die Falle "editiere die falsche Kopie" existiert überall, wo Source- und Install-Pfade differieren — also bei `pipeline/`, den Stempel-Dateien, **und** bei `agents/`, `commands/`, `skills/`. Konsequenz dort ist gleich: `.claude/agents/orchestrator.md` direkt ändern → Änderung beim nächsten `setup.sh --update` weg, Source-Pfad `agents/orchestrator.md` ist der einzige stabile Edit-Punkt.

### Hook-Scope (was der Hook blockt vs. was er bewusst nicht blockt)

Der Hook blockt nur die drei oberen Zeilen (`.pipeline/**`, `.claude/.pipeline-version`, `.claude/.template-hash`). Die `.claude/{agents,commands,skills}/`-Pfade sind **nicht** blockiert — bewusst, weil:

1. T-988 schließt zuerst die Tür, die T-989 ausgelöst hat (`.pipeline/`-Edit + Stash-Pop → tagelang blockierter `git pull`).
2. `.claude/{agents,commands,skills}/`-Edits haben dieses Konflikt-Profil bisher nicht produziert; ein präventiver Block dort wäre Scope-Creep.
3. Eine spätere Iteration kann den Hook ausweiten (BLOCKED_PREFIXES erweitern), wenn die Falle in der Praxis Schaden anrichtet.

Bis dahin: **wenn du `.claude/agents/`, `.claude/commands/` oder `.claude/skills/` editierst und die Änderung soll überleben — editiere stattdessen die Source unter `agents/`, `commands/`, `skills/`** und lass `setup.sh --update` (oder den nächsten Pipeline-Run, der setup.sh implizit triggert) den Install-Pfad regenerieren. Der Hook warnt dich nicht — die Disziplin liegt bei dir.

## Kern-Regel

**Editier Sources, nicht Installs.** Für jede Datei mit unterschiedlichem Source- und Install-Pfad ist die Source der einzige Edit-Punkt:

- Pipeline-Logik → `pipeline/…`, nicht `.pipeline/…`.
- Agent-Definitionen → `agents/…`, nicht `.claude/agents/…`.
- Commands → `commands/…`, nicht `.claude/commands/…`.
- Skills → `skills/<name>/SKILL.md`, nicht `.claude/skills/<name>.md`.
- Stempel-Dateien (`.claude/.pipeline-version`, `.claude/.template-hash`) → nie hand-editieren, sie werden von `setup.sh` geschrieben.

`setup.sh --update` regeneriert alle Install-Pfade aus den Sources.

**Shared-path-Verzeichnisse** (`.claude/rules/`, `.claude/scripts/`, `.claude/hooks/`) haben in diesem Repo Source- und Install-Pfad identisch — da gibt's nichts zu verwechseln.

Der Hook enforced aktuell nur die Top-3 (`.pipeline/`, `.claude/.pipeline-version`, `.claude/.template-hash`) — das ist der T-988-Scope. `.claude/{agents,commands,skills}/`-Edits sind nicht blockiert, aber die Regel gilt trotzdem (s. Hook-Scope-Sektion oben).

## Die Leitplanke

Ein Git-Pre-Commit-Hook (`.githooks/pre-commit`) blockt jeden Commit, der Dateien unter den drei verbotenen Pfaden ändert. Der Hook armed sich nur wenn die Self-Install-Signatur erkannt wird (sowohl `pipeline/package.json` als auch `.pipeline/package.json` vorhanden). In Kunden-Projekten — die nur `.pipeline/` haben, keine `pipeline/`-Source — greift der Hook nicht. `setup.sh` setzt `git config core.hooksPath .githooks` beim Install/Update, damit der Hook ohne manuelle Konfiguration aktiv wird.

## Emergency override

Für den Ausnahmefall, wo die installierte Kopie tatsächlich manuell repariert werden muss (z.B. das T-989-Szenario: Index-State repariert, Working-Tree hat sich schon korrigiert, aber ein `git commit` als Aufräum-Commit soll durch), gibt es ein Umgehungs-Flag:

```bash
GIT_ALLOW_INSTALLED_EDIT=1 git commit -m "chore: ..."
```

Das Flag ist eine bewusste Entscheidung, nicht ein Default. Wer es setzt, weiß warum.

## Anti-Patterns

❌ `.pipeline/lib/load-skills.ts` öffnen und "nur kurz" ein Verhalten tweaken. Der Tweak ist weg beim nächsten `setup.sh --update`, und bis dahin verhält sich die installierte Engine anders als die Source-Engine.

❌ `.claude/.pipeline-version` manuell auf einen neueren Wert setzen, um "framework-version-check.md" zu befriedigen. Die Datei ist ein Stempel; ihn zu fälschen lügt über den tatsächlichen Install-Stand.

❌ `.claude/.template-hash` löschen oder setzen, weil `setup.sh` sonst "template geändert" meldet. Den Hash setzt `setup.sh` nach erfolgreichem Update — hand-setzen heißt setup.sh zu umgehen.

❌ `.claude/agents/orchestrator.md` (oder `.claude/commands/develop.md`, `.claude/skills/frontend-design.md`) direkt editieren. Der Hook warnt hier nicht, aber der nächste `setup.sh --update` kopiert die Source drüber und dein Edit ist weg. Edit-Punkt ist `agents/orchestrator.md` bzw. `commands/develop.md` bzw. `skills/frontend-design/SKILL.md`.

✅ Änderung an der Pipeline-Logik: `pipeline/run.ts` editieren, committen, `setup.sh --update` laufen lassen, den regenerierten `.pipeline/run.ts` im selben Repo verifizieren (Diff prüfen), dann pushen.

✅ Änderung an einer Rule / einem Script / einem Hook: `.claude/rules/<rule>.md`, `.claude/scripts/<script>`, `.claude/hooks/<hook>.sh` editieren — diese drei Verzeichnisse haben Source-Pfad = Install-Pfad, also kein Verwechslungspfad.

✅ Änderung an einem Agent / Command / Skill: `agents/<agent>.md`, `commands/<command>.md`, `skills/<skill>/SKILL.md` editieren. `setup.sh --update` regeneriert den Install unter `.claude/…`.

## Anti-Pattern: Source-Pfade in Runtime-Aufrufen

Slash-Commands, Hooks, und Scripts, die in **Konsumer-Repos** laufen müssen (also überall außer dem Engine-Repo selbst), dürfen ausschließlich **Install-Pfade** aufrufen — niemals Source-Pfade.

**Regel:**

| Wenn du aufrufen willst… | Nutze | NICHT |
|---|---|---|
| Den Pipeline-Runner | `bash "$REPO_ROOT/.pipeline/run.sh"` (oder `npx tsx .pipeline/run.ts`) | `bun run pipeline/run.ts` |
| Ein Pipeline-Script | `bash .claude/scripts/board-api.sh ...` | `bash scripts/board-api.sh ...` |
| Eine Agent-Definition (im Subagent-Spawn) | `Read('.claude/agents/{role}.md')` | `Read('agents/{role}.md')` |
| Eine Skill-Definition (im Subagent-Spawn) | `Read('.claude/skills/{name}.md')` | `Read('skills/{name}/SKILL.md')` |

**Warum:** Konsumer-Repos (`just-ship-board`, `supaflow`, jedes mit `setup.sh` installierte Projekt) haben **nur** den Install-Pfad. Source-Pfade wie `pipeline/`, `agents/`, `commands/`, `skills/` existieren dort schlicht nicht. Ein Aufruf gegen den Source-Pfad schlägt mit `No such file or directory` fehl, sobald das Konsumer-Projekt denselben Code ausführt.

Im **Engine-Repo** funktionieren beide Pfade (Source-Pfad existiert + Install-Pfad ist eine kopierte Kopie). Das ist genau die Falle: Ein Refactor, der nur im Engine-Repo getestet wird, sieht keinen Fehler — und bricht im selben Moment in jedem Konsumer-Projekt.

**Negativ-Beispiel (Incident T-1060, 2026-04-29):**

```markdown
# commands/develop.md (T-1060, kaputt in Konsumer-Repos)
cd "$WORKTREE_DIR" && bun run "$REPO_ROOT/pipeline/run.ts" develop \
  --ticket="$TICKET_NUMBER" --mode=local --worktree="$WORKTREE_DIR"
```

Zwei Bugs in einer Zeile: Source-Pfad `pipeline/` existiert nicht in Konsumer-Repos, und `bun` ist nicht universell installiert. Direkt nach Merge tagesgleich in Supaflow reproduziert: `command not found: bun`, dann `no pipeline/run.ts`.

**Positiv-Beispiel (T-1061-Fix):**

```markdown
# commands/develop.md (korrekt)
# Use install-path .pipeline/run.sh — works in engine + consumer repos, no bun required.
cd "$WORKTREE_DIR" && bash "$REPO_ROOT/.pipeline/run.sh" develop \
  --ticket="$TICKET_NUMBER" --mode=local --worktree="$WORKTREE_DIR"
```

`.pipeline/run.sh` ist ein Wrapper, der `exec npx tsx "$(dirname "$0")/run.ts" "$@"` macht — Node statt Bun, kein zusätzliches Tool nötig. Existiert in beiden Welten (im Engine-Repo per `setup.sh`-Install-in-self, im Konsumer per regulärem `setup.sh`).

## Historischer Kontext — T-989

Am 2026-04 hat jemand in `.pipeline/lib/load-skills.ts` editiert, die Änderung gestasht, auf einen anderen State gewechselt, und beim Stash-Pop gab es einen Konflikt. Der Konflikt wurde nie aufgelöst — die Stage-1/2/3-Einträge blieben im Index, sechs Rebase-Versuche scheiterten am selben Problem, zwei lokale Docs-Commits stauten sich, `git pull` blockierte tagelang. Die Reparatur (T-989) war trivial: `git checkout --ours`, die Stash-Version verwerfen, Rebase läuft durch. Aber das echte Problem war, dass die Source-vs-Install-Verwechslung überhaupt möglich war. Diese Rule plus der Commit-Hook (T-988) schließen die Tür.

## Self-Check vor dem ersten Edit

1. Liegt die Datei unter einem der **drei Hook-blockierten Pfade** (`.pipeline/`, `.claude/.pipeline-version`, `.claude/.template-hash`)? Falls ja: **STOP.** Source-Pfad ist `pipeline/…` (ohne Punkt), bzw. bei den Stempel-Dateien gar keiner — dann ist die Änderung ein `setup.sh`-Job, kein manueller Edit.
2. Liegt die Datei unter `.claude/agents/`, `.claude/commands/`, oder `.claude/skills/`? Falls ja: **STOP.** Der Hook warnt hier nicht, aber der Edit wird beim nächsten Update überschrieben. Edit-Punkt ist `agents/`, `commands/` oder `skills/<name>/SKILL.md`.
3. Falls keines von beidem: freie Fahrt (`.claude/rules/`, `.claude/scripts/`, `.claude/hooks/`, oder direkt in den Source-Verzeichnissen).
4. Schreibe ich gerade einen Pfad in einem Slash-Command, Hook, oder Script, der in einem Konsumer-Projekt laufen soll? Falls ja: `.pipeline/`, `.claude/scripts/`, `.claude/agents/`, `.claude/skills/` (Install-Pfade), niemals `pipeline/`, `agents/`, `commands/`, `skills/` (Source-Pfade). Source-Pfade existieren nur im Engine-Repo. Siehe Sektion "Anti-Pattern: Source-Pfade in Runtime-Aufrufen".

## Verwandte Regeln

- `framework-abstraction-check.md` — generelles Framework-vs-Project-vs-Runtime Level-Denken.
- `branch-check-before-edit.md` — komplementär: welche Branches darf ich überhaupt editieren.
- T-989 Fix-Summary — wie der letzte Incident aufgeräumt wurde.
