#!/bin/bash
# ask-human.sh — Ask a question to the human and pause the pipeline
# Usage: bash .claude/scripts/ask-human.sh --question "..." [--option "..."] [--context "..."]
#
# In pipeline mode (BOARD_API_URL set): Posts question to Board API, outputs __WAITING_FOR_INPUT__
# In local mode (no BOARD_API_URL): Prints question to stdout for the agent to relay in chat
#
# Environment variables (set by pipeline worker/server):
#   TICKET_NUMBER  — Current ticket number
#   BOARD_API_URL  — Board API base URL
#   PIPELINE_KEY   — Auth key for Board API

set -euo pipefail

# --- Parse arguments ---
QUESTION=""
OPTIONS=()
CONTEXT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --question)
      QUESTION="$2"
      shift 2
      ;;
    --option)
      OPTIONS+=("$2")
      shift 2
      ;;
    --context)
      CONTEXT="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$QUESTION" ]; then
  echo "Error: --question is required" >&2
  exit 1
fi

# --- Build options JSON ---
OPTIONS_JSON="null"
if [ ${#OPTIONS[@]} -gt 0 ]; then
  OPTIONS_JSON="["
  KEY_INDEX=0
  KEYS=("A" "B" "C" "D" "E" "F" "G" "H" "I" "J")
  for opt in "${OPTIONS[@]}"; do
    if [ "$KEY_INDEX" -gt 0 ]; then
      OPTIONS_JSON+=","
    fi
    KEY="${KEYS[$KEY_INDEX]}"
    # Escape quotes in option label
    ESCAPED_OPT=$(echo "$opt" | sed 's/"/\\"/g')
    OPTIONS_JSON+="{\"key\":\"$KEY\",\"label\":\"$ESCAPED_OPT\"}"
    KEY_INDEX=$((KEY_INDEX + 1))
  done
  OPTIONS_JSON+="]"
fi

# --- Pipeline mode: Post to Board API ---
if [ -n "${BOARD_API_URL:-}" ] && [ -n "${TICKET_NUMBER:-}" ] && [ -n "${PIPELINE_KEY:-}" ]; then
  # Build request body
  BODY="{\"question\":$(echo "$QUESTION" | jq -Rs .)"
  if [ "$OPTIONS_JSON" != "null" ]; then
    BODY+=",\"options\":$OPTIONS_JSON"
  fi
  if [ -n "$CONTEXT" ]; then
    BODY+=",\"context\":$(echo "$CONTEXT" | jq -Rs .)"
  fi
  BODY+="}"

  # Post question to Board API with retry
  MAX_RETRIES=3
  RETRY=0
  SUCCESS=false

  while [ "$RETRY" -lt "$MAX_RETRIES" ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "X-Pipeline-Key: $PIPELINE_KEY" \
      -H "Content-Type: application/json" \
      -d "$BODY" \
      "${BOARD_API_URL}/api/tickets/${TICKET_NUMBER}/questions" \
      --max-time 10) || HTTP_CODE="000"

    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
      SUCCESS=true
      break
    fi

    RETRY=$((RETRY + 1))
    if [ "$RETRY" -lt "$MAX_RETRIES" ]; then
      sleep $((RETRY * 2))
    fi
  done

  if [ "$SUCCESS" = true ]; then
    echo "__WAITING_FOR_INPUT__"
  else
    echo "Warning: Could not post question to Board API (HTTP $HTTP_CODE after $MAX_RETRIES retries)" >&2
    # Fallback: print question to stdout so agent sees it
    echo ""
    echo "FRAGE AN DEN USER (Board API nicht erreichbar):"
    echo "  $QUESTION"
    if [ ${#OPTIONS[@]} -gt 0 ]; then
      for i in "${!OPTIONS[@]}"; do
        echo "  ${KEYS[$i]}) ${OPTIONS[$i]}"
      done
    fi
    if [ -n "$CONTEXT" ]; then
      echo "  Kontext: $CONTEXT"
    fi
  fi
else
  # --- Local mode: Print question for the agent to relay ---
  echo ""
  echo "Ich habe eine Frage:"
  echo "  $QUESTION"
  if [ ${#OPTIONS[@]} -gt 0 ]; then
    KEYS=("A" "B" "C" "D" "E" "F" "G" "H" "I" "J")
    echo "  Optionen:"
    for i in "${!OPTIONS[@]}"; do
      echo "    ${KEYS[$i]}) ${OPTIONS[$i]}"
    done
  fi
  if [ -n "$CONTEXT" ]; then
    echo "  Kontext: $CONTEXT"
  fi
fi
