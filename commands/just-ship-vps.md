---
name: just-ship-vps
description: Autonomes Dev-Environment auf einem VPS einrichten — Docker, HTTPS, Pipeline-Server
---

# /just-ship-vps — VPS Setup

Richte einen VPS als autonomes Entwicklungs-Environment ein. Der VPS empfaengt Tickets vom Board und entwickelt sie autonom.

## Voraussetzungen

Teile dem User mit, was du brauchst. Gib klare Anweisungen, keine Fragen:

```
Ich richte jetzt just-ship auf deinem VPS ein. Dafuer brauche ich von dir:

1. **VPS IP-Adresse**
   → Hostinger Dashboard → dein VPS → IP kopieren

2. **SSH-Zugang**
   → Ich verbinde mich per SSH. Falls du noch keinen SSH Key hast:
     ssh-keygen -t ed25519
   Dann den Key auf den VPS kopieren:
     ssh-copy-id root@DEINE-IP
   Danach sollte `ssh root@DEINE-IP` ohne Passwort funktionieren.

3. **GitHub Personal Access Token**
   → github.com → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
   → Generate new token → Scopes: repo + workflow → Generate → Token kopieren

4. **Domain/Subdomain fuer HTTPS**
   → Setze einen DNS A-Record: z.B. dev.deinedomain.de → VPS-IP
   → Beim Domain-Provider unter DNS-Einstellungen einen A-Record anlegen
   → Die Subdomain muss auf die VPS-IP zeigen

Gib mir diese 4 Dinge, dann mache ich den Rest.
```

Warte auf die Antwort des Users. Wenn alles da ist, weiter.

## Phase 1: VPS einrichten

Alle Schritte laufen per SSH. Verwende `ssh root@<IP> "<command>"` fuer jeden Befehl.

### 1.1 SSH-Verbindung pruefen

```bash
ssh -o ConnectTimeout=5 root@<IP> "echo 'SSH OK'"
```

Falls fehlschlaegt: Sage dem User was zu tun ist (ssh-copy-id nochmal, Firewall pruefen).

### 1.2 System-Update

```bash
ssh root@<IP> "apt-get update && apt-get upgrade -y"
```

### 1.3 Docker installieren

```bash
ssh root@<IP> "curl -fsSL https://get.docker.com | sh"
```

Pruefen:
```bash
ssh root@<IP> "docker --version && docker compose version"
```

### 1.4 User erstellen

```bash
ssh root@<IP> "id claude-dev 2>/dev/null || (useradd -m -s /bin/bash claude-dev && usermod -aG docker claude-dev)"
```

### 1.5 Verzeichnisse anlegen

```bash
ssh root@<IP> "mkdir -p /home/claude-dev/projects /home/claude-dev/.just-ship && chown -R claude-dev:claude-dev /home/claude-dev"
```

### 1.6 Just-Ship Framework klonen

```bash
ssh root@<IP> "su - claude-dev -c 'git clone https://github.com/yves-s/just-ship.git /home/claude-dev/just-ship 2>/dev/null || (cd /home/claude-dev/just-ship && git pull)'"
```

### 1.7 Globale Env-Datei erstellen

Erstelle `/home/claude-dev/.env` mit dem GitHub Token:

```bash
ssh root@<IP> "cat > /home/claude-dev/.env << 'ENVEOF'
GH_TOKEN=<github-token>
ENVEOF
chmod 600 /home/claude-dev/.env && chown claude-dev:claude-dev /home/claude-dev/.env"
```

### 1.8 Server-Config erstellen

Generiere einen zufaelligen Pipeline Key:

```bash
PIPELINE_KEY=$(openssl rand -hex 32)
```

Erstelle `/home/claude-dev/.just-ship/server-config.json`:

```bash
ssh root@<IP> "cat > /home/claude-dev/.just-ship/server-config.json << CFGEOF
{
  \"server\": {
    \"port\": 3001,
    \"pipeline_key\": \"$PIPELINE_KEY\"
  },
  \"workspace\": {
    \"workspace_id\": \"\",
    \"board_url\": \"\",
    \"api_key\": \"\"
  },
  \"projects\": {}
}
CFGEOF
chown claude-dev:claude-dev /home/claude-dev/.just-ship/server-config.json
chmod 600 /home/claude-dev/.just-ship/server-config.json"
```

Die Workspace-Felder werden in Phase 2 befuellt.

### 1.9 Caddyfile erstellen

```bash
ssh root@<IP> "cat > /home/claude-dev/just-ship/vps/Caddyfile << 'CADDYEOF'
<domain> {
    reverse_proxy pipeline-server:3001
}
CADDYEOF
chown claude-dev:claude-dev /home/claude-dev/just-ship/vps/Caddyfile"
```

Ersetze `<domain>` mit der Subdomain des Users.

### 1.10 Docker Image bauen und starten

```bash
ssh root@<IP> "cd /home/claude-dev/just-ship && docker compose -f vps/docker-compose.yml build && docker compose -f vps/docker-compose.yml up -d"
```

### 1.11 Verifizieren

Warte 10 Sekunden (Caddy braucht Zeit fuer das Zertifikat), dann:

```bash
curl -s "https://<domain>/health"
```

Erwartete Antwort: `{"status":"ok","mode":"multi-project","running":null}`

Falls fehlschlaegt: Container-Logs pruefen:
```bash
ssh root@<IP> "cd /home/claude-dev/just-ship && docker compose -f vps/docker-compose.yml logs --tail=50"
```

### 1.12 Ergebnis melden

```
VPS ist eingerichtet!

- Server: https://<domain>
- Pipeline Key: <PIPELINE_KEY>
- Status: Bereit fuer Projekte

Naechster Schritt: Projekt verbinden. Sag mir welches Projekt du anbinden willst.
```

## Phase 2: Projekt verbinden

Wird pro Projekt ausgefuehrt. Der User sagt welches Projekt.

### 2.1 Lokale Projekt-Config lesen

Lies `project.json` im lokalen Projektverzeichnis:
- `pipeline.workspace_id` → fuer Board-Verbindung
- `pipeline.project_id` → Projekt-UUID im Board

Lies auch die Board-Credentials:
```bash
WS_ID=$(node -e "process.stdout.write(require('<project-path>/project.json').pipeline?.workspace_id || '')")
WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id "$WS_ID")
BOARD_URL=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url)")
API_KEY=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key)")
```

### 2.2 Lokale Env-Vars sammeln

Lies aus dem lokalen Projekt:
- `.env` oder `.env.local` — suche nach ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, etc.
- Frage den User ob noch weitere Env-Vars benoetigt werden

### 2.3 Projekt auf VPS klonen

```bash
ssh root@<IP> "su - claude-dev -c 'git clone <repo-url> /home/claude-dev/projects/<slug>'"
```

### 2.4 setup.sh im Projekt ausfuehren

```bash
ssh root@<IP> "su - claude-dev -c 'cd /home/claude-dev/projects/<slug> && bash /home/claude-dev/just-ship/setup.sh'"
```

### 2.5 Projekt-Env-Datei erstellen

```bash
ssh root@<IP> "cat > /home/claude-dev/.env.<slug> << 'ENVEOF'
ANTHROPIC_API_KEY=<key>
SUPABASE_URL=<url>
SUPABASE_SERVICE_KEY=<key>
# ... weitere projekt-spezifische vars
ENVEOF
chmod 600 /home/claude-dev/.env.<slug> && chown claude-dev:claude-dev /home/claude-dev/.env.<slug>"
```

### 2.6 Server-Config aktualisieren

Aktualisiere `/home/claude-dev/.just-ship/server-config.json`:
- Setze `workspace.workspace_id`, `workspace.board_url`, `workspace.api_key` (falls noch leer)
- Fuege das Projekt unter `projects` hinzu:

```json
{
  "projects": {
    "<slug>": {
      "project_id": "<uuid-from-board>",
      "repo_url": "<repo-url>",
      "project_dir": "/home/claude-dev/projects/<slug>",
      "env_file": "/home/claude-dev/.env.<slug>"
    }
  }
}
```

Verwende `node -e` oder `jq` um das JSON sauber zu mergen.

### 2.7 Server neu starten

```bash
ssh root@<IP> "cd /home/claude-dev/just-ship && docker compose -f vps/docker-compose.yml restart pipeline-server"
```

### 2.8 Verifizieren

```bash
curl -s "https://<domain>/health"
```

Sollte jetzt das Projekt listen.

### 2.9 Board konfigurieren

Sage dem User:

```
Projekt <name> ist verbunden!

Damit der "Develop" Button im Board funktioniert, muessen noch die Pipeline-Settings
im Workspace konfiguriert werden:

- Pipeline URL: https://<domain>
- Pipeline Key: <PIPELINE_KEY>

Das kann im Board unter Settings → Workspace → Pipeline konfiguriert werden.
```

## Fehlerbehandlung

- **SSH schlaegt fehl:** User anweisen ssh-copy-id nochmal zu machen, Firewall/Port 22 pruefen
- **Docker Build fehlschlaegt:** Logs zeigen, meist fehlende Dependencies oder Netzwerk
- **HTTPS-Zertifikat fehlschlaegt:** DNS A-Record pruefen (kann bis zu 24h dauern), Port 80+443 muessen offen sein
- **Health-Check fehlschlaegt:** Container-Logs pruefen, Port-Mapping verifizieren
