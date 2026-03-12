# Spike T-287: Universal Event Streaming

**Datum:** 2026-03-12
**Status:** Abgeschlossen
**Branch:** `feature/287-universal-event-streaming`

---

## Problem

Events werden aktuell NUR gesendet wenn:
- `/develop` Command genutzt wird (manuelle `send-event.sh` Aufrufe im Command-Flow)
- SDK Pipeline läuft (`pipeline/lib/event-hooks.ts` mit programmatischen Hooks)

In der Praxis wird aber oft:
- Manuell an Tickets gearbeitet ("implementiere T-274") ohne `/develop`
- Verbesserungen ohne eigenes Ticket durchgeführt
- Ad-hoc Änderungen gemacht

**Ergebnis:** Das Board sieht keine Agents, keinen Output, keinen Fortschritt.

---

## Forschungsergebnisse

### 1. Ticket-Kontext ermitteln

**Empfehlung: Option A (Branch-Name) + Option B (Fallback-Datei)**

Claude Code bietet einen **`SessionStart` Hook** in `settings.json`, der bei JEDER Session feuert — interaktiv (CLI), VSCode Extension und SDK. Der Hook erhält folgende Daten via stdin:

```json
{
  "session_id": "abc123",
  "cwd": "/Users/.../project",
  "hook_event_name": "SessionStart",
  "source": "startup|resume|clear|compact"
}
```

**Besonderes Feature:** `SessionStart` hat Zugriff auf die Umgebungsvariable `CLAUDE_ENV_FILE`. Dort geschriebene Key-Value-Paare werden als Environment-Variablen für ALLE nachfolgenden Bash-Aufrufe in der Session gesetzt.

**Strategie:**
1. `SessionStart` Hook liest Branch-Name via `git rev-parse --abbrev-ref HEAD`
2. Extrahiert Ticket-Nummer aus Branch (`feature/287-...` → `287`)
3. Schreibt `TICKET_NUMBER=287` in `$CLAUDE_ENV_FILE`
4. Schreibt `287` in `.claude/.active-ticket` (Fallback für Scripts)
5. Sendet `agent_started` Event für `orchestrator`

**Fallback:** Wenn kein Ticket aus dem Branch extrahierbar ist (z.B. `main`), wird kein Event gesendet. Die Datei `.claude/.active-ticket` wird geleert.

**Fazit:** Kein manuelles Setzen nötig. Branch-Konvention (`feature/{N}-...`, `fix/{N}-...`) reicht als Quelle.

### 2. Agent-Tracking ohne /develop

**Empfehlung: Option A (settings.json Hooks)**

Claude Code unterstützt **Shell-Command-Hooks** in `settings.json` für folgende Events:

| Event | Matcher | Feuert in | Relevanz |
|-------|---------|-----------|----------|
| `SubagentStart` | Agent-Typ | Alle Sessions | Agent gestartet |
| `SubagentStop` | Agent-Typ | Alle Sessions | Agent fertig |
| `PostToolUse` | Tool-Name | Alle Sessions | Datei geändert |
| `SessionStart` | Source | Alle Sessions | Session begonnen |
| `SessionEnd` | Exit-Reason | Alle Sessions | Session beendet |

**Entscheidend:** Diese Hooks feuern in ALLEN Claude Code Sessions, nicht nur im SDK. Das bedeutet:
- Interaktive CLI → Hooks feuern
- VSCode Extension → Hooks feuern
- SDK Pipeline → Hooks feuern (zusätzlich zu programmatischen Hooks)

**SubagentStart Input:**
```json
{
  "session_id": "abc123",
  "hook_event_name": "SubagentStart",
  "agent_id": "agent-abc123",
  "agent_type": "frontend",
  "cwd": "/project/path"
}
```

**Architektur:**
- Hooks konfiguriert in `.claude/settings.json` (wird von `setup.sh` installiert)
- Jeder Hook ruft `send-event.sh` asynchron auf (`"async": true`)
- `send-event.sh` liest Ticket-Nummer aus `.claude/.active-ticket`
- Silent fail — blockiert nie die Session

### 3. Agent-Logs auf dem Ticket

**Empfehlung: Neuer Event-Typ `log` + Ticket-Detail-Timeline**

**Aktueller Stand des Boards:**
- `task_events` Tabelle speichert Events mit `agent_type`, `event_type`, `metadata` (JSONB)
- Events werden NUR für Realtime-Activity-Tracking genutzt (pulsierende Dots, Agent-Panel)
- **Kein Event-Log auf dem Ticket-Detail** — Events werden nicht als Timeline angezeigt
- Activity Window: 60 Sekunden (danach verschwinden Agents aus der Anzeige)

**Neuer Event-Typ `log`:**
```json
{
  "ticket_number": 287,
  "agent_type": "frontend",
  "event_type": "log",
  "metadata": {
    "message": "3 Dateien erstellt: UserCard.tsx, UserList.tsx, user.css"
  }
}
```

**Was geloggt wird (knapp, lesbar):**
- `agent_started` → was der Agent macht (1 Zeile)
- `completed` → was er gemacht hat (2-3 Zeilen, Dateiliste)
- `log` → Zwischenstatus oder Build-Ergebnis

**Board-Änderungen nötig:**
1. Ticket-Detail-Sheet um Event-Timeline erweitern
2. Events chronologisch anzeigen mit Icons (▶ started, ✓ completed, ✗ failed, 📝 log)
3. `metadata.message` als lesbaren Text rendern

### 4. Architektur

**Empfehlung: settings.json Hooks + send-event.sh (kein Sidecar)**

```
┌─────────────────────────────────────────────────┐
│ Claude Code Session (CLI / VSCode / SDK)        │
│                                                 │
│  SessionStart ─► detect-ticket.sh               │
│    → git branch → extract ticket number         │
│    → write CLAUDE_ENV_FILE + .active-ticket      │
│    → send-event.sh {N} orchestrator started     │
│                                                 │
│  SubagentStart ─► on-agent-start.sh             │
│    → read .active-ticket                        │
│    → send-event.sh {N} {agent_type} started     │
│                                                 │
│  SubagentStop ─► on-agent-stop.sh               │
│    → read .active-ticket                        │
│    → send-event.sh {N} {agent_type} completed   │
│                                                 │
│  SessionEnd ─► on-session-end.sh                │
│    → send-event.sh {N} orchestrator completed   │
│    → cleanup .active-ticket                     │
└──────────────────────┬──────────────────────────┘
                       │ HTTP POST (async, 3s timeout)
                       ▼
            ┌──────────────────┐
            │ Dev Board API    │
            │ POST /api/events │
            └──────────────────┘
```

**Warum kein Sidecar:**
- settings.json Hooks decken alle Events ab
- `send-event.sh` existiert bereits und funktioniert
- Async Hooks blockieren die Session nicht
- Silent fail — Board-Ausfälle beeinflussen die Arbeit nicht

**Warum keine CLAUDE.md Instruktion:**
- Fragil — Claude "vergisst" Instruktionen bei langer Session
- Nicht deterministisch — manchmal werden Events gesendet, manchmal nicht
- Hooks sind deterministisch und automatisch

**Koexistenz mit SDK Pipeline:**
- SDK Pipeline (`run.ts`) nutzt programmatische `event-hooks.ts` → diese bleiben
- settings.json Hooks feuern ZUSÄTZLICH → kein Konflikt
- Doppelte Events sind harmlos (Board zeigt nur den neuesten Status)

---

## Proof of Concept

### Dateien

1. **`.claude/hooks/detect-ticket.sh`** — SessionStart Hook
2. **`.claude/hooks/on-agent-start.sh`** — SubagentStart Hook
3. **`.claude/hooks/on-agent-stop.sh`** — SubagentStop Hook
4. **`.claude/hooks/on-session-end.sh`** — SessionEnd Hook
5. **`.claude/settings.json`** — Hook-Konfiguration (erweitert)

### Installierbarkeit

`setup.sh` installiert die Hooks automatisch. In Projekten OHNE `pipeline` Config in `project.json` passiert nichts (send-event.sh prüft bereits auf API-URL/Key).

---

## Follow-up Tickets

| Ticket | Titel | Typ | Priorität | Status |
|--------|-------|-----|-----------|--------|
| — | **Pipeline: Hook-Scripts + settings.json Config** | feature | — | ✅ Im PoC dieses Spikes implementiert |
| — | **Pipeline: setup.sh Hook-Installation** | chore | — | ✅ Im PoC dieses Spikes implementiert |
| T-290 | **Board: Event-Timeline auf Ticket-Detail** | feature | medium | backlog |
| T-291 | **Board: Log Event-Typ unterstützen** | feature | low | backlog |

Die Pipeline-seitigen Änderungen (Hook-Scripts, settings.json, setup.sh) sind vollständig im PoC dieses Spikes implementiert. Nur die Board-seitigen Änderungen (T-290, T-291) sind als separate Tickets erfasst.
