# PIR: Bot Attack & API Outage — 2026-04-01

> Vollständiges Dokument liegt im Board-Repo:
> `just-ship-board/docs/pir-2026-04-01-bot-attack-api-outage.md`

**Dauer:** ~7 Stunden | **Schweregrad:** Kritisch | **Datenverlust:** Keiner

## Kurzfassung

Bot-Attacke auf Auth-Endpoints des Boards + latenter Next.js 16 Routing-Bug = kompletter API-Ausfall. Root Cause war ein Dynamic-Route-Konflikt (`[slug]` vs `[workspaceId]`), der alle Serverless Functions crashte. Bots amplifizierten das Problem durch Concurrency-Slot-Exhaustion.

## Ergriffene Maßnahmen

### Code (just-ship-board)
- Next.js Route-Konflikt behoben
- Middleware: Bot-Blocking, Origin-Check, getUser()-Skip für API/Auth-Pages
- Register: Rate-Limiting (3/IP/15min), Email-Verification, fail-fast Validation
- Pipeline Auth: Unhandled Promise Fix
- Health-Endpoint + noindex Headers

### Vercel Dashboard
- Firewall: Rate Limit Auth (10/60s/IP), Block .vercel.app, Bypass Pipeline-Key + UptimeRobot
- Bot Protection: Log | AI Bots: Block | SSO Protection: On | Skew Protection: Off

### Monitoring (UptimeRobot)
- Board API Health (`/api/health`, 5min, Keyword "ok")
- Board Frontend (`/login`, 5min, HTTP 200)
- Website (`www.just-ship.io`, 5min, HTTP 200)

### Notfall-Playbook
1. UptimeRobot DOWN → Vercel Dashboard
2. Logs prüfen → Angriffsvektoren identifizieren
3. Attack Mode aktivieren (300ms global)
4. Gezielte Firewall-Rules
5. Attack Mode deaktivieren wenn Rules greifen

## Offene Punkte
- CAPTCHA auf Registration (Medium)
- Bot Protection → Enabled mit Pipeline-Bypass (Medium)
- WAF für Edge-Level DDoS (Low)
- VPS-Sicherheit erhöhen (separates Ticket)
