#!/bin/bash
# ============================================================
# logs.sh — Docker Container Logs vom Remote-VPS
#
# Laeuft LOKAL, verbindet sich per SSH und streamt Docker-Logs.
#
# Usage:
#   bash vps/logs.sh --host <ip-or-domain> [container] [options]
#
# Arguments:
#   container          Container-Name oder ID (partial match via grep)
#
# Options:
#   --host <host>      VPS Hostname oder IP (required)
#   -n, --lines <N>    Anzahl Zeilen (default: 100)
#   -f, --follow       Log-Output live folgen
#   -h, --help         Hilfe anzeigen
#
# Examples:
#   bash vps/logs.sh --host 72.60.32.232
#   bash vps/logs.sh --host 72.60.32.232 pipeline
#   bash vps/logs.sh --host 72.60.32.232 pipeline -n 50
#   bash vps/logs.sh --host 72.60.32.232 pipeline -f
#   bash vps/logs.sh --host 72.60.32.232 caddy -f -n 200
# ============================================================

set -euo pipefail

# --- Farben ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ~${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }
h()    { echo -e "\n${YELLOW}▶ $*${NC}"; }

# --- Hilfe ---
usage() {
  echo ""
  echo "Usage: bash vps/logs.sh --host <ip-or-domain> [container] [options]"
  echo ""
  echo "Arguments:"
  echo "  container          Container-Name oder ID (partial match)"
  echo ""
  echo "Options:"
  echo "  --host <host>      VPS Hostname oder IP (required)"
  echo "  -n, --lines <N>    Anzahl Zeilen (default: 100)"
  echo "  -f, --follow       Log-Output live folgen"
  echo "  -h, --help         Diese Hilfe anzeigen"
  echo ""
  echo "Examples:"
  echo "  bash vps/logs.sh --host 72.60.32.232"
  echo "  bash vps/logs.sh --host 72.60.32.232 pipeline"
  echo "  bash vps/logs.sh --host 72.60.32.232 pipeline -n 50"
  echo "  bash vps/logs.sh --host 72.60.32.232 pipeline -f"
  echo "  bash vps/logs.sh --host 72.60.32.232 caddy -f -n 200"
  echo ""
}

# --- Argumente parsen ---
HOST=""
CONTAINER=""
LINES=100
FOLLOW=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --host)       HOST="$2"; shift 2 ;;
    -n|--lines)   LINES="$2"; shift 2 ;;
    -f|--follow)  FOLLOW=true; shift ;;
    -h|--help)    usage; exit 0 ;;
    --*)          echo "Unbekannte Option: $1"; usage; exit 1 ;;
    *)
      # Erstes Positional-Argument ist der Container-Name
      if [[ -z "$CONTAINER" ]]; then
        CONTAINER="$1"
      else
        echo "Unbekanntes Argument: $1"; usage; exit 1
      fi
      shift
      ;;
  esac
done

# --- Pflicht-Parameter pruefen ---
[[ -z "$HOST" ]] && { echo -e "${RED}Fehler:${NC} --host ist erforderlich."; usage; exit 1; }

# SECURITY: Validate HOST is a valid hostname/IP (no injection chars)
if ! [[ "$HOST" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  fail "--host muss ein gültiger Hostname oder IP sein (erhalten: $HOST)"
fi

# LINES muss eine positive Zahl sein
if ! [[ "$LINES" =~ ^[0-9]+$ ]] || [[ "$LINES" -lt 1 ]]; then
  fail "--lines muss eine positive Ganzzahl sein (erhalten: $LINES)"
fi

# --- SSH Verbindung pruefen ---
h "Verbindung pruefen"

ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "root@$HOST" "echo ok" >/dev/null 2>&1 \
  || fail "SSH zu root@$HOST fehlgeschlagen. SSH-Key hinterlegt? ssh-copy-id root@$HOST"
ok "SSH erreichbar: root@$HOST"

# --- Keine Container-Angabe: Liste ausgeben ---
if [[ -z "$CONTAINER" ]]; then
  h "Laufende Docker-Container auf $HOST"
  echo ""
  ssh "root@$HOST" "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
  echo ""
  echo -e "${YELLOW}Tipp:${NC} Containername als Argument uebergeben:"
  echo "  bash vps/logs.sh --host $HOST <container-name>"
  echo ""
  exit 0
fi

# --- Container-Name aufloesen ---
h "Container suchen: '$CONTAINER'"

# SECURITY: Escape container name for shell injection protection
CONTAINER_ESCAPED="${CONTAINER//\'/\'\\\'\'}"

CONTAINER_ID=$(ssh "root@$HOST" "docker ps --filter 'name='\''$CONTAINER_ESCAPED'\'' -q" 2>/dev/null || true)

if [[ -z "$CONTAINER_ID" ]]; then
  echo -e "${RED}  ✗${NC} Kein laufender Container mit Name '$CONTAINER' gefunden."
  echo ""
  echo -e "${YELLOW}Laufende Container:${NC}"
  ssh "root@$HOST" "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
  echo ""
  exit 1
fi

# Bei mehreren Matches den vollstaendigen Namen des ersten treffer anzeigen
CONTAINER_NAME=$(ssh "root@$HOST" "docker ps --filter 'name='\''$CONTAINER_ESCAPED'\'' --format '{{.Names}}' | head -1")
MATCH_COUNT=$(echo "$CONTAINER_ID" | wc -l | tr -d ' ')

if [[ "$MATCH_COUNT" -gt 1 ]]; then
  warn "Mehrere Container gefunden ($MATCH_COUNT). Verwende ersten: $CONTAINER_NAME"
  CONTAINER_ID=$(echo "$CONTAINER_ID" | head -1)
else
  ok "Container gefunden: $CONTAINER_NAME ($CONTAINER_ID)"
fi

# --- Logs ausgeben ---
if [[ "$FOLLOW" == true ]]; then
  h "Live-Logs: $CONTAINER_NAME (tail=$LINES, follow)"
  echo -e "${YELLOW}  Ctrl+C zum Beenden${NC}"
  echo ""
  # -t fuer pseudo-TTY damit Farben und Ctrl+C funktionieren
  ssh -t "root@$HOST" "docker logs --tail $LINES -f $CONTAINER_ID" 2>&1
else
  h "Logs: $CONTAINER_NAME (letzte $LINES Zeilen)"
  echo ""
  ssh "root@$HOST" "docker logs --tail $LINES $CONTAINER_ID" 2>&1
fi
