import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectConfig } from "./config.js";
import { logger } from "./logger.ts";

// SECURITY: Validate skill name to prevent path traversal
function isValidSkillName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/** Agent roles that can receive skills */
export type AgentRole =
  | "orchestrator"
  | "frontend"
  | "backend"
  | "data-engineer"
  | "qa"
  | "devops"
  | "security"
  | "triage";

/** Which skills each agent role receives */
const SKILL_AGENT_MAP: Record<string, AgentRole[]> = {
  "shopify-liquid":         ["frontend", "orchestrator"],
  "shopify-theme":          ["frontend", "qa", "devops", "orchestrator"],
  "shopify-metafields":     ["data-engineer", "backend", "orchestrator"],
  "shopify-storefront-api": ["backend", "frontend", "orchestrator"],
  "shopify-hydrogen":       ["frontend", "backend", "orchestrator"],
  "shopify-admin-api":      ["backend", "data-engineer", "orchestrator"],
  "shopify-checkout":       ["frontend", "backend", "orchestrator"],
  "shopify-apps":           ["backend", "frontend", "orchestrator"],
  "shopify-app-scaffold":   ["orchestrator", "frontend"],
};

/** Default skills per platform+variant when skills.domain is not set */
const VARIANT_DEFAULTS: Record<string, string[]> = {
  liquid:   ["shopify-liquid", "shopify-theme"],
  hydrogen: ["shopify-hydrogen", "shopify-storefront-api"],
};

export interface LoadedSkills {
  /** All skill names that were resolved */
  skillNames: string[];
  /** Skill content filtered per agent role */
  byRole: Map<AgentRole, string>;
}

/**
 * Load domain and custom skills based on project config.
 * Returns skill content mapped per agent role.
 */
export function loadSkills(projectDir: string, config: ProjectConfig): LoadedSkills {
  const skillNames = resolveSkillNames(config);
  const skillContents = new Map<string, string>();

  const frameworkSkillsDir = resolve(projectDir, "skills");
  const installedSkillsDir = resolve(projectDir, ".claude", "skills");

  for (const name of skillNames) {
    // SECURITY: reject names with path traversal characters
    if (!isValidSkillName(name)) {
      logger.warn(`Skill name '${name}' contains invalid characters — skipping.`);
      continue;
    }
    const content = loadSkillFile(name, frameworkSkillsDir, installedSkillsDir);
    if (content) {
      skillContents.set(name, content);
    } else {
      logger.warn(`Skill '${name}' not found — skipping.`);
    }
  }

  // Load custom skills
  const customSkills = config.skills?.custom ?? [];
  for (const name of customSkills) {
    // SECURITY: reject names with path traversal characters
    if (!isValidSkillName(name)) {
      logger.warn(`Custom skill name '${name}' contains invalid characters — skipping.`);
      continue;
    }
    const customPath = resolve(projectDir, ".claude", "skills", `${name}.md`);
    if (existsSync(customPath)) {
      skillContents.set(name, readFileSync(customPath, "utf-8"));
    } else {
      logger.warn(`Custom skill '${name}' not found in .claude/skills/ — skipping.`);
    }
  }

  // Build per-role skill content
  const byRole = new Map<AgentRole, string>();
  const roles: AgentRole[] = [
    "orchestrator", "frontend", "backend", "data-engineer",
    "qa", "devops", "security", "triage",
  ];

  for (const role of roles) {
    const parts: string[] = [];
    for (const [name, content] of skillContents) {
      const allowedRoles = SKILL_AGENT_MAP[name];
      // Domain skills: only if role is in map. Custom skills (no map entry): all agents get them.
      if (!allowedRoles || allowedRoles.includes(role)) {
        parts.push(`\n## Skill: ${name}\n\n${content}`);
      }
    }
    if (parts.length > 0) {
      byRole.set(role, `\n# Domain Skills\n${parts.join("\n")}`);
    }
  }

  return { skillNames: [...skillContents.keys()], byRole };
}

function resolveSkillNames(config: ProjectConfig): string[] {
  if (config.skills?.domain && config.skills.domain.length > 0) {
    return config.skills.domain;
  }
  if (config.stack.platform === "shopify" && config.stack.variant) {
    return VARIANT_DEFAULTS[config.stack.variant] ?? [];
  }
  return [];
}

function loadSkillFile(
  name: string,
  frameworkDir: string,
  installedDir: string,
): string | null {
  const frameworkPath = resolve(frameworkDir, `${name}.md`);
  if (existsSync(frameworkPath)) {
    return readFileSync(frameworkPath, "utf-8");
  }
  const installedPath = resolve(installedDir, `${name}.md`);
  if (existsSync(installedPath)) {
    return readFileSync(installedPath, "utf-8");
  }
  return null;
}
