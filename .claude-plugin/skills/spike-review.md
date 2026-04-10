---
name: just-ship:spike-review
description: Spike-Ergebnis reviewen — Zusammenfassung anzeigen, Follow-Up-Tickets erstellen, Spike-Ticket abschliessen
---

# /spike-review — Spike-Ergebnis reviewen und Follow-Up-Tickets erstellen

Reviewe ein abgeschlossenes Spike-Ticket: Spike-Dokument finden, Zusammenfassung anzeigen, Implementation Steps in Ticket-Entwuerfe umwandeln, und den Spike abschliessen.

## Konfiguration

Lies `project.json` fuer Pipeline-Config.

**Pipeline (optional):** Falls `pipeline.workspace_id` gesetzt → `board-api.sh` verwenden:
```bash
bash .claude/scripts/board-api.sh get "tickets/{N}"
bash .claude/scripts/board-api.sh post tickets '{"title": "...", "body": "..."}'
```
Credentials werden intern aufgelöst.

Falls keine Pipeline konfiguriert: Ticket-Status-Updates und Ticket-Erstellung ueberspringen, nur Zusammenfassung anzeigen.

## Zwei Modi

### Modus 1: Interaktiv (Operator-driven)

Der Operator reviewed die Zusammenfassung, bestaetigt oder verwirft den Vorschlag, und entscheidet ueber Follow-Up-Tickets. Jeder Schritt wartet auf Bestaetigung.

### Modus 2: Autonom (Pipeline-driven)

Erkennung: Falls `$ARGUMENTS` das Wort `--auto` enthaelt, laeuft der Flow vollstaendig autonom. Alle Entwuerfe werden ohne Rueckfrage als Tickets erstellt, der Spike wird automatisch geschlossen.

## Ablauf

### 1. Ticket identifizieren

`$ARGUMENTS` enthaelt die Ticket-Nummer (z.B. `T-472`, `472`, oder `T-472 --auto`).

**Guard:** Falls kein Argument uebergeben → Fehlermeldung: `Bitte eine Ticket-Nummer angeben: /spike-review T-{N}`

Nummer extrahieren und validieren:
```bash
# Trim whitespace
ARG=$(echo "$ARGUMENTS" | xargs)
if [ -z "$ARG" ]; then
  echo "Bitte eine Ticket-Nummer angeben: /spike-review T-{N}"
  exit 1
fi

# Remove --auto flag if present
TICKET_ARG=$(echo "$ARG" | sed 's/ *--auto.*//')
AUTO_MODE=$(echo "$ARG" | grep -q "\-\-auto" && echo "true" || echo "false")

# Extract number, accept both T-472 and 472 format
TICKET_NUM=$(echo "$TICKET_ARG" | sed 's/^T-//' | grep -oE '^[0-9]+$')
if [ -z "$TICKET_NUM" ]; then
  echo "Ungueltige Ticket-Nummer: $TICKET_ARG. Erwartet: T-472 oder 472"
  exit 1
fi
```

Falls Pipeline konfiguriert — Ticket-Daten laden:

**Board API (bevorzugt):**
```bash
bash .claude/scripts/board-api.sh get "tickets/{N}"
```

**Legacy Supabase MCP (Fallback):**
```sql
SELECT * FROM public.tickets WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}';
```

Ausgabe: `▶ Spike T-{N}: {title}`

### 2. Spike-Dokument finden

Suche in `docs/spikes/` nach dem Spike-Dokument:

```bash
# Pattern 1: Ticket-Nummer im Dateinamen (z.B. 472-monitoring-solution.md, T-472-*.md)
find docs/spikes/ -name "*{N}*" -type f 2>/dev/null

# Pattern 2: Alle Dateien in docs/spikes/ durchsuchen nach Ticket-Referenz im Inhalt
grep -rl "T-{N}" docs/spikes/ 2>/dev/null
```

**Mehrere Treffer:** Den neuesten nehmen (nach Aenderungsdatum).

**Kein Treffer:** Fehlermeldung:
```
Kein Spike-Dokument fuer T-{N} gefunden.

Erwartet: docs/spikes/{N}-*.md oder docs/spikes/T-{N}-*.md
Alternativ: eine Datei in docs/spikes/ die "T-{N}" im Inhalt referenziert.
```
→ Stoppen.

Ausgabe: `✓ Spike-Dokument gefunden: {dateiname}`

### 3. Zusammenfassung erstellen und anzeigen

Lies das Spike-Dokument vollstaendig mit dem Read-Tool.

Erstelle eine kompakte Zusammenfassung:

```
## Spike-Review: T-{N} — {title}

**Dokument:** {dateiname}
**Status:** {status aus Dokument-Header, z.B. "Complete"}

### Kernfrage
{Was wurde untersucht — 1-2 Saetze}

### Ergebnis
{Die wichtigsten Findings als Bullet Points — max 5}

### Empfehlung
{Die empfohlene Loesung — 2-3 Saetze}
```

Falls das Dokument eine **"Implementation Steps"** oder **"Implementation"** Sektion enthaelt:

```
### Implementation Steps (aus Spike)
{Die Schritte woertlich aus dem Dokument}
```

Zeige die Zusammenfassung dem Operator an.

### 4. Follow-Up-Tickets vorbereiten

Falls das Spike-Dokument eine **"Implementation Steps"** oder **"Implementation"** Sektion enthaelt:

Fuer jeden Schritt einen Ticket-Entwurf erstellen:

- **Titel:** Aus dem Step-Text ableiten (aktionsorientiert, max 80 Zeichen)
- **Body:** Markdown mit:
  - `## Context` — Referenz auf den Spike: "Follow-up from Spike T-{N}: {spike-title}"
  - `## Problem` — Was dieser Schritt addressiert
  - `## Desired Behavior` — Was nach Abschluss anders ist
  - `## Acceptance Criteria` — Ableitbar aus dem Step-Text, testbar formuliert
  - `## Out of Scope` — Andere Implementation Steps die NICHT in diesem Ticket enthalten sind
- **Priority:** `medium` (default, Operator kann aendern)
- **Tags:** `["spike-followup", "{relevante-tags-aus-spike}"]`
- **Status:** `backlog`

Nummeriere die Entwuerfe: `Draft 1/N`, `Draft 2/N`, etc.

Zeige alle Entwuerfe kompakt an:

```
### Follow-Up-Tickets (aus Implementation Steps)

**Draft 1/{N}:** {Titel}
  ACs: {Kurzform der Acceptance Criteria}

**Draft 2/{N}:** {Titel}
  ACs: {Kurzform der Acceptance Criteria}

...
```

Falls **keine Implementation Steps** vorhanden: Ueberspringen, direkt zu Schritt 5.

### 5. Bestaetigung und Ticket-Erstellung

#### Modus: Interaktiv

```
{N} Follow-Up-Tickets vorbereitet. Wie weiter?

a) Alle erstellen und Spike abschliessen
b) Tickets anzeigen und einzeln bearbeiten
c) Spike abschliessen ohne Follow-Up-Tickets
d) Abbrechen (Spike bleibt offen)
```

- **Option a:** Alle Tickets erstellen (Schritt 6), dann Spike schliessen (Schritt 7).
- **Option b:** Jeden Entwurf einzeln anzeigen. Der Operator kann pro Entwurf: erstellen, bearbeiten, oder ueberspringen. Danach Spike schliessen.
- **Option c:** Direkt zu Schritt 7 (Spike schliessen).
- **Option d:** Stoppen. Keine Aenderungen.

Falls keine Implementation Steps vorhanden waren:

```
Keine Implementation Steps im Spike gefunden.

a) Spike abschliessen (Status: done)
b) Abbrechen (Spike bleibt offen)
```

#### Modus: Autonom (`--auto`)

Falls Implementation Steps vorhanden: Alle Tickets erstellen (Schritt 6) und Spike schliessen (Schritt 7) ohne Rueckfrage.

Falls **keine** Implementation Steps vorhanden: Spike trotzdem schliessen (Schritt 7) ohne Rueckfrage.

### 6. Tickets erstellen

Falls Pipeline konfiguriert — Tickets via Board API oder Supabase erstellen:

**Board API (bevorzugt):**
```bash
bash .claude/scripts/board-api.sh post tickets '{
  "title": "{ticket_title}",
  "body": "{ticket_body_markdown}",
  "priority": "medium",
  "tags": ["spike-followup"],
  "status": "backlog",
  "project_id": "{pipeline.project_id}",
  "parent_ticket_id": "{spike_ticket_id}"
}'
```

**Legacy Supabase MCP (Fallback):**
```sql
INSERT INTO public.tickets (title, body, priority, tags, status, workspace_id, project_id, parent_ticket_id)
VALUES (
  '{title}',
  '{body_markdown}',
  'medium',
  ARRAY['spike-followup'],
  'backlog',
  '{pipeline.workspace_id}',
  (SELECT id FROM public.projects WHERE name = '{pipeline.project_name}' AND workspace_id = '{pipeline.workspace_id}'),
  '{spike_ticket_id}'
)
RETURNING number, title;
```

Ausgabe pro erstelltem Ticket: `✓ T-{new_number}: {title}`

Falls keine Pipeline konfiguriert: Ticket-Entwuerfe als Markdown ausgeben, User kann sie manuell erstellen.

### 7. Spike-Ticket abschliessen

Falls Pipeline konfiguriert:

**Board API (bevorzugt):**
```bash
bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"status": "done"}'
```

**Legacy Supabase MCP (Fallback):**
```sql
UPDATE public.tickets SET status = 'done' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}' RETURNING number, title, status;
```

Ausgabe: `✓ Spike T-{N} abgeschlossen (Status: done)`

### 8. Abschluss-Ausgabe

```
Spike-Review abgeschlossen:
  Spike: T-{N} — {title} (done)
  Dokument: docs/spikes/{dateiname}
  Follow-Up-Tickets: {anzahl} erstellt
  → Naechster Schritt: /develop um das erste Follow-Up-Ticket zu implementieren
```

Falls keine Tickets erstellt wurden:
```
Spike-Review abgeschlossen:
  Spike: T-{N} — {title} (done)
  Dokument: docs/spikes/{dateiname}
  → Keine Follow-Up-Tickets erstellt
```

## Fehlerbehandlung

- **Kein Argument:** Fehlermeldung mit Usage-Hinweis
- **Ticket nicht gefunden (Pipeline):** Fehlermeldung, Stopp
- **Spike-Dokument nicht gefunden:** Fehlermeldung mit erwartetem Dateinamen-Pattern, Stopp
- **Ticket-Erstellung fehlgeschlagen:** Fehler anzeigen, mit naechstem Ticket fortfahren
- **Status-Update fehlgeschlagen:** Fehler anzeigen, User informieren — Rest trotzdem durchfuehren

## Verboten

- NICHT den Skill `finishing-a-development-branch` aufrufen
- NICHT Code implementieren — dieses Command erstellt nur Tickets
- NICHT `cat ~/.just-ship/config.json` — IMMER `board-api.sh` verwenden
- NICHT automatisch `/develop` starten nach dem Review
