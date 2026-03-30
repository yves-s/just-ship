# P1 — Pipeline-Stabilität

> Pipeline zuverlässig genug für Production. Crash Recovery, Stuck Detection, Budget-Kontrolle.
> Voraussetzung: P0 fertig (Token-Felder in Events, Skill-Loader existiert).

---

## Done-Metrik

Der VPS-Worker läuft 48 Stunden ohne manuellen Eingriff durch — inklusive Recovery nach simuliertem Crash, Timeout-Handling, und Budget-Check.

---

## 1. Crash Recovery + Checkpoint Persistence

### Was

Pipeline-State wird als Checkpoint auf dem Ticket persistiert. Bei Crash kann die Pipeline am letzten Checkpoint wiederaufsetzen.

### DB-Migration

```sql
ALTER TABLE tickets
  ADD COLUMN pipeline_checkpoint jsonb;
```

### Checkpoint-Schema

```typescript
interface PipelineCheckpoint {
  phase: 'queued' | 'triage' | 'planning' | 'agents_dispatched' | 'agents_done' | 'qa' | 'pr_created';
  completed_agents: string[];      // z.B. ["data-engineer", "backend"]
  pending_agents: string[];        // z.B. ["frontend"]
  branch_name: string;             // Feature-Branch für Resume
  worktree_path?: string;          // Falls Worktree aktiv
  started_at: string;              // ISO timestamp
  last_updated: string;            // ISO timestamp
  attempt: number;                 // Retry-Counter (1-based)
  error?: string;                  // Letzter Fehler falls vorhanden
}
```

### Pipeline-Integration

**Checkpoint schreiben:**

Bei jeder Phase-Transition updated die Pipeline das Checkpoint-Feld:

```typescript
async function updateCheckpoint(ticketId: number, checkpoint: Partial<PipelineCheckpoint>) {
  await supabase
    .from('tickets')
    .update({ pipeline_checkpoint: { ...currentCheckpoint, ...checkpoint, last_updated: now() } })
    .eq('id', ticketId);
}
```

Checkpoint-Updates passieren an diesen Stellen in `pipeline/run.ts`:
1. Nach Triage: `{ phase: 'triage', ... }`
2. Nach Planning (Orchestrator): `{ phase: 'planning', ... }`
3. Nach Agent-Dispatch: `{ phase: 'agents_dispatched', pending_agents: [...] }`
4. Nach jedem Agent-Completion: `completed_agents` updaten, `pending_agents` reduzieren
5. Nach QA: `{ phase: 'qa', ... }`
6. Nach PR-Erstellung: `{ phase: 'pr_created', ... }`

**Resume-Logik:**

`server.ts` `/api/launch` prüft vor dem Start:

```typescript
const ticket = await getTicket(ticketId);
const checkpoint = ticket.pipeline_checkpoint;

if (checkpoint && checkpoint.phase !== 'pr_created') {
  // Resume statt Neustart
  return resumePipeline(ticket, checkpoint);
}

// Kein Checkpoint oder Pipeline war fertig → Neustart
return startPipeline(ticket);
```

Resume-Verhalten pro Phase:

| Checkpoint-Phase | Resume-Verhalten |
|---|---|
| `triage` | Triage wiederholen (billig, Haiku) |
| `planning` | Planning wiederholen (Orchestrator) |
| `agents_dispatched` | Nur `pending_agents` starten, `completed_agents` überspringen |
| `agents_done` | Direkt zu QA |
| `qa` | QA wiederholen |
| `pr_created` | Pipeline fertig, kein Resume nötig |

### Acceptance Criteria

- [ ] Checkpoint wird bei jeder Phase-Transition geschrieben
- [ ] `/api/launch` erkennt existierenden Checkpoint und resumt
- [ ] Nach simuliertem Crash: Pipeline setzt am richtigen Punkt fort
- [ ] Bereits abgeschlossene Agents werden nicht wiederholt
- [ ] Checkpoint wird nach erfolgreichem PR-Create gelöscht (auf null gesetzt)

---

## 2. Stuck Detection + Timeout Supervision

### Was

Agents die hängen bleiben werden erkannt und gehandelt. Konfigurierbare Timeouts pro Agent-Modell.

### Timeout-Defaults

```typescript
const AGENT_TIMEOUTS: Record<string, number> = {
  'haiku':   10 * 60 * 1000,  // 10 Minuten
  'sonnet':  20 * 60 * 1000,  // 20 Minuten
  'opus':    30 * 60 * 1000,  // 30 Minuten
};
```

Konfigurierbar pro Projekt in `project.json`:

```json
{
  "pipeline": {
    "timeouts": {
      "haiku": 600000,
      "sonnet": 1200000,
      "opus": 1800000
    }
  }
}
```

### Supervisor-Loop

In `pipeline/run.ts`, wenn Agents parallel laufen:

```typescript
async function superviseAgents(agents: RunningAgent[], timeouts: TimeoutConfig): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  for (const agent of agents) {
    const timeout = timeouts[agent.model] ?? timeouts.sonnet;

    try {
      const result = await Promise.race([
        agent.promise,
        timeoutPromise(timeout, agent.name),
      ]);
      results.push(result);
    } catch (error) {
      if (error instanceof TimeoutError) {
        await postEvent({ type: 'agent_timeout', agent: agent.name, timeout_ms: timeout });
        agent.retryCount++;

        if (agent.retryCount >= 3) {
          await postEvent({ type: 'agent_stuck', agent: agent.name, retries: 3 });
          // Agent wird übersprungen, Pipeline geht weiter
          results.push({ agent: agent.name, status: 'stuck', error: 'Max retries exceeded' });
        } else {
          // Retry mit frischem Context
          agent.promise = restartAgent(agent);
          // Zurück in die Supervision
        }
      }
    }
  }

  return results;
}
```

### Eskalation

| Situation | Aktion |
|---|---|
| 1x Timeout | Retry mit frischem Context, `agent_timeout` Event |
| 2x Timeout | Retry, Warning-Event |
| 3x Timeout | Agent skip, `agent_stuck` Event, Pipeline geht weiter ohne diesen Agent |
| Alle Agents stuck | `pipeline_failed` Event mit Reason `all_agents_stuck` |

### Acceptance Criteria

- [ ] Agents die länger als Timeout laufen werden erkannt
- [ ] Retry-Logik: bis 3x, dann Skip
- [ ] Events: `agent_timeout`, `agent_stuck` werden gepostet
- [ ] Timeout-Werte sind pro Projekt konfigurierbar
- [ ] Pipeline failed nicht wegen eines einzelnen stuck Agent

---

## 3. Fresh Context per Task

### Was

Jeder Task startet mit frischem Claude-Context. Kein akkumulierter Session-Ballast.

### Problem

Aktuell kann es passieren dass ein Agent-Context aus vorherigen Runs Informationen enthält die für den aktuellen Task irrelevant oder sogar schädlich sind.

### Lösung

**Context Pre-Loading statt Session-Accumulation:**

1. Jeder Agent-Call bekommt einen frischen System-Prompt, zusammengesetzt aus:
   - Agent-Definition (aus `agents/`)
   - Domain-Skills (aus Skill-Loader, P0)
   - Relevante Files (vom Orchestrator identifiziert)
   - Ticket-Context (Beschreibung, Acceptance Criteria)

2. Kein State wird zwischen Agent-Calls geshared außer:
   - Die expliziten Ergebnisse (Output, Diff)
   - Der Checkpoint (auf dem Ticket)

3. Der Orchestrator identifiziert die relevanten Files pro Agent und übergibt sie explizit:

```typescript
const orchestratorResult = await orchestrator.execute({
  ticket,
  skills: loadedSkills.orchestrator,
});

// Orchestrator gibt zurück: welche Files jeder Agent braucht
const agentInstructions = orchestratorResult.agentInstructions;

for (const [agentName, instruction] of Object.entries(agentInstructions)) {
  await agent.execute({
    instruction: instruction.task,
    files: instruction.relevantFiles,  // Explizit, nicht aus Session
    skills: loadedSkills[agentName],
  });
}
```

### Acceptance Criteria

- [ ] Jeder Agent-Call startet mit frischem Context
- [ ] Skill-Content wird per Call injiziert (nicht aus Session)
- [ ] Orchestrator übergibt explizit relevante Files pro Agent
- [ ] Kein impliziter State-Transfer zwischen Agents

---

## 4. Budget Tracking + Ceiling

### Was

Aggregierte Kosten pro Ticket und Projekt. Budget-Ceiling pro Workspace mit Pipeline-Block bei Überschreitung.

### Abhängigkeit

P0 Ticket 5+6 müssen fertig sein (Token-Felder in Events, Pipeline reportet Usage).

### Supabase Views

```sql
-- Kosten pro Ticket
CREATE VIEW ticket_costs AS
SELECT
  t.id AS ticket_id,
  t.project_id,
  t.workspace_id,
  COALESCE(SUM(te.input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(te.output_tokens), 0) AS total_output_tokens,
  COALESCE(SUM(te.estimated_cost_usd), 0) AS total_cost_usd
FROM tickets t
LEFT JOIN task_events te ON te.ticket_id = t.id
  AND te.estimated_cost_usd IS NOT NULL
GROUP BY t.id, t.project_id, t.workspace_id;

-- Kosten pro Projekt pro Monat
CREATE VIEW project_costs AS
SELECT
  t.project_id,
  t.workspace_id,
  DATE_TRUNC('month', te.created_at) AS month,
  COUNT(DISTINCT t.id) AS ticket_count,
  COALESCE(SUM(te.input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(te.output_tokens), 0) AS total_output_tokens,
  COALESCE(SUM(te.estimated_cost_usd), 0) AS total_cost_usd
FROM tickets t
LEFT JOIN task_events te ON te.ticket_id = t.id
  AND te.estimated_cost_usd IS NOT NULL
GROUP BY t.project_id, t.workspace_id, DATE_TRUNC('month', te.created_at);
```

### Budget Ceiling

```sql
ALTER TABLE workspaces
  ADD COLUMN budget_ceiling_usd numeric(10,2),
  ADD COLUMN budget_alert_threshold numeric(3,2) DEFAULT 0.8;
```

- `budget_ceiling_usd`: Maximales Budget pro Monat. NULL = kein Limit.
- `budget_alert_threshold`: Bei welchem Prozentsatz eine Warnung kommt (Default: 80%).

### Pipeline-Check

Vor jedem `/api/launch`:

```typescript
async function checkBudget(workspaceId: string): Promise<{ allowed: boolean; reason?: string }> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace.budget_ceiling_usd) return { allowed: true };

  const currentMonth = await getCurrentMonthCost(workspaceId);

  if (currentMonth >= workspace.budget_ceiling_usd) {
    await postEvent({ type: 'budget_exceeded', workspace_id: workspaceId, cost: currentMonth, ceiling: workspace.budget_ceiling_usd });
    return { allowed: false, reason: `Budget exceeded: $${currentMonth} / $${workspace.budget_ceiling_usd}` };
  }

  if (currentMonth >= workspace.budget_ceiling_usd * workspace.budget_alert_threshold) {
    await postEvent({ type: 'budget_threshold', workspace_id: workspaceId, cost: currentMonth, ceiling: workspace.budget_ceiling_usd });
  }

  return { allowed: true };
}
```

### Acceptance Criteria

- [ ] `ticket_costs` View aggregiert korrekt aus task_events
- [ ] `project_costs` View aggregiert pro Projekt und Monat
- [ ] Budget Ceiling blockiert Pipeline-Launch bei Überschreitung
- [ ] Budget-Threshold-Event wird bei 80% gepostet
- [ ] `budget_exceeded` Event enthält aktuelle Kosten und Ceiling
- [ ] NULL Ceiling = kein Limit (backward-compatible)

---

## Ticket-Reihenfolge

```
T-1: Crash Recovery — pipeline_checkpoint Feld + Checkpoint-Schreib-Logik
  │
  └──→ T-2: Resume-Logik in /api/launch

T-3: Agent-Timeout Supervision mit konfigurierbaren Limits
  │
  └──→ T-4: Stuck Detection (3x Timeout = Skip, alle stuck = Fail)

T-5: Fresh Context per Task (Context Pre-Loading)

T-6: Budget Views (ticket_costs, project_costs)
  │
  └──→ T-7: Budget Ceiling + Pipeline-Block bei Überschreitung
```

T-1/T-2, T-3/T-4, T-5, T-6/T-7 sind vier unabhängige Stränge die parallel bearbeitet werden können.
