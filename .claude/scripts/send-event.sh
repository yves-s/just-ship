#!/bin/bash
# send-event.sh — Send pipeline event to Dev Board
# Usage: bash .claude/scripts/send-event.sh <ticket_number> <agent_type> <event_type> [metadata_json]
#
# Reads api_url and api_key from project.json pipeline config.
# Silent fail — never blocks the pipeline.

TICKET_NUMBER="$1"
AGENT_TYPE="$2"
EVENT_TYPE="$3"
METADATA="${4:-{}}"

[ -z "$TICKET_NUMBER" ] || [ -z "$AGENT_TYPE" ] || [ -z "$EVENT_TYPE" ] && exit 0

# Read pipeline config from project.json
if [ ! -f "project.json" ]; then exit 0; fi

API_URL=$(python3 -c "import json; d=json.load(open('project.json')); print(d.get('pipeline',{}).get('api_url',''))" 2>/dev/null)
API_KEY=$(python3 -c "import json; d=json.load(open('project.json')); print(d.get('pipeline',{}).get('api_key',''))" 2>/dev/null)

[ -z "$API_URL" ] || [ -z "$API_KEY" ] && exit 0

curl -s --max-time 3 -X POST "${API_URL}/api/events" \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: ${API_KEY}" \
  -d "{\"ticket_number\": ${TICKET_NUMBER}, \"agent_type\": \"${AGENT_TYPE}\", \"event_type\": \"${EVENT_TYPE}\", \"metadata\": ${METADATA}}" \
  >/dev/null 2>&1 &
