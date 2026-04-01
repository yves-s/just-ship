# Shopify Agency Workflow — Design Spec

> Feedback von Shopify-Agentur (Vincent + Marvin, 2026-04-01) in just-ship einarbeiten.
> Approach: "Extend & Enhance" — bestehende Komponenten erweitern, keine parallele Struktur.

## Kontext & Pain Points

Eine Shopify-Agentur hat folgende Kern-Probleme identifiziert:

1. **Context Switching** — Entwickler springen zwischen Projekten und kleinen Tasks, selbst 10-Minuten-Fixes unterbrechen den Flow
2. **Ticket-Qualität** — Man muss "richtig prompten können", was Tech-Know-how voraussetzt, obwohl das Tool das eliminieren soll
3. **Output-Inkonsistenz** — Änderungen greifen nicht überall (z.B. CTA-Farbe nur in 3 von 4 Sections geändert)
4. **Setup-Friction** — GitHub-Integration funktioniert nicht direkt, fehlende automatische Requirements
5. **App-Boilerplate** — Shopify CLI generiert viel Demo-Code, erst aufwändiger Cleanup nötig

**Ziel-Metrik:** 80% der Tasks benötigen keine manuelle Intervention.

## Scope

Drei Cluster in Prioritätsreihenfolge:

| Cluster | Thema | Priorität |
|---|---|---|
| A | Triage Enrichment — "Bad Prompts retten" | Erste Umsetzung |
| B | Zero-Friction Shopify Dev Environment | Wichtigstes Feature |
| C | Output-Qualität via Shopify-spezifische QA | Absicherung |

**Nicht im Scope:** Slack-Integration (separates Ticket), Auto-Install von Tooling, Visual Regression Baseline-Vergleich.

---

## Cluster A: Triage Enrichment

### Problem

Der bestehende Triage-Agent (`agents/triage.md`) analysiert Ticket-Qualität und reichert den Body an, aber:
- Kein Codebase-Zugriff (Haiku, tools-frei) — kann betroffene Dateien nicht identifizieren
- Kein Board-Feedback — User sieht nicht, was die Triage interpretiert hat
- Keine Shopify-spezifischen Checks (Settings vs. hardcoded, Section-Propagation)

### Design

#### Zweiphasige Triage

**Phase 1: Analysis (bestehend, Haiku)**
- Verdict: `sufficient` / `enriched`
- QA-Tier: `full` / `light` / `skip`
- Schnell, kein Tool-Zugriff

**Phase 2: Enrichment (neu, Sonnet mit Tools)**
- Wird ausgeführt wenn: `verdict !== "sufficient"` ODER `stack.platform === "shopify"`
- Hat Zugriff auf: Grep, Glob, Read (Codebase-Kontext)
- **Architektur:** Separater `query()`-Call in `pipeline/run.ts` nach Phase 1. Nicht Teil des Triage-Agent-Prompts, sondern eigener Prompt in `agents/triage-enrichment.md` mit `model: "sonnet"` und `allowedTools: ["Grep", "Glob", "Read"]`. Ergebnis wird als `enrichedDescription` an `TriageResult` angehängt.
- **Timeout:** Max 60 Sekunden. Bei Timeout: Phase 2 wird komplett übersprungen (partielle Ergebnisse verworfen), Pipeline läuft mit Original-Ticket weiter. Warning-Log.

#### Enrichment-Schritte

1. **Betroffene Dateien identifizieren** — Grep/Glob im Projekt, z.B. "CTA-Farbe" → alle Sections mit `btn-primary`
2. **Fehlende ACs generieren** — Mobile/Tablet/Desktop Breakpoints, Hover/Active/Focus States, Dark Mode
3. **Scope-Interpretation** — Vages Ticket wird zu konkreter Implementierungsanweisung mit Dateiliste
4. **Shopify-spezifische Checks** (wenn `stack.platform === "shopify"`):
   - Settings-Schema statt hardcoded Values?
   - Section-Settings statt globale Änderung?
   - Online Store 2.0 Pattern eingehalten?

#### Board Comment

Enrichment wird als Comment auf das Ticket gepostet (neuer `POST /api/tickets/{N}/comments` Endpoint):

```markdown
Triage Enrichment

Scope: CTA-Farbe in 4 Dateien ändern
Betroffene Dateien:
- sections/hero.liquid (Zeile 45: hardcoded #FF6B35)
- sections/featured-collection.liquid (Zeile 12)
- snippets/product-card.liquid (Zeile 88)
- assets/theme.css (.btn-primary)

Ergänzte Acceptance Criteria:
- [ ] Farbe konsistent auf Mobile/Tablet/Desktop
- [ ] Hover-State der CTAs angepasst
- [ ] Keine hardcoded Farbwerte, sondern CSS Custom Property

QA-Tier: full (UI-sichtbare Änderung)
```

#### Nicht-blockierend

Der Comment ist informativ. Pipeline wartet **nicht** auf User-Feedback — sie läuft weiter mit dem angereicherten Ticket. User kann im Board eingreifen falls die Interpretation falsch ist.

### Daten-Handoff: Triage → QA

Das Enrichment-Ergebnis wird als `enrichedDescription` Feld am `TriageResult` gespeichert. In `pipeline/run.ts` wird dieses Feld an den `QaContext` weitergereicht, sodass der QA-Agent die angereicherten ACs und die Dateiliste als Prüf-Grundlage hat. `QaContext` Interface in `pipeline/lib/config.ts` wird um `enrichedACs?: string` und `triageFindings?: string[]` erweitert.

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `agents/triage-enrichment.md` | **Neu** — Phase 2 Enrichment-Prompt (Sonnet, Tools) |
| `agents/triage.md` | `scaffold_type` als optionales Output-Feld im JSON-Schema ergänzen |
| `pipeline/run.ts` | `TriageResult` Interface exportieren und um `enrichedDescription` + `scaffold_type` erweitern. Nach Triage: Enrichment-Step + Comment-Post + Enrichment-Daten an QaContext. **Hinweis:** `TriageResult` ist aktuell lokal in `run.ts` definiert (Zeile 51) — bleibt dort, wird aber exportiert damit `config.ts` es referenzieren kann. |
| `pipeline/lib/config.ts` | `QaContext` um `enrichedACs?: string`, `triageFindings?: string[]` und `shopifyQaReport?: ShopifyQaReport` erweitern (siehe TypeScript-Interface unten) |
| `.claude/scripts/post-comment.sh` | **Neu** — Board Comment API Helper |
| Board: `api/tickets/[N]/comments` | **Neu** — Comment Endpoint |

---

## Cluster B: Zero-Friction Shopify Dev Environment

### B1: Environment Check

#### Problem

Setup-Friction: Shopify CLI nicht installiert, Auth abgelaufen, `shopify.store` nicht gesetzt — Pipeline schlägt fehl ohne klare Fehlermeldung.

#### Design

Neues Script `shopify-env-check.sh`:

```bash
shopify-env-check.sh
# Exit 0: alles ok (oder nur Warnings)
# Exit 1: Pflicht-Check fehlgeschlagen
```

**Checks:**

| Check | Methode | Level |
|---|---|---|
| Node.js | `node --version` | Error |
| Shopify CLI | `shopify version` | Error |
| Git | `git --version` | Error |
| GitHub CLI | `gh --version` | Warning |
| Shopify Auth | Token oder Interactive (siehe unten) | Error |
| `shopify.store` in project.json | JSON-Parse + Format-Check (`*.myshopify.com`) | Error |

**Auth-Check differenziert nach Umgebung:**
- Wenn `SHOPIFY_CLI_THEME_TOKEN` gesetzt → Auth gilt als valide (Token-basiert, VPS/CI)
- Sonst: `shopify auth info 2>/dev/null` oder Fallback `shopify theme list --store={store} 2>/dev/null` (interaktiv, lokal)

**Kein Auto-Install.** Bei Fehler: klare Meldung mit Copy-Paste-Befehl.

**Caching:** Schreibt `.claude/.env-check-passed` mit Timestamp. Wird nur wiederholt wenn Datei älter als 24h oder nicht vorhanden.

**Integration:** Aufgerufen von `/develop` wenn `stack.platform === "shopify"`, vor allem anderen.

### B2: Hybrid Theme Dev (theme dev + theme push)

#### Problem

Aktuell nur `shopify theme push --unpublished` (Snapshot, kein Live-Reload). Entwickler wollen `shopify theme dev` mit Hot Reload lokal.

#### Design

Bestehende `shopify-preview.sh` wird zu `shopify-dev.sh` erweitert (Preview-Script bleibt als Alias).

**Modus-Erkennung (Priorität):**
1. Expliziter Flag: `--mode=dev` oder `--mode=push` überschreibt alles
2. Env-Variable: `JUST_SHIP_MODE=pipeline` → Push-Modus (gesetzt in VPS systemd unit)
3. Fallback: TTY vorhanden → Dev-Modus, sonst Push-Modus

```
Lokal (TTY + kein JUST_SHIP_MODE) → shopify theme dev --store={store}
VPS/Pipeline (JUST_SHIP_MODE=pipeline oder kein TTY) → shopify theme push --unpublished
```

**Subcommands:**
```bash
shopify-dev.sh start "T-42" "Hero section redesign"  # dev oder push je nach Umgebung
shopify-dev.sh stop                                     # Stoppt dev-server / cleanup push-theme
shopify-dev.sh url                                      # Aktuelle Preview-URL zurückgeben
```

**Lokaler Modus (`theme dev`):**
1. Startet `shopify theme dev --store={store_url} --port={free_port}` im Hintergrund (Port via `lsof` frei-Check, Fallback 9292)
2. Schreibt PID in `.claude/.shopify-dev-pid` für Cleanup
3. Parsed stdout nach Preview-URL (Timeout: 30s, Retry: 1x)
4. Schreibt URL in `.claude/.dev-preview-url`
5. Postet URL als Board Comment aufs Ticket
6. Dev-Server läuft weiter während Pipeline arbeitet
7. Cleanup: `kill $(cat .claude/.shopify-dev-pid)` bei Pipeline-Ende oder `/ship`

**Failure Modes:**
- Port belegt → nächsten freien Port versuchen (9292, 9293, 9294)
- `theme dev` startet nicht (Auth, Store-Error) → Fehler loggen, Fallback auf Push-Modus
- URL nicht im Stdout gefunden nach 30s → Warning, weiter ohne Preview
- Pipeline-Crash/Timeout → PID-Datei bleibt als Orphan. `shopify-env-check.sh` prüft bei jedem Start ob `.claude/.shopify-dev-pid` existiert und der Prozess noch läuft — wenn ja, killt er ihn bevor ein neuer gestartet wird.

**Remote Modus (`theme push`):**
- Wie bisher, aber Preview-URL wird automatisch als Board Comment gepostet
- Theme-Name enthält Ticket-ID: `"T-42: Hero section redesign"`

**Integration:** `/develop` ruft `shopify-dev.sh start` auf wenn `stack.platform === "shopify"` und `stack.variant === "liquid"`. Passiert nach Branch-Erstellung, vor Implementierung.

### B3: App Scaffolding + Cleanup

#### Problem

`shopify app create` generiert Demo-App mit Boilerplate. Erst viel Cleanup nötig.

#### Design

Neuer Skill `shopify-app-scaffold.md` — kein eigenes Script (einmaliger Vorgang pro Projekt).

**Cleanup-Regeln (Opinionated Starter):**

| Aktion | Dateien |
|---|---|
| **Entfernen** | Example Routes, Demo-Components, Placeholder-Daten, Mock-API-Calls |
| **Behalten** | `app/root.tsx`, `app/entry.server.tsx`, Auth-Config (`app/shopify.server.ts`), `shopify.app.toml`, `package.json`, Prisma/DB-Setup |
| **Anlegen** | Leere `app/routes/app._index.tsx` (minimale Polaris Page), `.env.example`, aufgeräumte `README.md` |

**Trigger:** Triage Phase 1 erkennt App-Scaffold-Intent und setzt `scaffold_type: "shopify-app"` im `TriageResult`. Erkennung über Ticket-Tag `app-scaffold` ODER Keywords im Titel/Body ("neue App erstellen", "create app", "app scaffolding"). Der Orchestrator prüft `scaffold_type` und lädt den Skill automatisch.

**project.json nach Scaffold:**
```json
{
  "stack": {
    "platform": "shopify",
    "variant": "remix",
    "framework": "remix",
    "language": "typescript"
  },
  "shopify": { "store": "client.myshopify.com" },
  "build": { "dev": "shopify app dev", "install": "npm install" }
}
```

### Betroffene Dateien (Cluster B gesamt)

| Datei | Änderung |
|---|---|
| `.claude/scripts/shopify-env-check.sh` | **Neu** — Environment Validation |
| `.claude/scripts/shopify-dev.sh` | **Neu** — Hybrid dev/push Script |
| `.claude/scripts/shopify-preview.sh` | Wird dünner Wrapper: leitet `push` → `shopify-dev.sh start --mode=push`, `cleanup` → `shopify-dev.sh stop` |
| `skills/shopify-app-scaffold.md` | **Neu** — App Cleanup Skill |
| `commands/develop.md` | `shopify-preview.sh push` Aufruf → `shopify-dev.sh start` ersetzen, env-check ergänzen |
| `pipeline/run.ts` | Env-Check vor Orchestrator-Spawn (auch VPS-Pfad), `scaffold_type` Handling |
| `pipeline/lib/config.ts` | `TriageResult` um `scaffold_type?: string` erweitern (Import aus run.ts) |

---

## Cluster C: Shopify-spezifische QA

### Stufe 1: Statische Analyse (läuft immer bei Shopify)

Neues Script `shopify-qa.sh` — läuft nach Implementierung, vor QA-Agent Review.

**Checks:**

1. **Hardcoded Values** — Farbwerte (`#hex`, `rgb()`), Font-Sizes, Spacing die nicht über CSS Custom Properties oder Section Settings laufen
2. **Incomplete Propagation** — Wenn Ticket z.B. `btn-primary` ändert: alle Vorkommen in Liquid/CSS/JS konsistent?
3. **Section Schema** — Settings definiert aber nicht verwendet? Verwendet aber nicht definiert? `default`-Werte vorhanden?
4. **Breakpoint Coverage** — Media Queries für geänderte CSS? Responsive-relevante Änderungen ohne Mobile-Anpassung?
5. **Online Store 2.0 Compliance** — JSON Templates statt `.liquid`? Section Settings statt globale Metafields?

**Scope:** Nur geänderte Dateien (via `git diff`) werden geprüft, nicht das gesamte Theme. Verhindert False Positives aus bestehendem Code.

**Ignore-Mechanismus:** Inline-Comment `/* shopify-qa-ignore */` auf der Zeile davor unterdrückt ein Finding. Für Third-Party-CSS: gesamte Datei via `.shopify-qa-ignore` (Datei-Glob-Liste analog `.gitignore`).

**Verhältnis zu `shopify theme check`:** `shopify-qa.sh` ersetzt `theme check` NICHT. `theme check` ist ein Linter (Liquid Syntax, Performance, Accessibility). `shopify-qa.sh` prüft Konsistenz und Vollständigkeit der aktuellen Änderungen. Beide laufen — `theme check` als Teil des Build-Steps (bestehend), `shopify-qa.sh` danach.

**Output-Schema:**
```json
{
  "findings": [
    {
      "severity": "error|warning|info",
      "check": "hardcoded_values|incomplete_propagation|section_schema|breakpoint_coverage|os2_compliance",
      "file": "sections/hero.liquid",
      "line": 45,
      "message": "Hardcoded color #FF6B35 — use CSS custom property"
    }
  ],
  "summary": { "errors": 1, "warnings": 2, "info": 0 }
}
```

Exit-Code: `1` wenn `errors > 0`, sonst `0`.

Bei `error`: Pipeline blockt, DevOps-Agent fixt. Bei `warning`: Report geht an QA-Agent als zusätzlicher Kontext.

### Stufe 2: Visual Regression (nur bei QA-Tier "full")

Baut auf bestehendem QA-Runner (`pipeline/lib/qa-runner.ts`) auf:

1. Preview-URL aus Board oder `.claude/.dev-preview-url` holen
2. Playwright rendert betroffene Seiten auf 3 Breakpoints:
   - Mobile: 375px
   - Tablet: 768px
   - Desktop: 1440px
3. Screenshots gehen an QA-Agent, der visuell prüft:
   - Änderungen sichtbar und korrekt?
   - Layout auf allen Breakpoints konsistent?
   - Hover/Focus States (via Playwright-Interaktion)

**Kein Baseline-Vergleich** — QA-Agent bewertet Screenshots gegen enriched Acceptance Criteria aus Triage.

### Pipeline-Integration

```
Implementierung → Build Check → shopify-qa.sh (Stufe 1) → QA Agent Review
                                                            ↓ (wenn tier=full)
                                                    Playwright Screenshots (Stufe 2)
                                                            ↓
                                                    QA Agent Verdict
```

### QA-Agent bekommt zusätzlich

- Enriched ACs aus der Triage (Breakpoints, States, betroffene Dateien)
- Statische Analyse Report aus `shopify-qa.sh`
- Screenshots (bei Tier "full")
- Shopify-spezifische Checkliste aus dem Skill

### Betroffene Dateien (Cluster C)

| Datei | Änderung |
|---|---|
| `.claude/scripts/shopify-qa.sh` | **Neu** — Statische Analyse |
| `.shopify-qa-ignore` | **Neu** (Template) — Ignore-Datei für False Positives |
| `pipeline/lib/qa-runner.ts` | Shopify QA-Step einbauen (vor QA-Agent), `QaContext` um Enrichment-Daten erweitern |
| `pipeline/lib/qa-fix-loop.ts` | Shopify-QA-Errors als fixbaren Check-Typ registrieren |
| `pipeline/lib/config.ts` | `QaContext` um `shopifyQaReport?: ShopifyQaReport` erweitern |
| `agents/qa.md` | Shopify-spezifische Review-Anweisungen ergänzen |

---

## Board Comment API

Wird von allen drei Clustern benötigt (Triage, Preview, QA).

### Neuer Endpoint

```
POST /api/tickets/{N}/comments
Header: X-Pipeline-Key: {api_key}
Body: { "body": "markdown content", "author": "pipeline", "type": "triage|preview|qa" }
Response: { "id": "...", "created_at": "..." }
```

**Upsert-Semantik:** Wenn `type` gesetzt ist, führt die API ein `INSERT ... ON CONFLICT (ticket_id, type) DO UPDATE SET body = EXCLUDED.body, updated_at = now()` aus. So werden bei Re-Runs keine Duplikate erstellt.

### Helper Script

Neues `.claude/scripts/post-comment.sh`:

```bash
post-comment.sh {ticket_number} "Comment body as markdown"
```

Löst Credentials über `write-config.sh read-workspace` — gleicher Pattern wie alle Board-API-Calls.

### Error-Handling (post-comment.sh)

Comments sind **nie blockierend**. Bei Fehler:
- HTTP 4xx/5xx oder Timeout → Warning in stderr, Exit 0 (Pipeline läuft weiter)
- Board nicht erreichbar → Stille Failure, kein Retry
- Gleicher Pattern wie `shopify-preview.sh` — immer Exit 0, Errors in stderr

### Comment-Deduplication

Bei Pipeline-Re-Runs auf demselben Ticket: `post-comment.sh` schickt ein `type`-Feld mit (`triage`, `preview`, `qa`). Board-API überschreibt den letzten Comment gleichen Typs statt einen neuen zu erstellen. So entstehen keine Duplikate.

### Board-seitige Änderung

Neues DB-Model `ticket_comments` in Board-Repo (`just-ship-board`):

```sql
CREATE TABLE ticket_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'pipeline',
  type TEXT,  -- 'triage', 'preview', 'qa' (für Deduplication)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);
CREATE UNIQUE INDEX idx_ticket_comments_dedup ON ticket_comments(ticket_id, type) WHERE type IS NOT NULL;
```

API-Route und UI-Komponente (Comment-Liste unter Ticket-Detail) im Board-Repo. Kommentare chronologisch sortiert, Markdown-Rendering.

---

## TypeScript Interfaces

Konsolidierte Interface-Erweiterungen für `pipeline/lib/config.ts`:

```typescript
// Neuer Type für Shopify QA Report (spiegelt JSON-Output von shopify-qa.sh)
interface ShopifyQaFinding {
  severity: 'error' | 'warning' | 'info';
  check: 'hardcoded_values' | 'incomplete_propagation' | 'section_schema' | 'breakpoint_coverage' | 'os2_compliance';
  file: string;
  line: number;
  message: string;
}

interface ShopifyQaReport {
  findings: ShopifyQaFinding[];
  summary: { errors: number; warnings: number; info: number };
}

// Erweiterung bestehender Interfaces
interface QaContext {
  // ... bestehende Felder ...
  enrichedACs?: string;          // Aus Triage Phase 2
  triageFindings?: string[];     // Betroffene Dateien aus Enrichment
  shopifyQaReport?: ShopifyQaReport;  // Aus shopify-qa.sh
}
```

## Implementierungsreihenfolge

Die Board Comment API ist Voraussetzung für alle drei Cluster. Empfohlene Reihenfolge:

1. **Board Comment API** (Board-Repo) — DB-Migration, Endpoint, UI-Komponente
2. **post-comment.sh** (Engine-Repo) — Helper Script
3. **Cluster A** — Triage Enrichment (agents/triage-enrichment.md, pipeline/run.ts)
4. **Cluster B** — Shopify Dev Environment (env-check, shopify-dev.sh, app-scaffold)
5. **Cluster C** — Shopify QA (shopify-qa.sh, QA-Runner Integration)

Jedes Cluster kann als eigenständiges Ticket/PR umgesetzt werden.

---

## Follow-up Ticket: Slack Integration

> **Slack Webhook Integration** — Incoming Webhook in `project.json` konfigurierbar (`notifications.slack_webhook`). Preview-URLs, Status-Updates und Triage-Enrichments an Slack Channel senden. Kein Bot, nur Outbound-Notifications. Slack ist primäres Arbeitswerkzeug von Agenturen.

Priorität: nach Cluster A/B/C. Eigener Scope.

---

## Zusammenfassung der neuen/geänderten Dateien

### Neue Dateien
| Datei | Typ | Beschreibung |
|---|---|---|
| `agents/triage-enrichment.md` | Agent | Phase 2 Enrichment (Sonnet, Tools) |
| `.claude/scripts/shopify-env-check.sh` | Script | Environment Validation |
| `.claude/scripts/shopify-dev.sh` | Script | Hybrid theme dev/push |
| `.claude/scripts/shopify-qa.sh` | Script | Statische Liquid/Theme Analyse |
| `.claude/scripts/post-comment.sh` | Script | Board Comment API Helper |
| `skills/shopify-app-scaffold.md` | Skill | App Cleanup nach Scaffolding |

### Geänderte Dateien
| Datei | Änderung |
|---|---|
| `agents/triage.md` | `scaffold_type` Output-Feld ergänzen |
| `agents/qa.md` | Shopify-spezifische Review-Anweisungen |
| `pipeline/run.ts` | Enrichment-Step + Comment-Post + Shopify QA + Env-Check |
| `pipeline/lib/config.ts` | `TriageResult`, `QaContext` Interfaces erweitern |
| `pipeline/lib/qa-runner.ts` | Shopify QA-Step vor Agent Review |
| `pipeline/lib/qa-fix-loop.ts` | Shopify-QA-Errors als fixbaren Check-Typ |
| `commands/develop.md` | Shopify env-check + dev-start Integration |
| `.claude/scripts/shopify-preview.sh` | Wird Wrapper für shopify-dev.sh |

### Board-Repo (just-ship-board)
| Änderung | Beschreibung |
|---|---|
| DB: `ticket_comments` Tabelle | Comments Model (mit Dedup-Index) |
| API: `POST /api/tickets/[N]/comments` | Comment Endpoint (Upsert bei type) |
| UI: Comment-Anzeige unter Tickets | Board Frontend (Markdown, chronologisch) |
