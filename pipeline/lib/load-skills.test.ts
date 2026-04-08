import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSkills } from "./load-skills.js";
import type { ProjectConfig } from "./config.js";

// Mock fs to avoid actual file reads in tests
vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    // Mock skill files to return dummy content
    if (path.includes("shopify-liquid.md")) {
      return "# Shopify Liquid Skill";
    }
    if (path.includes("shopify-theme.md")) {
      return "# Shopify Theme Skill";
    }
    if (path.includes("shopify-apps.md")) {
      return "# Shopify Apps Skill";
    }
    if (path.includes("shopify-admin-api.md")) {
      return "# Shopify Admin API Skill";
    }
    if (path.includes("shopify-hydrogen.md")) {
      return "# Shopify Hydrogen Skill";
    }
    if (path.includes("shopify-storefront-api.md")) {
      return "# Shopify Storefront API Skill";
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
