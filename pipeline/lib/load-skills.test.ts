import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSkills, parseSkillFrontmatter, loadSkillFrontmatters, loadSkillByName } from "./load-skills.js";
import type { ProjectConfig } from "./config.js";

const MOCK_SKILL_WITH_TRIGGERS = (name: string, description: string, triggers: string[]) =>
  `---\nname: ${name}\ndescription: ${description}\ntriggers:\n${triggers.map((t) => `  - ${t}`).join("\n")}\n---\n\n# ${name} Body Content\n\nThis is the full body.`;

// Mock fs to avoid actual file reads in tests
vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    // Mock skill files to return content with frontmatter + triggers
    if (path.includes("shopify-liquid.md")) {
      return MOCK_SKILL_WITH_TRIGGERS("shopify-liquid", "Use for Liquid templates", ["shopify", "liquid", "sections"]);
    }
    if (path.includes("shopify-theme.md")) {
      return MOCK_SKILL_WITH_TRIGGERS("shopify-theme", "Use for theme structure", ["shopify", "theme", "assets"]);
    }
    if (path.includes("shopify-apps.md")) {
      return MOCK_SKILL_WITH_TRIGGERS("shopify-apps", "Use for Shopify apps", ["shopify", "app", "polaris"]);
    }
    if (path.includes("shopify-admin-api.md")) {
      return MOCK_SKILL_WITH_TRIGGERS("shopify-admin-api", "Use for Admin API", ["shopify", "admin-api", "graphql"]);
    }
    if (path.includes("shopify-hydrogen.md")) {
      return MOCK_SKILL_WITH_TRIGGERS("shopify-hydrogen", "Use for Hydrogen storefronts", ["shopify", "hydrogen", "ssr"]);
    }
    if (path.includes("shopify-storefront-api.md")) {
      return MOCK_SKILL_WITH_TRIGGERS("shopify-storefront-api", "Use for Storefront API", ["shopify", "storefront-api", "headless"]);
    }
    return "";
  }),
  existsSync: vi.fn(() => true),
}));

/**
 * Test suite for load-skills.ts variant defaults
 *
 * Verifies that VARIANT_DEFAULTS correctly maps Shopify variants
 * to their expected domain skills without requiring manual configuration.
 */

describe("loadSkills — VARIANT_DEFAULTS", () => {
  const mockProjectDir = "/mock/project";

  describe("Liquid Theme Variant", () => {
    it("loads shopify-liquid and shopify-theme for liquid variant", () => {
      const config: ProjectConfig = {
        name: "test-theme",
        stack: {
          language: "Liquid/JSON",
          framework: "",
          backend: "",
          package_manager: "npm",
          platform: "shopify",
          variant: "liquid",
        },
        build: {
          dev: "shopify theme dev",
          web: "shopify theme check",
          install: "",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.skillNames).toContain("shopify-liquid");
      expect(result.skillNames).toContain("shopify-theme");
      expect(result.skillNames.length).toBe(2);
    });

    it("uses VARIANT_DEFAULTS when skills.domain is empty for liquid", () => {
      const config: ProjectConfig = {
        name: "test-theme",
        stack: {
          language: "Liquid/JSON",
          framework: "",
          backend: "",
          package_manager: "npm",
          platform: "shopify",
          variant: "liquid",
        },
        build: {
          dev: "shopify theme dev",
          web: "shopify theme check",
          install: "",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      const byRoleContent = result.byRole.get("frontend");
      expect(byRoleContent).toBeDefined();
      expect(byRoleContent).toContain("shopify-liquid");
      expect(byRoleContent).toContain("shopify-theme");
    });
  });

  describe("Remix App Variant", () => {
    it("loads shopify-apps and shopify-admin-api for remix variant", () => {
      const config: ProjectConfig = {
        name: "test-app",
        stack: {
          language: "TypeScript",
          framework: "Remix",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "remix",
        },
        build: {
          dev: "shopify app dev",
          web: "npm run build",
          install: "npm install",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.skillNames).toContain("shopify-apps");
      expect(result.skillNames).toContain("shopify-admin-api");
      expect(result.skillNames.length).toBe(2);
    });

    it("uses VARIANT_DEFAULTS when skills.domain is empty for remix", () => {
      const config: ProjectConfig = {
        name: "test-app",
        stack: {
          language: "TypeScript",
          framework: "Remix",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "remix",
        },
        build: {
          dev: "shopify app dev",
          web: "npm run build",
          install: "npm install",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      const byRoleContent = result.byRole.get("backend");
      expect(byRoleContent).toBeDefined();
      expect(byRoleContent).toContain("shopify-apps");
      expect(byRoleContent).toContain("shopify-admin-api");
    });
  });

  describe("Hydrogen Storefront Variant", () => {
    it("loads shopify-hydrogen and shopify-storefront-api for hydrogen variant", () => {
      const config: ProjectConfig = {
        name: "test-hydrogen",
        stack: {
          language: "TypeScript",
          framework: "Hydrogen",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "hydrogen",
        },
        build: {
          dev: "npm run dev",
          web: "npm run build",
          install: "npm install",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.skillNames).toContain("shopify-hydrogen");
      expect(result.skillNames).toContain("shopify-storefront-api");
      expect(result.skillNames.length).toBe(2);
    });

    it("uses VARIANT_DEFAULTS when skills.domain is empty for hydrogen", () => {
      const config: ProjectConfig = {
        name: "test-hydrogen",
        stack: {
          language: "TypeScript",
          framework: "Hydrogen",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "hydrogen",
        },
        build: {
          dev: "npm run dev",
          web: "npm run build",
          install: "npm install",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      const byRoleContent = result.byRole.get("frontend");
      expect(byRoleContent).toBeDefined();
      expect(byRoleContent).toContain("shopify-hydrogen");
      expect(byRoleContent).toContain("shopify-storefront-api");
    });
  });

  describe("Custom Skills Override", () => {
    it("uses explicit skills.domain when provided (overrides VARIANT_DEFAULTS)", () => {
      const config: ProjectConfig = {
        name: "test-app",
        stack: {
          language: "TypeScript",
          framework: "Remix",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "remix",
        },
        build: {
          dev: "shopify app dev",
          web: "npm run build",
          install: "npm install",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: ["shopify-apps", "shopify-admin-api"],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      // When skills.domain is explicitly provided, it should be used as-is
      // (even if variant has VARIANT_DEFAULTS)
      expect(result.skillNames).toContain("shopify-apps");
      expect(result.skillNames).toContain("shopify-admin-api");
      expect(result.skillNames.length).toBe(2);
    });
  });

  describe("Non-Shopify Platform", () => {
    it("returns empty skills for non-shopify platform without explicit domain", () => {
      const config: ProjectConfig = {
        name: "test-project",
        stack: {
          language: "TypeScript",
          framework: "Next.js",
          backend: "Node.js",
          package_manager: "npm",
          platform: "vercel",
          variant: "",
        },
        build: {
          dev: "npm run dev",
          web: "npm run build",
          install: "npm install",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "vercel",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.skillNames.length).toBe(0);
    });
  });

  describe("Unknown Variant", () => {
    it("returns empty skills for unknown variant", () => {
      const config: ProjectConfig = {
        name: "test-project",
        stack: {
          language: "TypeScript",
          framework: "",
          backend: "",
          package_manager: "npm",
          platform: "shopify",
          variant: "unknown-variant",
        },
        build: {
          dev: "",
          web: "",
          install: "",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.skillNames.length).toBe(0);
    });
  });

  describe("Progressive Disclosure — frontmatterIndex and token estimates", () => {
    it("includes frontmatterIndex with name and description for each loaded skill", () => {
      const config: ProjectConfig = {
        name: "test-app",
        stack: {
          language: "TypeScript",
          framework: "Remix",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "remix",
        },
        build: { dev: "", web: "", install: "", verify: "", test: "" },
        hosting: { provider: "", project_id: "", team_id: "", coolify_url: "", coolify_app_uuid: "" },
        shopify: { store: "" },
        skills: { domain: [], custom: [] },
        paths: { src: "", tests: "" },
        supabase: { project_id: "" },
        pipeline: { workspace_id: "", project_id: "" },
        conventions: { branch_prefix: "feature/", commit_format: "conventional", language: "en" },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.frontmatterIndex).toBeDefined();
      expect(typeof result.frontmatterIndex).toBe("string");
      expect(result.frontmatterIndex).toContain("shopify-apps");
      expect(result.frontmatterIndex).toContain("shopify-admin-api");
      // Each line should be "- name: description" format
      const lines = result.frontmatterIndex.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((line) => {
        expect(line).toMatch(/^- \S+/);
      });
    });

    it("includes non-zero token estimates", () => {
      const config: ProjectConfig = {
        name: "test-app",
        stack: {
          language: "TypeScript",
          framework: "Remix",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "remix",
        },
        build: { dev: "", web: "", install: "", verify: "", test: "" },
        hosting: { provider: "", project_id: "", team_id: "", coolify_url: "", coolify_app_uuid: "" },
        shopify: { store: "" },
        skills: { domain: [], custom: [] },
        paths: { src: "", tests: "" },
        supabase: { project_id: "" },
        pipeline: { workspace_id: "", project_id: "" },
        conventions: { branch_prefix: "feature/", commit_format: "conventional", language: "en" },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.totalFrontmatterTokens).toBeGreaterThan(0);
      expect(result.totalFullTokens).toBeGreaterThan(0);
      // Full tokens should be >= frontmatter tokens (full content is always larger)
      expect(result.totalFullTokens).toBeGreaterThanOrEqual(result.totalFrontmatterTokens);
    });

    it("returns zero token counts and empty frontmatterIndex when no skills are loaded", () => {
      const config: ProjectConfig = {
        name: "test-project",
        stack: {
          language: "TypeScript",
          framework: "Next.js",
          backend: "Node.js",
          package_manager: "npm",
          platform: "vercel",
          variant: "",
        },
        build: { dev: "", web: "", install: "", verify: "", test: "" },
        hosting: { provider: "vercel", project_id: "", team_id: "", coolify_url: "", coolify_app_uuid: "" },
        shopify: { store: "" },
        skills: { domain: [], custom: [] },
        paths: { src: "", tests: "" },
        supabase: { project_id: "" },
        pipeline: { workspace_id: "", project_id: "" },
        conventions: { branch_prefix: "feature/", commit_format: "conventional", language: "en" },
      };

      const result = loadSkills(mockProjectDir, config);

      expect(result.totalFrontmatterTokens).toBe(0);
      expect(result.totalFullTokens).toBe(0);
      expect(result.frontmatterIndex).toBe("");
    });
  });

  describe("Role-Based Skill Assignment", () => {
    it("assigns Remix skills to appropriate roles", () => {
      const config: ProjectConfig = {
        name: "test-app",
        stack: {
          language: "TypeScript",
          framework: "Remix",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "remix",
        },
        build: {
          dev: "shopify app dev",
          web: "npm run build",
          install: "npm install",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      // Backend role should get shopify-apps and shopify-admin-api
      const backendContent = result.byRole.get("backend");
      expect(backendContent).toBeDefined();
      expect(backendContent).toContain("shopify-apps");
      expect(backendContent).toContain("shopify-admin-api");

      // Frontend should also get these skills
      const frontendContent = result.byRole.get("frontend");
      expect(frontendContent).toBeDefined();
      expect(frontendContent).toContain("shopify-apps");
    });

    it("assigns Liquid skills to frontend and qa roles", () => {
      const config: ProjectConfig = {
        name: "test-theme",
        stack: {
          language: "Liquid/JSON",
          framework: "",
          backend: "",
          package_manager: "npm",
          platform: "shopify",
          variant: "liquid",
        },
        build: {
          dev: "shopify theme dev",
          web: "shopify theme check",
          install: "",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      const frontendContent = result.byRole.get("frontend");
      expect(frontendContent).toBeDefined();
      expect(frontendContent).toContain("shopify-liquid");
      expect(frontendContent).toContain("shopify-theme");

      const qaContent = result.byRole.get("qa");
      expect(qaContent).toBeDefined();
      expect(qaContent).toContain("shopify-theme");
    });

    it("assigns Hydrogen skills to frontend and backend roles", () => {
      const config: ProjectConfig = {
        name: "test-hydrogen",
        stack: {
          language: "TypeScript",
          framework: "Hydrogen",
          backend: "Node.js",
          package_manager: "npm",
          platform: "shopify",
          variant: "hydrogen",
        },
        build: {
          dev: "npm run dev",
          web: "npm run build",
          install: "npm install",
          verify: "",
          test: "",
        },
        hosting: {
          provider: "",
          project_id: "",
          team_id: "",
          coolify_url: "",
          coolify_app_uuid: "",
        },
        shopify: {
          store: "test.myshopify.com",
        },
        skills: {
          domain: [],
          custom: [],
        },
        paths: {
          src: "src/",
          tests: "tests/",
        },
        supabase: {
          project_id: "",
        },
        pipeline: {
          workspace_id: "",
          project_id: "",
        },
        conventions: {
          branch_prefix: "feature/",
          commit_format: "conventional",
          language: "en",
        },
      };

      const result = loadSkills(mockProjectDir, config);

      const frontendContent = result.byRole.get("frontend");
      expect(frontendContent).toBeDefined();
      expect(frontendContent).toContain("shopify-hydrogen");
      expect(frontendContent).toContain("shopify-storefront-api");

      const backendContent = result.byRole.get("backend");
      expect(backendContent).toBeDefined();
      expect(backendContent).toContain("shopify-hydrogen");
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
  it("returns frontmatter array without loading full body for resolved skills", () => {
    const config: ProjectConfig = {
      name: "test-app",
      stack: {
        language: "TypeScript",
        framework: "Remix",
        backend: "Node.js",
        package_manager: "npm",
        platform: "shopify",
        variant: "remix",
      },
      build: { dev: "", web: "", install: "", verify: "", test: "" },
      hosting: { provider: "", project_id: "", team_id: "", coolify_url: "", coolify_app_uuid: "" },
      shopify: { store: "" },
      skills: { domain: [], custom: [] },
      paths: { src: "", tests: "" },
      supabase: { project_id: "" },
      pipeline: { workspace_id: "", project_id: "" },
      conventions: { branch_prefix: "feature/", commit_format: "conventional", language: "en" },
    };

    const frontmatters = loadSkillFrontmatters("/mock/project", config);

    expect(Array.isArray(frontmatters)).toBe(true);
    expect(frontmatters.length).toBe(2); // shopify-apps + shopify-admin-api for remix
    const names = frontmatters.map((f) => f.name);
    expect(names).toContain("shopify-apps");
    expect(names).toContain("shopify-admin-api");
    // Each frontmatter should have filePath set
    frontmatters.forEach((fm) => {
      expect(typeof fm.filePath).toBe("string");
      expect(fm.filePath.length).toBeGreaterThan(0);
      expect(fm.triggers.length).toBeGreaterThan(0);
    });
  });
});

describe("loadSkillByName", () => {
  it("loads full content for a specific skill by name", () => {
    const content = loadSkillByName("/mock/project", "shopify-liquid");

    expect(content).not.toBeNull();
    expect(content).toContain("shopify-liquid");
  });

  it("returns null for a skill name with path traversal characters", () => {
    const content = loadSkillByName("/mock/project", "../etc/passwd");

    expect(content).toBeNull();
  });

  it("returns null when the skill file does not exist", async () => {
    // Override existsSync to return false for this test
    const fs = await import("node:fs");
    const { existsSync } = vi.mocked(fs);
    existsSync.mockReturnValueOnce(false).mockReturnValueOnce(false);

    const content = loadSkillByName("/mock/project", "nonexistent-skill");

    expect(content).toBeNull();
  });
});
