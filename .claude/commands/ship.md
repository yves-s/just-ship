---
name: ship
description: Commit, Push, PR erstellen, Supabase "in_review". Vollständig autonom, NULL Rückfragen.
disable-model-invocation: true
---

# /ship — PR erstellen (ohne Merge)

Commit → Push → PR. Merged wird erst nach Freigabe via `/merge`.

## WICHTIGSTE REGEL

**DU DARFST NICHT STOPPEN ODER FRAGEN.** Führe ALLE Schritte 1-5 hintereinander aus. Kein "Soll ich...?", kein "Möchtest du...?". EINFACH ALLES DURCHLAUFEN.

## NICHT verwenden

- NICHT den Skill `finishing-a-development-branch` aufrufen
- NICHT den User nach Optionen fragen

## Konfiguration

Lies `project.json`. Pipeline-Schritte NUR wenn `pipeline.project_id` gesetzt ist.

## Trigger

- `/ship`
- Phase 5 des Orchestrator-Workflows

## Ablauf — ALLE Schritte ohne Pause durchführen

### 1. Commit

```bash
git add <betroffene-dateien>
git commit -m "feat(#{ticket}): {kurze englische Beschreibung}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

SOFORT WEITER ZU SCHRITT 2.

### 2. Push

```bash
git push -u origin $(git branch --show-current)
```

SOFORT WEITER ZU SCHRITT 3.

### 3. PR erstellen

```bash
gh pr create --title "feat(#{ticket}): {Beschreibung}" --body "$(cat <<'EOF'
## Summary
- {Bullet Points}

## Test plan
- {Was wurde getestet}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

SOFORT WEITER ZU SCHRITT 4.

### 4. Pipeline-Status auf "in_review" (nur wenn konfiguriert)

Via `mcp__claude_ai_Supabase__execute_sql` mit `pipeline.project_id`:
```sql
UPDATE public.tickets
SET status = 'in_review'
WHERE number = {N}
  AND workspace_id = '{pipeline.workspace_id}'
RETURNING number, title, status;
```

SOFORT WEITER ZU SCHRITT 5.

### 5. Bestätigung (EINZIGE Ausgabe an den User)

```
✓ Shipped: feat(#{ticket}): {Beschreibung}
  PR: {url}
  Board: in_review (falls konfiguriert)

→ Nach Review: "passt" oder /merge zum Mergen
```

## Verboten

- `git add -A` oder `git add .`
- `--force` push
- Fragen stellen
- Zwischen Schritten stoppen
- Den Skill `finishing-a-development-branch` aufrufen
- Automatisch mergen
