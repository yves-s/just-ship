---
name: merge
description: Alles abschliessen — commit, push, PR, merge, zurück auf main. Vollständig autonom, NULL Rückfragen.
disable-model-invocation: true
---

# /merge — ALLES abschliessen, ein Befehl

Vom uncommitted Code bis zum gemergten PR auf main. **Ein Befehl, keine Unterbrechung.**

## WICHTIGSTE REGEL

**DU DARFST NICHT STOPPEN ODER FRAGEN.** Führe ALLE Schritte 1-7 hintereinander aus. Kein "Soll ich...?", kein "Möchtest du...?", kein "Ich habe committed, soll ich jetzt pushen?". EINFACH ALLES DURCHLAUFEN.

Falls du den Drang hast eine Frage zu stellen: **UNTERDRÜCKE IHN** und mach einfach den nächsten Schritt.

## NICHT verwenden

- NICHT den Skill `finishing-a-development-branch` aufrufen
- NICHT den User nach Optionen fragen
- NICHT nach Bestätigung fragen
- NICHT zwischen Schritten stoppen

## Konfiguration

Lies `project.json`. Supabase-Schritte NUR wenn `supabase.project_id` gesetzt ist.

## Trigger

- `/merge`
- "passt", "done", "sieht gut aus", "klappt", "fertig", "ship it", "mach zu"

## Ablauf — ALLE Schritte ohne Pause durchführen

### 1. Commit (falls nötig)

```bash
git status
```

Falls uncommitted changes:
```bash
git add <betroffene-dateien>
git commit -m "feat(#{ticket}): {englische Beschreibung}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

SOFORT WEITER ZU SCHRITT 2.

### 2. Push

```bash
git push -u origin $(git branch --show-current)
```

SOFORT WEITER ZU SCHRITT 3.

### 3. PR erstellen (falls keiner existiert)

```bash
gh pr view 2>/dev/null || gh pr create --title "feat(#{ticket}): {Beschreibung}" --body "$(cat <<'EOF'
## Summary
- {Bullet Points}

## Test plan
- {Was wurde getestet}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

SOFORT WEITER ZU SCHRITT 4.

### 4. Merge

```bash
gh pr merge --squash --delete-branch
```

SOFORT WEITER ZU SCHRITT 5.

### 5. Zurück auf main

```bash
git checkout main && git pull origin main
```

SOFORT WEITER ZU SCHRITT 6.

### 6. Supabase-Status auf "done" (nur wenn konfiguriert)

Via `mcp__claude_ai_Supabase__execute_sql`:
```sql
UPDATE public.tickets SET status = 'done', summary = '{summary}' WHERE number = {N} RETURNING number, title, status;
```

SOFORT WEITER ZU SCHRITT 7.

### 7. Bestätigung (EINZIGE Ausgabe an den User)

```
✓ Merged: feat(#{ticket}): {Beschreibung}
  PR: {url}
  Branch: {branch} → deleted
  Supabase: done (falls konfiguriert)
```

## Fehlerbehandlung

- **Pre-Commit Hook Failure:** Fixen, NEUEN Commit, weiter
- **Push rejected:** `git pull --rebase origin {branch}`, dann nochmal pushen
- **Merge-Konflikte:** NUR DANN dem User zeigen — das ist der EINZIGE Grund zum Stoppen
- **PR existiert bereits:** Überspringen, direkt mergen
- **Alles schon auf main:** Sagen "Bereits auf main, nichts zu tun"

## Verboten

- `git add -A` oder `git add .`
- `--force` push
- `--amend` bei Hook-Failure
- Fragen stellen
- Zwischen Schritten stoppen
- Den Skill `finishing-a-development-branch` aufrufen
