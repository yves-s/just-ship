#!/bin/bash
# ============================================================
# connect-project.sh — Projekt auf dem VPS verbinden
#
# Laeuft LOKAL, macht alles per SSH. Deterministisch, kein
# LLM-Interpretationsspielraum. Jeder Schritt wird verifiziert.
#
# Usage:
#   bash vps/connect-project.sh \
#     --host <vps-host> \
#     --project-path <lokaler-pfad> \
#     --repo <owner/repo> \
#     --slug <name-auf-vps>
#
# Optional:
#   --board-url <url>       Board URL fuer Workspace-Config
#   --board-api-key <key>   Board API Key fuer Workspace-Config
#   --workspace-id <uuid>   Workspace UUID fuer server-config
#
# Voraussetzungen:
#   - SSH Zugang zu root@<host> (key-based)
#   - Globale .env auf dem VPS mit ANTHROPIC_API_KEY und GH_TOKEN
#   - server-config.json auf dem VPS
#   - Docker Container laeuft
# ============================================================

set -euo pipefail

# --- Farben ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ~${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }
h()    { echo -e "\n${YELLOW}▶ $*${NC}"; }

# --- Argumente parsen ---
VPS_HOST=""
PROJECT_PATH=""
REPO=""
SLUG=""
BOARD_URL=""
BOARD_API_KEY=""
WORKSPACE_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --host) VPS_HOST="$2"; shift 2 ;;
    --project-path) PROJECT_PATH="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --board-url) BOARD_URL="$2"; shift 2 ;;
    --board-api-key) BOARD_API_KEY="$2"; shift 2 ;;
    --workspace-id) WORKSPACE_ID="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# --- Pflicht-Parameter pruefen ---
[[ -z "$VPS_HOST" ]] && fail "Missing --host"
[[ -z "$PROJECT_PATH" ]] && fail "Missing --project-path"
[[ -z "$REPO" ]] && fail "Missing --repo (z.B. yves-s/my-project)"
[[ -z "$SLUG" ]] && fail "Missing --slug (z.B. my-project)"

echo ""
echo "================================================"
echo "  Just Ship — Projekt verbinden"
echo "  VPS: $VPS_HOST"
echo "  Projekt: $SLUG ($REPO)"
echo "================================================"

# ============================================================
# PRE-FLIGHT CHECKS
# ============================================================

h "Pre-Flight Checks"

# SSH erreichbar?
ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "root@$VPS_HOST" "echo ok" >/dev/null 2>&1 \
  || fail "SSH zu root@$VPS_HOST fehlgeschlagen. ssh-copy-id root@$VPS_HOST ausfuehren."
ok "SSH erreichbar"

# Lokale project.json existiert?
[[ -f "$PROJECT_PATH/project.json" ]] \
  || fail "Keine project.json in $PROJECT_PATH. Zuerst /add-project im Projekt ausfuehren."
ok "Lokale project.json vorhanden"

# project.json hat pipeline.project_id?
PROJECT_ID=$(node -e "process.stdout.write(require('$PROJECT_PATH/project.json').pipeline?.project_id || '')" 2>/dev/null)
[[ -n "$PROJECT_ID" ]] \
  || fail "project.json hat keine pipeline.project_id. Zuerst /add-project ausfuehren."
ok "project_id: $PROJECT_ID"

# Workspace ID aus project.json oder Parameter
if [[ -z "$WORKSPACE_ID" ]]; then
  WORKSPACE_ID=$(node -e "process.stdout.write(require('$PROJECT_PATH/project.json').pipeline?.workspace_id || '')" 2>/dev/null)
fi
[[ -n "$WORKSPACE_ID" ]] || warn "Keine workspace_id — Workspace-Config wird nicht aktualisiert"

# Globale .env hat ANTHROPIC_API_KEY?
REMOTE_HAS_KEY=$(ssh "root@$VPS_HOST" "grep -c '^ANTHROPIC_API_KEY=.\+' /home/claude-dev/.env 2>/dev/null || echo 0")
[[ "$REMOTE_HAS_KEY" -ge 1 ]] \
  || fail "ANTHROPIC_API_KEY fehlt oder ist leer in /home/claude-dev/.env auf dem VPS. Bitte dort eintragen."
ok "ANTHROPIC_API_KEY auf VPS vorhanden"

# GH_TOKEN vorhanden?
REMOTE_HAS_GH=$(ssh "root@$VPS_HOST" "grep -c '^GH_TOKEN=.\+' /home/claude-dev/.env 2>/dev/null || echo 0")
[[ "$REMOTE_HAS_GH" -ge 1 ]] \
  || fail "GH_TOKEN fehlt in /home/claude-dev/.env auf dem VPS."
ok "GH_TOKEN auf VPS vorhanden"

# server-config.json existiert?
ssh "root@$VPS_HOST" "test -f /home/claude-dev/.just-ship/server-config.json" \
  || fail "server-config.json nicht gefunden. VPS wurde noch nicht eingerichtet (Phase 1)."
ok "server-config.json vorhanden"

# Projekt nicht bereits verbunden?
ALREADY=$(ssh "root@$VPS_HOST" "node -e \"
  const cfg = JSON.parse(require('fs').readFileSync('/home/claude-dev/.just-ship/server-config.json','utf-8'));
  process.stdout.write(cfg.projects['$SLUG'] ? 'yes' : 'no');
\"")
if [[ "$ALREADY" == "yes" ]]; then
  warn "Projekt '$SLUG' ist bereits auf dem VPS registriert — wird aktualisiert"
fi

# ============================================================
# STEP 1: Repo klonen (oder updaten)
# ============================================================

h "Repo klonen"

REPO_EXISTS=$(ssh "root@$VPS_HOST" "test -d /home/claude-dev/projects/$SLUG/.git && echo yes || echo no")

if [[ "$REPO_EXISTS" == "yes" ]]; then
  ssh "root@$VPS_HOST" "su - claude-dev -c 'cd /home/claude-dev/projects/$SLUG && git fetch origin && git checkout main -f && git reset --hard origin/main'" >/dev/null 2>&1 \
    || warn "git update fehlgeschlagen — Repo bleibt auf aktuellem Stand"
  ok "Repo existiert — aktualisiert"
else
  # Clone via gh CLI (HTTPS ohne Token funktioniert nicht)
  ssh "root@$VPS_HOST" "su - claude-dev -c 'GH_TOKEN=\$(grep GH_TOKEN /home/claude-dev/.env | cut -d= -f2) gh repo clone $REPO /home/claude-dev/projects/$SLUG'" 2>&1 \
    || fail "git clone fehlgeschlagen. Ist das Repo korrekt? $REPO"
  ok "Repo geklont → /home/claude-dev/projects/$SLUG"
fi

# Verify
ssh "root@$VPS_HOST" "test -d /home/claude-dev/projects/$SLUG/.git" \
  || fail "Repo-Verzeichnis existiert nicht nach Clone"

# ============================================================
# STEP 2: project.json kopieren
# ============================================================

h "project.json kopieren"

cat "$PROJECT_PATH/project.json" | ssh "root@$VPS_HOST" "cat > /home/claude-dev/projects/$SLUG/project.json && chown claude-dev:claude-dev /home/claude-dev/projects/$SLUG/project.json"

# Verify
REMOTE_PID=$(ssh "root@$VPS_HOST" "node -e \"process.stdout.write(require('/home/claude-dev/projects/$SLUG/project.json').pipeline?.project_id || '')\"" 2>/dev/null)
[[ "$REMOTE_PID" == "$PROJECT_ID" ]] \
  || fail "project.json auf VPS hat falsche project_id: '$REMOTE_PID' (erwartet: '$PROJECT_ID')"
ok "project.json kopiert und verifiziert"

# ============================================================
# STEP 3: setup.sh ausfuehren
# ============================================================

h "setup.sh ausfuehren"

ssh "root@$VPS_HOST" "su - claude-dev -c 'export GH_TOKEN=\$(grep GH_TOKEN /home/claude-dev/.env | cut -d= -f2) && cd /home/claude-dev/projects/$SLUG && bash /home/claude-dev/just-ship/setup.sh'" 2>&1 \
  | grep -E '(✓|✗|~|Error|error)' || true
ok "setup.sh abgeschlossen"

# ============================================================
# STEP 4: Projekt-Env-Datei erstellen
# ============================================================

h "Env-Datei erstellen"

# Globale Keys vom VPS lesen (nie im Klartext anzeigen)
REMOTE_ANTHROPIC=$(ssh "root@$VPS_HOST" "grep '^ANTHROPIC_API_KEY=' /home/claude-dev/.env | cut -d= -f2")
REMOTE_GH_TOKEN=$(ssh "root@$VPS_HOST" "grep '^GH_TOKEN=' /home/claude-dev/.env | cut -d= -f2")

# Lokale .env / .env.local lesen (falls vorhanden)
LOCAL_ENV=""
for envfile in "$PROJECT_PATH/.env" "$PROJECT_PATH/.env.local"; do
  if [[ -f "$envfile" ]]; then
    LOCAL_ENV+=$(grep -v '^#' "$envfile" | grep -v '^$' | grep -v '^ANTHROPIC_API_KEY=' | grep -v '^GH_TOKEN=' || true)
    LOCAL_ENV+=$'\n'
  fi
done

# Env-Datei schreiben
ssh "root@$VPS_HOST" "cat > /home/claude-dev/.just-ship/env.$SLUG << 'ENVEOF'
ANTHROPIC_API_KEY=$REMOTE_ANTHROPIC
GH_TOKEN=$REMOTE_GH_TOKEN
$LOCAL_ENV
ENVEOF
chmod 600 /home/claude-dev/.just-ship/env.$SLUG
chown claude-dev:claude-dev /home/claude-dev/.just-ship/env.$SLUG"

# Verify: Key nicht leer
VERIFY_KEY=$(ssh "root@$VPS_HOST" "grep '^ANTHROPIC_API_KEY=.\+' /home/claude-dev/.just-ship/env.$SLUG | wc -l")
[[ "$VERIFY_KEY" -ge 1 ]] \
  || fail "ANTHROPIC_API_KEY in env.$SLUG ist leer!"
ok "env.$SLUG erstellt ($(ssh "root@$VPS_HOST" "wc -l < /home/claude-dev/.just-ship/env.$SLUG") Zeilen)"

# ============================================================
# STEP 5: server-config.json aktualisieren
# ============================================================

h "Server-Config aktualisieren"

# Repo URL bestimmen
REPO_URL="https://github.com/$REPO.git"

ssh "root@$VPS_HOST" "node -e \"
const fs = require('fs');
const cfgPath = '/home/claude-dev/.just-ship/server-config.json';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));

// Projekt hinzufuegen/updaten
cfg.projects['$SLUG'] = {
  project_id: '$PROJECT_ID',
  repo_url: '$REPO_URL',
  project_dir: '/home/claude-dev/projects/$SLUG',
  env_file: '/home/claude-dev/.just-ship/env.$SLUG'
};

// Workspace-Config setzen falls angegeben und noch leer
if ('$WORKSPACE_ID' && !cfg.workspace.workspace_id) {
  cfg.workspace.workspace_id = '$WORKSPACE_ID';
}
if ('$BOARD_URL' && !cfg.workspace.board_url) {
  cfg.workspace.board_url = '$BOARD_URL';
}
if ('$BOARD_API_KEY' && !cfg.workspace.api_key) {
  cfg.workspace.api_key = '$BOARD_API_KEY';
}

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log('Projects: ' + Object.keys(cfg.projects).join(', '));
\""

# Verify
VERIFY_PID=$(ssh "root@$VPS_HOST" "node -e \"
  const cfg = JSON.parse(require('fs').readFileSync('/home/claude-dev/.just-ship/server-config.json','utf-8'));
  const match = Object.entries(cfg.projects).find(([,p]) => p.project_id === '$PROJECT_ID');
  process.stdout.write(match ? match[0] : 'NOT_FOUND');
\"")
[[ "$VERIFY_PID" == "$SLUG" ]] \
  || fail "project_id $PROJECT_ID nicht in server-config.json gefunden (got: $VERIFY_PID)"
ok "server-config.json aktualisiert"

# ============================================================
# STEP 6: Container neu starten
# ============================================================

h "Pipeline-Server neu starten"

ssh "root@$VPS_HOST" "cd /home/claude-dev/just-ship && CLAUDE_UID=\$(id -u claude-dev) CLAUDE_GID=\$(id -g claude-dev) docker compose -f vps/docker-compose.yml up -d --force-recreate pipeline-server" 2>&1 \
  | grep -E '(Started|Recreated|Error)' || true

# Warten bis der Server hochgefahren ist (retry bis zu 30s)
echo -n "  Warte auf Server"
for i in $(seq 1 6); do
  sleep 5
  echo -n "."
  if ssh "root@$VPS_HOST" "docker exec \$(docker ps -q --filter name=pipeline) curl -sf http://localhost:3001/health --max-time 3" >/dev/null 2>&1; then
    echo ""
    break
  fi
  if [[ $i -eq 6 ]]; then
    echo " Timeout"
  fi
done

# ============================================================
# STEP 7: Verifizierung (ALLE muessen bestehen)
# ============================================================

h "Verifizierung"
FAILED=0

# Check 1: Health (von innerhalb des Containers, da expose nur fuer Docker-Netzwerk)
HEALTH=$(ssh "root@$VPS_HOST" "docker exec \$(docker ps -q --filter name=pipeline) curl -sf http://localhost:3001/health --max-time 5" 2>/dev/null || echo "FAIL")
if echo "$HEALTH" | grep -q '"ok"'; then
  ok "Health-Check: OK"
else
  echo -e "${RED}  ✗${NC} Health-Check fehlgeschlagen: $HEALTH"
  FAILED=1
fi

# Check 2: Projekt in Logs
LOGS=$(ssh "root@$VPS_HOST" "docker logs \$(docker ps -q --filter name=pipeline) 2>&1 | grep 'Projects:' | tail -1")
if echo "$LOGS" | grep -q "$SLUG"; then
  ok "Server-Logs: $SLUG gefunden"
else
  echo -e "${RED}  ✗${NC} $SLUG nicht in Server-Logs: $LOGS"
  FAILED=1
fi

# Check 3: project_id aufloesbar
PID_CHECK=$(ssh "root@$VPS_HOST" "node -e \"
  const cfg = JSON.parse(require('fs').readFileSync('/home/claude-dev/.just-ship/server-config.json','utf-8'));
  const match = Object.entries(cfg.projects).find(([,p]) => p.project_id === '$PROJECT_ID');
  process.stdout.write(match ? 'OK' : 'FAIL');
\"")
if [[ "$PID_CHECK" == "OK" ]]; then
  ok "project_id aufloesbar: $PROJECT_ID → $SLUG"
else
  echo -e "${RED}  ✗${NC} project_id $PROJECT_ID nicht aufloesbar"
  FAILED=1
fi

# Check 4: ANTHROPIC_API_KEY im Container
KEY_IN_CONTAINER=$(ssh "root@$VPS_HOST" "docker exec \$(docker ps -q --filter name=pipeline) sh -c 'test -n \"\$ANTHROPIC_API_KEY\" && echo OK || echo FAIL'" 2>/dev/null || echo "FAIL")
if [[ "$KEY_IN_CONTAINER" == "OK" ]]; then
  ok "ANTHROPIC_API_KEY im Container verfuegbar"
else
  echo -e "${RED}  ✗${NC} ANTHROPIC_API_KEY fehlt im Docker Container"
  FAILED=1
fi

# ============================================================
# ERGEBNIS
# ============================================================

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}================================================${NC}"
  echo -e "${GREEN}  Projekt $SLUG ist verbunden!${NC}"
  echo -e "${GREEN}================================================${NC}"
  echo ""
  echo "  Server:     $(echo "$HEALTH" | node -e "try{process.stdout.write('https://$VPS_HOST')}catch{}" 2>/dev/null || echo "https://$VPS_HOST")"
  echo "  Projekt:    $SLUG (project_id: $PROJECT_ID)"
  echo "  Verifiziert: Health OK, Logs OK, project_id OK, API Key OK"
  echo ""
  echo "  Der VPS empfaengt jetzt Tickets fuer dieses Projekt."
  echo ""
else
  echo -e "${RED}================================================${NC}"
  echo -e "${RED}  Projekt $SLUG NICHT vollstaendig verbunden!${NC}"
  echo -e "${RED}================================================${NC}"
  echo ""
  echo "  Fehlgeschlagene Checks oben pruefen und beheben."
  echo "  Dann dieses Script erneut ausfuehren."
  echo ""
  exit 1
fi
