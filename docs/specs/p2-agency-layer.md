# P2 — Agency Layer

> Board und Client-Facing Features die den Unterschied zu reinen Dev-Tools machen.
> Voraussetzung: P1 fertig (Budget Views, Token-Tracking aktiv).

---

## Done-Metrik

Ein Kunde sieht sein Kosten-Dashboard im Board.

---

## 1. Project Intake (vorgezogen — höchste Priorität in P2)

### Was

AI-gestütztes Information-Gathering-System. Der Kunde bekommt einen Link, beschreibt sein Projekt, beantwortet AI-generierte Follow-up-Fragen, lädt Assets hoch und teilt Zugänge — alles an einem Ort, ohne technisches Wissen. Eliminiert den Roundtrip-Bottleneck zwischen Entwickler und Kunde.

### Das Problem das es löst

Der Bottleneck liegt nicht beim Coden, sondern beim Information Gathering. Aktuell:
- Entwickler ist Middleman für jede Rückfrage (skaliert nicht)
- Kunde merkt nicht, dass er der Blocker ist
- Informationen liegen verstreut (Notion, Email, Chat, Drive)
- Technische Fragen überfordern nicht-technische Kunden
- Kein Tracking welche Infos fehlen, kein Reminder-System
- Jeder Roundtrip kostet 1-3 Tage

### Warum vorgezogen

Stärkster Verkaufsmoment für das Agency-Modell. Agentur schickt Link → Kunde beschreibt Projekt in eigenen Worten → AI stellt gezielte Follow-ups → Entwickler bekommt alles organisiert und "ready to build". Kein Onboarding-Call, kein Account-Setup, kein Hin-und-Her.

### Client Flow (4 Schritte)

```
1. Link öffnen → Willkommen + Beschreibung
   - Name + Email eingeben
   - Freitext-Projektbeschreibung
   - Dateien/Screenshots per Drag & Drop
   - Links einfügen (Figma, Drive, etc.)
   [Weiter →]
        │
        ▼
2. AI analysiert (2-5 Sek)
   - Projektbeschreibung lesen
   - Dateien analysieren
   - Projekt-Typ erkennen
   - Gap-Analyse: was fehlt?
   - Follow-up-Fragen generieren
        │
        ▼
3. Follow-up-Fragen (AI-generiert, nicht hardcoded)
   - 3-8 gezielte Fragen, eine pro Screen
   - Nicht-technisch formuliert, mit Kontext + Guidance
   - Frage-Typen: Freitext, Multiple Choice, File Upload, Link, Guided Action
   - Überspringbar (nice-to-have Items)
   [Weiter →]
        │
        ▼
4. Checkliste (fortlaufend)
   - Dynamisch generiert aus AI-Analyse + Antworten
   - Fortschrittsbalken (motiviert zur Completion)
   - Erledigte Items collapsed, offene expanded mit Guidance + Inline-Upload
   - "Wichtig" vs "Optional" Tags
   - Jederzeit zurückkommen — Fortschritt wird gespeichert
   - "Ready" wenn alle must-have Items erledigt
```

### Entwickler-Dashboard

```
/[slug]/intakes — Übersicht aller Intakes

┌───────────────────┬──────────────┬────────┬──────────────────┬──────────┐
│ Projekt           │ Status       │ Fertig │ Letzte Aktivität │          │
├───────────────────┼──────────────┼────────┼──────────────────┼──────────┤
│ Redesign Firma X  │ 🟢 Ready     │ 100%   │ vor 2 Stunden    │ [Start]  │
│ App Firma Y       │ 🔵 In Progr. │ 65%    │ vor 1 Tag        │ [Detail] │
│ Dashboard Firma Z │ 🟡 Waiting   │ 30%    │ vor 5 Tagen      │ [Remind] │
│ Landing Page W    │ ⚪ Sent       │ 0%     │ —                │ [Link]   │
└───────────────────┴──────────────┴────────┴──────────────────┴──────────┘
```

**Intake-Status:**

| Status | Bedeutung |
|---|---|
| `sent` | Link verschickt, Kunde hat noch nicht angefangen |
| `in_progress` | Kunde füllt aus, aber Items offen |
| `waiting` | Kunde inaktiv seit > X Tagen |
| `ready` | Alle must-have Items erledigt |
| `building` | Entwickler hat "Start Building" geklickt |
| `archived` | Inaktiv seit 30 Tagen, archiviert |

**Intake-Detail-View:**
- AI-Zusammenfassung des Projekts (Typ, Scope, Tags)
- Alle bereitgestellten Materialien (Dateien, Links)
- Checkliste-Status (was fehlt noch)
- Aktionen: "Frage hinzufügen", "Link kopieren", "Erinnern"
- "Start Building" → Konvertiert Intake zu Board-Projekt + Tickets

### "Start Building" Flow

```
Entwickler klickt "Start Building"
  │
  ├── Board-Projekt erstellen (falls nicht vorhanden)
  │   - stack.platform aus AI-Analyse (z.B. "shopify")
  │
  ├── AI generiert initiale Tickets aus Intake-Material
  │   - Breakdown in implementierbare Tickets
  │   - Jedes Ticket mit Beschreibung + Acceptance Criteria
  │   - Tags basierend auf Projekt-Typ
  │
  ├── Tickets im Board (Status: backlog)
  │
  ├── Intake-Status → "building"
  │
  └── Notification an Entwickler: "Projekt ready, X Tickets erstellt"
```

### AI-Integration

**Analyse-Pipeline (Claude Sonnet, ~$0.05-0.10 pro Intake):**

1. Content-Extraktion — Text parsen, Dokumente lesen, Links kategorisieren
2. Projekt-Klassifikation — Typ erkennen (Web App, E-Commerce, Dashboard, etc.), Komplexität schätzen
3. Gap-Analyse — Was fehlt typischerweise? Was ist unklar/widersprüchlich?
4. Fragen-Generierung — 3-8 Fragen, priorisiert, nicht-technisch, mit passenden Frage-Typen

**Beispiel-Fragen (AI-generiert, nicht hardcoded):**

| Statt (technisch) | Frage (kundenfreundlich) |
|---|---|
| "Welches Auth-System?" | "Sollen sich Nutzer einloggen können? Wenn ja: mit Email, Google, oder beidem?" |
| "Welche DB braucht ihr?" | "Werden Daten gespeichert, die Nutzer eingeben? Z.B. Bestellungen, Profile, Texte?" |
| "Wo liegen die Assets?" | "Hast du schon Design-Dateien, Logos oder Bilder? Du kannst sie hier hochladen oder einen Link teilen." |
| "Welche API-Integrationen?" | "Nutzt ihr schon Tools die angebunden werden sollen? Z.B. Stripe, Mailchimp, etc.?" |

**System Prompt (Konzept):**
```
Du bist ein Projekt-Intake-Assistent für ein Software-Entwicklungsteam.
Analysiere die Projektbeschreibung und generiere Follow-up-Fragen die alle
Informationen sammeln die ein Entwicklerteam braucht.

Regeln:
- ALLE Fragen nicht-technisch formulieren. Keine Fachbegriffe ohne Erklärung.
- NICHT nach technischen Entscheidungen fragen (Framework, DB, etc.)
- Frage nach: Funktionalität, Nutzer, Inhalte, Design, bestehende Systeme,
  Zugänge, Deadlines, Referenzen.
- Jede Frage hat: question, guidance, type (text|choice|file_upload|link|
  guided_action), is_required, category.
- Maximal 8 Fragen. Wenn der Kunde schon viel geliefert hat: weniger Fragen.
```

### DB-Schema

```sql
-- Intakes (Haupttabelle)
CREATE TABLE project_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) NOT NULL,
  project_id uuid REFERENCES projects(id),   -- NULL bis "Start Building"
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  title text,
  client_name text,
  client_email text,
  status text NOT NULL DEFAULT 'sent',        -- sent|in_progress|waiting|ready|building|archived
  description text,                           -- Erste Freitext-Beschreibung
  ai_analysis jsonb,                          -- AI-Zusammenfassung + Projekt-Typ + Tags
  completion_percent integer DEFAULT 0,
  last_client_activity timestamptz,
  reminder_paused boolean DEFAULT false,
  next_reminder_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Intake Items (Fragen + Checkliste)
CREATE TABLE intake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid REFERENCES project_intakes(id) NOT NULL,
  type text NOT NULL,                         -- question|file_upload|link|guided_action
  category text,                              -- description|design|content|access|technical|other
  question text NOT NULL,
  guidance text,                              -- Hilfetext / Erklärung
  answer text,                                -- Kunden-Antwort (Freitext)
  answer_files text[],                        -- Storage-Pfade
  answer_links text[],                        -- URLs
  is_completed boolean DEFAULT false,
  is_required boolean DEFAULT true,           -- must-have vs nice-to-have
  is_ai_generated boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Intake Files
CREATE TABLE intake_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid REFERENCES project_intakes(id) NOT NULL,
  item_id uuid REFERENCES intake_items(id),   -- NULL = loose upload
  filename text NOT NULL,
  storage_path text NOT NULL,                 -- Supabase Storage: intake/{intake_id}/
  mime_type text,
  size_bytes bigint,
  uploaded_at timestamptz DEFAULT now()
);

-- Intake Reminders (Phase 2 des Intakes)
CREATE TABLE intake_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid REFERENCES project_intakes(id) NOT NULL,
  type text NOT NULL,                         -- welcome|nudge|urgent|archive_warning
  sent_at timestamptz DEFAULT now(),
  email_to text,
  opened_at timestamptz                       -- Email-Tracking (optional)
);

-- RLS: project_intakes + intake_items readable by Token-Bearer (public) + Workspace-Members
-- RLS: intake_files writable by Token-Bearer (upload) + Workspace-Members
-- RLS: intake_reminders only Workspace-Members
```

### Routes

**Client-facing (kein Auth, Token-basiert):**

| Route | Seite |
|---|---|
| `/intake/<token>` | Willkommen + Beschreibung + Upload |
| `/intake/<token>/questions` | Follow-up-Fragen (eine pro Screen) |
| `/intake/<token>/checklist` | Checkliste mit Status + Inline-Aktionen |

**Entwickler (Board Auth):**

| Route | Seite |
|---|---|
| `/[slug]/intakes` | Intake-Übersicht (Dashboard) |
| `/[slug]/intakes/new` | Neuen Intake erstellen |
| `/[slug]/intakes/[id]` | Intake-Detail (alles was der Kunde bereitgestellt hat) |

### API Endpoints

| Method | Path | Auth | Beschreibung |
|---|---|---|---|
| `GET` | `/api/intake/<token>` | Token | Intake-Daten für Client |
| `PATCH` | `/api/intake/<token>` | Token | Beschreibung/Antworten speichern |
| `POST` | `/api/intake/<token>/files` | Token | File Upload |
| `POST` | `/api/intake/<token>/analyze` | Token | AI-Analyse triggern |
| `GET` | `/api/intakes` | Board Auth | Alle Intakes (Entwickler) |
| `POST` | `/api/intakes` | Board Auth | Neuen Intake erstellen |
| `PATCH` | `/api/intakes/[id]` | Board Auth | Intake bearbeiten |
| `POST` | `/api/intakes/[id]/remind` | Board Auth | Reminder manuell senden |
| `POST` | `/api/intakes/[id]/start-building` | Board Auth | Intake → Board-Projekt + Auto-Tickets |

### Implementierungs-Phasen (innerhalb P2)

**Intake Phase 1 (MVP):**
- Intake erstellen + Link teilen (Board UI)
- Client-facing Pages (Beschreibung + Upload + Fragen + Checkliste)
- AI-Analyse + Fragen-Generierung (Claude Sonnet)
- Entwickler-Übersicht + Detail-View
- "Start Building" → Manuell Projekt + Tickets erstellen
- Supabase Storage für Dateien

**Intake Phase 2 (Automation):**
- Email-Reminder-System (Resend)
- "Start Building" → Auto-Ticket-Generierung via AI
- Email-Tracking (geöffnet/nicht geöffnet)
- Intake-Status im Board-Dashboard-Widget

**Intake Phase 3 (Intelligence):**
- Template-Intakes (vorgefüllte Fragen für Shopify, Web App, etc.)
- Sidekick-Chat-Integration im Intake
- Intake-Analytics (Completion-Time, Drop-off-Rate)
- Pipeline-Auto-Start bei 100% Completion

### Acceptance Criteria (Phase 1)

- [ ] Intake-Link ohne Account nutzbar (Token-basiert)
- [ ] Client kann Beschreibung + Dateien + Links bereitstellen
- [ ] AI analysiert Input und generiert 3-8 Follow-up-Fragen
- [ ] Fragen sind nicht-technisch formuliert mit Guidance
- [ ] Checkliste zeigt Fortschritt (% complete, must-have vs optional)
- [ ] Kunde kann jederzeit zurückkommen (Fortschritt gespeichert)
- [ ] Entwickler sieht alle Intakes mit Status im Board
- [ ] Intake-Detail zeigt AI-Zusammenfassung + alle Materialien
- [ ] "Start Building" erstellt Board-Projekt
- [ ] Notification an Entwickler bei neuem Intake und bei "Ready"

---

## 2. Kosten-Dashboard

### Was

Board-Seite die Workspace-Level und Projekt-Level Kosten anzeigt. Basiert auf den Views aus P1.

### Wo

Board-Repo: neue Route `/dashboard/costs` (oder Tab im bestehenden Dashboard).

### Daten

Liest aus P1 Views: `ticket_costs`, `project_costs`.

### UI-Komponenten

**Workspace-Level:**
- Gesamtkosten diesen Monat (Zahl + Trend vs. letzter Monat)
- Budget-Auslastung (Balken gegen Ceiling, falls gesetzt)
- Kosten pro Projekt (Tabelle, sortierbar)

**Projekt-Level (Drill-Down):**
- Kosten diesen Monat
- Top-5-Tickets nach Kosten
- Kosten-Verlauf (letzte 4 Wochen, einfaches Balkendiagramm)
- Token-Breakdown: Input vs Output

**Zeitraum-Filter:**
- Diese Woche
- Dieser Monat
- Letzter Monat
- Custom Range

### Kein externes Charting-Library

Einfache CSS-Balken oder SVG. Kein Recharts, kein Chart.js. Die Daten sind simpel genug für native Darstellung.

### Acceptance Criteria

- [ ] Dashboard zeigt Workspace-Gesamtkosten
- [ ] Budget-Balken gegen Ceiling (wenn gesetzt)
- [ ] Drill-Down pro Projekt zeigt Top-Tickets
- [ ] Zeitraum-Filter funktioniert
- [ ] Realtime-Update wenn neue Events reinkommen (bestehende Subscription)

---

## 3. HTML Reports

### Was

Statische HTML-Reports pro Projekt und Zeitraum. Per Email versendbar, kein Login nötig.

### Inhalt

- Zeitraum (z.B. "Kalenderwoche 13, 2026")
- Erledigte Tickets (Titel, Status-Änderung, Agent der gearbeitet hat)
- Offene Tickets (Backlog-Übersicht)
- Kosten-Summary (Tokens, USD)
- Agent-Activity-Summary (welche Agents wie oft, welche Models)
- Nächste Schritte (offene Tickets mit höchster Priorität)

### Generierung

**Supabase Edge Function: `generate-report`**

```typescript
// Input: workspace_id, project_id, date_range
// 1. Query task_events + tickets für Zeitraum
// 2. Aggregiere: erledigte Tickets, Kosten, Agent-Activity
// 3. Render HTML Template
// 4. Speichere in Supabase Storage (reports/{workspace_id}/{project_id}/{date}.html)
// 5. Return: Public URL

// Template: Inline CSS, kein JavaScript, Email-kompatibel
```

### Trigger

- Manuell: Button im Board ("Report generieren")
- Automatisch: Cron Edge Function (wöchentlich, pro Workspace konfigurierbar)
- Config in `workspaces.report_config`:

```json
{
  "auto_generate": true,
  "frequency": "weekly",
  "day": "monday",
  "send_to": ["client@example.com"]
}
```

### Acceptance Criteria

- [ ] Report enthält Ticket-Summary, Kosten, Agent-Activity
- [ ] HTML ist standalone (Inline CSS, kein JS, kein Login)
- [ ] Report wird in Supabase Storage gespeichert
- [ ] Manueller Trigger aus Board funktioniert
- [ ] Automatische wöchentliche Generierung konfigurierbar

---

## 4. Notification-System

### Was

Event-driven Notifications als Consumer von task_events. Kanal-Routing pro Workspace.

### Architektur

```
task_event INSERT
  → Supabase Database Webhook / Edge Function Trigger
  → Event-Typ in Notification-Rules?
  → Ja → Workspace-Config: welcher Kanal?
  → Telegram / Slack / Email
```

### Notification-Config

Auf `workspaces` Tabelle:

```sql
ALTER TABLE workspaces
  ADD COLUMN notification_config jsonb;
```

**Config-Schema (ohne Secrets):**

```json
{
  "rules": [
    { "event": "pipeline_failed", "channels": ["telegram", "email"], "severity": "high" },
    { "event": "ticket_completed", "channels": ["slack"], "severity": "low" },
    { "event": "budget_threshold", "channels": ["telegram"], "severity": "medium" },
    { "event": "intake_submitted", "channels": ["telegram", "slack"], "severity": "medium" }
  ]
}
```

### Secrets-Handling

Secrets werden **nicht** in notification_config gespeichert.

```sql
CREATE TABLE workspace_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) NOT NULL,
  channel text NOT NULL,              -- 'telegram', 'slack', 'email'
  secret_key text NOT NULL,           -- z.B. 'bot_token', 'webhook_url', 'api_key'
  encrypted_value text NOT NULL,      -- Verschlüsselter Wert
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, channel, secret_key)
);

-- RLS: Nur Workspace-Owner kann Secrets lesen/schreiben
-- Encryption: Supabase Vault oder application-level encryption
```

### Edge Function: `process-notification`

```typescript
// Triggered by task_event INSERT (Database Webhook)
// 1. Lese Event-Typ
// 2. Lese workspace notification_config
// 3. Matche Event gegen Rules
// 4. Für jeden matchenden Channel:
//    a. Lese Secrets aus workspace_secrets
//    b. Sende Notification

async function sendTelegram(chatId: string, botToken: string, message: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
  });
}

async function sendSlack(webhookUrl: string, message: string) {
  await fetch(webhookUrl, {
    method: 'POST',
    body: JSON.stringify({ text: message }),
  });
}

async function sendEmail(to: string, subject: string, html: string) {
  // Resend API
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: 'Just Ship <notifications@just-ship.io>', to, subject, html }),
  });
}
```

### Notification-Events

| Event-Typ | Trigger | Default-Severity |
|---|---|---|
| `pipeline_failed` | Pipeline crashed oder alle Agents stuck | high |
| `pipeline_completed` | PR erstellt | low |
| `ticket_completed` | Ticket Status → done | low |
| `budget_threshold` | Kosten > 80% vom Ceiling | medium |
| `budget_exceeded` | Kosten > 100% vom Ceiling | high |
| `agent_stuck` | Agent 3x Timeout | medium |
| `intake_submitted` | Kunde hat Beschreibung abgegeben | medium |
| `intake_ready` | Alle must-have Items erledigt, bereit für "Start Building" | high |

### Acceptance Criteria

- [ ] Edge Function triggert bei relevanten task_events
- [ ] Notification-Rules pro Workspace konfigurierbar
- [ ] Secrets in separater Tabelle mit restriktiver RLS
- [ ] Telegram: Nachricht wird gesendet
- [ ] Slack: Webhook wird aufgerufen
- [ ] Email: Resend API wird aufgerufen
- [ ] Nicht-konfigurierte Events werden ignoriert (kein Spam)

---

## Ticket-Reihenfolge

```
Intake (Phase 1 MVP — höchste Priorität):
T-1: DB Schema (project_intakes, intake_items, intake_files) + RLS
  │
  └──→ T-2: Client-facing Pages (Beschreibung + Upload)
       │
       ├──→ T-3: AI-Analyse + Fragen-Generierung (Claude Sonnet API)
       │    │
       │    └──→ T-4: Follow-up-Fragen UI + Checkliste UI
       │
       └──→ T-5: File Upload (Supabase Storage)

T-6: Entwickler-Dashboard (Intake-Übersicht + Detail-View)
  │
  └──→ T-7: "Start Building" Flow (Intake → Board-Projekt)

Kosten-Dashboard:
T-8: Kosten-Dashboard UI (Board-Seite)

HTML Reports:
T-9: HTML Report Generator (Edge Function + Template)
  │
  └──→ T-10: Report Auto-Generation (Cron + Config)

Notifications:
T-11: Notification Edge Function + workspace_secrets Tabelle
  │
  ├──→ T-12: Telegram Channel
  ├──→ T-13: Slack Channel
  └──→ T-14: Email Channel (Resend)

Intake Phase 2 (nach MVP):
T-15: Email-Reminder-System
T-16: Auto-Ticket-Generierung via AI bei "Start Building"
```

Empfohlene Reihenfolge: T-1→T-7 (Intake MVP zuerst), dann T-8 (Dashboard), dann T-11→T-12 (Notifications mit Telegram), dann T-9→T-10 (Reports), dann T-13/T-14 (weitere Channels), dann T-15/T-16 (Intake Phase 2).
