# CLAUDE.md – agentic-dev-telegram-bot Project Instructions

> Dieses Dokument wird von Claude Code automatisch gelesen.
> Projektspezifische Konfiguration (Stack, Build-Commands, Pfade, Pipeline-Verbindung) liegt in `project.json`.

---

## Projekt

**agentic-dev-telegram-bot** – Telegram Bot zur Ticket-Erstellung im Agentic Dev Board. Nimmt Text, Sprachnachrichten und Screenshots entgegen, strukturiert sie per AI (Claude + Whisper) in Tickets und speichert sie in Supabase.

---

## Konventionen

### Git
- **Branches:** `feature/{ticket-id}-{kurzbeschreibung}`, `fix/...`, `chore/...`
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`)
- **Sprache:** Commit Messages auf Englisch

### Code
- TypeScript (strict mode, ES2022 target)
- ESM Modules (`"type": "module"` in package.json)
- Imports mit `.js` Extension (ESM-kompatibel)
- Runtime: Node.js mit `tsx` für TypeScript-Ausführung
- AI: Anthropic SDK für Bildanalyse/Ticket-Strukturierung, OpenAI SDK für Whisper-Transkription

### Dateien
- Keine Dateien löschen ohne explizite Anweisung

---

## Autonomer Modus

Dieses Repo nutzt ein Multi-Agent-System. Ob lokal oder auf dem Server:

1. **Arbeite autonom** — keine interaktiven Fragen, keine manuellen Bestätigungen
2. **Plane selbst** — kein Planner-Agent, keine Spec-Datei. Lies betroffene Dateien direkt und gib Agents konkrete Instruktionen
3. **Wenn unklar:** Konservative Lösung wählen, nicht raten
4. **Commit + PR** am Ende des Workflows → Board-Status "in_review"
5. **Merge erst nach Freigabe** — User sagt "passt"/"merge" oder `/merge`

## Ticket-Workflow (Agentic Dev Board)

> Nur aktiv wenn `pipeline.api_url` und `pipeline.api_key` in `project.json` gesetzt sind. Ohne Pipeline-Config werden diese Schritte übersprungen.

Falls Pipeline konfiguriert ist, sind Status-Updates **PFLICHT**:

| Workflow-Schritt | Board-Status | Wann |
|---|---|---|
| `/ticket` — Ticket schreiben | — | Erstellt ein neues Ticket im Board |
| `/develop` — Ticket implementieren | **`in_progress`** | Sofort nach Ticket-Auswahl, VOR dem Coding |
| `/ship` — PR erstellen | **`in_review`** | Nach PR-Erstellung |
| `/merge` — PR mergen | **`done`** | Nach erfolgreichem Merge |

Status-Updates via Board API (curl):
```bash
curl -s -X PATCH -H "X-Pipeline-Key: {pipeline.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "{status}"}' \
  "{pipeline.api_url}/api/tickets/{N}"
```

**Backward Compatibility:** Falls nur `pipeline.project_id` gesetzt ist (ohne `api_url`/`api_key`), wird `mcp__claude_ai_Supabase__execute_sql` als Fallback verwendet. Fuehre `/setup-pipeline` aus um auf Board API zu upgraden.

**Überspringe KEINEN dieser Schritte.** Falls ein Update fehlschlägt, versuche es erneut oder informiere den User.

---

## Architektur

```
bot.ts                    — Haupt-Bot (Telegraf), Message-Handler, Projekt-Auswahl
lib/
├── ai.ts                 — AI-Funktionen (transcribeVoice, describeImage, structureTicket)
├── auth.ts               — Telegram-User-Autorisierung via Supabase
├── supabase.ts           — Supabase Client
└── types.ts              — TypeScript Interfaces
002_telegram_users.sql    — DB-Migration für telegram_users Tabelle
telegram-bot.service      — systemd Service-Definition
```

---

## Sicherheit

- Keine API Keys, Tokens oder Secrets im Code
- Input Validation auf allen Endpoints

---

## Konversationelle Trigger

**"passt"**, **"done"**, **"fertig"**, **"klappt"**, **"sieht gut aus"** → automatisch `/merge` ausführen

**Wichtig:** `/ship` und `/merge` laufen **vollständig autonom** — keine Rückfragen bei Commit, Push, PR oder Merge. Der User hat seine Freigabe bereits gegeben.
