import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSkills, parseSkillFrontmatter, loadSkillFrontmatters, loadSkillByName } from "./load-skills.js";
import type { ProjectConfig } from "./config.js";

const MOCK_SKILL_WITH_TRIGGERS = (name: string, description: string, triggers: string[]) =>
  `---\nname: ${name}\ndescription: ${description}\ntriggers:\n${triggers.map((t) => `  - ${t}`).join("\n")}\n---\n\n# ${name} Body Content\n\nThis is the full body.`;

// Mock fs to avoid actual file reads in tests
vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes("custom-skill.md")) {
      return MOCK_SKILL_WITH_TRIGGERS("custom-skill", "A custom project skill", ["custom", "project"]);
    }
    if (path.includes("another-skill.md")) {
      return MOCK_SKILL_WITH_TRIGGERS("another-skill", "Another skill for testing", ["another", "test"]);
    }
    return "";
  }),
  existsSync: vi.fn((path: string) => path.includes("custom-skill.md") || path.includes("another-skill.md")),
}));

/**
 * Test suite for load-skills.ts
 *
 * Shopify domain knowledge is now provided by the @shopify/dev-mcp MCP server.
 * VARIANT_DEFAULTS were removed — Shopify variants no longer map to local skill files.
 */

const makeShopifyConfig = (variant: string): ProjectConfig => ({
  name: "test-project",
  description: "",
  conventions: { branch_prefix: "feature/" },
  pipeline: {
    projectId: "",
    workspaceId: "",
    apiUrl: "",
    apiKey: "",
  },
  maxWorkers: 1,
  qa: {
    maxFixIterations: 3,
    playwrightTimeoutMs: 60000,
    previewProvider: "none",
    vercelProjectId: "",
    vercelTeamId: "",
    vercelPreviewPollIntervalMs: 10000,
    vercelPreviewMaxWaitMs: 300000,
    coolifyUrl: "",
    coolifyAppUuid: "",
    coolifyPollIntervalMs: 10000,
    coolifyMaxWaitMs: 300000,
  },
  stack: {
    packageManager: "npm",
    platform: "shopify",
    variant,
  },
  skills: { domain: [], custom: [] },
});

describe("loadSkills — Shopify MCP migration", () => {
  const mockProjectDir = "/mock/project";

  describe("Shopify variants return no local skills (MCP provides domain knowledge)", () => {
    it("returns empty skill names for liquid variant", () => {
      const result = loadSkills(mockProjectDir, makeShopifyConfig("liquid"));
      expect(result.skillNames.length).toBe(0);
    });

    it("returns empty skill names for remix variant", () => {
      const result = loadSkills(mockProjectDir, makeShopifyConfig("remix"));
      expect(result.skillNames.length).toBe(0);
    });

    it("returns empty skill names for hydrogen variant", () => {
      const result = loadSkills(mockProjectDir, makeShopifyConfig("hydrogen"));
      expect(result.skillNames.length).toBe(0);
    });

    it("returns empty byRole map for Shopify variants", () => {
      const result = loadSkills(mockProjectDir, makeShopifyConfig("liquid"));
      expect(result.byRole.size).toBe(0);
    });
  });

  describe("Non-Shopify platform", () => {
    it("returns empty skills for non-shopify platform without explicit domain", () => {
      const config: ProjectConfig = {
        ...makeShopifyConfig(""),
        stack: {
          packageManager: "npm",
          platform: "vercel",
          variant: "",
        },
      };

      const result = loadSkills(mockProjectDir, config);
      expect(result.skillNames.length).toBe(0);
    });
  });

  describe("Unknown variant", () => {
    it("returns empty skills for unknown Shopify variant", () => {
      const result = loadSkills(mockProjectDir, makeShopifyConfig("unknown-variant"));
      expect(result.skillNames.length).toBe(0);
    });
  });

  describe("Progressive Disclosure — frontmatterIndex and token estimates", () => {
    it("includes frontmatterIndex with name and description for loaded skills", () => {
      const config: ProjectConfig = {
        ...makeShopifyConfig(""),
        stack: {
          packageManager: "npm",
          platform: "",
          variant: "",
        },
        skills: { domain: ["custom-skill", "another-skill"], custom: [] },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.frontmatterIndex).toBeDefined();
      expect(typeof result.frontmatterIndex).toBe("string");
      expect(result.frontmatterIndex).toContain("custom-skill");
      expect(result.frontmatterIndex).toContain("another-skill");
      const lines = result.frontmatterIndex.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((line) => {
        expect(line).toMatch(/^- \S+/);
      });
    });

    it("includes non-zero token estimates for explicit skills", () => {
      const config: ProjectConfig = {
        ...makeShopifyConfig(""),
        stack: {
          packageManager: "npm",
          platform: "",
          variant: "",
        },
        skills: { domain: ["custom-skill"], custom: [] },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.totalFrontmatterTokens).toBeGreaterThan(0);
      expect(result.totalFullTokens).toBeGreaterThan(0);
      expect(result.totalFullTokens).toBeGreaterThanOrEqual(result.totalFrontmatterTokens);
    });

    it("returns zero token counts and empty frontmatterIndex when no skills are loaded", () => {
      const config: ProjectConfig = {
        ...makeShopifyConfig(""),
        stack: {
          packageManager: "npm",
          platform: "vercel",
          variant: "",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.totalFrontmatterTokens).toBe(0);
      expect(result.totalFullTokens).toBe(0);
      expect(result.frontmatterIndex).toBe("");
    });
  });

  describe("Explicit skills.domain override", () => {
    it("uses explicit skills.domain when provided for any platform", () => {
      const config: ProjectConfig = {
        ...makeShopifyConfig("liquid"),
        skills: { domain: ["custom-skill"], custom: [] },
      };

      const result = loadSkills(mockProjectDir, config);
      expect(result.skillNames).toContain("custom-skill");
      expect(result.skillNames.length).toBe(1);
    });

    it("custom skills in skills.custom are loaded regardless of variant", () => {
      const config: ProjectConfig = {
        ...makeShopifyConfig("liquid"),
        skills: { domain: [], custom: ["custom-skill"] },
      };

      const result = loadSkills(mockProjectDir, config);
      expect(result.byRole.size).toBeGreaterThan(0);
    });
  });
});

describe("parseSkillFrontmatter", () => {
  it("extracts name, description, and triggers from multi-line format", () => {
    const content = `---
name: backend
description: Use when implementing API endpoints or webhook handlers.
triggers:
  - api
  - endpoint
  - webhook
---

# Backend Body`;

    const result = parseSkillFrontmatter(content);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("backend");
    expect(result!.description).toBe("Use when implementing API endpoints or webhook handlers.");
    expect(result!.triggers).toEqual(["api", "endpoint", "webhook"]);
  });

  it("extracts triggers from inline array format", () => {
    const content = `---
name: frontend-design
description: Use when building UI components.
triggers: [ui, component, layout]
---

# Frontend Body`;

    const result = parseSkillFrontmatter(content);

    expect(result).not.toBeNull();
    expect(result!.triggers).toEqual(["ui", "component", "layout"]);
  });

  it("extracts description from YAML block scalar (> format)", () => {
    const content = `---
name: product-cto
description: >
  Your technical co-founder with obsessive product taste.
  Use whenever building features or reviewing architecture.
triggers:
  - architecture
  - product
---

# CTO Body`;

    const result = parseSkillFrontmatter(content);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("product-cto");
    expect(result!.description).toContain("technical co-founder");
    expect(result!.triggers).toContain("architecture");
  });

  it("returns empty triggers array when triggers field is missing", () => {
    const content = `---
name: simple-skill
description: A simple skill without triggers.
---

# Simple Body`;

    const result = parseSkillFrontmatter(content);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("simple-skill");
    expect(result!.triggers).toEqual([]);
  });

  it("returns null when no frontmatter delimiters are present", () => {
    const content = `# Just a heading\n\nNo frontmatter here.`;

    const result = parseSkillFrontmatter(content);

    expect(result).toBeNull();
  });

  it("returns null when name field is missing", () => {
    const content = `---
description: A skill without a name.
triggers:
  - something
---

# Body`;

    const result = parseSkillFrontmatter(content);

    expect(result).toBeNull();
  });
});

describe("loadSkillFrontmatters", () => {
  it("returns frontmatter array for explicitly configured skills", () => {
    const config: ProjectConfig = {
      ...makeShopifyConfig(""),
      stack: {
        packageManager: "npm",
        platform: "",
        variant: "",
      },
      skills: { domain: ["custom-skill", "another-skill"], custom: [] },
    };

    const frontmatters = loadSkillFrontmatters("/mock/project", config);

    expect(Array.isArray(frontmatters)).toBe(true);
    expect(frontmatters.length).toBe(2);
    const names = frontmatters.map((f) => f.name);
    expect(names).toContain("custom-skill");
    expect(names).toContain("another-skill");
    frontmatters.forEach((fm) => {
      expect(typeof fm.filePath).toBe("string");
      expect(fm.filePath.length).toBeGreaterThan(0);
      expect(fm.triggers.length).toBeGreaterThan(0);
    });
  });
});

describe("loadSkillByName", () => {
  it("loads full content for a specific skill by name", () => {
    const content = loadSkillByName("/mock/project", "custom-skill");

    expect(content).not.toBeNull();
    expect(content).toContain("custom-skill");
  });

  it("returns null for a skill name with path traversal characters", () => {
    const content = loadSkillByName("/mock/project", "../etc/passwd");

    expect(content).toBeNull();
  });

  it("returns null when the skill file does not exist", async () => {
    const fs = await import("node:fs");
    const { existsSync } = vi.mocked(fs);
    existsSync.mockReturnValueOnce(false).mockReturnValueOnce(false);

    const content = loadSkillByName("/mock/project", "nonexistent-skill");

    expect(content).toBeNull();
  });
});
