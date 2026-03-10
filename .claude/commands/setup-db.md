---
name: setup-db
description: Projekt mit dem Agentic Dev Board verbinden — Workspace & Projekt anlegen, project.json konfigurieren
disable-model-invocation: true
---

# /setup-db — Agentic Dev Board verbinden

Verbindet dieses Projekt mit dem Agentic Dev Board. Legt Workspace und Projekt an falls nötig, schreibt alles automatisch in `project.json`.

## Voraussetzungen

Supabase MCP muss in Claude Code verbunden sein:
→ Claude Code Settings → Integrations → Supabase → Connect

Falls nicht verbunden: Erkläre dem User wie er das aktiviert, dann abbrechen.

## Ausführung

### 1. Bestehende Konfiguration prüfen

Lies `project.json`. Falls `pipeline.project_id` bereits gesetzt ist:
- Zeige: "Pipeline bereits konfiguriert: Projekt '{pipeline.project_name}' in Workspace {pipeline.workspace_id}"
- Frage: "Neu konfigurieren? (j/N)"
- Falls nein: abbrechen

### 2. Supabase-Projekt des Dev Boards wählen

Rufe `mcp__claude_ai_Supabase__list_projects` auf.

Falls mehrere Projekte: Liste aufzeigen, User wählen lassen.
Falls nur eines: Automatisch nehmen.

Merke die `project_id`.

### 3. Workspace auswählen oder anlegen

Via `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT id, name, slug FROM public.workspaces ORDER BY created_at ASC;
```

**Falls Workspaces vorhanden:** Liste anzeigen + Option "Neuen Workspace anlegen"

**Falls User einen bestehenden wählt:** Diese `workspace_id` verwenden.

**Falls User neuen Workspace anlegt:**
```sql
INSERT INTO public.workspaces (name, slug)
VALUES ('{name}', '{slug}')
RETURNING id, name, slug;
```
Slug = name in lowercase, Leerzeichen → Bindestriche, nur a-z 0-9 -.

### 4. Projekt auswählen oder anlegen

```sql
SELECT id, name FROM public.projects
WHERE workspace_id = '{workspace_id}'
ORDER BY name;
```

**Falls Projekte vorhanden:** Liste anzeigen + Option "Neues Projekt anlegen"

**Falls User ein bestehendes wählt:** Diese `project_id` und `project_name` verwenden.

**Falls User neues Projekt anlegt:**
Frage: "Projektname:"
```sql
INSERT INTO public.projects (workspace_id, name)
VALUES ('{workspace_id}', '{name}')
RETURNING id, name;
```

### 5. API Key anlegen (optional)

Frage: "API Key für Agent-Event-Hooks generieren? (empfohlen) (J/n)"

Falls ja:
```sql
INSERT INTO public.api_keys (workspace_id, name, key_hash, key_prefix, created_by)
VALUES (
  '{workspace_id}',
  '{project_name} Pipeline',
  encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
  'adb_',
  (SELECT id FROM auth.users LIMIT 1)
)
RETURNING id, key_prefix;
```

Hinweis: Der vollständige API Key kann nur im Board-UI unter Settings → API Keys eingesehen werden.

### 6. project.json schreiben

Schreibe folgende Werte in `project.json` unter `pipeline`:
```json
"pipeline": {
  "project_id": "{supabase_project_id}",
  "project_name": "{projekt_name}",
  "workspace_id": "{workspace_id}"
}
```

### 7. Bestätigung

```
Pipeline verbunden.

  Board-Projekt : {project_name}
  Workspace     : {workspace_name}
  Supabase      : {project_id}

/ticket funktioniert jetzt.
```
