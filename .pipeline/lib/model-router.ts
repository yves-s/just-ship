/**
 * Smart Model Routing — routes agents to the optimal model per phase.
 *
 * Planning phases (triage, code-review, qa, security) default to Opus.
 * Implementation phases (backend, frontend, data-engineer, devops) default to Sonnet.
 *
 * Override defaults via `pipeline.model_routing` in project.json.
 */

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.ts";

// --- Model string validation ---

/** Known valid model aliases accepted by the Claude Code SDK. */
const VALID_MODELS = new Set(["opus", "sonnet", "haiku", "inherit"]);

/**
 * Validates a user-supplied model string.
 * Accepts known aliases and full model IDs (e.g. "claude-opus-4-5").
 * Returns false for empty strings and values that are clearly not model identifiers.
 */
function isValidModel(model: string): boolean {
  if (!model || typeof model !== "string") return false;
  if (VALID_MODELS.has(model)) return true;
  // Accept full model IDs: must start with "claude-" and contain only safe chars
  return /^claude-[a-z0-9-]+$/.test(model);
}

// --- Phase classification ---

export type RoutingPhase = "planning" | "implementation";

/** Default agent → phase mapping. Agents not listed here get no override (inherit parent model). */
const DEFAULT_PHASE_MAP: Record<string, RoutingPhase> = {
  // Planning phases → Opus
  "code-review": "planning",
  qa: "planning",
  security: "planning",

  // Implementation phases → Sonnet
  backend: "implementation",
  frontend: "implementation",
  "data-engineer": "implementation",
  devops: "implementation",
};

/** Default model per phase. */
const DEFAULT_PHASE_MODELS: Record<RoutingPhase, AgentDefinition["model"]> = {
  planning: "opus",
  implementation: "sonnet",
};

// --- Config schema ---

export interface ModelRoutingConfig {
  /** Agents classified as planning phase. Default: code-review, qa, security */
  planning_phases?: string[];
  /** Agents classified as implementation phase. Default: backend, frontend, data-engineer, devops */
  implementation_phases?: string[];
  /** Model for planning phases. Default: opus */
  planning_model?: string;
  /** Model for implementation phases. Default: sonnet */
  implementation_model?: string;
  /** Per-agent overrides. Keys are agent names, values are model strings. */
  override?: Record<string, string>;
  /** Whether routing is enabled. Default: true when model_routing is present. */
  enabled?: boolean;
}

// --- Router ---

export interface ModelRouter {
  /** Get the routed model for an agent. Returns undefined if no routing applies (inherit parent). */
  getModel(agentName: string): AgentDefinition["model"] | undefined;
  /** Apply routing to all loaded agent definitions in-place. Returns count of agents routed. */
  applyToAgents(agents: Record<string, AgentDefinition>): number;
}

export function createModelRouter(config?: ModelRoutingConfig | null): ModelRouter {
  // No config = no routing. Agents keep their frontmatter models.
  if (!config) {
    return {
      getModel: () => undefined,
      applyToAgents: () => 0,
    };
  }

  // Explicit disable
  if (config.enabled === false) {
    logger.info("Model routing disabled via config");
    return {
      getModel: () => undefined,
      applyToAgents: () => 0,
    };
  }

  // Build phase map from config (or defaults)
  const phaseMap = new Map<string, RoutingPhase>();

  const planningAgents = config.planning_phases ?? Object.entries(DEFAULT_PHASE_MAP)
    .filter(([, phase]) => phase === "planning")
    .map(([name]) => name);

  const implAgents = config.implementation_phases ?? Object.entries(DEFAULT_PHASE_MAP)
    .filter(([, phase]) => phase === "implementation")
    .map(([name]) => name);

  for (const name of planningAgents) phaseMap.set(name, "planning");
  for (const name of implAgents) phaseMap.set(name, "implementation");

  // Phase → model mapping (validate user-supplied models, fall back to defaults)
  const rawPlanningModel = config.planning_model;
  const rawImplModel = config.implementation_model;

  if (rawPlanningModel && !isValidModel(rawPlanningModel)) {
    logger.warn({ model: rawPlanningModel }, "Invalid planning_model — using default 'opus'");
  }
  if (rawImplModel && !isValidModel(rawImplModel)) {
    logger.warn({ model: rawImplModel }, "Invalid implementation_model — using default 'sonnet'");
  }

  const phaseModels: Record<RoutingPhase, AgentDefinition["model"]> = {
    planning: (rawPlanningModel && isValidModel(rawPlanningModel))
      ? (rawPlanningModel as AgentDefinition["model"])
      : DEFAULT_PHASE_MODELS.planning,
    implementation: (rawImplModel && isValidModel(rawImplModel))
      ? (rawImplModel as AgentDefinition["model"])
      : DEFAULT_PHASE_MODELS.implementation,
  };

  // Per-agent overrides — validate each model string
  const rawOverrides = config.override ?? {};
  const overrides: Record<string, string> = {};
  for (const [agent, model] of Object.entries(rawOverrides)) {
    if (!isValidModel(model)) {
      logger.warn({ agent, model }, "Invalid model in override — agent will use phase-based routing");
    } else {
      overrides[agent] = model;
    }
  }

  function getModel(agentName: string): AgentDefinition["model"] | undefined {
    // Per-agent override takes highest priority
    if (agentName in overrides) {
      return overrides[agentName] as AgentDefinition["model"];
    }

    // Phase-based routing
    const phase = phaseMap.get(agentName);
    if (phase) {
      return phaseModels[phase];
    }

    // No routing for this agent — inherit parent model
    return undefined;
  }

  function applyToAgents(agents: Record<string, AgentDefinition>): number {
    let routed = 0;
    for (const [name, def] of Object.entries(agents)) {
      const model = getModel(name);
      if (model) {
        const previous = def.model ?? "inherit";
        def.model = model;
        logger.info({ agent: name, model, phase: phaseMap.get(name) ?? "override", previous }, "Model routed");
        routed++;
      }
    }
    return routed;
  }

  logger.info({
    planningModel: phaseModels.planning,
    implementationModel: phaseModels.implementation,
    planningAgents: [...phaseMap.entries()].filter(([, p]) => p === "planning").map(([n]) => n),
    implementationAgents: [...phaseMap.entries()].filter(([, p]) => p === "implementation").map(([n]) => n),
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  }, "Model routing initialized");

  return { getModel, applyToAgents };
}
