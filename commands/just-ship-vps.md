---
name: just-ship-vps
description: VPS verwalten — Status pruefen, Projekte verbinden, neuen VPS einrichten
---

# /just-ship-vps — VPS Setup

Richte einen VPS als autonomes Entwicklungs-Environment ein. Der VPS empfaengt Tickets vom Board und entwickelt sie autonom.

## WICHTIG: Secrets maskieren

Gib NIEMALS API Keys, Tokens oder Passwoerter im Klartext im Chat aus.
Wenn du Werte gesammelt hast, zeige sie maskiert:

- `ANTHROPIC_API_KEY=sk-ant-...d4f8`  (erste 6 + letzte 4 Zeichen)
- `GH_TOKEN=ghp_...x9mK`
- `api_key=adp_...0d56`

Die echten Werte werden direkt per SSH auf den VPS geschrieben — sie muessen nie im Chat sichtbar sein.

## Phase 0: VPS-Status pruefen

**IMMER zuerst ausfuehren** bevor du den User nach Daten fragst.

### 0.1 Workspace-ID ermitteln

Lies die `pipeline.workspace_id` aus `project.json` des aktuellen Projekts:

```bash
WS_ID=$(node -e "process.stdout.write(require('./project.json').pipeline?.workspace_id || '')")
```

Falls keine `workspace_id` vorhanden → direkt zu "Voraussetzungen" (Neuer VPS).

### 0.2 VPS-URL aus der Pipeline-DB pruefen

Via Supabase MCP (Pipeline-DB `wsmnutkobalfrceavpxs`):

```sql
SELECT id, name, vps_url, vps_api_key
FROM public.workspaces
WHERE id = '<workspace_id>';
```

### 0.3 Entscheidungsbaum

```
vps_url ist leer oder NULL?
  → JA: Neuer VPS → weiter mit "Voraussetzungen"
  → NEIN: VPS existiert bereits → 0.4 Health-Check
```

### 0.4 Health-Check auf bestehenden VPS

Extrahiere die IP/Domain aus `vps_url` und pruefe:

```bash
curl -sf "<vps_url>/health" --max-time 5
```

```
Health-Check erfolgreich ({"status":"ok"})?
  → JA: VPS laeuft → 0.5 Status melden
  → NEIN: VPS nicht erreichbar → 0.6 Diagnose anbieten
```

### 0.5 VPS laeuft — Status melden und Optionen anbieten

```
VPS ist bereits eingerichtet und laeuft!

- Server: <vps_url>
- Status: <health-response>

Was moechtest du tun?
1. **Weiteres Projekt verbinden** → Phase 2
2. **VPS updaten** (just-ship + Docker Image neu bauen)
3. **VPS-Status + Logs anzeigen**
```

Warte auf die Antwort des Users und fuehre die gewaehlte Option aus:
- **Option 1:** Springe zu Phase 2 (Projekt verbinden)
- **Option 2:** Fuehre das Update aus:
  ```bash
  # IP/Domain aus vps_url extrahieren
  ssh root@<IP> "cd /home/claude-dev/just-ship && git pull && docker compose -f vps/docker-compose.yml build --no-cache pipeline-server && docker compose -f vps/docker-compose.yml up -d pipeline-server"
  ```
  Dann Health-Check und Ergebnis melden.
- **Option 3:** Zeige Logs und Container-Status:
  ```bash
  ssh root@<IP> "docker ps --filter name=pipeline && docker logs --tail 30 \$(docker ps -q --filter name=pipeline) 2>&1"
  ```

### 0.6 VPS nicht erreichbar — Diagnose

```
VPS ist konfiguriert (<vps_url>), aber der Health-Check schlaegt fehl.

Moegliche Ursachen:
- Server ist gestoppt → Container neu starten
- Netzwerk/Firewall blockiert den Port
- Domain/DNS stimmt nicht mehr

Soll ich per SSH debuggen? Dafuer brauche ich die VPS IP-Adresse.
```

Falls der User die IP gibt, SSH-Verbindung testen und Container-Status pruefen:
```bash
ssh -o ConnectTimeout=5 root@<IP> "docker ps --filter name=pipeline && docker logs --tail 20 \$(docker ps -q --filter name=pipeline) 2>&1"
```

---

## Voraussetzungen (Neuer VPS)

Nur wenn Phase 0 ergeben hat, dass kein VPS konfiguriert ist.

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
   → https://github.com/settings/tokens/new
   → Scopes: repo, workflow, read:org → Generate → Token kopieren
   → WICHTIG: read:org wird benoetigt, damit gh auth funktioniert

4. **Anthropic API Key**
   → https://console.anthropic.com/settings/keys → Key kopieren
   → Wird fuer den Pipeline-Agent benoetigt (Claude Code CLI auf dem VPS)

5. **Subdomain fuer HTTPS** (empfohlen)
   → Setze einen DNS A-Record: just-ship.deinedomain.de → VPS-IP
   → Beim Domain-Provider unter DNS-Einstellungen einen A-Record anlegen
   → Paste die URL hier in den Chat, dann richte ich HTTPS gleich mit ein
   → Ohne HTTPS wird der API Key unverschluesselt uebertragen

Gib mir diese 5 Dinge, dann mache ich den Rest.
```

Warte auf die Antwort des Users. Wenn alles da ist, weiter.

## Phase 1: VPS einrichten

Alle Schritte laufen per SSH. Verwende `ssh root@<IP> "<command>"` fuer jeden Befehl.

### 1.1 SSH-Verbindung pruefen

```bash
ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new root@<IP> "echo 'SSH OK'"
```

Falls fehlschlaegt: Sage dem User was zu tun ist (ssh-copy-id nochmal, Firewall pruefen).

### 1.2 System-Update

```bash
ssh root@<IP> "apt-get update && apt-get upgrade -y"
```

### 1.3 Docker + gh CLI installieren

Docker:
```bash
ssh root@<IP> "curl -fsSL https://get.docker.com | sh"
```

Node.js 20 installieren (wird von setup.sh benoetigt):
```bash
ssh root@<IP> "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
```

gh CLI auf dem Host installieren (wird fuer setup.sh und claude-dev User gebraucht):
```bash
ssh root@<IP> "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null && ARCH=\$(dpkg --print-architecture) && echo \"deb [arch=\${ARCH} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\" > /etc/apt/sources.list.d/github-cli.list && apt-get update -qq && apt-get install -y gh -qq"
```

Pruefen:
```bash
ssh root@<IP> "docker --version && docker compose version && node --version && gh --version"
```

### 1.4 User erstellen + authentifizieren

```bash
ssh root@<IP> "id claude-dev 2>/dev/null || (useradd -m -u 1001 -s /bin/bash claude-dev && usermod -aG docker claude-dev)"
```

Git-Identity und GitHub-Auth fuer claude-dev einrichten:
```bash
ssh root@<IP> "su - claude-dev -c 'git config --global user.name \"Claude Dev\" && git config --global user.email \"claude-dev@pipeline\" && git config --global init.defaultBranch main'"
ssh root@<IP> "su - claude-dev -c 'echo <github-token> | gh auth login --with-token && gh auth setup-git'"
```

Falls `gh auth login` mit `missing required scope 'read:org'` fehlschlaegt:
Der User muss einen neuen Token mit `read:org` Scope erstellen. Sage dem User:
```
Der GitHub Token braucht den Scope `read:org`. Bitte erstelle einen neuen Token mit:
repo + workflow + read:org → https://github.com/settings/tokens/new
```

Alternativ als Fallback: `GH_TOKEN` als Env-Var setzen (umgeht die Scope-Validierung):
```bash
ssh root@<IP> "su - claude-dev -c 'echo \"export GH_TOKEN=<github-token>\" >> ~/.bashrc && GH_TOKEN=<github-token> gh auth setup-git 2>/dev/null || true'"
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

Erstelle `/home/claude-dev/.env` mit GitHub Token und Anthropic API Key.
Diese gelten global fuer alle Projekte auf dem VPS:

```bash
ssh root@<IP> "
CLAUDE_UID=\$(id -u claude-dev)
CLAUDE_GID=\$(id -g claude-dev)
cat > /home/claude-dev/.env << ENVEOF
GH_TOKEN=<github-token>
ANTHROPIC_API_KEY=<anthropic-key>
CLAUDE_UID=\$CLAUDE_UID
CLAUDE_GID=\$CLAUDE_GID
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

### 1.9 Docker Image bauen und starten

Ohne HTTPS (Default):

```bash
ssh root@<IP> "cd /home/claude-dev/just-ship && CLAUDE_UID=\$(id -u claude-dev) CLAUDE_GID=\$(id -g claude-dev) docker compose -f vps/docker-compose.yml build pipeline-server && CLAUDE_UID=\$(id -u claude-dev) CLAUDE_GID=\$(id -g claude-dev) docker compose -f vps/docker-compose.yml up -d pipeline-server"
```

Mit HTTPS (falls User eine Domain angegeben hat): Zuerst Caddyfile erstellen, dann alle Services starten:

```bash
ssh root@<IP> "cat > /home/claude-dev/just-ship/vps/Caddyfile << 'CADDYEOF'
<domain> {
    reverse_proxy pipeline-server:3001
}
CADDYEOF
chown claude-dev:claude-dev /home/claude-dev/just-ship/vps/Caddyfile"

ssh root@<IP> "cd /home/claude-dev/just-ship && CLAUDE_UID=\$(id -u claude-dev) CLAUDE_GID=\$(id -g claude-dev) docker compose -f vps/docker-compose.yml build pipeline-server && CLAUDE_UID=\$(id -u claude-dev) CLAUDE_GID=\$(id -g claude-dev) docker compose -f vps/docker-compose.yml up -d"
```

### 1.10 Verifizieren

Warte 10 Sekunden (Caddy braucht Zeit fuer HTTPS-Zertifikat), dann:

```bash
ssh root@<IP> "curl -s http://localhost:3001/health"
```

Erwartete Antwort: `{"status":"ok","mode":"multi-project","running":null}`

Falls HTTPS aktiv, auch extern pruefen:
```bash
curl -s "https://<domain>/health"
```

Falls Server restartet oder keine Antwort kommt, debuggen:
```bash
ssh root@<IP> "docker logs <container-name> 2>&1"
ssh root@<IP> "docker inspect <container-name> --format '{{.State.Status}} exit={{.State.ExitCode}}'"
```

Falls Container restartet ohne Logs — Entrypoint crasht. Mit ueberschriebenem Entrypoint testen:
```bash
ssh root@<IP> "docker run --rm --env-file /home/claude-dev/.env -e SERVER_CONFIG_PATH=/home/claude-dev/.just-ship/server-config.json -v /home/claude-dev/.just-ship:/home/claude-dev/.just-ship:ro --entrypoint sh <image-name> -c 'cd /app && node --import tsx pipeline/server.ts 2>&1'"
```

### 1.11 Ergebnis melden

Ohne HTTPS:
```
VPS ist eingerichtet!

- Server: http://<IP>:3001
- Pipeline Key: <PIPELINE_KEY> (maskiert)
- Status: Bereit fuer Projekte

HTTPS ist nicht aktiv. Fuer HTTPS siehe vps/README.md → "HTTPS einrichten".

**Naechster Schritt: Projekt verbinden.**

Jetzt muss ich noch wissen, an welchem Projekt der VPS arbeiten soll.
Sag mir einfach den Namen oder Pfad — z.B. "mein-projekt" oder "~/Developer/mein-projekt".
```

Mit HTTPS:
```
VPS ist eingerichtet!

- Server: https://<domain>
- Pipeline Key: <PIPELINE_KEY> (maskiert)
- Status: Bereit fuer Projekte

**Naechster Schritt: Projekt verbinden.**

Jetzt muss ich noch wissen, an welchem Projekt der VPS arbeiten soll.
Sag mir einfach den Namen oder Pfad — z.B. "mein-projekt" oder "~/Developer/mein-projekt".
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

### 2.2 Env-Vars sammeln

Der ANTHROPIC_API_KEY wurde in den Voraussetzungen schon gesammelt. Falls nicht vorhanden, den User fragen.

Zusaetzlich aus dem lokalen Projekt pruefen:
- `.env` oder `.env.local` — suche nach SUPABASE_URL, SUPABASE_SERVICE_KEY, etc.
- Falls weitere projektspezifische Env-Vars gefunden werden, dem User maskiert zeigen

### 2.3 Projekt auf VPS klonen

```bash
ssh root@<IP> "su - claude-dev -c 'git clone <repo-url> /home/claude-dev/projects/<slug>'"
```

### 2.4 setup.sh im Projekt ausfuehren

`GH_TOKEN` muss als Env-Var gesetzt sein, damit `gh` im setup.sh authentifiziert ist:

```bash
ssh root@<IP> "su - claude-dev -c 'export GH_TOKEN=<github-token> && cd /home/claude-dev/projects/<slug> && bash /home/claude-dev/just-ship/setup.sh'"
```

### 2.5 Projekt-Env-Datei erstellen

```bash
ssh root@<IP> "cat > /home/claude-dev/.just-ship/env.<slug> << 'ENVEOF'
ANTHROPIC_API_KEY=<anthropic-key>
GH_TOKEN=<github-token>
# ... weitere projekt-spezifische vars
ENVEOF
chmod 600 /home/claude-dev/.just-ship/env.<slug> && chown claude-dev:claude-dev /home/claude-dev/.just-ship/env.<slug>"
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
      "env_file": "/home/claude-dev/.just-ship/env.<slug>"
    }
  }
}
```

Verwende `node -e` um das JSON sauber zu mergen.

### 2.7 Server neu starten

```bash
ssh root@<IP> "cd /home/claude-dev/just-ship && CLAUDE_UID=\$(id -u claude-dev) CLAUDE_GID=\$(id -g claude-dev) docker compose -f vps/docker-compose.yml up -d --force-recreate pipeline-server"
```

### 2.8 Verifizieren

```bash
ssh root@<IP> "curl -s http://localhost:3001/health"
```

Sollte jetzt das Projekt listen. Pruefe die Logs:
```bash
ssh root@<IP> "docker logs <container-name> 2>&1 | tail -10"
```

Erwartete Log-Zeile: `Projects: <slug>`

### 2.9 Pipeline im Board registrieren

Die Pipeline-Verbindung (URL + Key) wird automatisch im Board gesetzt via Supabase MCP.

Bestimme die Pipeline-URL:
- Mit HTTPS: `https://<domain>`
- Ohne HTTPS: `http://<IP>:3001`

Via Supabase MCP (Pipeline-DB `wsmnutkobalfrceavpxs`):

```sql
UPDATE public.workspaces
SET vps_url = '<pipeline-url>', vps_api_key = '<PIPELINE_KEY>'
WHERE id = '<workspace_id>'
RETURNING id, name, vps_url;
```

Falls der Supabase MCP nicht verfuegbar ist, dem User sagen:
```
Pipeline-Settings muessen manuell im Board konfiguriert werden:
Board → Settings → Workspace → Pipeline
- Pipeline URL: <pipeline-url>
- Pipeline Key: <PIPELINE_KEY>
```

### 2.10 Ergebnis melden

```
Projekt <name> ist verbunden!

- Server: <pipeline-url>
- Projekt: <slug> (project_id: <uuid>)
- Board: Pipeline-Verbindung konfiguriert
- Status: Bereit — "Develop" Button im Board funktioniert

Der VPS empfaengt jetzt Tickets vom Board und entwickelt sie autonom.
```

## Fehlerbehandlung

- **SSH schlaegt fehl:** User anweisen ssh-copy-id nochmal zu machen, Firewall/Port 22 pruefen
- **gh auth: missing scope 'read:org':** User muss neuen Token mit read:org erstellen, oder GH_TOKEN env var als Fallback nutzen
- **setup.sh: gh NOT FOUND:** gh CLI nicht auf dem Host installiert (Phase 1.3 nochmal pruefen)
- **setup.sh haengt oder bricht ab:** `GH_TOKEN` env var muss gesetzt sein (Phase 2.4)
- **Docker Build fehlschlaegt:** Logs zeigen, meist fehlende Dependencies oder Netzwerk
- **Container restartet ohne Logs:** Entrypoint crasht — mit `--entrypoint sh` debuggen (Phase 1.10)
- **Port 3001 nicht erreichbar:** Firewall pruefen, `ufw allow 3001/tcp` oder Hostinger Firewall-Settings
- **HTTPS-Zertifikat fehlschlaegt:** DNS A-Record pruefen (kann bis zu 24h dauern), Port 80+443 muessen offen sein
- **Health-Check fehlschlaegt:** Container-Logs pruefen, Port-Mapping verifizieren
