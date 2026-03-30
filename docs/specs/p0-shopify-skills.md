# P0 — Shopify Skills & Foundation

> Erste Phase. Shopify-Spezialisierung aktivieren, Skill-Infrastruktur bauen, Datengrundlage für Cost-Tracking legen.
> Voraussetzungen: Keine.

---

## Done-Metrik

Der Shopify Test Case läuft komplett über die Pipeline — Ticket erstellt, Skills geladen, Agents mit Shopify-Kontext, Verification Command ausgeführt, Token-Usage in Events.

---

## Ausgangslage

P0 baut **nicht bei Null**. 3 Shopify Skills existieren und sind validiert:
- `skills/shopify-liquid.md` — Liquid Syntax, Sections, Snippets, Schema-Patterns
- `skills/shopify-theme.md` — Theme-Architektur, JSON Templates, Settings, Asset Pipeline
- `skills/shopify-metafields.md` — Metafield Types, Reference Resolution, Metaobjects

Dazu existiert ein Eval-Workspace (`shopify-skills-workspace/`) mit 3 Iterationen die die Skill-Effektivität A/B-getestet haben.

Was fehlt ist nicht der Skill-Content, sondern die **Pipeline-Integration**: Die Skills werden heute nicht automatisch geladen, die Pipeline weiß nicht dass es ein Shopify-Projekt ist, und Token-Usage wird nicht getrackt. P0 baut die Infrastruktur die diese Skills in die Pipeline einbindet.

---

## 1. project.json Schema erweitern

### Was

Neue Felder in project.json für Platform-Awareness, Skill-Konfiguration, und Agent-Steuerung.

### Schema-Erweiterung

```json
{
  "stack": {
    "language": "TypeScript",
    "package_manager": "npm",
    "platform": "shopify",
    "variant": "liquid"
  },
  "skills": {
    "domain": ["shopify-liquid", "shopify-theme", "shopify-metafields"],
    "custom": ["client-design-system"]
  },
  "pipeline": {
    "project_id": "...",
    "workspace_id": "...",
    "skip_agents": ["security", "data-engineer"]
  }
}
```

### Neue Felder

| Feld | Typ | Required | Beschreibung |
|---|---|---|---|
| `stack.platform` | string | nein | Platform-Identifier (`"shopify"`, `"nextjs"`, `"rails"`, etc.) |
| `stack.variant` | string | nein | Platform-Variante (`"liquid"`, `"hydrogen"`) |
| `skills.domain` | string[] | nein | Domain-Skills die geladen werden sollen |
| `skills.custom` | string[] | nein | Projekt-spezifische Skills (in `.claude/skills/`) |
| `pipeline.skip_agents` | string[] | nein | Agents die für dieses Projekt übersprungen werden |

### Backward Compatibility

- Alle neuen Felder sind optional
- Projekte ohne `stack.platform` funktionieren wie bisher
- `pipeline.skip_agents` Default: leeres Array (alle Agents aktiv)
- Bestehende Felder (`stack.language`, `stack.package_manager`, etc.) bleiben unverändert

### Template Update

`templates/project.json` bekommt die neuen Felder als Kommentar-Beispiele. `setup.sh` fragt bei `--setup` nach Platform wenn interaktiv.

### Acceptance Criteria

- [ ] project.json mit `stack.platform: "shopify"` wird korrekt geladen
- [ ] Fehlende Felder (platform, variant, skills, skip_agents) verursachen keine Fehler
- [ ] Template enthält dokumentierte Beispiele für alle neuen Felder

---

## 2. Skill-Loader

### Was

Neues Pipeline-Modul das Domain-Skills und Custom-Skills aus project.json liest und in Agent-Prompts injiziert.

### Abhängigkeit

Ticket 1 (project.json Schema) muss fertig sein.

### Datei

`pipeline/lib/load-skills.ts`

### Verhalten

```
1. Lese project.json → skills.domain + skills.custom + stack.platform + stack.variant
2. Falls skills.domain leer aber stack.platform gesetzt:
   - platform "shopify" + variant "liquid"    → ["shopify-liquid", "shopify-theme"]
   - platform "shopify" + variant "hydrogen"  → ["shopify-hydrogen", "shopify-storefront-api"]
3. Löse Skill-Dateien auf:
   - Domain Skills: skills/{name}.md (im Framework)
   - Custom Skills: .claude/skills/{name}.md (im Projekt)
4. Filtere Skills pro Agent-Rolle:
   - Frontend: liquid, theme, hydrogen, checkout
   - Backend: storefront-api, admin-api, apps, checkout
   - Data Engineer: admin-api, metafields
   - QA: theme
   - Orchestrator: alle
5. Return: Map<AgentRole, string[]> (Skill-Content pro Agent)
```

### Agent-Skill-Mapping

```typescript
const SKILL_AGENT_MAP: Record<string, AgentRole[]> = {
  'shopify-liquid':         ['frontend', 'orchestrator'],
  'shopify-theme':          ['frontend', 'qa', 'devops', 'orchestrator'],
  'shopify-metafields':     ['data-engineer', 'backend', 'orchestrator'],
  'shopify-storefront-api': ['backend', 'frontend', 'orchestrator'],
  'shopify-hydrogen':       ['frontend', 'backend', 'orchestrator'],
  'shopify-admin-api':      ['backend', 'data-engineer', 'orchestrator'],
  'shopify-checkout':       ['frontend', 'backend', 'orchestrator'],
  'shopify-apps':           ['backend', 'frontend', 'orchestrator'],
};
```

### Integration in Pipeline

`pipeline/run.ts` ruft `loadSkills(projectConfig)` auf und übergibt die gefilterten Skills an jeden Agent als zusätzlichen System-Prompt-Abschnitt.

### Acceptance Criteria

- [ ] Skill-Loader liest project.json und löst Domain-Skills auf
- [ ] Automatik: platform + variant → Default-Skills wenn skills.domain leer
- [ ] Skill-Content wird pro Agent-Rolle gefiltert
- [ ] Custom Skills aus .claude/skills/ werden geladen
- [ ] Fehlende Skill-Dateien → Warning, kein Crash
- [ ] Skills erscheinen im Agent-System-Prompt

---

## 3. Verification Commands

### Was

Platform-spezifische Verification Commands die automatisch im QA-Step der Pipeline ausgeführt werden.

### Abhängigkeit

Ticket 2 (Skill-Loader) muss fertig sein — Verification Commands sind ein Spezialfall von skill-basiertem Verhalten.

### Konfiguration

In `project.json`:

```json
{
  "build": {
    "web": "npm run build",
    "test": "npm run test",
    "verify": "shopify theme check --fail-level error"
  }
}
```

### Verhalten

- Pipeline prüft `build.verify` im QA-Step
- Falls gesetzt: Command wird ausgeführt, Output an QA-Agent übergeben
- Falls Command fehlschlägt: QA-Agent bekommt den Error-Output und kann Fix vorschlagen
- Falls nicht gesetzt: Skip (backward-compatible)

### Shopify-Defaults

Wenn `stack.platform === "shopify"` und `stack.variant === "liquid"` und `build.verify` nicht gesetzt:
- Default: `shopify theme check --fail-level error`
- Nur wenn `shopify` CLI im Projekt verfügbar ist (check via `which shopify`)

### Acceptance Criteria

- [ ] `build.verify` Command wird im QA-Step ausgeführt
- [ ] Error-Output wird an QA-Agent weitergegeben
- [ ] Shopify-Default greift wenn platform/variant gesetzt aber verify leer
- [ ] Fehlender CLI (`shopify` not found) → Warning, kein Pipeline-Fail

---

## 4. Sidekick Shopify-Kontext

### Was

Sidekick erkennt die Platform eines Projekts und bietet domainspezifische Ticket-Templates und Follow-up-Fragen.

### Abhängigkeit

Kann parallel zu Tickets 2+3 implementiert werden. Braucht nur `stack.platform` in der Projekt-Config (Ticket 1).

### Wo

Board-Repo (just-ship-board): `src/lib/sidekick/ai.ts` (System-Prompt), `src/lib/sidekick/tools.ts` (Ticket-Templates)

### Änderungen

**1. Projekt-Config im Sidekick laden**

Der Sidekick-Page-Route (`/sidekick/[projectSlug]`) lädt bereits das Projekt aus der DB. Erweiterung: `stack` Felder aus dem Projekt-Record lesen (müssen in der projects Tabelle oder als Metadaten verfügbar sein).

Optionen:
- a) `projects.stack` als JSONB-Spalte (neues DB-Feld)
- b) `projects.platform` als enum-Spalte
- c) Sidekick fragt Board-API nach project.json Config

Empfehlung: (a) — JSONB ist flexibel, ein Feld, eine Migration.

**2. System-Prompt Erweiterung**

Wenn `platform === "shopify"`:

```
Du bist der Projekt-Assistent für ein Shopify-Projekt (${variant}).

Wenn der Nutzer ein Problem beschreibt, frage gezielt nach:
- Welche Seite/Section ist betroffen?
- Ist es ein Theme-Problem oder ein Daten-Problem?
- Gibt es einen Screenshot?

Biete diese Schnellaktionen an:
- "Neue Section erstellen" → Frage nach Section-Typ, Inhalt, Position
- "Theme-Anpassung" → Frage nach welchem Bereich (Header, Footer, PDP, PLP, Cart)
- "Metafield Setup" → Frage nach Datentyp und wo es angezeigt werden soll
- "Performance Problem" → Frage nach welcher Seite, Ladezeit, Mobile/Desktop
- "Bug melden" → Frage nach Browser, Schritte zum Reproduzieren, Screenshot

Erstelle Tickets mit dem passenden Tag: shopify-theme, shopify-metafield, shopify-performance, shopify-bug.
```

**3. Ticket-Templates**

`create_ticket` Tool bekommt optionale Template-Unterstützung. Wenn Platform bekannt:
- Ticket-Description enthält strukturierte Felder (Section-Name, Betroffene Seite, etc.)
- Tags werden automatisch gesetzt basierend auf Template-Typ
- Priority-Suggestion basierend auf Typ (Bug = high, neue Section = medium, etc.)

### Acceptance Criteria

- [ ] Sidekick erkennt Shopify-Projekte und passt System-Prompt an
- [ ] Shopify-spezifische Schnellaktionen werden im Chat angeboten
- [ ] Tickets aus Shopify-Kontext haben passende Tags
- [ ] Nicht-Shopify-Projekte funktionieren unverändert

---

## 5. task_events Token-Felder

### Was

Erweitere das `task_events` Schema um Token-Usage-Tracking. Datengrundlage für späteres Cost-Dashboard (P2).

### Abhängigkeit

Kann parallel zu allen anderen Tickets implementiert werden.

### DB-Migration

```sql
ALTER TABLE task_events
  ADD COLUMN input_tokens integer,
  ADD COLUMN output_tokens integer,
  ADD COLUMN model text,
  ADD COLUMN estimated_cost_usd numeric(10,6);
```

Alle Felder nullable — bestehende Events bleiben unverändert.

### Kosten-Berechnung

Grobe Schätzung basierend auf Model:

```typescript
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-3-5-20241022': { input: 0.0008, output: 0.004 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1K[model] ?? COST_PER_1K['claude-sonnet-4-20250514'];
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}
```

Model-Preise als Config, nicht hardcoded — Preise ändern sich.

### RLS

Bestehende RLS-Policies auf task_events decken die neuen Spalten automatisch ab (row-level, nicht column-level).

### Acceptance Criteria

- [ ] Migration läuft ohne Datenverlust
- [ ] Neue Felder sind nullable (backward-compatible)
- [ ] Kosten-Berechnung basiert auf aktuellem Model-Pricing
- [ ] Pricing ist konfigurierbar (nicht hardcoded)

---

## 6. Pipeline Token-Usage Reporting

### Was

Pipeline reportet bei jedem Agent-Call die Token-Usage in task_events.

### Abhängigkeit

Ticket 5 (Token-Felder) muss fertig sein.

### Wo

`pipeline/lib/event-hooks.ts` — die Event-Posting-Logik.

### Änderungen

**1. Token-Usage aus Agent SDK extrahieren**

Claude Agent SDK gibt Token-Usage im Response zurück. Nach jedem Agent-Call:

```typescript
const result = await agent.execute(task);
const usage = result.usage; // { input_tokens, output_tokens }

await postEvent({
  type: 'agent_completed',
  agent: agentName,
  // ... bestehende Felder
  input_tokens: usage.input_tokens,
  output_tokens: usage.output_tokens,
  model: agent.model,
  estimated_cost_usd: estimateCost(agent.model, usage.input_tokens, usage.output_tokens),
});
```

**2. Aggregierte Events**

Zusätzlich zum per-Agent-Event ein Summary-Event am Ende der Pipeline:

```typescript
await postEvent({
  type: 'pipeline_completed',
  input_tokens: totalInputTokens,
  output_tokens: totalOutputTokens,
  estimated_cost_usd: totalCost,
});
```

### skip_agents Integration

`pipeline/run.ts` liest `pipeline.skip_agents` aus project.json und überspringt die gelisteten Agents. Kein Agent-Call = kein Event = keine Kosten.

```typescript
const skipAgents = projectConfig.pipeline?.skip_agents ?? [];
const activeAgents = allAgents.filter(a => !skipAgents.includes(a.role));
```

### Acceptance Criteria

- [ ] Jeder Agent-Call erzeugt ein Event mit Token-Usage
- [ ] Pipeline-Summary-Event enthält aggregierte Kosten
- [ ] skip_agents aus project.json werden übersprungen
- [ ] Token-Usage ist im Board via Realtime sichtbar (bestehende Subscription)

---

## Ticket-Reihenfolge (Abhängigkeiten)

```
T-1: project.json Schema erweitern
  │
  ├──→ T-2: Skill-Loader (load-skills.ts)
  │      │
  │      └──→ T-3: Verification Commands in Pipeline-QA
  │
  ├──→ T-4: Sidekick Shopify-Kontext (parallel zu T-2/T-3)
  │
  └──→ T-5: task_events Token-Felder (parallel zu T-2/T-3/T-4)
         │
         └──→ T-6: Pipeline Token-Usage Reporting + skip_agents
```

Kritischer Pfad: T-1 → T-2 → T-3 (Schema → Loader → Verification)
Paralleler Pfad: T-4, T-5 (ab T-1 fertig)
Letzter Schritt: T-6 (braucht T-5 für DB-Felder)
