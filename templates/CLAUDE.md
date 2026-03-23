# CLAUDE.md – {{PROJECT_NAME}} Project Instructions

> Dieses Dokument wird von Claude Code automatisch gelesen.
> Projektspezifische Konfiguration (Stack, Build-Commands, Pfade, Pipeline-Verbindung) liegt in `project.json`.

---

## Projekt

**{{PROJECT_NAME}}** – TODO: Kurze Projektbeschreibung hier einfügen.

---

## Konventionen

### Git
- **Branches:** `feature/{ticket-id}-{kurzbeschreibung}`, `fix/...`, `chore/...`
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`)
- **Sprache:** Commit Messages auf Englisch

### Code
- TODO: Code-Konventionen hier einfügen (Sprache, Framework, Imports, etc.)

### Dateien
- Keine Dateien löschen ohne explizite Anweisung

---

## Autonomer Modus

Dieses Repo nutzt ein Multi-Agent-System. Ob lokal oder auf dem Server:

1. **Arbeite autonom** — keine interaktiven Fragen, keine manuellen Bestätigungen
2. **Plane selbst** — kein Planner-Agent, keine Spec-Datei. Lies betroffene Dateien direkt und gib Agents konkrete Instruktionen
3. **Wenn unklar:** Konservative Lösung wählen, nicht raten
4. **Commit + PR** am Ende des Workflows → Board-Status "in_review"
5. **Merge erst nach Freigabe** — User sagt "passt"/"ship it" oder `/ship`

## Ticket-Workflow (Just Ship Board)

> Nur aktiv wenn `pipeline.workspace_id` und `pipeline.project_id` in `project.json` gesetzt sind. Ohne Pipeline-Config werden diese Schritte übersprungen.

Falls Pipeline konfiguriert ist, sind Status-Updates **PFLICHT**:

| Workflow-Schritt | Board-Status | Wann |
|---|---|---|
| `/ticket` — Ticket schreiben | — | Erstellt ein neues Ticket im Board |
| `/develop` — Ticket implementieren | **`in_progress`** | Sofort nach Ticket-Auswahl, VOR dem Coding |
| `/ship` — PR mergen & abschließen | **`done`** | Nach erfolgreichem Merge |

Status-Updates via Board API (Credentials werden aus `~/.just-ship/config.json` aufgelöst):
```bash
WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id <workspace_id>)
# → { board_url, api_key, ... }
curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "{status}"}' \
  "{board_url}/api/tickets/{N}"
```

**Workspace-Credentials** (API Key) liegen in `~/.just-ship/config.json` — nicht in `project.json`. Führe `/setup-just-ship` aus, um die Pipeline-Verbindung einzurichten.

**Überspringe KEINEN dieser Schritte.** Falls ein Update fehlschlägt, versuche es erneut oder informiere den User.

---

## Architektur

TODO: Projektstruktur hier einfügen.

```
src/
├── ...
```

---

## Sicherheit

- Keine API Keys, Tokens oder Secrets im Code
- Input Validation auf allen Endpoints

---

## Konversationelle Trigger

**"passt"**, **"done"**, **"fertig"**, **"klappt"**, **"sieht gut aus"** → automatisch `/ship` ausführen

**Wichtig:** `/ship` läuft **vollständig autonom** — keine Rückfragen bei Commit, Push, PR oder Merge. Der User hat seine Freigabe bereits gegeben.
