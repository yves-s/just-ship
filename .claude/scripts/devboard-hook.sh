#!/bin/sh
# devboard-hook.sh — Sendet Agent-Events an das Agentic Dev Board
#
# Aufruf:
#   devboard-hook.sh <event_type> [tool_name] [file_path]
#
# Umgebungsvariablen (von Claude Code Hooks gesetzt):
#   CLAUDE_TOOL_NAME    — Name des aufgerufenen Tools
#   CLAUDE_FILE_PATH    — Betroffene Datei (falls vorhanden)
#
# Konfiguration aus project.json:
#   pipeline.api_url     — Devboard API URL
#   pipeline.api_key     — API Key (X-Pipeline-Key Header)
#   pipeline.ticket_number — Aktuelles Ticket (optional, aus Branch)

# ── Konfiguration lesen ──────────────────────────────────────────────────────

PROJECT_JSON="project.json"

if [ ! -f "$PROJECT_JSON" ]; then
  exit 0
fi

API_URL=$(node -e "try{const c=require('./$PROJECT_JSON');process.stdout.write(c.pipeline&&c.pipeline.api_url||'')}catch(e){}" 2>/dev/null)
API_KEY=$(node -e "try{const c=require('./$PROJECT_JSON');process.stdout.write(c.pipeline&&c.pipeline.api_key||'')}catch(e){}" 2>/dev/null)

# Ohne Konfiguration: silent exit
if [ -z "$API_URL" ] || [ -z "$API_KEY" ]; then
  exit 0
fi

# ── Ticket-Nummer aus aktuellem Branch ermitteln ─────────────────────────────

TICKET_NUMBER=$(git branch --show-current 2>/dev/null | grep -oE '[0-9]+' | head -1)

if [ -z "$TICKET_NUMBER" ]; then
  exit 0
fi

# ── Event-Payload zusammenstellen ────────────────────────────────────────────

EVENT_TYPE="${1:-tool_use}"
TOOL_NAME="${2:-${CLAUDE_TOOL_NAME:-}}"
FILE_PATH="${3:-${CLAUDE_FILE_PATH:-}}"
AGENT_TYPE="${CLAUDE_AGENT_NAME:-orchestrator}"

METADATA="{}"
if [ -n "$TOOL_NAME" ] && [ -n "$FILE_PATH" ]; then
  METADATA="{\"tool_name\":\"$TOOL_NAME\",\"file_path\":\"$FILE_PATH\"}"
elif [ -n "$TOOL_NAME" ]; then
  METADATA="{\"tool_name\":\"$TOOL_NAME\"}"
fi

PAYLOAD="{\"ticket_number\":$TICKET_NUMBER,\"agent_type\":\"$AGENT_TYPE\",\"event_type\":\"$EVENT_TYPE\",\"metadata\":$METADATA}"

# ── POST an Devboard ─────────────────────────────────────────────────────────

curl -sf \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: $API_KEY" \
  -d "$PAYLOAD" \
  --max-time 3 \
  "$API_URL/api/events" \
  > /dev/null 2>&1 || true

# Silent fail: Pipeline läuft immer weiter, egal ob Devboard erreichbar ist
exit 0
