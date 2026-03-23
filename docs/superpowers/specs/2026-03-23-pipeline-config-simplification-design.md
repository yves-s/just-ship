# Pipeline Config Vereinfachung

> Redundanz aus der Pipeline-Konfiguration entfernen. Zwei IDs pro Projekt, eine globale Board-URL, Secrets nur in der globalen Config.

## Problem

Die aktuelle Pipeline-Konfiguration hat mehrere Redundanzen:

- `api_url` / `board_url` wird pro Workspace gespeichert, obwohl es nur ein Board gibt (`https://board.just-ship.io`)
- `project_name` in `project.json` ist oft `null` und wird nirgends gebraucht
- `workspace` (Slug) als Referenz in `project.json` ist instabil — Slugs können sich aendern, UUIDs nicht
- Credential-Aufloesung hat einen 3-stufigen Fallback-Wasserfall (neues Format → altes Format → Legacy Supabase)
- Workspace-Eintraege in der globalen Config speichern `workspace_id` als Feld statt als Key

## Neues Format

### `project.json` (pro Projekt, committable, keine Secrets)

```json
{
  "pipeline": {
    "workspace_id": "421dffa5-5f2e-44a8-bdc1-7e0f31a87149",
    "project_id": "2d1ef2aa-376b-4b84-b631-7c5dc7de6ffc"
  }
}
```

Entfaellt: `workspace`, `workspace_slug`, `project_name`, `api_url`, `api_key`

### `~/.just-ship/config.json` (global, Secrets)

```json
{
  "board_url": "https://board.just-ship.io",
  "default_workspace": "421dffa5-5f2e-44a8-bdc1-7e0f31a87149",
  "workspaces": {
    "421dffa5-5f2e-44a8-bdc1-7e0f31a87149": {
      "slug": "agentic-dev",
      "api_key": "adp_..."
    }
  }
}
```

Aenderungen vs. aktuell:
- `board_url` einmal global statt pro Workspace
- Workspace-Key ist die UUID statt des Slugs
- `workspace_id` entfaellt als Feld (ist der Key)
- `board_url` entfaellt pro Workspace
- `default_workspace` referenziert UUID statt Slug

## Credential-Aufloesung

Alle Commands (`/develop`, `/ship`, `/ticket`) nutzen denselben Pfad:

```
1. project.json lesen → pipeline.workspace_id
2. Global config lesen:
   - board_url = config.board_url
   - api_key = config.workspaces[workspace_id].api_key
3. API-Calls: curl -H "X-Pipeline-Key: {api_key}" "{board_url}/api/..."
```

Fallback-Stufen:
1. `workspace_id` + `project_id` gesetzt → Board API (Normalfall)
2. Nur `project_id` ohne `workspace_id`, und project_id hat keine Bindestriche → Legacy Supabase MCP, Warnung ausgeben
3. Nichts gesetzt → Standalone-Modus

Der alte Fallback "api_url und api_key direkt in project.json" entfaellt komplett.

## Token-Handling (`jsp_`)

Token-Format bleibt unveraendert: `{ v, b, w, i, k }`. Kein Breaking Change am Board.

`connect` Command interpretiert:
- `i` (workspace_id) → Key in `config.workspaces`
- `k` (api_key) → Wert in Workspace-Eintrag
- `w` (workspace slug) → `slug` Feld im Workspace-Eintrag
- `b` (board_url) → setzt `config.board_url` falls noch nicht vorhanden

## Migration

`write-config.sh migrate` erkennt automatisch welches Format vorliegt und transformiert entsprechend.

### Pfad A: Altes Format (Credentials direkt in `project.json`, keine globale Config)

`project.json` hat `pipeline.api_url`, `pipeline.api_key`, `pipeline.workspace_id`:

1. Globale Config erstellen/erweitern:
   - `config.board_url` = `pipeline.api_url`
   - Neuer Eintrag: `config.workspaces[pipeline.workspace_id] = { api_key: pipeline.api_key }`
2. `project.json` aufraemen:
   - Setze `pipeline.workspace_id` (bleibt, ist schon UUID)
   - Entferne: `api_url`, `api_key`, `project_name`
   - Behalte: `project_id`

### Pfad B: Zwischenformat (Slug in `project.json`, Slug-Keys in globaler Config)

`project.json` hat `pipeline.workspace` (Slug), globale Config hat Slug-Keys:

1. Globale Config transformieren:
   - Fuer jeden Workspace-Eintrag (Key = Slug):
     - Lese `workspace_id` aus dem Eintrag
     - Erstelle neuen Eintrag: `config.workspaces[workspace_id] = { slug: alter_key, api_key }`
     - Loesche alten Slug-Key-Eintrag
   - `config.board_url` aus dem ersten Workspace der eine `board_url` hat
   - `default_workspace`: Slug → UUID uebersetzen
2. `project.json` aufraemen:
   - `pipeline.workspace` (Slug) → Lookup in migrierter Config → `pipeline.workspace_id` (UUID)
   - Entferne: `workspace`, `workspace_slug`, `api_url`, `api_key`, `project_name`
   - Behalte: `project_id`

### Erkennung

Automatische Format-Erkennung:
- `pipeline.api_key` in `project.json` → Pfad A
- `pipeline.workspace` (String ohne Bindestriche) in `project.json` → Pfad B
- `pipeline.workspace_id` (UUID mit Bindestrichen) → bereits migriert, nichts tun
- Globale Config: Key ist UUID (enthaelt Bindestriche) → bereits migriert; Key ist Slug → migrieren

## write-config.sh Commands

### `add-workspace`

Aktuell: `--slug, --board, --workspace-id, --key`
Neu: `--workspace-id, --key, --slug (optional), --board (optional)`

- `--workspace-id` wird zum Pflichtfeld (ist der Key)
- `--slug` ist optional (Metadaten)
- `--board` ist optional — setzt `config.board_url` falls noch nicht vorhanden, sonst ignoriert
- Slug-Kollisions-Check entfaellt (Key ist jetzt UUID, keine Kollision moeglich)

### `set-project`

Aktuell: `--workspace (slug), --project-id, --project-name (optional)`
Neu: `--workspace-id, --project-id`

- `--workspace-id` statt `--workspace`
- `--project-name` entfaellt
- Schreibt `pipeline.workspace_id` und `pipeline.project_id` in `project.json`
- Entfernt alte Felder (`workspace`, `api_url`, `api_key`, `project_name`)

### `read-workspace`

Aktuell: `--slug` → sucht nach Slug-Key
Neu: `--id` → sucht nach UUID-Key, `--slug` als Fallback (iteriert ueber Eintraege)

Output: `{ workspace_id, slug, api_key, board_url }` (board_url aus globalem Feld)

`read-workspace` ist die kanonische Quelle fuer Credentials. Commands und Scripts (`send-event.sh`, etc.) sollten `read-workspace` aufrufen statt eigene Config-Parsing-Logik zu implementieren.

### `connect`

Token-Parsing bleibt gleich. Aenderungen:
- `add-workspace` mit `--workspace-id` statt `--slug` als Key
- `set-project` mit `--workspace-id` statt `--workspace`
- Slug wird als Metadaten mitgespeichert
- `board_url` aus Token setzt globale `config.board_url`

### `migrate`

Komplett ueberarbeitet — transformiert sowohl globale Config als auch `project.json` wie oben beschrieben.

### `remove-board`

Bleibt funktional gleich — Parameter aendert sich von `--slug` zu `--id`.

### `parse-jsp`

Keine Aenderung — gibt weiterhin alle Token-Felder aus.

## Betroffene Dateien

### Scripts

| Datei | Aenderung |
|---|---|
| `.claude/scripts/write-config.sh` | Alle Commands auf neues Format (UUID-Keys, globale board_url) |
| `scripts/write-config.sh` | Identische Kopie — synchron halten mit `.claude/scripts/write-config.sh` |
| `.claude/scripts/send-event.sh` | `workspace_id` statt `workspace`, Lookup per UUID-Key, `board_url` aus Top-Level |

### Pipeline SDK

| Datei | Aenderung |
|---|---|
| `pipeline/lib/config.ts` | `WorkspaceEntry` Interface: `workspace_id` entfaellt (ist Key), `board_url` entfaellt (ist global). `loadProjectConfig()`: liest `pipeline.workspace_id` statt `pipeline.workspace`, Lookup per UUID-Key, `board_url` aus `globalConfig.board_url` |

### Commands

| Datei | Aenderung |
|---|---|
| `commands/develop.md` | Credential-Aufloesung: `workspace_id` statt `workspace`, kein altes-Format-Fallback |
| `commands/ship.md` | Credential-Aufloesung: `workspace_id` statt `workspace`, kein altes-Format-Fallback |
| `commands/setup-just-ship.md` | Connect-Flow: `set-project --workspace-id`, kein `project_name` |
| `commands/connect-board.md` | Pruefe `workspace_id` statt `workspace`, `set-project --workspace-id` |
| `commands/disconnect-board.md` | `remove-board --id` statt `--slug` |
| `commands/add-project.md` | `set-project --workspace-id` statt `--workspace`, kein `--project-name` |

### Skills

| Datei | Aenderung |
|---|---|
| `skills/ticket-writer.md` | Credential-Aufloesung: `workspace_id` statt `workspace`, kein altes-Format-Fallback |

### Config & Templates

| Datei | Aenderung |
|---|---|
| `project.json` | Migrieren auf neues Format |
| `templates/project.json` | Template: nur `workspace_id` + `project_id` |
| `templates/CLAUDE.md` | Ticket-Workflow: Board API statt SQL, `workspace_id` statt `workspace` Slug |
| `CLAUDE.md` | Ticket-Workflow SQL-Beispiel aktualisieren (nutzt jetzt Board API statt SQL) |
| `vps/README.md` | Config-Beispiel aktualisieren (neue Struktur) |

## Hinweise

### Slug-Anzeige

Der Slug wird als Metadaten im Workspace-Eintrag gespeichert (`slug` Feld) und fuer menschenlesbare Ausgaben verwendet (z.B. "Workspace 'agentic-dev' verbunden" statt einer UUID). Der Slug kommt ueber den `connect`-Flow aus dem `jsp_`-Token und wird nie als Lookup-Key verwendet.

### Workspace-ID nicht gefunden

Falls `project.json` eine `workspace_id` enthaelt die nicht in der globalen Config existiert: Fehlermeldung mit Hinweis auf `just-ship connect`. Kein Fallback auf `default_workspace` — das wuerde stillschweigend das falsche Projekt verbinden.

## Nicht betroffen

- Board-seitiger Code (Token-Generierung, API-Endpoints)
- Agent-Definitionen
