# Agent SDK Migration — Vollständige Analyse (2026-03-12)

## Kontext

Migration der Shell-Pipeline (`run.sh`, `worker.sh`, `send-event.sh`, `devboard-hook.sh`) zu TypeScript mit `@anthropic-ai/claude-agent-sdk`. Zwei Hauptziele:

1. **Native Event Streaming zum Dev Board** (statt fire-and-forget Shell-Scripts)
2. **Parallel Agent Execution** (SDK unterstützt mehrere Agent-Tool-Calls in einem Response)

## SDK Version

- **package.json**: `^0.1.0`
- **Installiert**: `0.1.77`

## Tickets (Board: Just Ship)

| Ticket | Prio | Titel | Status |
|--------|------|-------|--------|
| T-277 | high | fix: SubagentStop hook uses agent_id instead of agent_type | ✅ done |
| T-278 | medium | refactor: Use SDK AgentDefinition type with model field | ✅ done |
| T-279 | high | feat: Event Streaming to Dev Board — end-to-end test | ✅ done |
| T-280 | high | feat: Parallel Agent Execution — Orchestrator + Test | ✅ done |
| T-281 | low | chore: MCP Server Support entscheiden und aufräumen | ✅ done |
| T-282 | medium | chore: VPS Deployment mit worker.ts testen | backlog |

## Reihenfolge

```
T-277 (Bug: agent_type Fix)
  → T-278 (Refactor: SDK AgentDefinition)
    → T-279 (HAUPTZIEL: Event Streaming)
      → T-280 (HAUPTZIEL: Parallel Execution)
        → T-281 (MCP Cleanup)
        → T-282 (VPS Test)
```

---

## Was FERTIG ist (bestätigt funktionierend)

### Pipeline-Infrastruktur
- `pipeline/run.ts` — `query()` mit Orchestrator, Branch-Erstellung, JSON-Output
- `pipeline/worker.ts` — Supabase-Polling, atomisches Claiming, `executePipeline()` Import
- `pipeline/lib/config.ts` — `project.json` Loading, CLI-Arg-Parsing
- `pipeline/lib/load-agents.ts` — Agent `.md` Parsing → `AgentDefinition` Objekte
- `pipeline/lib/event-hooks.ts` — Hook-Definitionen (Code vorhanden, NICHT getestet)
- `pipeline/lib/mcp-tools.ts` — Tool-Pattern-Loading (funktional nutzlos, s.u.)
- `pipeline/run.sh` — 2-Zeilen Wrapper für Backwards-Kompatibilität
- `setup.sh` — Installiert Pipeline-Files + `npm install` + Cleanup alter Dateien

### Getestet
- `setup.sh --update` auf Aime Web — 30 Dateien korrekt installiert
- Config/Agent Loading — alle Funktionen arbeiten korrekt
- SDK `query()` — Verbindung, Prompt, Response OK (Haiku)
- Agent Spawning — Orchestrator → QA-Agent funktioniert
- Voller Pipeline-Run — Ticket #275, Branch + Commit + PR #4 auf Aime Web
- Worker Env-Validation — sauberer Exit bei fehlenden Vars

---

## Bugs im aktuellen Code

### Bug 1: SubagentStop Hook (T-277)

**Datei:** `pipeline/lib/event-hooks.ts:42`

```typescript
// AKTUELL (FALSCH):
agent_type: hookInput.agent_id ?? "unknown"

// KORREKT:
agent_type: hookInput.agent_type
```

**SDK-Typ** `SubagentStopHookInput`:
```typescript
type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: "SubagentStop";
  agent_id: string;           // technische ID
  agent_type: string;          // ← DAS brauchen wir ("frontend", "backend", etc.)
  agent_transcript_path: string;
  stop_hook_active: boolean;
  last_assistant_message?: string;
};
```

### Bug 2: Eigener AgentDefinition statt SDK-Typ (T-278)

**Datei:** `pipeline/lib/load-agents.ts:4-8`

```typescript
// AKTUELL (eigener Typ, eingeschränkt):
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
}
```

**SDK-Typ** (vollständig):
```typescript
type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: "sonnet" | "opus" | "haiku" | "inherit";
  skills?: string[];
  maxTurns?: number;
  mcpServers?: AgentMcpServerSpec[];
  criticalSystemReminder_EXPERIMENTAL?: string;
};
```

**Impact:** Agents können kein `model` direkt setzen. Der Orchestrator steuert es nur via Prompt.

### Bug 3: MCP-Tools funktionieren nicht (T-281)

**Datei:** `pipeline/lib/mcp-tools.ts`

`loadMcpTools()` liest Tool-Patterns aus `settings.json` und fügt sie zu `allowedTools` hinzu.

**Problem:** `allowedTools` auto-approved nur vorhandene Tools — es **startet keine MCP-Server**. Im headless SDK-Modus laufen keine MCP-Server ohne die `mcpServers` Option. Der Code ist effektiv nutzlos.

**Empfehlung:** Entfernen (Option B). Pipeline braucht keine MCP-Tools.

---

## Offene Hauptziele

### HAUPTZIEL 1: Event Streaming zum Dev Board (T-279)

**Status:** Code vorhanden, NIE getestet

**Warum nicht getestet:**
- Aime Web `project.json` hat `api_url: ""` und `api_key: ""`
- → `hasPipeline = false` in `run.ts:51`
- → Hooks werden komplett übersprungen

**Was nötig ist:**
1. API-Key in Pipeline-DB erzeugen (`api_keys` Tabelle, Format: `adp_<hex>`)
2. `project.json` von Aime Web befüllen
3. Pipeline laufen lassen
4. Events in `task_events` Tabelle prüfen
5. Board Agent-Panel verifizieren

**Event-API-Kontrakt:**
```
POST {api_url}/api/events
Header: X-Pipeline-Key: adp_<hex>
Body: { ticket_number: number, agent_type: string, event_type: string, metadata?: object }
```

**Event-Typen die gesendet werden:**
| Hook | Event Type | Trigger |
|------|-----------|---------|
| SubagentStart | `agent_started` | Agent wird gespawnt |
| SubagentStop | `completed` | Agent fertig |
| PostToolUse (Write\|Edit) | `tool_use` | Datei geändert |
| Pipeline-Start | `agent_started` | Pipeline beginnt |
| Pipeline-Ende | `completed` | Pipeline fertig |
| Pipeline-Fehler | `pipeline_failed` | Unbehandelter Fehler |

### HAUPTZIEL 2: Parallel Agent Execution (T-280)

**Status:** Nicht getestet, nicht konfiguriert

**SDK unterstützt es nativ:** Wenn der LLM mehrere Agent Tool-Calls in einem Response sendet, spawnt der SDK sie automatisch.

**Was nötig ist:**
- Orchestrator-Prompt (`agents/orchestrator.md`) muss paralleles Spawning explizit anweisen
- z.B. "Spawne Frontend- und Backend-Agent gleichzeitig wenn die Aufgaben unabhängig sind"
- Test mit einem Ticket das Frontend + Backend Arbeit erfordert

---

## SDK API-Referenz (Kurzfassung für Migration)

### query() Options (die wir nutzen)

```typescript
query({
  prompt: string,
  options: {
    cwd: string,                    // ✅ Projektverzeichnis
    model: string,                  // ✅ "opus" für Orchestrator
    permissionMode: PermissionMode, // ✅ "bypassPermissions"
    allowDangerouslySkipPermissions: boolean, // ✅ true
    allowedTools: string[],         // ✅ Tool-Liste
    agents: Record<string, AgentDefinition>, // ✅ Sub-Agents
    hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>, // ✅ Event Hooks
    maxTurns: number,               // ✅ 200
    settingSources: SettingSource[], // ✅ ["project"]
    persistSession: boolean,        // ✅ false
    abortController: AbortController, // ✅ für Worker-Shutdown
  }
})
```

### query() Options (die wir NICHT nutzen, aber könnten)

```typescript
{
  mcpServers: Record<string, McpServerConfig>, // MCP-Server direkt starten
  systemPrompt: string | { type: 'preset', preset: 'claude_code', append?: string },
  maxBudgetUsd: number,           // Kostenkontrolle
  effort: 'low' | 'medium' | 'high' | 'max',
  env: Record<string, string>,    // Environment Variables
  disallowedTools: string[],      // Tool-Blacklist
}
```

### AgentDefinition (SDK-Typ)

```typescript
type AgentDefinition = {
  description: string;     // REQUIRED: Wann Agent nutzen
  prompt: string;          // REQUIRED: System-Prompt
  tools?: string[];        // Erlaubte Tools (default: alle vom Parent)
  disallowedTools?: string[];
  model?: "sonnet" | "opus" | "haiku" | "inherit";
  skills?: string[];
  maxTurns?: number;
  mcpServers?: AgentMcpServerSpec[];
};
```

### Hook-Typen (die wir nutzen)

```typescript
// SubagentStart
type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;     // ← Name des Agents ("frontend", "backend", etc.)
};

// SubagentStop
type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: "SubagentStop";
  agent_id: string;
  agent_type: string;     // ← Name des Agents
  agent_transcript_path: string;
  stop_hook_active: boolean;
  last_assistant_message?: string;
};

// PostToolUse
type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  tool_use_id: string;
};

// BaseHookInput (alle Hooks erben davon)
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  agent_id?: string;      // Nur in Subagent-Kontext
  agent_type?: string;    // Nur in Subagent-Kontext
};
```

### HookCallback Return-Typen

```typescript
// Async (fire-and-forget, Pipeline wartet nicht):
{ async: true, asyncTimeout?: number }

// Sync (Pipeline wartet, kann blocken/modifizieren):
{
  continue?: boolean,
  systemMessage?: string,
  hookSpecificOutput?: { ... }
}

// Leeres Objekt = erlauben ohne Änderung:
{}
```

### SDKResultMessage

```typescript
type SDKResultMessage =
  | { type: "result"; subtype: "success"; result: string; total_cost_usd: number; ... }
  | { type: "result"; subtype: "error_max_turns" | "error_during_execution" | ...; errors: string[]; ... };
```

---

## Dateien-Übersicht

| Datei | Zweck | Status |
|-------|-------|--------|
| `pipeline/run.ts` | SDK `query()` Aufruf, Branch, JSON-Output | ✅ Funktioniert |
| `pipeline/worker.ts` | Supabase-Polling, `executePipeline()` | ✅ Implementiert |
| `pipeline/lib/config.ts` | `project.json` + CLI Args | ✅ Funktioniert |
| `pipeline/lib/load-agents.ts` | Agent `.md` → `AgentDefinition` | ⚠️ Eigener Typ (T-278) |
| `pipeline/lib/event-hooks.ts` | SDK Hooks → Board Events | ⚠️ Bug (T-277), ungetestet |
| `pipeline/lib/mcp-tools.ts` | MCP Tool-Patterns | ❌ Nutzlos (T-281) |
| `pipeline/run.sh` | Shell-Wrapper | ✅ |
| `pipeline/package.json` | Dependencies | ✅ |
| `setup.sh` | Install/Update | ✅ Getestet |
| `agents/orchestrator.md` | Orchestrator-Prompt | ⚠️ Kein Parallel-Spawning (T-280) |
| `vps/*` | VPS-Infrastruktur | ⚠️ Ungetestet (T-282) |
