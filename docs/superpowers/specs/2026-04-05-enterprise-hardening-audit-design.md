# Enterprise Hardening Audit — Full-Stack Quality Gap Analysis

**Date:** 2026-04-05
**Scope:** Engine (just-ship), Board (just-ship-board), VPS/Infrastructure
**Method:** Automated deep-read of all repos + gap analysis against project skills (Product CTO, Backend, Frontend Design, Design Lead, Data Engineer, UX Planning, Creative Design)

---

## Executive Summary

Just Ship funktioniert. Aber es verstosst systematisch gegen seine eigenen Qualitaetsstandards. Die Skills definieren Enterprise-Level-Anforderungen (Structured Logging, Circuit Breakers, Error Boundaries, Metriken, Alerting). Der Code liefert Startup-Level (console.log, keine Timeouts, keine Error Boundaries, kein APM).

**Enterprise-Readiness: 6/10** — funktional, aber nicht produktionsgehaertet.

Die drei kritischsten Luecken:
1. **Observability ist null** — kein Structured Logging, keine Metriken, kein Alerting
2. **Resilience fehlt** — keine Circuit Breakers, keine Timeouts auf externe Calls, kein Rate Limiting
3. **UI-Robustheit fehlt** — keine Error Boundaries, inkonsistente Component States

---

## Bereich 1: Observability (KRITISCH)

### 1.1 Structured Logging

**Skill-Demand (Product CTO + Backend):**
- JSON Logging mit Correlation IDs, Timing, Status fuer alle externen Calls
- Log Events: `{domain}.{action}.started/completed/failed`
- Context: requestId, userId, durationMs, status
- Nie Passwords, Tokens, PII loggen

**Reality:**
- Engine: `console.log` mit manuellen Timestamps `[YYYY-MM-DD HH:MM:SS] message`
- Board: `console.error("[context]", err)` in API Routes — kein requestId, kein Timing
- VPS: systemd journal + Dozzle (in-memory, verloren bei Restart)

**Gap:** KRITISCH — Kein korreliertes Debugging moeglich. Bei Incidents: Blindflug.

**Massnahme L-01: Structured Logging einfuehren**
- Pino als Logger in Engine + Board
- JSON-Output mit: `level`, `timestamp`, `requestId`, `userId`, `workspaceId`, `ticketNumber`, `durationMs`, `service` (engine/board/worker)
- Request-ID-Propagation: Board generiert UUID, sendet als `X-Request-ID` Header an VPS, Pipeline propagiert an Agents
- Log-Levels: `debug` (dev), `info` (requests, lifecycle), `warn` (degraded), `error` (failures)
- Sensitive Data Redaction: API Keys, Tokens, Passwords automatisch maskiert
- Board: Pino-HTTP Middleware fuer automatisches Request-Logging

### 1.2 Metriken & APM

**Skill-Demand (Product CTO):**
- Error Rate, Latency p50/p95/p99, Throughput
- Per-Endpoint Metriken

**Reality:** Null. Kein APM, keine Metriken, keine Dashboards.

**Gap:** KRITISCH — Keine Sichtbarkeit in Performance oder Fehlerraten.

**Massnahme L-02: Lightweight Metriken**
- Engine: Run-Duration, Token-Cost, Error-Rate pro Projekt als JSON-Loglines (querybar via Dozzle/Loki)
- Board: Response-Time und Status-Code Logging via Pino-HTTP (kein separates APM noetig, Logs sind die Metriken)
- Bugsink Error-Rate als primaerer Health-Indikator
- Langfristig: OpenTelemetry Traces fuer Cross-Service-Korrelation

### 1.3 Alerting

**Skill-Demand (Product CTO):**
- Alerting auf Symptome: Error Rate > 1% (5min), Latency p95 > 2s

**Reality:** Kein Alerting. Bugsink sammelt Errors, aber niemand wird benachrichtigt.

**Gap:** KRITISCH — Incidents werden erst bemerkt wenn User sich beschweren.

**Massnahme L-03: Alerting-Pipeline**
- Bugsink Webhook → n8n → Slack/Telegram Notification bei:
  - Neue Fehlerklasse (first seen)
  - Error Spike (> 5 gleiche Fehler in 5 Minuten)
  - Pipeline-Run failed
  - VPS Health Check failed
- Board: Unhandled API 500s → Bugsink (Board braucht eigenes Sentry/Bugsink-SDK)

### 1.4 Log Management

**Reality:**
- Keine Log-Rotation konfiguriert
- Bugsink Volume waechst unbegrenzt
- systemd Journal ohne Size-Limit
- Dozzle in-memory (Logs verloren bei Container-Restart)

**Massnahme L-04: Log Lifecycle**
- systemd Journal: `SystemMaxUse=2G` in journald.conf
- Bugsink: Retention Policy (90 Tage Events, danach Auto-Delete)
- File Logs: logrotate fuer `/home/claude-dev/pipeline-logs/`
- Langfristig: Loki fuer zentrale Log-Aggregation

---

## Bereich 2: Resilience & Reliability (HOCH)

### 2.1 Timeouts auf externe Calls

**Skill-Demand (Backend):**
- Alle externen Calls mit expliziten Timeouts

**Reality:**
- Engine: Watchdog-Timeout (30min) auf Pipeline-Run, aber keine Timeouts auf einzelne API-Calls (Anthropic, GitHub, Supabase)
- Board: Hat Timeouts auf VPS/Pipeline-Calls (AbortSignal.timeout 10-15s auf dispatch, health, GitHub webhook forwarding). **Fehlt** auf: Sidekick Anthropic SDK Calls (kein Timeout → haengt bis Vercel Function Timeout killt), Stripe API (SDK Default 80s, nicht explizit konfiguriert)

**Gap:** HOCH — Sidekick ohne Timeout ist besonders kritisch (public-facing, serverless). Engine-interne Calls ohne Timeouts blockieren Pipeline-Slots.

**Massnahme R-01: Explicit Timeouts**
- Engine Anthropic SDK: `timeout: 120_000` (2min) auf allen Completions
- Board Sidekick Anthropic SDK: `timeout: 60_000` (1min) — serverless-kompatibel
- Supabase Calls: `AbortSignal.timeout(10_000)` auf Queries (Engine)
- Stripe API: Verifizieren dass SDK Default (80s) aktiv ist, ggf. auf 30s reduzieren
- GitHub API: `request.timeout` auf gh CLI Calls (Engine)
- fetch() Calls ohne AbortController: Systematisch nachruesten (Engine)

### 2.2 Circuit Breakers

**Skill-Demand (Product CTO + Backend):**
- Circuit Breakers fuer konsistent-fehlende Services
- Graceful Degradation fuer nicht-kritische Dependencies

**Reality:** Keine Circuit Breakers. Wenn Anthropic API down ist, failen alle Requests sofort durch.

**Gap:** HOCH — Kaskadierendes Failure-Risiko.

**Massnahme R-02: Circuit Breaker Pattern**
- Custom Implementation (~50 Zeilen, keine Library noetig fuer Single-VPS): Error-Counter pro Service, nach N Failures in M Sekunden → Service als "open" markieren, Requests sofort ablehnen, nach Cooldown → "half-open" (1 Probe-Request)
- Anwenden auf: Anthropic API (Engine + Board Sidekick), GitHub API, Board API (von Engine)
- Nicht noetig fuer: Supabase (managed, hochverfuegbar)

### 2.3 Rate Limiting

**Skill-Demand (Backend):**
- Rate Limiting auf Public Endpoints

**Reality:**
- VPS: Kein Rate Limiting auf `/api/launch`, `/api/events`, `/api/ship`
- Board: DB-backed Rate Limiting auf Registration (`check_rate_limit` RPC) + Bot-Detection-Middleware (429 auf suspicious User-Agents auf Auth-Pages). Alle anderen Endpoints ungeschuetzt.

**Gap:** HOCH — VPS komplett ungeschuetzt. Board hat Basis-Schutz auf Auth, aber nicht auf Ticket-APIs, Sidekick, oder Pipeline-Endpoints.

**Massnahme R-03: Rate Limiting**
- VPS `/api/launch`: Max 10 Requests/Minute pro Project
- VPS `/api/events`: Max 100 Requests/Minute pro Pipeline-Run
- Board Public APIs: Global Rate Limit (100 req/min pro IP)
- Board Sidekick: Max 20 Messages/Minute pro Conversation
- Implementation: In-Memory Counter (Map mit TTL) — kein Redis noetig bei Single-VPS

### 2.4 Idempotency

**Skill-Demand (Backend + Product CTO):**
- Idempotency auf State-Changing Operations

**Reality:** Nicht implementiert. Doppelte Webhook-Deliveries oder Retry-Logik koennte Duplikate erzeugen.

**Gap:** HOCH fuer Webhooks und Pipeline-Trigger.

**Massnahme R-04: Idempotency Keys**
- `/api/launch`: Idempotency via `ticketNumber + attempt` (bereits teilweise durch `runningTickets` Set)
- Webhooks (GitHub, Stripe): Deduplizierung via Event-ID (Stripe: `event.id`, GitHub: `X-GitHub-Delivery`)
- Board Ticket-Creation: Optional `Idempotency-Key` Header

### 2.5 Docker Resource Limits

**Reality:**
- Kein Memory-Limit auf pipeline-server Container
- Kein CPU-Limit
- Kein Docker Healthcheck

**Massnahme R-05: Container Haertung**
```yaml
# docker-compose.yml
pipeline-server:
  deploy:
    resources:
      limits:
        memory: 8G
        cpus: "2"
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

### 2.6 Graceful Degradation

**Reality:** Wenn Bugsink down ist, loggt niemand Errors. Wenn Board API down ist, schlagen Pipeline-Events fehl (best-effort, aber kein Retry).

**Massnahme R-06: Degradation-Strategie**
- Event-Hooks: Events in lokale Queue schreiben wenn Board API nicht erreichbar, Retry bei naechstem Heartbeat
- Bugsink: Sentry SDK hat built-in Buffering — verifizieren dass es aktiv ist
- Sidekick: Wenn Anthropic API down → "Service temporarily unavailable" statt Crash

---

## Bereich 3: UI Robustheit (HOCH)

### 3.1 Error Boundaries

**Skill-Demand (Frontend Design):**
- Error Boundaries auf allen kritischen UI-Bereichen

**Reality:** Null. Kein einziges `<ErrorBoundary>` in der Board-App.

**Gap:** KRITISCH — Ein Runtime-Error in einer Komponente crasht die gesamte App (weisser Screen).

**Massnahme U-01: Error Boundary Hierarchie**
- Global Error Boundary in `layout.tsx` (Fallback: "Etwas ist schiefgelaufen. Seite neu laden.")
- Route-Level Boundaries (Next.js `error.tsx` in key Routes: board, dashboard, settings, tickets)
- Component-Level Boundaries um: Board (Drag&Drop), Sidekick (Chat), Activity Feed (Realtime)
- Client-Side Error Reporting: Fehler an Bugsink/Sentry senden

### 3.2 Component States

**Skill-Demand (Frontend Design + UX Planning):**
- 5 States: Empty, Loading, Error, Partial, Complete
- Skeleton Screens statt Spinner

**Reality:** Teilweise. Viele Components haben nur Complete + Loading (Spinner). Empty States existieren fuer manche, nicht alle. Error States sind generische Toasts.

**Massnahme U-02: State-Audit fuer kritische Components**
- Board Columns: Empty State vorhanden (gut). Error State fehlt. Loading ist Spinner (sollte Skeleton sein).
- Dashboard KPIs: Loading fehlt. Error fehlt.
- Activity Feed: Loading fehlt. Empty State fehlt.
- Settings Tabs: Inkonsistent.
- Ticket Detail Sheet: Error State fehlt.
- Prioritaet: Board + Dashboard zuerst, dann Settings.

### 3.3 Error Messages

**Skill-Demand (UX Planning):**
- Error Messages mit: (1) Was ist passiert, (2) Warum, (3) Was tun

**Reality:** Generische Toasts ("An error occurred", "Failed to update").

**Massnahme U-03: Kontextuelle Error Messages**
- API-Fehler: Spezifische Messages basierend auf Error-Code
- Network-Fehler: "Keine Verbindung zum Server. Pruefe deine Internetverbindung."
- Validation-Fehler: Field-Level Hints (Zod Errors bereits vorhanden, aber nicht ueberall im UI angezeigt)
- Timeout: "Die Anfrage hat zu lange gedauert. Versuche es erneut."

### 3.4 Keyboard Navigation & Accessibility

**Skill-Demand (Design Lead + Frontend Design):**
- 4.5:1 Kontrast (WCAG AA)
- Visible Focus Indicators
- Keyboard-operable Interactive Elements
- `aria-live` fuer dynamische Updates

**Reality:**
- Radix UI Primitives liefern Basis-Keyboard-Support
- Kontrast nicht explizit geprueft
- `aria-live` nicht verwendet (Realtime-Updates nicht announced)
- Board Drag&Drop: Keyboard-Support unklar

**Massnahme U-04: Accessibility Audit**
- axe-core oder Lighthouse Accessibility Audit auf Board
- Kontrast-Check auf oklch Color Tokens
- `aria-live="polite"` auf Activity Feed, Agent Panel, Ticket-Updates
- Keyboard-Test: Alle kritischen Flows (Board, Ticket erstellen, Settings) durchklicken

---

## Bereich 4: Security Haertung (MITTEL-HOCH)

### 4.1 Bugsink Default-Passwort

**Reality:** `BUGSINK_ADMIN_PASSWORD` Default ist `admin`.

**Massnahme S-01:** Auto-generate bei Installation (openssl rand -base64 32), in `.env` schreiben, User informieren.

### 4.2 CSP Verschaerfung

**Reality:** Board CSP erlaubt `unsafe-inline` + `unsafe-eval`.

**Massnahme S-02:**
- `unsafe-eval` entfernen (Next.js braucht es nicht in Production)
- `unsafe-inline` durch Nonce-basierte CSP ersetzen (Next.js nonce Support)
- Sidekick `frame-ancestors`: Auf registrierte Domains beschraenken statt `*`

### 4.3 Webhook Signature Verification

**Skill-Demand (Backend):**
- Validate HMAC Signature first bei allen eingehenden Webhooks

**Reality:**
- Stripe Webhook: Nutzt `constructEvent()` mit Signature Verification — korrekt
- GitHub Webhook: Board empfaengt GitHub Push/PR Events — HMAC Verification muss geprueft werden
- Pipeline Callback: Kein Signature-Check, nur Bearer Auth

**Massnahme S-05: Webhook Audit**
- GitHub Webhook Handler pruefen: Wird `X-Hub-Signature-256` verifiziert?
- Falls nicht: HMAC-SHA256 Verification implementieren (GitHub Webhook Secret)
- Pipeline Callback: Bearer-Auth ist ausreichend (server-to-server, kein Public Endpoint)

### 4.4 Sidekick Token Security

**Reality:**
- Sidekick nutzt localStorage fuer JWT Tokens (Third-Party iframe, Cookies funktionieren nicht)
- localStorage Tokens sind anfaellig fuer XSS (im Gegensatz zu httpOnly Cookies)
- Token Expiration und Refresh-Handling muss verifiziert werden

**Massnahme S-06: Sidekick Auth Haertung**
- Token Expiration: Verifizieren dass Supabase JWT TTL auf 1h steht (nicht 7 Tage)
- Token Refresh: Automatisches Refresh vor Ablauf implementieren (falls nicht vorhanden)
- CSP fuer Sidekick iframe: `frame-ancestors` auf registrierte Projekt-Domains einschraenken statt `*`

### 4.5 Secret Rotation

**Reality:** Kein Mechanismus fuer Key-Rotation.

**Massnahme S-03:**
- API Keys: Revoke + Re-Generate Flow existiert bereits (gut)
- Anthropic API Key: Quartalmaessige Rotation dokumentieren
- Pipeline Key: Rotation-Prozedur dokumentieren (Board + VPS muessen gleichzeitig aktualisiert werden)

### 4.6 Server Config Encryption

**Reality:** `server-config.json` liegt als Plaintext auf Disk.

**Massnahme S-04:** Sensible Felder (`pipeline_key`, `api_key`, `update_secret`) mit AES-256 verschluesseln. Encryption Key als einziges Secret in Environment.

---

## Bereich 5: Database Hardening (MITTEL)

### 5.1 task_events Wachstum

**Reality:** Tabelle waechst unbegrenzt. Kein Partitioning, keine Archivierung.

**Massnahme D-01: Event Lifecycle**
- Option A (wenn pg_partman verfuegbar auf Supabase Pro): Range-Partitioning nach `created_at` (monatlich)
- Option B (einfacher, kein Extension noetig): Cron-basierter DELETE von Events aelter als 90 Tage via Supabase pg_cron oder externer Cron
- Events aelter als 90 Tage → Cold Storage (separate Tabelle oder JSON-Export vor Delete)
- Materialized View fuer Activity Feed (letzte 7 Tage, refreshed stuendlich)

### 5.2 Migration Quality

**Skill-Demand (Data Engineer):**
- Idempotent Migrations (IF NOT EXISTS)
- Rollback Instructions dokumentiert
- Destructive Changes: rename first, drop after 7 days

**Reality:** 29 Migrations, nicht konsistent idempotent, keine Rollback-Docs.

**Massnahme D-02: Migration Standards durchsetzen**
- Neue Migrations ab jetzt: Template mit Rollback-Block als Kommentar
- `IF NOT EXISTS` / `IF EXISTS` pflicht
- Bestehende 29 Migrations: Nicht nachtraeglich aendern (sie sind applied), aber als Baseline akzeptieren

### 5.3 RLS Audit

**Reality:** 9 Tabellen mit RLS. Unklar ob alle public Tables abgedeckt sind.

**Massnahme D-03: RLS Vollstaendigkeits-Pruefung**
- SQL Query: `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`
- Jede Tabelle ohne RLS bewerten: Braucht sie RLS? Wenn ja, Policy erstellen.

### 5.4 Backup-Strategie

**Reality:** Supabase managed Backups (Point-in-Time Recovery auf Pro Plan). VPS Config nicht gebackupt.

**Massnahme D-04:**
- Supabase: Verifizieren dass PITR aktiv ist auf Pipeline-DB
- VPS: `server-config.json` und `.env` in verschluesseltes Backup (taeglich, off-VPS)

---

## Bereich 6: Testing (MITTEL)

### 6.1 Board Test Coverage

**Reality:** 0 Test-Files in `src/`. 30+ API Endpoints komplett ungetestet.

**Massnahme T-01: Test-Strategie Board**
- Prioritaet 1: API Route Tests (Auth, Validation, Error Cases) — groesster Risk-Bereich
- Prioritaet 2: RLS Policy Tests (verifizieren dass Cross-Workspace-Zugriff geblockt wird)
- Prioritaet 3: Critical Path Integration Tests (Login → Board → Ticket erstellen → Pipeline triggern)
- Tool: Vitest (bereits konfiguriert) + Supertest fuer API Routes

### 6.2 Engine Test Maintenance

**Reality:** 8 Unit-Test-Files vorhanden (error-handler, budget, checkpoint, artifact-verifier, resume, scope-guard, supervisor, verify-commands). Solide Basis fuer kritische Module.

**Massnahme T-02:**
- Coverage-Report aktivieren (Istanbul/v8)
- Fehlende Tests: `server.ts` Endpoints, `worker.ts` Lifecycle, `drain.ts` State Machine
- Integration Test: Vollstaendiger Pipeline-Run-Stub (Mock Claude API, verify Event-Sequenz)

---

## Bereich 7: Ops & Disaster Recovery (MITTEL)

### 7.1 Runbook

**Reality:** Keins.

**Massnahme O-01: Incident Runbook erstellen**
- Szenario 1: VPS nicht erreichbar → SSH, Docker Status, Logs pruefen
- Szenario 2: Pipeline haengt → Drain, Force-Drain, Container Restart
- Szenario 3: Board 500s → Bugsink pruefen, Supabase Status, Vercel Logs
- Szenario 4: Anthropic API down → Circuit Breaker greift, Queue pausieren
- Szenario 5: Supabase down → Board degraded (read-only Cache), Pipeline pausiert

### 7.2 Deprecated Files aufraeumen

**Reality:** 3 deprecated systemd Services, 1 deprecated setup Script im Repo.

**Massnahme O-02:** In `vps/deprecated/` verschieben oder loeschen (nach Bestaetigung).

### 7.3 Dependency Supply Chain Security

**Reality:** Kein `npm audit` in CI/CD, kein Dependabot, keine Lock-File-Integrity-Checks.

**Massnahme O-03: Supply Chain Hardening**
- `npm audit` als Teil des Build-Checks (Engine + Board)
- Dependabot oder Renovate fuer automatische Dependency-Updates aktivieren
- Lock-File-Integrity: `npm ci` statt `npm install` in Production Builds

---

## Priorisierte Umsetzungsreihenfolge

### Phase 1: Foundation (P0) — Muss sofort passieren

| ID | Massnahme | Aufwand | Repo |
|----|-----------|---------|------|
| S-01 | Bugsink Default-Passwort auto-generieren | XS | VPS |
| L-01 | Structured Logging (Pino) | M | Engine + Board |
| U-01 | Error Boundaries | S | Board |
| R-01 | Explicit Timeouts (besonders Sidekick — public-facing, serverless) | S | Engine + Board |
| R-03 | Rate Limiting VPS API | S | Engine |
| R-05 | Docker Resource Limits + Healthcheck | S | VPS |

### Phase 2: Resilience (P1) — Naechste Woche

| ID | Massnahme | Aufwand | Repo |
|----|-----------|---------|------|
| L-03 | Alerting Pipeline | S | VPS + n8n |
| U-02 | Component States Audit | M | Board |
| R-02 | Circuit Breaker | M | Engine + Board |
| L-02 | Lightweight Metriken | S | Engine + Board |
| S-05 | Webhook Signature Verification | S | Board |

### Phase 3: Hardening (P2) — Diesen Monat

| ID | Massnahme | Aufwand | Repo |
|----|-----------|---------|------|
| T-01 | Board Test Coverage | L | Board |
| D-01 | task_events Lifecycle | M | Board DB |
| S-02 | CSP Verschaerfung | S | Board |
| R-04 | Idempotency Keys | M | Engine + Board |
| D-03 | RLS Audit | S | Board DB |
| L-04 | Log Lifecycle | S | VPS |

### Phase 4: Polish (P3) — Laufend

| ID | Massnahme | Aufwand | Repo |
|----|-----------|---------|------|
| U-03 | Kontextuelle Error Messages | M | Board |
| U-04 | Accessibility Audit | M | Board |
| S-06 | Sidekick Auth Haertung (Token TTL, frame-ancestors) | S | Board |
| O-01 | Incident Runbook | S | Docs |
| S-03 | Secret Rotation Doku | S | Docs |
| S-04 | Config Encryption | M | VPS |
| D-02 | Migration Standards | S | Board |
| T-02 | Engine Test Maintenance | M | Engine |
| R-06 | Degradation-Strategie | M | Engine |
| D-04 | Backup-Strategie | S | VPS + DB |
| O-03 | Supply Chain Security (npm audit, Dependabot) | S | Engine + Board |
| O-02 | Deprecated Files aufraeumen | XS | VPS |

---

## Erfolgskriterien

Nach vollstaendiger Umsetzung:

- **Observability:** Jeder Request tracebar von Board → VPS → Pipeline → Agent. Error-Rate messbar. Alerting bei Incidents < 5 Minuten.
- **Resilience:** Kein externer Service-Ausfall crasht das System. Rate Limits verhindern Missbrauch. Container-Crashes werden automatisch recovered.
- **UI:** Kein weisser Screen. Alle kritischen Components haben 5 States. Error Messages sind hilfreich.
- **Security:** Keine Default-Passwoerter. CSP gehaertet. Secrets rotierbar.
- **Database:** Events archiviert. RLS lueckenlos. Migrations standardisiert.
- **Testing:** Board API Routes getestet. Engine Coverage > 80%.
- **Ops:** Runbook fuer Top-5-Szenarien. Backup verifiziert. Deprecated Code entfernt.

**Ziel-Enterprise-Readiness: 9/10**
