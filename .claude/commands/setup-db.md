---
name: setup-db
description: Supabase-Datenbank einrichten — Tabellen erstellen, Projekt anlegen, project.json konfigurieren
disable-model-invocation: true
---

# /setup-db — Supabase-Datenbank einrichten

Richtet die Supabase-Datenbank für Ticket-Management ein.

## Voraussetzungen

- Supabase-Integration in Claude aktiviert: Settings → Integrations → Supabase
- Ein Supabase-Projekt existiert bereits

## Ausführung

### 1. Bestehende Konfiguration prüfen

Lies `project.json` und prüfe ob `supabase.project_id` bereits gesetzt ist.

**Falls bereits komplett konfiguriert** (project_id, user_id und project_name vorhanden):
- Sage: "Supabase ist bereits konfiguriert (Projekt: {project_name}). Migration erneut ausführen?"
- Falls der User bestätigt: weiter mit Schritt 3 (nur Migration)
- Falls nicht: abbrechen

### 2. Supabase-Projekt auswählen

Falls `supabase.project_id` leer ist:

1. `mcp__claude_ai_Supabase__list_projects` aufrufen
2. Projekte auflisten und User wählen lassen
3. Project-ID merken

### 3. Migration ausführen

Lies die SQL-Migration aus dem Framework:
- Datei: Finde die `migrations/001_create_tables.sql` im Framework-Verzeichnis (gleiche Ebene wie `commands/`)
- Lies den Inhalt der Datei

Führe die Migration via `mcp__claude_ai_Supabase__apply_migration` aus mit:
- `project_id`: die gewählte Supabase Project-ID
- `name`: "001_create_tables"
- `query`: der SQL-Inhalt der Migrationsdatei

### 4. Projekt anlegen

Frage: "Projektname für Ticket-Filterung? (leer = kein Projekt-Filter)"

Falls ein Name angegeben wird:
```sql
INSERT INTO public.projects (name)
VALUES ('{projekt_name}')
ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
RETURNING id, name;
```
Via `mcp__claude_ai_Supabase__execute_sql` ausführen.

Falls kein Name: `project_name` bleibt `null`.

### 5. User-ID generieren

Generiere eine zufällige UUID als Pipeline-Identifier:
```bash
python3 -c "import uuid; print(uuid.uuid4())"
```

Diese UUID identifiziert die Pipeline-Instanz (nicht ein Auth-User).

### 6. project.json aktualisieren

Schreibe folgende Werte in `project.json` unter `supabase`:
```json
"supabase": {
  "project_id": "{supabase_project_id}",
  "user_id": "{generierte_uuid}",
  "project_name": "{projekt_name_oder_null}"
}
```

Falls ein alter `notion`-Block existiert: beibehalten (Legacy), aber Supabase-Block hinzufügen/aktualisieren.

### 7. Bestätigung

```
DB eingerichtet.

  Supabase-Projekt: {project_id}
  Pipeline User-ID: {user_id}
  Projektname: {project_name || "(kein Filter)"}

/ticket funktioniert jetzt.
```
