This repo is Just Ship bootstrapping itself: the framework **source** lives here, AND the framework is **installed** here so we can use `/ticket`, `/develop`, `/ship` while developing the framework. The two coexist in the filesystem — and they must not be confused. Editing the installed copy silently diverges it from the source and causes incidents like T-989 (2026-04 stash-pop conflict that blocked `git pull` for six rebase attempts).

## The topology

| Pfad (Source) | Pfad (Installiert) | Unterschied? |
|---|---|---|
| `pipeline/` | `.pipeline/` | **Ja** — Source mit, Install ohne führendem Punkt |
| `.claude/.pipeline-version` | — | **Nur Install** — Version-Stempel von `setup.sh`, keine Source-Datei |
| `.claude/.template-hash` | — | **Nur Install** — Template-Hash-Stempel von `setup.sh`, keine Source-Datei |
| `agents/*.md` | `.claude/agents/*.md` | Unterschiedlich, aber setup.sh installiert aus der Source — der Install-Pfad ist allein für Claude Code |
| `commands/*.md` | `.claude/commands/*.md` | Wie oben |
| `skills/*/SKILL.md` | `.claude/skills/*.md` | Wie oben |
| `.claude/rules/*.md` | `.claude/rules/*.md` | **Pfad identisch** — hier ist Editieren OK, weil Source und Install denselben Pfad teilen |
| `.claude/scripts/*` | `.claude/scripts/*` | Wie rules — identische Pfade, Source-Editierung ist der normale Weg |
| `.claude/hooks/*.sh` | `.claude/hooks/*.sh` | Wie rules |

Die drei problematischen Pfade sind genau die, bei denen Source und Install **unterschiedliche Dateisystem-Pfade** haben (`pipeline/` vs `.pipeline/`) oder bei denen **keine Source existiert** (die Stempel-Dateien). Dort — und nur dort — gibt es die Falle "editiere die falsche Kopie".

## Kern-Regel

**Niemals in `.pipeline/`, `.claude/.pipeline-version` oder `.claude/.template-hash` schreiben.** Diese Pfade sind Installer-Output. Wenn eine Änderung an Pipeline-Logik nötig ist, editiere `pipeline/` (die Source). `setup.sh --update` regeneriert `.pipeline/` daraus.

Alle anderen `.claude/`-Unterordner (`rules/`, `scripts/`, `hooks/`, `agents/`, `commands/`, `skills/`) haben in diesem Repo die Source **unter demselben Pfad** wie die Installation — da gibt's nichts zu verwechseln, da editierst du normal.

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

✅ Änderung an der Pipeline-Logik: `pipeline/run.ts` editieren, committen, `setup.sh --update` laufen lassen, den regenerierten `.pipeline/run.ts` im selben Repo verifizieren (Diff prüfen), dann pushen.

✅ Änderung an einer Rule oder einem Skill: `.claude/rules/<rule>.md` oder `skills/<skill>/SKILL.md` editieren — das ist gleichzeitig Source UND Install-Ziel, also kein Verwechslungspfad.

## Historischer Kontext — T-989

Am 2026-04 hat jemand in `.pipeline/lib/load-skills.ts` editiert, die Änderung gestasht, auf einen anderen State gewechselt, und beim Stash-Pop gab es einen Konflikt. Der Konflikt wurde nie aufgelöst — die Stage-1/2/3-Einträge blieben im Index, sechs Rebase-Versuche scheiterten am selben Problem, zwei lokale Docs-Commits stauten sich, `git pull` blockierte tagelang. Die Reparatur (T-989) war trivial: `git checkout --ours`, die Stash-Version verwerfen, Rebase läuft durch. Aber das echte Problem war, dass die Source-vs-Install-Verwechslung überhaupt möglich war. Diese Rule plus der Commit-Hook (T-988) schließen die Tür.

## Self-Check vor dem ersten Edit

1. Liegt die Datei unter `.pipeline/`, `.claude/.pipeline-version` oder `.claude/.template-hash`?
2. Falls ja: **STOP.** Was ist der Source-Pfad? Vermutlich derselbe ohne führenden Punkt (`pipeline/...`) oder gar nicht — dann ist die Änderung ein `setup.sh`-Job, kein manueller Edit.
3. Falls nein: freie Fahrt. Die Rule schützt exakt die drei genannten Pfade, nichts anderes.

## Verwandte Regeln

- `framework-abstraction-check.md` — generelles Framework-vs-Project-vs-Runtime Level-Denken.
- `branch-check-before-edit.md` — komplementär: welche Branches darf ich überhaupt editieren.
- T-989 Fix-Summary — wie der letzte Incident aufgeräumt wurde.
