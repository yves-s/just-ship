# P5 — Engine Abstraction & Scale

> Langfristige technische Weichenstellungen. Engine austauschbar machen, Multi-Provider, Declarative Workflows.
> Voraussetzung: P0 (Skill-Loader) + P1 (Resume-Logik, Crash Recovery).

---

## Done-Metrik

Das Engine-Interface existiert als TypeScript-Interface, Claude Code implementiert es, und `pipeline/run.ts` nutzt es statt direkter SDK-Calls.

---

## 1. Engine Abstraction Layer

### Was

TypeScript-Interface das die Execution Engine abstrahiert. Alle Engine-spezifischen Aufrufe laufen über dieses Interface. Ermöglicht zukünftig alternative Engines (GSD 2, etc.) ohne Pipeline-Code zu ändern.

### Interface

```typescript
// pipeline/lib/engine.ts

interface TaskDefinition {
  ticketId: number;
  instruction: string;
  files: string[];                    // Relevante Files für Context
  skills: string[];                   // Skill-Content (aus Skill-Loader)
  agentDefinition: string;            // Agent-Markdown (aus agents/)
  model: 'opus' | 'sonnet' | 'haiku';
  timeout: number;                     // Millisekunden
  workingDirectory: string;            // Projekt-Root oder Worktree
}

interface TaskResult {
  status: 'completed' | 'failed' | 'timeout';
  output: string;                      // Agent-Output (Zusammenfassung, Diff, etc.)
  usage: TokenUsage;
  duration_ms: number;
  error?: string;
}

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
  estimated_cost_usd: number;
}

interface ExecutionEngine {
  /** Unique identifier for this engine */
  readonly name: string;

  /** Execute a task */
  execute(task: TaskDefinition): Promise<TaskResult>;

  /** Check if engine is available and healthy */
  healthCheck(): Promise<boolean>;

  /** Get cumulative token usage for current session */
  getTokenUsage(): Promise<TokenUsage>;

  /** Check if a previous task can be resumed */
  canResume(taskId: string): boolean;

  /** Resume a previously interrupted task */
  resume(taskId: string, checkpoint: PipelineCheckpoint): Promise<TaskResult>;
}
```

### Claude Code Engine Implementierung

```typescript
// pipeline/lib/engines/claude-code.ts

import { Agent } from '@anthropic-ai/claude-agent-sdk';

class ClaudeCodeEngine implements ExecutionEngine {
  readonly name = 'claude-code';

  async execute(task: TaskDefinition): Promise<TaskResult> {
    const agent = new Agent({
      model: this.resolveModel(task.model),
      systemPrompt: this.buildSystemPrompt(task),
      tools: this.getTools(task),
      workingDirectory: task.workingDirectory,
    });

    const startTime = Date.now();

    try {
      const result = await agent.run(task.instruction);
      return {
        status: 'completed',
        output: result.output,
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          model: task.model,
          estimated_cost_usd: this.estimateCost(task.model, result.usage),
        },
        duration_ms: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: 'failed',
        output: '',
        usage: { input_tokens: 0, output_tokens: 0, model: task.model, estimated_cost_usd: 0 },
        duration_ms: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    // Check: claude CLI verfügbar, API Key gesetzt, etc.
    try {
      // Simple API ping
      return true;
    } catch {
      return false;
    }
  }

  // ... weitere Methoden
}
```

### Refactoring von run.ts

**Vorher (direkte SDK-Calls):**
```typescript
// pipeline/run.ts
import { Agent } from '@anthropic-ai/claude-agent-sdk';

const triageAgent = new Agent({ model: 'haiku', ... });
const result = await triageAgent.run(instruction);
```

**Nachher (über Engine-Interface):**
```typescript
// pipeline/run.ts
import { getEngine } from './lib/engine';

const engine = getEngine(projectConfig);
const result = await engine.execute({
  ticketId,
  instruction,
  files: relevantFiles,
  skills: triageSkills,
  agentDefinition: triageAgentDef,
  model: 'haiku',
  timeout: AGENT_TIMEOUTS.haiku,
  workingDirectory: projectDir,
});
```

### Engine Registry

```typescript
// pipeline/lib/engine.ts

const engines: Record<string, () => ExecutionEngine> = {
  'claude-code': () => new ClaudeCodeEngine(),
  // Future: 'gsd': () => new GSDEngine(),
};

function getEngine(config: ProjectConfig): ExecutionEngine {
  const engineName = config.pipeline?.engine ?? 'claude-code';
  const factory = engines[engineName];
  if (!factory) throw new Error(`Unknown engine: ${engineName}`);
  return factory();
}
```

### project.json Erweiterung

```json
{
  "pipeline": {
    "engine": "claude-code"
  }
}
```

Default: `"claude-code"`. Feld ist optional, backward-compatible.

### Acceptance Criteria

- [ ] ExecutionEngine Interface ist definiert
- [ ] ClaudeCodeEngine implementiert das Interface vollständig
- [ ] pipeline/run.ts nutzt Engine-Interface statt direkter SDK-Calls
- [ ] Bestehende Funktionalität ist unverändert (kein Behavior-Change)
- [ ] Engine ist über project.json konfigurierbar
- [ ] Health-Check funktioniert

---

## 2. GSD 2 Evaluation

### Was

Evaluierung von GSD 2 als alternative Execution Engine. Kein Code, nur ein strukturierter Report.

### Evaluations-Checkliste

| Kriterium | Frage | Gewichtung |
|---|---|---|
| **Task Dispatch** | Kann GSD Tasks über CLI/API empfangen? | MUST |
| **Token Usage** | Reportet GSD Token-Verbrauch? | MUST |
| **Output Format** | Gibt GSD strukturierten Output zurück (Diff, Summary)? | MUST |
| **Resume** | Kann GSD unterbrochene Tasks wiederaufnehmen? | SHOULD |
| **Tool Use** | Unterstützt GSD File-Edit, Bash, etc.? | MUST |
| **Model Selection** | Kann man das Model pro Task setzen? | SHOULD |
| **Working Directory** | Kann GSD in einem spezifischen Verzeichnis arbeiten? | MUST |
| **Timeout** | Kann man Timeouts setzen? | SHOULD |
| **Skill Injection** | Kann man Custom System Prompts / Skills injizieren? | MUST |
| **Cost** | Was kostet GSD pro Task vs. Claude Code? | NICE |
| **Stability** | Wie stabil ist GSD in Production? | MUST |

### Output

Markdown-Report in `docs/evaluations/gsd-2-engine-eval.md`:
- Pro Kriterium: ja/nein/teilweise + Notizen
- Gesamtbewertung: Ready / Not Ready / Needs Work
- Empfehlung: Implementieren / Warten / Verwerfen

### Acceptance Criteria

- [ ] Checkliste vollständig abgearbeitet
- [ ] Report liegt in docs/evaluations/
- [ ] Klare Empfehlung (implement/wait/reject)

---

## 3. Multi-Provider Model Support

### Was

OpenRouter als Fallback-Provider wenn Anthropic API nicht verfügbar (Rate Limit, Outage).

### Konfiguration

```json
{
  "pipeline": {
    "model_config": {
      "primary_provider": "anthropic",
      "fallback_provider": "openrouter",
      "openrouter_api_key_env": "OPENROUTER_API_KEY"
    }
  }
}
```

### Fallback-Logik

```typescript
async function executeWithFallback(engine: ExecutionEngine, task: TaskDefinition): Promise<TaskResult> {
  try {
    return await engine.execute(task);
  } catch (error) {
    if (isRateLimitOrOutage(error) && hasFallbackProvider()) {
      console.warn(`Primary provider failed, falling back to ${fallbackProvider}`);
      const fallbackEngine = getEngine({ ...config, provider: fallbackProvider });
      return await fallbackEngine.execute(task);
    }
    throw error;
  }
}
```

### Model-Mapping (OpenRouter)

| Anthropic Model | OpenRouter Equivalent |
|---|---|
| claude-opus-4 | anthropic/claude-opus-4 |
| claude-sonnet-4 | anthropic/claude-sonnet-4 |
| claude-haiku-3.5 | anthropic/claude-haiku-3.5 |

OpenRouter nutzt die selben Models, nur über anderen Endpoint. Der Vorteil ist Redundanz, nicht alternative Models.

### Acceptance Criteria

- [ ] Fallback triggert bei Rate Limit / API Outage
- [ ] OpenRouter-Calls funktionieren mit selben Models
- [ ] Token-Usage wird auch vom Fallback-Provider reported
- [ ] Kein Fallback bei normalen Fehlern (nur bei Provider-Problemen)

---

## 4. Declarative Workflow Engine

### Was

Projektspezifische Pipeline-Konfiguration die den Default-Flow überschreibt. Volle YAML/JSON-Konfiguration.

### Hinweis

P0 implementiert bereits `pipeline.skip_agents` als simples Feature-Flag. Die Declarative Workflow Engine ist die vollständige Version davon.

### Config-Schema

In `project.json`:

```json
{
  "pipeline": {
    "workflow": {
      "triage": true,
      "planning": true,
      "agents": {
        "frontend": { "enabled": true, "model": "sonnet" },
        "backend": { "enabled": true, "model": "sonnet" },
        "data-engineer": { "enabled": false },
        "security": { "enabled": false }
      },
      "qa": {
        "enabled": true,
        "model": "haiku",
        "verify_command": "shopify theme check --fail-level error"
      },
      "auto_pr": true,
      "auto_merge": false,
      "max_qa_retries": 2
    }
  }
}
```

### Verhalten

Der Pipeline-Runner liest `pipeline.workflow` und überschreibt die Defaults:

```typescript
function resolveWorkflow(config: ProjectConfig): PipelineWorkflow {
  const workflow = config.pipeline?.workflow;
  const skipAgents = config.pipeline?.skip_agents ?? [];

  return {
    triage: workflow?.triage ?? true,
    planning: workflow?.planning ?? true,
    agents: resolveAgents(workflow?.agents, skipAgents),
    qa: {
      enabled: workflow?.qa?.enabled ?? true,
      model: workflow?.qa?.model ?? 'haiku',
      verifyCommand: workflow?.qa?.verify_command ?? config.build?.verify,
      maxRetries: workflow?.max_qa_retries ?? 2,
    },
    autoPR: workflow?.auto_pr ?? true,
    autoMerge: workflow?.auto_merge ?? false,
  };
}
```

### Backward Compatibility

- `pipeline.skip_agents` (P0) bleibt funktional
- `pipeline.workflow.agents` überschreibt `skip_agents` wenn beide gesetzt
- Ohne `pipeline.workflow`: Default-Verhalten wie bisher

### Acceptance Criteria

- [ ] Workflow-Config wird aus project.json gelesen
- [ ] Agents können pro Projekt aktiviert/deaktiviert werden
- [ ] Model kann pro Agent überschrieben werden
- [ ] QA-Verify-Command ist konfigurierbar
- [ ] auto_merge = false verhindert automatischen Merge
- [ ] Backward-compatible mit skip_agents aus P0

---

## 5. Community & Distribution (Nicht-technisch)

Checkliste:

- [ ] Discord Server aufsetzen
- [ ] Erste externe User einladen (aus ICP-Gesprächen P4)
- [ ] Public Building Content starten (Twitter/LinkedIn)
- [ ] Documentation Site aufsetzen (setup.sh Anleitung, Skill-Authoring Guide)
- [ ] Contributing Guide für externe Skill-Autoren

---

## Ticket-Reihenfolge

```
T-1: ExecutionEngine Interface + TypeScript Types
  │
  └──→ T-2: ClaudeCodeEngine Implementierung (Refactoring aus run.ts)
       │
       └──→ T-3: Engine Registry + project.json Config

T-4: GSD 2 Evaluation (Report, kein Code)

T-5: OpenRouter Fallback-Provider
  (hängt an T-1/T-2 — braucht Engine-Interface)

T-6: Declarative Workflow Config Schema + Parser
  │
  └──→ T-7: Workflow Config in Pipeline-Runner integrieren
```

T-1→T-2→T-3 ist der kritische Pfad (Engine Abstraction).
T-4 ist unabhängig (reiner Research-Task).
T-5 hängt an Engine-Interface.
T-6→T-7 ist unabhängig von Engine, kann parallel laufen.
