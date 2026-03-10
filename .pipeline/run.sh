#!/bin/bash
# =============================================================================
# run.sh – Autonome Dev Pipeline via Claude Code Agent
#
# Nutzung:
#   ./run.sh <TICKET_ID> <TICKET_TITLE> [TICKET_DESCRIPTION] [LABELS]
#
# Nutzt claude --agent für den Orchestrator, der intern Sub-Agents spawnt.
# Funktioniert lokal und auf VPS (erkennt root + claude-dev User).
# Liest Projektname und Branch-Prefix aus project.json.
# Gibt am Ende JSON für n8n aus.
# =============================================================================

set -euo pipefail

TICKET_ID="${1:?Usage: ./run.sh <TICKET_ID> <TICKET_TITLE> [DESCRIPTION] [LABELS]}"
TICKET_TITLE="${2:?Usage: ./run.sh <TICKET_ID> <TICKET_TITLE> [DESCRIPTION] [LABELS]}"
TICKET_DESCRIPTION="${3:-No description provided}"
TICKET_LABELS="${4:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Read project config
if [ -f "project.json" ]; then
  PROJECT_NAME=$(python3 -c "import json; print(json.load(open('project.json'))['name'])" 2>/dev/null || echo "project")
  BRANCH_PREFIX=$(python3 -c "import json; print(json.load(open('project.json'))['conventions']['branch_prefix'])" 2>/dev/null || echo "feature/")
else
  PROJECT_NAME="project"
  BRANCH_PREFIX="feature/"
fi

echo "================================================" >&2
echo "  ${PROJECT_NAME} — Autonomous Pipeline" >&2
echo "  Ticket: $TICKET_ID — $TICKET_TITLE" >&2
echo "================================================" >&2

# Ensure we're on main and up to date
git checkout main 2>/dev/null || true
git pull origin main 2>/dev/null || true

# Create feature branch
BRANCH_SLUG=$(echo "$TICKET_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | head -c 40)
BRANCH_NAME="${BRANCH_PREFIX}${TICKET_ID}-${BRANCH_SLUG}"
git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"

echo "" >&2
echo "Branch: $BRANCH_NAME" >&2
echo "Starting orchestrator..." >&2
echo "" >&2

# Build the claude command
CLAUDE_CMD="claude --agent orchestrator --dangerously-skip-permissions -p \"$(cat <<PROMPT_EOF
Implementiere folgendes Ticket end-to-end:

Ticket-ID: $TICKET_ID
Titel: $TICKET_TITLE
Beschreibung: $TICKET_DESCRIPTION
Labels: $TICKET_LABELS

Folge deinem Workflow:
1. Lies project.json und CLAUDE.md für Projekt-Kontext
2. Plane die Implementierung (Phase 1)
3. Spawne die nötigen Experten-Agents (Phase 2: Implementierung)
4. Build-Check + QA Review (Phase 3-4)
5. Ship: Commit, Push, PR erstellen (Phase 5) — KEIN Merge

Branch ist bereits erstellt: $BRANCH_NAME
PROMPT_EOF
)\""

# VPS detection: if running as root and claude-dev user exists, switch user
EXIT_CODE=0
if [ "$(id -u)" -eq 0 ] && id "claude-dev" &>/dev/null; then
  echo "[VPS] Running as claude-dev user" >&2
  su - claude-dev -c "cd ${PROJECT_DIR} && ${CLAUDE_CMD}" >&2 || EXIT_CODE=$?
else
  eval "${CLAUDE_CMD}" >&2 || EXIT_CODE=$?
fi

echo "" >&2
echo "================================================" >&2

# JSON output for n8n (last thing on stdout)
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "  Pipeline complete" >&2
  echo "================================================" >&2
  cat <<JSON_EOF
{
  "status": "completed",
  "ticket_id": "${TICKET_ID}",
  "ticket_title": "${TICKET_TITLE}",
  "branch": "${BRANCH_NAME}",
  "project": "${PROJECT_NAME}"
}
JSON_EOF
else
  echo "  Pipeline FAILED (exit code: $EXIT_CODE)" >&2
  echo "================================================" >&2
  cat <<JSON_EOF
{
  "status": "failed",
  "exit_code": ${EXIT_CODE},
  "ticket_id": "${TICKET_ID}",
  "ticket_title": "${TICKET_TITLE}",
  "branch": "${BRANCH_NAME}",
  "project": "${PROJECT_NAME}"
}
JSON_EOF
  exit $EXIT_CODE
fi
