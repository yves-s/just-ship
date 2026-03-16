---
name: update-just-ship
description: CLAUDE.md und project.json gegen aktuelle Framework-Templates abgleichen und ergänzen
disable-model-invocation: true
---

# /update-just-ship — Projekt-Dateien aktualisieren

Gleicht `CLAUDE.md` und `project.json` gegen die aktuellen Framework-Templates ab und ergänzt fehlende Abschnitte/Felder. Wird nach `setup.sh --update` ausgeführt, wenn sich Templates geändert haben.

## Wichtigste Regel

**Bestehende projektspezifische Inhalte NIEMALS überschreiben oder entfernen.** Nur fehlende Abschnitte/Felder hinzufügen oder veraltete Framework-Referenzen aktualisieren.

## Ausführung

### 1. Framework-Pfad ermitteln

Lies `.claude/.pipeline-version` — falls vorhanden, bestätigt das eine aktive Installation.

Ermittle den Framework-Pfad: Prüfe ob `~/just-ship/` existiert (Standard-Installationspfad).
Falls nicht gefunden: Frage den User nach dem Pfad zum Framework-Verzeichnis.

### 2. Templates laden

Lies die aktuellen Templates aus dem Framework:
- `{framework}/templates/CLAUDE.md` — CLAUDE.md Template
- `{framework}/templates/project.json` — project.json Template (falls vorhanden)

Lies die aktuellen Projekt-Dateien:
- `CLAUDE.md`
- `project.json`

### 3. CLAUDE.md abgleichen

Vergleiche die Projekt-`CLAUDE.md` Abschnitt für Abschnitt gegen das Template.

**Für jeden Abschnitt im Template (identifiziert durch `##` Headings):**

| Situation | Aktion |
|-----------|--------|
| Abschnitt fehlt im Projekt komplett | Hinzufügen (mit projektspezifischem Inhalt wenn möglich) |
| Abschnitt existiert, hat TODO-Platzhalter | TODO ersetzen via Stack-Erkennung (wie `/setup-just-ship`) |
| Abschnitt existiert, hat projektspezifischen Inhalt | **NICHT anfassen** |
| Abschnitt existiert, aber Template-Version hat sich geändert (z.B. neue Workflow-Tabelle) | Framework-Teile aktualisieren, projektspezifische Teile beibehalten |

**Spezielle Behandlung — Ticket-Workflow-Tabelle:**
Die Workflow-Tabelle unter `## Ticket-Workflow` ist rein Framework-Content (keine projektspezifischen Anpassungen). Diese darf vollständig durch die Template-Version ersetzt werden. Erkenne sie am `| Workflow-Schritt | Board-Status | Wann |` Header.

**Spezielle Behandlung — Konversationelle Trigger:**
Der Abschnitt `## Konversationelle Trigger` ist Framework-Content. Darf durch Template-Version ersetzt werden.

**Spezielle Behandlung — Autonomer Modus:**
Der Abschnitt `## Autonomer Modus` ist Framework-Content. Darf durch Template-Version ersetzt werden.

### 4. project.json abgleichen

Lies die aktuelle `project.json`. Vergleiche gegen die erwartete Struktur:

```json
{
  "name": "",
  "description": "",
  "stack": {},
  "build": {
    "web": "",
    "dev": "",
    "test": ""
  },
  "paths": {},
  "supabase": {
    "project_id": ""
  },
  "pipeline": {
    "project_id": "",
    "project_name": null,
    "workspace_id": ""
  },
  "conventions": {
    "commit_format": "conventional",
    "language": "de"
  }
}
```

**Für jedes Feld:**

| Situation | Aktion |
|-----------|--------|
| Feld fehlt komplett | Hinzufügen mit Default-Wert |
| Feld existiert mit Wert | **NICHT anfassen** |
| Feld existiert ohne Wert (leer) | Beibehalten (User hat es bewusst leer gelassen oder es wurde noch nicht konfiguriert) |

**Falls `stack` oder `build` leer sind und `/setup-just-ship` noch nie gelaufen ist:** Hinweis geben dass `/setup-just-ship` den Stack automatisch erkennt.

### 5. Änderungen anzeigen

Zeige eine Zusammenfassung der Änderungen:

```
/update-just-ship abgeschlossen.

CLAUDE.md:
  ✓ Ticket-Workflow-Tabelle aktualisiert (/ticket → /develop Trennung)
  ✓ Abschnitt "Konversationelle Trigger" aktualisiert
  ~ Architektur — unverändert (projektspezifisch)

project.json:
  ✓ Feld "build.dev" hinzugefügt
  ~ Alle anderen Felder unverändert
```

Falls keine Änderungen nötig waren:
```
Alles aktuell — keine Änderungen nötig.
```

### 6. Template-Hash speichern

Speichere den aktuellen Template-Stand damit `setup.sh --update` beim nächsten Mal erkennen kann ob sich etwas geändert hat:

```bash
# In .claude/.template-hash schreiben
md5 -q {framework}/templates/CLAUDE.md > .claude/.template-hash
```
