---
name: ticket
description: Ticket schreiben — Bug, Feature, Improvement oder Spike als strukturiertes Ticket erfassen
---

# /ticket — Ticket schreiben

Erstelle ein strukturiertes Ticket aus dem Input des Users. Du schreibst **nur** ein Ticket — du implementierst NICHTS.

## Ablauf

1. Nutze den `just-ship-ticket-writer` Skill mit `$ARGUMENTS` als Input
2. Der Skill erstellt ein PM-Quality Ticket (Titel, Problem, Desired Behavior, ACs, Out of Scope)
3. Liefere das Ticket an Pipeline (Supabase) — falls `pipeline.project_id` in `project.json` gesetzt ist

## Wichtig

- **Kein Code schreiben.** Kein Branch erstellen. Keine Implementierung starten.
- Falls der User ein Ticket implementieren will, verweise auf `/develop`.
- Falls `$ARGUMENTS` leer ist, frage den User was er dokumentieren möchte.
