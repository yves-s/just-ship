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
  // Shopify domain skills are provided by the @shopify/dev-mcp MCP server,
  // not by local skill files. No entries needed here for Shopify skills.
};

/** Parsed frontmatter from a skill file */
export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers: string[];
  filePath: string;
  category?: string;
  auditScope?: string;
}

/**
 * Parses YAML frontmatter from skill file content.
 * Handles both inline array `[a, b, c]` and multi-line `- a\n- b` formats.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const frontmatter = match[1];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : "";

  // description may be a multi-line block scalar ("> ") or inline string (with or without quotes)
  let description = "";
  const descBlockIndicator = frontmatter.match(/^description:\s*>\s*$/m);

  if (descBlockIndicator) {
    // Collect indented continuation lines after "description: >"
    const lines = frontmatter.split(/\r?\n/);
    let inBlock = false;
    const blockLines: string[] = [];
    for (const line of lines) {
      if (/^description:\s*>\s*$/.test(line)) {
        inBlock = true;
        continue;
      }
      if (inBlock) {
        if (/^\s+/.test(line)) {
          blockLines.push(line.trim());
        } else {
          break;
        }
      }
    }
    description = blockLines.filter(Boolean).join(" ");
  } else {
    const descInlineMatch = frontmatter.match(/^description:\s*["']?([^\n"']+)["']?\s*$/m);
    if (descInlineMatch) {
      description = descInlineMatch[1].trim();
    }
  }

  // triggers: parse inline `[a, b]` or multi-line `- a` format
  const triggers: string[] = [];
  const triggersLineMatch = frontmatter.match(/^triggers:\s*(.*)$/m);
  if (triggersLineMatch) {
    const inlineValue = triggersLineMatch[1].trim();
    if (inlineValue.startsWith("[")) {
      const inner = inlineValue.replace(/^\[|\]$/g, "");
      triggers.push(...inner.split(",").map((s) => s.trim()).filter(Boolean));
    } else {
      const lines = frontmatter.split(/\r?\n/);
      let inTriggers = false;
      for (const line of lines) {
        if (/^triggers:\s*$/.test(line)) {
          inTriggers = true;
          continue;
        }
        if (inTriggers) {
          const itemMatch = line.match(/^\s+-\s+(.+)$/);
          if (itemMatch) {
            triggers.push(itemMatch[1].trim());
          } else if (/^\S/.test(line)) {
            break;
          }
        }
      }
    }
  }

  // category (e.g. "audit")
  const categoryMatch = frontmatter.match(/^category:\s*(.+)$/m);
  const category = categoryMatch ? categoryMatch[1].trim() : undefined;

  // audit_scope — only meaningful when category is "audit"
  const auditScopeMatch = frontmatter.match(/^audit_scope:\s*(.+)$/m);
  const auditScope = category === "audit"
    ? (auditScopeMatch ? auditScopeMatch[1].trim() : "both")
    : undefined;

  if (!name) return null;

  return { name, description, triggers, filePath: "", category, auditScope };
}

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
  // Shopify variant defaults were removed — Shopify domain knowledge is now
  // provided by the @shopify/dev-mcp MCP server, not local skill files.
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
