---
name: ticket
description: Ticket schreiben — Bug, Feature, Improvement oder Spike als strukturiertes Ticket erfassen. Unterstützt auch Splitting (Epic + Children) und manuelles Gruppieren.
---

# /ticket — Ticket schreiben

Erstelle ein strukturiertes Ticket aus dem Input des Users. Du schreibst **nur** ein Ticket — du implementierst NICHTS.

## Ablauf

1. Nutze den `just-ship-ticket-writer` Skill mit `$ARGUMENTS` als Input
2. Der Skill erstellt ein PM-Quality Ticket (Titel, Problem, Desired Behavior, ACs, Out of Scope)
3. Liefere das Ticket an Pipeline (Supabase) — falls `pipeline.project_id` in `project.json` gesetzt ist

## Ziel-Projekt (optional)

`/ticket --project <slug-or-uuid> "..."` legt das Ticket in einem anderen Projekt im selben Workspace an. Ohne `--project` gilt `pipeline.project_id` aus `project.json` als Default.

- **UUID** (mit Bindestrichen): direkt als `project_id` an die Board API übergeben.
- **Slug** (z.B. `just-ship-board`): vor dem Create per `bash .claude/scripts/board-api.sh get projects` zur UUID aufgelöst (Match auf `data.projects[].slug`). Kein Match → Fehler ausgeben, kein Ticket erstellen.

Der `--project`-Wert wird vor dem Skill-Aufruf aus `$ARGUMENTS` extrahiert und an den Ticket-Writer-Skill weitergegeben, der ihn in jedem `POST tickets`-Body als `project_id` setzt. Das überschreibt die Default-Injection in `board-api.sh` und gilt auch für Split-Children und Epic-Container.

## Split-Modus

Wenn der Ticket-Writer das Ticket als zu gross erkennt (Split-Signale aus dem Skill), oder der User explizit einen Split anfordert:

Der Skill übernimmt den Split vollständig — inklusive Epic-Erstellung und Child-Tickets. Übergib den Kontext vollständig an den Skill und lass ihn den `Auto-Epic on Split`-Flow ausführen.

Der Skill erstellt:
1. **Epic zuerst** — Titel: `[Epic] {Gesamtthema}`, Body: Scope-Zusammenfassung, Status: `backlog`
2. **Child-Tickets** — jedes mit `parent_ticket_id` auf das Epic, eigene ACs, eigene Size (S/M/L)
3. **Hierarchie-Ausgabe** zur Bestätigung

Der Trigger ist die **Split-Aktion**, nicht die Ticket-Groesse. Jeder Split erzeugt ein Epic.

## Gruppier-Modus

Wenn der User bestehende Tickets gruppieren will (z.B. "Gruppier T-100, T-101, T-102"):

Der Skill übernimmt die Gruppierung — inklusive Epic-Erstellung und Verlinkung bestehender Tickets. Übergib die genannten Ticket-Nummern an den Skill und lass ihn den `Manual Grouping`-Flow ausführen.

Der Skill:
1. **Erstellt ein neues Epic** — Titel und Scope aus dem Kontext der genannten Tickets
2. **Verlinkt bestehende Tickets** — `parent_ticket_id` der genannten Tickets auf das neue Epic setzen
3. **Zeigt die Hierarchie** zur Bestätigung

## Wichtig

- **Kein Code schreiben.** Kein Branch erstellen. Keine Implementierung starten.
- Falls der User ein Ticket implementieren will, verweise auf `/develop`.
- Falls `$ARGUMENTS` leer ist, frage den User was er dokumentieren möchte.
