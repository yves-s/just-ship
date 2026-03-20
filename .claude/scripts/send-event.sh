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

# Try new format first: workspace slug → global config
WORKSPACE=$(python3 -c "import json; d=json.load(open('project.json')); print(d.get('pipeline',{}).get('workspace',''))" 2>/dev/null)
GLOBAL_CONFIG="$HOME/.just-ship/config.json"

if [ -n "$WORKSPACE" ] && [ -f "$GLOBAL_CONFIG" ]; then
  API_URL=$(JS_GC="$GLOBAL_CONFIG" JS_WS="$WORKSPACE" python3 -c "
import json, os
c = json.load(open(os.environ['JS_GC']))
w = c.get('workspaces', {}).get(os.environ['JS_WS'], {})
print(w.get('board_url', ''))" 2>/dev/null)
  API_KEY=$(JS_GC="$GLOBAL_CONFIG" JS_WS="$WORKSPACE" python3 -c "
import json, os
c = json.load(open(os.environ['JS_GC']))
w = c.get('workspaces', {}).get(os.environ['JS_WS'], {})
print(w.get('api_key', ''))" 2>/dev/null)
fi

# Fallback: old format (api_url/api_key directly in project.json)
if [ -z "$API_URL" ] || [ -z "$API_KEY" ]; then
  API_URL=$(python3 -c "import json; d=json.load(open('project.json')); print(d.get('pipeline',{}).get('api_url',''))" 2>/dev/null)
  API_KEY=$(python3 -c "import json; d=json.load(open('project.json')); print(d.get('pipeline',{}).get('api_key',''))" 2>/dev/null)
fi

[ -z "$API_URL" ] || [ -z "$API_KEY" ] && exit 0

curl -s --max-time 3 -X POST "${API_URL}/api/events" \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: ${API_KEY}" \
  -d "{\"ticket_number\": ${TICKET_NUMBER}, \"agent_type\": \"${AGENT_TYPE}\", \"event_type\": \"${EVENT_TYPE}\", \"metadata\": ${METADATA}}" \
  >/dev/null 2>&1 &
