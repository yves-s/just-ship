import { describe, it, expect, beforeEach } from "vitest";
import { createModelRouter, type ModelRoutingConfig } from "./model-router.ts";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

function makeAgents(): Record<string, AgentDefinition> {
  return {
    backend: { description: "Backend dev", prompt: "backend prompt", tools: ["Read"] },
    frontend: { description: "Frontend dev", prompt: "frontend prompt", tools: ["Read"] },
    "code-review": { description: "Code reviewer", prompt: "review prompt", tools: ["Read"] },
    qa: { description: "QA agent", prompt: "qa prompt", tools: ["Read"] },
    security: { description: "Security reviewer", prompt: "security prompt", tools: ["Read"] },
    "data-engineer": { description: "Data engineer", prompt: "data prompt", tools: ["Read"] },
    devops: { description: "DevOps", prompt: "devops prompt", tools: ["Read"] },
  };
}

describe("createModelRouter", () => {
  describe("without config (no routing)", () => {
    it("returns undefined for all agents", () => {
      const router = createModelRouter(null);
      expect(router.getModel("backend")).toBeUndefined();
      expect(router.getModel("code-review")).toBeUndefined();
    });

    it("does not modify any agents", () => {
      const router = createModelRouter(undefined);
      const agents = makeAgents();
      const count = router.applyToAgents(agents);
      expect(count).toBe(0);
      expect(agents.backend.model).toBeUndefined();
    });
  });

  describe("with enabled: false", () => {
    it("does not route any agents", () => {
      const router = createModelRouter({ enabled: false });
      expect(router.getModel("backend")).toBeUndefined();
      const agents = makeAgents();
      expect(router.applyToAgents(agents)).toBe(0);
    });
  });

  describe("with default config (empty object = enable with defaults)", () => {
    let router: ReturnType<typeof createModelRouter>;

    beforeEach(() => {
      router = createModelRouter({});
    });

    it("routes implementation agents to sonnet", () => {
      expect(router.getModel("backend")).toBe("sonnet");
      expect(router.getModel("frontend")).toBe("sonnet");
      expect(router.getModel("data-engineer")).toBe("sonnet");
      expect(router.getModel("devops")).toBe("sonnet");
    });

    it("routes planning agents to opus", () => {
      expect(router.getModel("code-review")).toBe("opus");
      expect(router.getModel("qa")).toBe("opus");
      expect(router.getModel("security")).toBe("opus");
    });

    it("returns undefined for unknown agents", () => {
      expect(router.getModel("unknown-agent")).toBeUndefined();
    });

    it("applies models to agent definitions in-place", () => {
      const agents = makeAgents();
      const count = router.applyToAgents(agents);
      expect(count).toBe(7); // all 7 known agents
      expect(agents.backend.model).toBe("sonnet");
      expect(agents.frontend.model).toBe("sonnet");
      expect(agents["code-review"].model).toBe("opus");
      expect(agents.qa.model).toBe("opus");
      expect(agents.security.model).toBe("opus");
      expect(agents["data-engineer"].model).toBe("sonnet");
      expect(agents.devops.model).toBe("sonnet");
    });
  });

  describe("with custom phase models", () => {
    it("uses configured models instead of defaults", () => {
      const router = createModelRouter({
        planning_model: "haiku",
        implementation_model: "haiku",
      });
      expect(router.getModel("backend")).toBe("haiku");
      expect(router.getModel("code-review")).toBe("haiku");
    });
  });

  describe("with custom phase assignments", () => {
    it("reassigns agents to different phases", () => {
      const router = createModelRouter({
        planning_phases: ["backend", "frontend"],
        implementation_phases: ["code-review"],
      });
      expect(router.getModel("backend")).toBe("opus");
      expect(router.getModel("frontend")).toBe("opus");
      expect(router.getModel("code-review")).toBe("sonnet");
      // Agents not in either list get no routing
      expect(router.getModel("qa")).toBeUndefined();
    });
  });

  describe("with per-agent overrides", () => {
    it("override takes priority over phase routing", () => {
      const router = createModelRouter({
        override: { backend: "haiku" },
      });
      // backend is in default implementation_phases → sonnet, but override → haiku
      expect(router.getModel("backend")).toBe("haiku");
      // frontend still gets phase default
      expect(router.getModel("frontend")).toBe("sonnet");
    });

    it("override works for unknown agents not in any phase", () => {
      const router = createModelRouter({
        override: { "custom-agent": "opus" },
      });
      expect(router.getModel("custom-agent")).toBe("opus");
    });
  });

  describe("applyToAgents with pre-existing model", () => {
    it("overwrites pre-existing model when routing applies", () => {
      const router = createModelRouter({});
      const agents: Record<string, AgentDefinition> = {
        backend: { description: "Backend", prompt: "p", tools: ["Read"], model: "opus" },
      };
      router.applyToAgents(agents);
      expect(agents.backend.model).toBe("sonnet");
    });

    it("does not touch agents without routing", () => {
      const router = createModelRouter({});
      const agents: Record<string, AgentDefinition> = {
        "custom-agent": { description: "Custom", prompt: "p", tools: ["Read"], model: "opus" },
      };
      router.applyToAgents(agents);
      expect(agents["custom-agent"].model).toBe("opus"); // untouched
    });
  });
});
