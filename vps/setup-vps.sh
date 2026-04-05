#!/bin/bash
# ============================================================
# DEPRECATED: This script has been replaced by Docker-based VPS setup.
# Use the /just-ship-vps command in Claude Code instead.
# See vps/docker-compose.yml and vps/Dockerfile for the new approach.
# ============================================================
# =============================================================================
# setup-vps.sh — Hostinger VPS Initial Setup
#
# Läuft als ROOT auf Ubuntu 22.04.
# Installiert alle Dependencies, erstellt den claude-dev User und
# richtet die Pipeline-Infrastruktur ein.
#
# Usage:
#   curl -o setup-vps.sh https://raw.githubusercontent.com/.../setup-vps.sh
#   chmod +x setup-vps.sh && sudo bash setup-vps.sh
#
# Environment (optional, interaktiv wenn nicht gesetzt):
#   ANTHROPIC_API_KEY    Claude API Key
#   GH_TOKEN             GitHub Personal Access Token (repo + workflow scope)
#   PIPELINE_SECRET      Webhook-Secret (random, wird generiert wenn leer)
# =============================================================================

set -euo pipefail

# ── Farben ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ~${NC} $*"; }
err()  { echo -e "${RED}  ✗${NC} $*"; }
h()    { echo -e "\n${YELLOW}▶ $*${NC}"; }

# ── Root-Check ────────────────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
  err "Dieses Script muss als root ausgeführt werden."
  exit 1
fi

echo ""
echo "================================================"
echo "  Just Ship — VPS Setup"
echo "  Ubuntu 22.04 / Hostinger"
echo "================================================"
echo ""

# ── System-Update ─────────────────────────────────────────────────────────────

h "System aktualisieren"
apt-get update -q
apt-get upgrade -y -q
ok "System aktuell"

# ── Dependencies installieren ─────────────────────────────────────────────────

h "Dependencies installieren"

# Node.js 20 LTS
if ! command -v node &>/dev/null || [[ "$(node --version)" < "v20" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -q
  apt-get install -y -q nodejs
fi
ok "Node.js $(node --version)"

# Basis-Tools
apt-get install -y -q \
  git \
  python3 \
  python3-pip \
  curl \
  jq \
  unzip \
  build-essential
ok "git, python3, curl, jq"

# GitHub CLI
if ! command -v gh &>/dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
    dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
    tee /etc/apt/sources.list.d/github-cli.list
  apt-get update -q
  apt-get install -y -q gh
fi
ok "gh $(gh --version | head -1 | awk '{print $3}')"

# Claude Code CLI
if ! command -v claude &>/dev/null; then
  npm install -g @anthropic-ai/claude-code --quiet
fi
ok "claude $(claude --version 2>/dev/null | head -1 || echo 'installed')"

# ── claude-dev User erstellen ─────────────────────────────────────────────────

h "claude-dev User einrichten"

if ! id "claude-dev" &>/dev/null; then
  useradd -m -s /bin/bash claude-dev
  ok "User claude-dev erstellt"
else
  warn "User claude-dev existiert bereits"
fi

# DEPRECATED: Use Docker-based setup instead (see vps/docker-compose.yml)
# Restrict sudo to git only — no blanket sudo group membership
echo "claude-dev ALL=(ALL) NOPASSWD: /usr/bin/git" > /etc/sudoers.d/claude-dev
chmod 440 /etc/sudoers.d/claude-dev

# Log-Verzeichnis
LOG_DIR="/home/claude-dev/pipeline-logs"
mkdir -p "$LOG_DIR"
chown claude-dev:claude-dev "$LOG_DIR"
ok "Log-Dir: $LOG_DIR"

# ── API Keys einlesen ─────────────────────────────────────────────────────────

h "API Keys konfigurieren"

ENV_FILE="/home/claude-dev/.env"

# Lese Keys interaktiv wenn nicht als Umgebungsvariable gesetzt
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  read -rsp "  ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY
  echo ""
fi

if [ -z "${GH_TOKEN:-}" ]; then
  echo ""
  echo "  GitHub Token benötigt (Scopes: repo, workflow):"
  echo "  → https://github.com/settings/tokens/new"
  read -rsp "  GH_TOKEN: " GH_TOKEN
  echo ""
fi

if [ -z "${PIPELINE_SECRET:-}" ]; then
  PIPELINE_SECRET=$(openssl rand -hex 32)
  echo "  PIPELINE_SECRET generiert (wird in .env gespeichert)"
fi

# Bugsink secrets auto-generieren
BUGSINK_SECRET_KEY=$(openssl rand -base64 50)
BUGSINK_ADMIN_PASSWORD=$(openssl rand -base64 32)

# .env schreiben
cat > "$ENV_FILE" <<ENVEOF
# Just Ship — Environment
# Generiert von setup-vps.sh am $(date +%Y-%m-%d)

ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
GH_TOKEN=${GH_TOKEN}
PIPELINE_SECRET=${PIPELINE_SECRET}

# Bugsink (auto-generated)
BUGSINK_SECRET_KEY=${BUGSINK_SECRET_KEY}
BUGSINK_ADMIN_EMAIL=admin@localhost
BUGSINK_ADMIN_PASSWORD=${BUGSINK_ADMIN_PASSWORD}
ENVEOF

chmod 600 "$ENV_FILE"
chown claude-dev:claude-dev "$ENV_FILE"
ok ".env gespeichert (chmod 600)"

# ── Git konfigurieren ─────────────────────────────────────────────────────────

h "Git konfigurieren"

su - claude-dev -c "git config --global user.name 'Claude Dev'"
su - claude-dev -c "git config --global user.email 'claude-dev@pipeline'"
su - claude-dev -c "git config --global init.defaultBranch main"

# gh mit GH_TOKEN authentifizieren
su - claude-dev -c "GH_TOKEN=${GH_TOKEN} gh auth setup-git" 2>/dev/null || true
echo "${GH_TOKEN}" | su - claude-dev -c "GH_TOKEN=${GH_TOKEN} gh auth login --with-token" 2>/dev/null || true

ok "Git + GitHub CLI konfiguriert"

# ── Framework klonen ──────────────────────────────────────────────────────────

h "Pipeline-Framework klonen"

FRAMEWORK_DIR="/home/claude-dev/just-ship"

if [ -d "$FRAMEWORK_DIR/.git" ]; then
  su - claude-dev -c "cd $FRAMEWORK_DIR && git pull origin main" || true
  warn "Framework bereits vorhanden — aktualisiert"
else
  su - claude-dev -c "GH_TOKEN=${GH_TOKEN} gh repo clone yves-s/just-ship $FRAMEWORK_DIR" 2>/dev/null || \
  su - claude-dev -c "git clone https://${GH_TOKEN}@github.com/yves-s/just-ship.git $FRAMEWORK_DIR"
  ok "Framework geklont → $FRAMEWORK_DIR"
fi

# ── systemd Services installieren ────────────────────────────────────────────

h "systemd Services installieren"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Service-Template installieren
install -m 644 "$SCRIPT_DIR/just-ship-pipeline@.service" \
  /etc/systemd/system/just-ship-pipeline@.service

systemctl daemon-reload
ok "systemd service template installiert"

# ── Zusammenfassung ───────────────────────────────────────────────────────────

echo ""
echo "================================================"
echo "  Setup abgeschlossen!"
echo "================================================"
echo ""
echo "Nächste Schritte:"
echo ""
echo "  1. Projekt klonen und Pipeline installieren:"
echo "     su - claude-dev"
echo "     git clone https://\$GH_TOKEN@github.com/org/repo.git ~/mein-projekt"
echo "     ~/just-ship/setup.sh  # im Projekt-Dir"
echo ""
echo "  2. Projekt-Config erstellen:"
echo "     cat > /home/claude-dev/.env.mein-projekt <<EOF"
echo "     SUPABASE_URL=https://xxx.supabase.co"
echo "     SUPABASE_SERVICE_KEY=eyJ..."
echo "     SUPABASE_PROJECT_ID=dc2b647e-...  # UUID aus tickets.project_id"
echo "     PROJECT_DIR=/home/claude-dev/mein-projekt"
echo "     POLL_INTERVAL=60"
echo "     EOF"
echo ""
echo "  3. Worker starten:"
echo "     systemctl enable --now just-ship-pipeline@mein-projekt"
echo "     journalctl -fu just-ship-pipeline@mein-projekt"
echo ""
echo "  Pipeline-Secret für Webhook:"
echo "  PIPELINE_SECRET=$(cat $ENV_FILE | grep PIPELINE_SECRET | cut -d= -f2)"
echo ""
