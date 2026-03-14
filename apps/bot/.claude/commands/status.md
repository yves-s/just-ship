---
name: status
description: /status — Aktuellen Stand anzeigen
disable-model-invocation: true
---

# /status — Aktuellen Stand anzeigen

Zeige eine Übersicht des aktuellen Arbeitsstands.

## Konfiguration

Lies `project.json` für Supabase-Config (`supabase.project_id`, `supabase.project_name`).

## Ausführung (direkt in der Hauptsession — kein Sub-Agent nötig)

### 1. Supabase-Ticket

> **Nur wenn Supabase konfiguriert ist** (`supabase.project_id` in `project.json` gesetzt).

Falls `supabase.project_name` gesetzt ist:
```sql
SELECT number, title, status, priority
FROM public.tickets
WHERE status = 'in_progress'
  AND project_id = (SELECT id FROM public.projects WHERE name = '{project_name}');
```

Falls `supabase.project_name` null ist:
```sql
SELECT number, title, status, priority
FROM public.tickets
WHERE status = 'in_progress'
  AND project_id IS NULL;
```

Via `mcp__claude_ai_Supabase__execute_sql` mit `project_id` aus project.json.

Zeige:
- Ticket-Titel
- Status
- Priorität

### 2. Git-Status

Zeige via Bash:
- Aktueller Branch (`git branch --show-current`)
- Geänderte Dateien (`git diff --stat`)
- Uncommitted Changes Anzahl

### 3. Zusammenfassung

Zeige eine kompakte Übersicht:

```
Ticket: {ID} — {Titel}
Status: {status}
Branch: {git branch}
Änderungen: {N Dateien geändert}
```

### Hinweise
- Dieser Command ist rein informativ — er ändert nichts
- Falls kein Ticket aktiv ist, sage das
