Vor dem ersten `Edit` oder `Write` in einer Session musst du wissen, auf welchem Branch du bist. Auf `main` (oder `master`) in einem Pipeline-konfigurierten Projekt ist Schreiben ohne explizite Freigabe verboten — das ist die Leitplanke, die den Ticket-Workflow schützt.

`main` ist kein Arbeitsbranch. Code, der dort landet, ist einen PR-Merge von Prod entfernt. Ein versehentlicher Commit auf `main` kollidiert mit anderen Workers, bricht das Pipeline-Konto von `/develop` und `/ship`, und zementiert Workflow-Bypässe wie den Incident am 2026-04-21 (`docs/incidents/2026-04-21-workflow-bypass-design-lead.md`).

## Wann dieser Check triggert

**Vor dem ersten `Edit` oder `Write` in einer Session** — also bevor irgendein Datei-Inhalt im Projekt verändert wird. Einmal pro Session, nicht vor jedem einzelnen Edit. Der Check entfällt für reine Lesearbeit (Read, Glob, Grep, Bash mit read-only Commands), weil die keinen Prod-nahen State verändern.

Gilt nicht für:
- `.worktrees/T-*/`-Pfade — Worktrees haben per Definition einen Feature-Branch, der Check ist dort redundant.
- Temp-Files (`/tmp/`, `~/.claude/`, außerhalb des Repos) — die sind nicht Teil des Projekt-States.
- Explizite Commands wie `/ticket`, `/develop`, `/ship`, `/recover` — die machen ihren eigenen Branch-Handling (oder schreiben nichts).

## Was der Check tut

Der Check ist **read-only** — kein Bash-Aufruf im Session-Start, keine Network-Calls. Er läuft im Kopf des Assistants, nicht als automatisierter Hook. (Ein harter PreToolUse-Hook kommt in einem separaten Ticket.)

Ablauf:

1. **Aktuellen Branch ermitteln.** `git branch --show-current` via Bash — einmalig. Ergebnis cachen für die Session.
2. **Pipeline-Status prüfen.** `project.json` lesen: ist `pipeline.workspace_id` gesetzt?
3. **Entscheiden:**

| Branch | Pipeline konfiguriert | Aktion |
|---|---|---|
| `main` / `master` | Ja | **Hard-Stop.** Kein Edit, kein Write. Route über Sidekick-Intake oder frage nach Ticket/Branch. |
| `main` / `master` | Nein | **Soft-Stop.** Nenne dem User den Branch, hole Bestätigung, bevor du schreibst. |
| Feature-Branch (`feature/`, `fix/`, `chore/`, `docs/`) | beliebig | Weiter, kein Block. |
| Detached HEAD / unbekannt | beliebig | Nenne den State, frage nach Klarheit. |

## Hard-Stop-Flow (main + Pipeline)

Wenn du auf `main` bist und die Pipeline konfiguriert ist, und der User ohne `/ticket`/`/develop`-Kontext Arbeit anstößt:

1. Kein `Edit`, kein `Write`. Sofort unterbrechen.
2. Prüfe, ob die User-Eingabe ein Sidekick-Trigger ist (siehe `sidekick-terminal-routing.md`). Wenn ja → Sidekick-Intake-Flow laden (`skills/sidekick-intake/SKILL.md`), `⚡ Sidekick joined` ankündigen, klassifizieren.
3. Wenn die Eingabe kein Sidekick-Trigger ist (reine Wissensfrage, Status-Check, Diagnose), antworte ohne Edit — die Arbeit bleibt read-only.
4. Wenn unklar: eine einzige Frage an den User — "Ist auf `main`. Soll ich das als Ticket anlegen (`/ticket`) oder arbeitest du bewusst auf main (dann Branch bestätigen)?"

Sobald ein Feature-Branch steht (via `/develop` oder expliziter Branch-Switch), ist der Check für die Session erledigt.

## Ausnahme-Klausel

Der Hard-Stop gilt **nicht**, wenn der User explizit freigibt:

- "arbeite direkt auf main" / "work on main"
- "/develop --direct" oder vergleichbare explizite Direct-Mode-Flags
- "commit das direkt auf main" / "push to main directly"
- Framework-Governance-Commits, die der User explizit autorisiert hat (`setup.sh`-Updates, CHANGELOG-Fixes nach Merge, o.ä.)

Die Freigabe muss aus der aktuellen Session kommen, nicht aus einer früheren. Ein "arbeite auf main" von gestern zählt nicht.

## Was der Check NICHT ist

- Er ersetzt nicht `no-premature-merge.md` oder `ship-trigger-context.md`. Der Branch-Check verhindert das Schreiben auf `main`; die anderen Rules verhindern das Mergen ohne Freigabe. Alle drei zusammen sind der Schutz-Stack.
- Er ist kein automatischer Hook. Der Assistant muss den Check selbst durchführen — disziplinierte Selbst-Prüfung, nicht Infrastruktur.
- Er blockt nicht Read-Arbeit. Lesen, Grepen, Bash-Status-Checks sind immer erlaubt.

## Selbst-Check vor dem ersten Edit/Write

1. Habe ich den Branch geprüft? Falls nein, `git branch --show-current` jetzt.
2. Bin ich auf `main` oder `master`? Falls ja, ist die Pipeline konfiguriert?
3. Wenn Pipeline + main: existiert ein Ticket für diese Arbeit, oder ist Sidekick-Intake der richtige Schritt?
4. Wenn keines von beidem: habe ich eine explizite User-Freigabe, auf main zu arbeiten?

Erst wenn mindestens eine der Fragen 3 oder 4 mit Ja beantwortet ist, darf der erste Edit/Write laufen.

## Beispiele

### Beispiel 1 — Sidekick-Trigger auf main (Hard-Stop, Route zum Intake)

```
User: Design Lead, lass uns die Card-Buttons überarbeiten.
Branch: main · Pipeline: konfiguriert

Assistant-Flow:
1. git branch --show-current → main
2. Pipeline konfiguriert ✓
3. Eingabe = Sidekick-Trigger (Rollen-Anrede + Feature-Wunsch, siehe sidekick-terminal-routing.md).
4. Kein Edit. Sidekick-Intake-Skill laden, klassifizieren, Ticket erstellen.
```

### Beispiel 2 — Feature-Branch (Check passiert, weiter ohne Block)

```
User: Fix the typo in the header.
Branch: feature/T-123-header · Pipeline: konfiguriert

Assistant-Flow:
1. git branch --show-current → feature/T-123-header
2. Kein main/master ✓ → Check bestanden, weiter.
```

### Beispiel 3 — main, keine Pipeline (Soft-Stop)

```
User: Ändere den Intro-Text.
Branch: main · Pipeline: nicht konfiguriert (standalone-Projekt)

Assistant-Flow:
1. git branch --show-current → main
2. Pipeline nicht konfiguriert → Soft-Stop.
3. "Ich bin auf `main`. Soll ich direkt schreiben, oder erst einen Feature-Branch machen?"
4. Nach Freigabe: schreiben.
```

### Beispiel 4 — Explizite Direct-Mode-Freigabe

```
User: Arbeite direkt auf main, ist nur ein Typo.
Branch: main · Pipeline: konfiguriert

Assistant-Flow:
1. git branch --show-current → main
2. Pipeline konfiguriert, aber User hat "arbeite direkt auf main" gesagt → Ausnahme-Klausel greift.
3. Edit direkt.
```

## Incident-Referenz

Die Rule ist die direkte Antwort auf den Workflow-Bypass am 2026-04-21: Rollen-Anrede → Implementation-Skill ohne Branch-Check → fünf Dateibereiche uncommitted auf `main`. Vollständiger Report: `docs/incidents/2026-04-21-workflow-bypass-design-lead.md`.
