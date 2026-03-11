#!/usr/bin/env bash
# Usage: send-event.sh <ticket_number> <agent_type> <event_type>
# Reads pipeline config from project.json in the current directory.
# Fails silently if pipeline is not configured or API is unreachable.

set -euo pipefail

TICKET_NUMBER="${1:-}"
AGENT_TYPE="${2:-}"
EVENT_TYPE="${3:-}"

if [[ -z "$TICKET_NUMBER" || -z "$AGENT_TYPE" || -z "$EVENT_TYPE" ]]; then
  exit 0
fi

# Find project.json in current dir or parents
PROJECT_JSON=""
DIR="$(pwd)"
while [[ "$DIR" != "/" ]]; do
  if [[ -f "$DIR/project.json" ]]; then
    PROJECT_JSON="$DIR/project.json"
    break
  fi
  DIR="$(dirname "$DIR")"
done

if [[ -z "$PROJECT_JSON" ]]; then
  exit 0
fi

API_URL=$(python3 -c "import json; d=json.load(open('$PROJECT_JSON')); print(d.get('pipeline',{}).get('api_url',''))" 2>/dev/null || true)
API_KEY=$(python3 -c "import json; d=json.load(open('$PROJECT_JSON')); print(d.get('pipeline',{}).get('api_key',''))" 2>/dev/null || true)

if [[ -z "$API_URL" || -z "$API_KEY" ]]; then
  exit 0
fi

curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: $API_KEY" \
  -d "{\"ticket_number\":$TICKET_NUMBER,\"agent_type\":\"$AGENT_TYPE\",\"event_type\":\"$EVENT_TYPE\"}" \
  --max-time 3 \
  "$API_URL/api/events" > /dev/null 2>&1 || true
