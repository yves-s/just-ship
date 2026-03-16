---
name: implement
description: Implementiere was gerade besprochen wurde — ohne Ticket, mit vollem Agent-Workflow
disable-model-invocation: true
---

# /implement — Implementieren ohne Ticket

Starte den vollen Agent-Workflow direkt aus dem Chat-Kontext oder einer expliziten Beschreibung.
Kein Board, kein Ticket, keine Status-Updates erforderlich.

## WICHTIGSTE REGEL

**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Alle Schritte 1–7 hintereinander ausführen.
Kein "Soll ich...?", kein "Möchtest du...?". ALLES DURCHLAUFEN.

## NICHT verwenden

- NICHT `/ship` aufrufen (würde automatisch mergen)
- NICHT `send-event.sh` aufrufen (kein Ticket, keine Event-IDs)
- NICHT auf Board-Status-Updates warten

## Konfiguration

Lies `project.json` für:
- Build- und Test-Commands (`build`, `test`)
- Stack-Details und Pfade

Pipeline-Config wird **ignoriert** — dieser Command läuft immer im Standalone-Modus.

## Ausführung

### 1. Spec ableiten

**Mit Argument (`/implement Beschreibung`):**
Nutze `$ARGUMENTS` direkt als Spec-Basis.

**Ohne Argument (`/implement`):**
Lies die aktuelle Konversation und destilliere eine kompakte Spec:
- Was wird gebaut?
- Welche Dateien/Bereiche sind betroffen?
- Was ist das gewünschte Verhalten / die Acceptance Criteria?

Falls kein klares Implementierungsziel ableitbar (leere Session, themenfremdes Gespräch, mehrere widersprüchliche Themen):
**STOP** — Ausgabe: "Ich konnte kein klares Implementierungsziel aus dem Chat ableiten. Bitte beschreibe kurz, was gebaut werden soll."

**Spec ausgeben** (immer, egal ob aus Argument oder Chat abgeleitet):
```
▶ Spec: {einzeiliges Summary}
  Ziel: {Was wird gebaut}
  Bereich: {Betroffene Dateien/Komponenten}
```

Danach SOFORT weiter — kein Warten auf Bestätigung.

### 2. Feature-Branch erstellen

Branch-Prefix aus Spec ableiten:
- Spec enthält "bug", "fix", "fehler" → `fix/`
- Spec enthält "chore", "refactor", "cleanup", "deps" → `chore/`
- Spec enthält "docs" → `docs/`
- Alles andere → `feature/`

`{slug}` = kurze Kebab-Case-Zusammenfassung der Spec (max. 5 Wörter)

```bash
git checkout main && git pull origin main
git checkout -b {prefix}/{slug}
```

### 3. Planung (SELBST, kein Planner-Agent)

**Lies nur die 5–10 betroffenen Dateien** direkt mit Read/Glob/Grep.
Lies `CLAUDE.md` für Architektur und Konventionen.
Lies `project.json` für Pfade und Stack-Details.

**Dann: Instruktionen für Agents formulieren** — mit exakten Code-Änderungen und neuen Dateien direkt im Prompt.

### 4. Implementierung (parallel wo möglich)

Spawne Agents via Agent-Tool mit konkreten Instruktionen:

| Agent | `model` | Wann |
|-------|---------|------|
| `data-engineer` | `haiku` | Bei Schema-Änderungen |
| `backend` | `sonnet` | Bei API/Hook-Änderungen |
| `frontend` | `sonnet` | Bei UI-Änderungen |

**Ausgabe vor Agent-Start:** `▶ [{agent-type}] — {was der Agent macht}`
**Ausgabe nach Agent-Ende:** `✓ [{agent-type}] abgeschlossen`

**Prompt-Muster:** Exakte Dateiliste + Code-Snippets, NICHT "lies die Spec".

### 5. Build-Check (Bash, kein Agent)

Ausgabe: `▶ build-check — {build command}`

Lies Build-Commands aus `project.json` und führe sie aus.

Nur bei Build-Fehlern: DevOps-Agent spawnen (model: `haiku`) um Fehler zu beheben.
Ausgabe: `▶ devops — Build-Fehler beheben`

**NICHT STOPPEN.** SOFORT weiter zu Schritt 6.

### 6. Review (ein Agent)

Ausgabe: `▶ qa — Acceptance Criteria & Security prüfen`

Ein QA-Agent (model: `haiku`):
- Acceptance Criteria gegen Code prüfen
- Security-Quick-Check (Secrets, RLS, Auth, Input Validation)
- Bei Problemen: direkt fixen

Ausgabe nach Abschluss: `✓ qa abgeschlossen`

**NICHT STOPPEN.** SOFORT weiter zu Schritt 7.

### 7. Abschließen — Commit + Push + PR (KEIN Merge)

```bash
git status
```

Falls uncommitted changes:
```bash
git add <betroffene-dateien>
git commit -m "feat: {englische Beschreibung}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Push:
```bash
git push -u origin $(git branch --show-current)
```

PR erstellen (kein Merge):
```bash
gh pr view 2>/dev/null || gh pr create \
  --title "feat: {Beschreibung}" \
  --body "$(cat <<'EOF'
## Summary
- {Bullet Points}

## Test plan
- {Was wurde getestet}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**NICHT mergen.** Der PR bleibt offen bis der User freigibt (via `/ship` oder "passt").

### Abschluss-Ausgabe

```
✓ Implementiert: {Beschreibung}
  Branch: {branch-name}
  PR: {url}
  → Zum Mergen: /ship oder "passt"
```

## Hinweis: Board-Integration nachträglich

Falls du das Ergebnis doch im Board tracken willst:
- `/ticket` auf diesem Branch aufrufen → erstellt Ticket und verknüpft es
