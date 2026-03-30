# P4 — Ecosystem & Feature Absorption

> Automatisiertes Monitoring des OSS-Ecosystems + externe Ticket-Quellen.
> Soft Dependency auf P2 (Notifications). Standalone möglich mit direktem Telegram-Call.

---

## Done-Metrik

Das Absorption-System erkennt ein neues GSD 2 Release, analysiert den Changelog, und erstellt automatisch ein Ticket im Board.

---

## 1. Feature Absorption System

### Was

Automatisierter Prozess der relevante Open-Source-Projekte trackt, neue Features identifiziert, per AI analysiert, und als Tickets in die Just Ship Pipeline einspeist.

### Getrackte Projekte

| Projekt | GitHub Repo | Fokus | Watch-Priorität |
|---|---|---|---|
| **Claude Agent SDK** | `anthropics/claude-agent-sdk` | SDK API Changes, Breaking Changes | CRITICAL |
| **GSD 2** | `gsd-build/gsd-2` | Context Engineering, Crash Recovery, Cost Tracking | HIGH |
| **Oh My Claude Code** | `Yeachan-Heo/oh-my-claudecode` | Execution Modes, Model Routing, Skills | MEDIUM |
| **Claude Squad** | `smtg-ai/claude-squad` | Multi-Instance Management | MEDIUM |
| **Vibe Kanban** | `BloopAI/vibe-kanban` | Board/PM Features | LOW |
| **Shopify Hydrogen** | `Shopify/hydrogen` | Storefront API Changes, neue Patterns | HIGH |
| **Shopify CLI** | `Shopify/cli` | Theme/App CLI Changes | MEDIUM |

### DB-Schema

```sql
-- Getrackte Releases
CREATE TABLE watched_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_owner text NOT NULL,
  repo_name text NOT NULL,
  last_release_tag text,
  last_release_date timestamptz,
  last_checked_at timestamptz DEFAULT now(),
  watch_priority text NOT NULL DEFAULT 'medium',  -- critical, high, medium, low
  focus_area text,                                  -- engine, orchestration, pm, shopify
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(repo_owner, repo_name)
);

-- Seed Data
INSERT INTO watched_releases (repo_owner, repo_name, watch_priority, focus_area) VALUES
  ('anthropics', 'claude-agent-sdk', 'critical', 'engine'),
  ('gsd-build', 'gsd-2', 'high', 'engine'),
  ('Yeachan-Heo', 'oh-my-claudecode', 'medium', 'engine'),
  ('smtg-ai', 'claude-squad', 'medium', 'orchestration'),
  ('BloopAI', 'vibe-kanban', 'low', 'pm'),
  ('Shopify', 'hydrogen', 'high', 'shopify'),
  ('Shopify', 'cli', 'medium', 'shopify');

-- Absorption-Log
CREATE TABLE absorption_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_repo text NOT NULL,           -- 'anthropics/claude-agent-sdk'
  source_release text NOT NULL,        -- 'v1.2.3'
  feature_title text NOT NULL,
  feature_description text,
  relevance_category text NOT NULL,    -- engine, orchestration, pm, devx, shopify
  relevance_score numeric(3,2),        -- 0.00 - 1.00
  priority text NOT NULL DEFAULT 'low', -- low, medium, high
  ticket_id uuid REFERENCES tickets(id),
  ticket_number integer,
  status text NOT NULL DEFAULT 'identified',  -- identified, ticketed, implemented, rejected
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index für schnelle Queries
CREATE INDEX idx_absorption_status ON absorption_log(status);
CREATE INDEX idx_absorption_repo ON absorption_log(source_repo);

-- RLS: Nur Pipeline-Workspace-Members
```

### Edge Function: `watch-releases`

**Trigger:** Cron, 1x/Tag (06:00 UTC)

```typescript
import { createClient } from '@supabase/supabase-js';

const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN');  // Optional, erhöht Rate Limit
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

interface WatchedRepo {
  id: string;
  repo_owner: string;
  repo_name: string;
  last_release_tag: string | null;
  watch_priority: string;
  focus_area: string;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  body: string;
  html_url: string;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 1. Alle aktiven Repos laden
  const { data: repos } = await supabase
    .from('watched_releases')
    .select('*')
    .eq('active', true);

  const results = [];

  for (const repo of repos ?? []) {
    try {
      // 2. Latest Release von GitHub holen
      const release = await fetchLatestRelease(repo.repo_owner, repo.repo_name);

      if (!release || release.tag_name === repo.last_release_tag) {
        // Kein neues Release
        await supabase
          .from('watched_releases')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', repo.id);
        continue;
      }

      // 3. Neues Release gefunden — Changelog analysieren
      const features = await analyzeChangelog(release.body, repo);

      // 4. Tickets erstellen für relevante Features
      for (const feature of features) {
        if (feature.relevance === 'irrelevant') {
          // Nur loggen, kein Ticket
          await supabase.from('absorption_log').insert({
            source_repo: `${repo.repo_owner}/${repo.repo_name}`,
            source_release: release.tag_name,
            feature_title: feature.title,
            feature_description: feature.description,
            relevance_category: feature.category,
            relevance_score: feature.score,
            priority: 'low',
            status: 'rejected',
            rejection_reason: 'Classified as irrelevant by analyzer',
          });
          continue;
        }

        // Ticket im Board erstellen
        const ticket = await createAbsorptionTicket(supabase, repo, release, feature);

        // Absorption-Log
        await supabase.from('absorption_log').insert({
          source_repo: `${repo.repo_owner}/${repo.repo_name}`,
          source_release: release.tag_name,
          feature_title: feature.title,
          feature_description: feature.description,
          relevance_category: feature.category,
          relevance_score: feature.score,
          priority: feature.priority,
          ticket_id: ticket.id,
          ticket_number: ticket.number,
          status: 'ticketed',
        });

        results.push({ repo: `${repo.repo_owner}/${repo.repo_name}`, feature: feature.title, ticket: ticket.number });
      }

      // 5. Release-Stand aktualisieren
      await supabase
        .from('watched_releases')
        .update({
          last_release_tag: release.tag_name,
          last_release_date: release.published_at,
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', repo.id);

    } catch (error) {
      console.error(`Error processing ${repo.repo_owner}/${repo.repo_name}:`, error);
    }
  }

  // 6. Notification senden (wenn Features gefunden)
  if (results.length > 0) {
    await sendNotification(supabase, results);
  }

  return new Response(JSON.stringify({ processed: repos?.length, features_found: results.length, results }));
});
```

### Changelog Analyzer (Haiku)

```typescript
async function analyzeChangelog(changelog: string, repo: WatchedRepo): Promise<AnalyzedFeature[]> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Analysiere diesen Changelog von ${repo.repo_owner}/${repo.repo_name} (Fokus: ${repo.focus_area}).

Identifiziere Features die für ein Agency OS / Multi-Projekt-Framework relevant sind.
Das Framework orchestriert AI-Agents für Softwareentwicklung über mehrere Kundenprojekte hinweg,
mit Shopify als erstem Vertikal.

Kategorisiere jedes Feature:
- engine: Execution Engine Verbesserungen (Context, Models, Tool Use, Performance)
- orchestration: Multi-Agent/Multi-Projekt Koordination
- pm: Projektmanagement, Board, Ticket-Workflows
- devx: Developer Experience, CLI, Setup
- shopify: Shopify-spezifische Änderungen
- irrelevant: Nicht relevant für diesen Use Case

Für jedes relevante Feature, bewerte:
- relevance_score: 0.0-1.0 (wie relevant für Agency OS)
- priority: low (nice-to-have), medium (relevant), high (breaking change oder security)

Output als JSON Array:
[{
  "title": "Feature-Name",
  "description": "Was es tut und warum es relevant ist",
  "category": "engine|orchestration|pm|devx|shopify|irrelevant",
  "score": 0.85,
  "priority": "medium"
}]

Nur JSON, kein anderer Text.

Changelog:
${changelog.slice(0, 8000)}`,  // Limit um Token-Kosten zu begrenzen
      }],
    }),
  });

  const result = await response.json();
  const text = result.content[0].text;

  try {
    return JSON.parse(text);
  } catch {
    console.error('Failed to parse Haiku response:', text);
    return [];
  }
}
```

### Ticket Generator

```typescript
async function createAbsorptionTicket(
  supabase: SupabaseClient,
  repo: WatchedRepo,
  release: GitHubRelease,
  feature: AnalyzedFeature
): Promise<{ id: string; number: number }> {
  const title = `[Absorption] ${feature.title} (von ${repo.repo_owner}/${repo.repo_name})`;

  const body = `## Feature aus ${repo.repo_owner}/${repo.repo_name} ${release.tag_name}

### Was
${feature.description}

### Quelle
- Release: [${release.tag_name}](${release.html_url})
- Kategorie: ${feature.category}
- Relevanz-Score: ${feature.score}

### Nächste Schritte
- [ ] Feature evaluieren: Passt es in die aktuelle Roadmap?
- [ ] Wenn ja: Implementierungs-Ticket erstellen
- [ ] Wenn nein: Status auf "rejected" setzen mit Begründung

---
*Automatisch erstellt vom Feature Absorption System*`;

  // These are env vars set on the Edge Function:
  // JUST_SHIP_WORKSPACE_ID — the Just Ship framework workspace
  // JUST_SHIP_PROJECT_ID — the Just Ship framework project
  const JUST_SHIP_WORKSPACE_ID = Deno.env.get('JUST_SHIP_WORKSPACE_ID')!;
  const JUST_SHIP_PROJECT_ID = Deno.env.get('JUST_SHIP_PROJECT_ID')!;

  const { data: ticket } = await supabase
    .from('tickets')
    .insert({
      workspace_id: JUST_SHIP_WORKSPACE_ID,
      project_id: JUST_SHIP_PROJECT_ID,
      title,
      body,
      tags: ['absorption', repo.repo_name],
      priority: feature.priority,
      status: 'backlog',
    })
    .select('id, number')
    .single();

  return ticket;
}
```

### Notification

**Mit P2 Notification-System (wenn vorhanden):**

Postet ein `absorption_features_detected` Event in task_events → Edge Function routet zu konfiguriertem Kanal.

**Standalone (ohne P2):**

Direkter Telegram-Call:

```typescript
async function sendNotification(supabase: SupabaseClient, results: AbsorptionResult[]) {
  const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const grouped = groupBy(results, r => r.repo);
  let message = `🔍 *Feature Absorption*\n\n`;

  for (const [repo, features] of Object.entries(grouped)) {
    message += `*${repo}*\n`;
    for (const f of features) {
      message += `  → T-${f.ticket}: ${f.feature}\n`;
    }
    message += '\n';
  }

  message += `${results.length} neue Features erkannt.`;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    }),
  });
}
```

### Kosten-Schätzung

- GitHub API Calls: Kostenlos (5000/h mit Token)
- Haiku Analyse pro Release: ~$0.01-0.05
- 7 Repos x ~2 Releases/Monat = ~14 Analysen/Monat = ~$0.50/Monat
- Vernachlässigbar

### Acceptance Criteria

- [ ] Edge Function pollt GitHub Releases täglich
- [ ] Neue Releases werden erkannt und Changelog analysiert
- [ ] Haiku kategorisiert Features korrekt (engine/orchestration/pm/devx/shopify/irrelevant)
- [ ] Relevante Features werden als Tickets im Board erstellt
- [ ] Irrelevante Features werden nur geloggt, kein Ticket
- [ ] Telegram-Notification bei neuen Features
- [ ] `watched_releases` Tabelle wird korrekt aktualisiert
- [ ] `absorption_log` enthält vollständige Historie

---

## 2. Linear Integration

### Was

Webhook-basierte Synchronisation zwischen Linear und Just Ship Board. Issues in Linear → Tickets im Board.

### Webhook-Receiver

Board-API Endpoint: `POST /api/integrations/linear/webhook`

```typescript
// Linear Webhook Payload → Board Ticket
// 1. Verifiziere Webhook Signature (Linear signing secret)
// 2. Parse Issue Data (title, description, priority, labels)
// 3. Erstelle oder update Board-Ticket
// 4. Bidirektionaler Sync: Board-Status → Linear Status

interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove';
  type: 'Issue';
  data: {
    id: string;
    title: string;
    description: string;
    priority: number;       // 0=none, 1=urgent, 2=high, 3=medium, 4=low
    state: { name: string }; // "In Progress", "Done", etc.
    labels: { name: string }[];
  };
}
```

### Status-Mapping

| Linear Status | Board Status |
|---|---|
| Backlog, Triage | backlog |
| Todo | ready_to_develop |
| In Progress | in_progress |
| In Review | in_review |
| Done | done |

### Bidirektionaler Sync

Board-Status-Change → Linear API Update:

```typescript
// Board Event: ticket_status_changed
// → Call Linear GraphQL API
// → Update Issue State

const LINEAR_API = 'https://api.linear.app/graphql';

async function syncToLinear(ticketId: string, newStatus: string, linearIssueId: string) {
  const stateId = await getLinearStateId(newStatus);
  await fetch(LINEAR_API, {
    method: 'POST',
    headers: { Authorization: linearApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation { issueUpdate(id: "${linearIssueId}", input: { stateId: "${stateId}" }) { success } }`,
    }),
  });
}
```

### Config

Pro Projekt in project.json:

```json
{
  "integrations": {
    "linear": {
      "team_id": "...",
      "sync_enabled": true,
      "webhook_secret": "..."  // Nein — Secret in workspace_secrets
    }
  }
}
```

Webhook Secret in `workspace_secrets` (P2 Tabelle).

### Acceptance Criteria

- [ ] Linear Issue Create → Board Ticket erstellt
- [ ] Linear Issue Update → Board Ticket updated
- [ ] Board Status Change → Linear Issue Status updated
- [ ] Priority-Mapping funktioniert
- [ ] Webhook Signature wird verifiziert
- [ ] Duplikat-Erkennung (gleiche Linear Issue → kein zweites Ticket)

---

## 3. GitHub Issues Integration

### Was

Gleich wie Linear, aber für GitHub Issues. Webhook-basiert.

### Webhook-Receiver

Board-API Endpoint: `POST /api/integrations/github/webhook`

```typescript
// GitHub Webhook: issues event
// action: opened, edited, closed, reopened, labeled, unlabeled

interface GitHubIssueEvent {
  action: 'opened' | 'edited' | 'closed' | 'reopened';
  issue: {
    number: number;
    title: string;
    body: string;
    labels: { name: string }[];
    state: 'open' | 'closed';
    html_url: string;
  };
  repository: {
    full_name: string;
  };
}
```

### Status-Mapping

| GitHub State | Board Status |
|---|---|
| open (new) | backlog |
| open (labeled: in-progress) | in_progress |
| closed | done |

### Config

```json
{
  "integrations": {
    "github": {
      "repo": "owner/repo",
      "sync_enabled": true,
      "label_filter": ["bug", "feature"]  // Nur Issues mit diesen Labels syncen
    }
  }
}
```

### Acceptance Criteria

- [ ] GitHub Issue Created → Board Ticket erstellt
- [ ] GitHub Issue Closed → Board Ticket → done
- [ ] Board Status Change → GitHub Issue Comment (optional)
- [ ] Label-Filter funktioniert
- [ ] Webhook Secret wird verifiziert

---

## 4. Distribution & Messaging (Nicht-technisch)

Checkliste, keine Tickets:

- [ ] Website auf "Agency OS + Shopify" umbauen
- [ ] LinkedIn Messaging auf Agency-Positionierung umstellen
- [ ] Agency-Angebot formalisieren (Pricing, Scope, Deliverables)
- [ ] ICP-Gespräche mit 5-10 Shopify-Freelancern/Agenturen führen
- [ ] Learnings aus Gesprächen dokumentieren und in Roadmap einfließen lassen

---

## Ticket-Reihenfolge

```
Feature Absorption:
T-1: watched_releases + absorption_log Tabellen + RLS + Seed Data
  │
  └──→ T-2: Edge Function watch-releases (GitHub API Polling)
       │
       └──→ T-3: Changelog Analyzer (Haiku Prompt + JSON Parsing)
            │
            └──→ T-4: Ticket Generator (Absorption → Board-Ticket)
                 │
                 └──→ T-5: Absorption Notification (Telegram direkt oder P2 Event-System)

Externe Integrations (unabhängig von Absorption):
T-6: GitHub Issues Webhook → Board-Ticket
T-7: Linear Issues Webhook → Board-Ticket
T-8: Bidirektionaler Status-Sync
```

T-1→T-5 ist der Absorption-Strang (sequentiell).
T-6, T-7, T-8 sind unabhängig und können parallel bearbeitet werden.
T-6/T-7 hängen nur am Board-API (existiert seit Tag 1).
