import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectConfig } from "./config.js";
import { logger } from "./logger.ts";
import {
  checkAppliesTo,
  detectRepoFlavour,
  resolveMode,
  type RuntimeContext,
} from "./applies-to.ts";

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

/**
 * Which agent roles each skill is delivered to.
 *
 * Each entry maps a skill name to the list of agent roles that should
 * receive its full content as part of their system prompt.
 *
 * Skills not listed here are treated as "custom" and delivered to ALL agents
 * (see `loadSkills` below — `if (!allowedRoles || allowedRoles.includes(role))`).
 *
 * Shopify domain skills are NOT listed here — they are provided by the
 * @shopify/dev-mcp MCP server.
 *
 * Adding a skill here is the load-bearing step that makes the corresponding
 * agent actually receive its domain expertise. Without an entry (or without
 * the skill being listed in `project.json` → `skills.domain`), the agent
 * falls back to its agent definition (`agents/<role>.md`) only — no
 * Anti-Pattern catalog, no Output Signature, no `⚡ Role joined` announcement.
 */
const SKILL_AGENT_MAP: Record<string, AgentRole[]> = {
  // Domain skills: each role gets its own primary skill
  "backend": ["backend"],
  "data-engineer": ["data-engineer"],
  "frontend-design": ["frontend"],
  "creative-design": ["frontend"],

  // QA + Security share testing/verification skills
  "webapp-testing": ["qa", "security"],
  "test-driven-development": ["qa", "security"],
  "verification-before-completion": ["qa", "security", "backend", "frontend", "data-engineer"],

  // Triage gets the ticket-writer skill so it can structure ambiguous input
  "ticket-writer": ["triage"],

  // Orchestrator gets workflow-shaping skills so it can plan and dispatch
  "dispatching-parallel-agents": ["orchestrator"],
  "subagent-driven-development": ["orchestrator"],
  "writing-plans": ["orchestrator"],
  "systematic-debugging": ["orchestrator", "backend", "frontend", "qa"],
  "find-skills": ["orchestrator"],
};

/** Parsed frontmatter from a skill file */
export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers: string[];
  filePath: string;
}

export interface LoadedSkills {
  /** All skill names that were resolved */
  skillNames: string[];
  /** Skill content filtered per agent role */
  byRole: Map<AgentRole, string>;
  /** Compact text index: "- {name}: {description}" per skill */
  frontmatterIndex: string;
  /** Approximate token count for frontmatter-only (chars / 4) */
  totalFrontmatterTokens: number;
  /** Approximate token count for full content (chars / 4) */
  totalFullTokens: number;
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
  const descInlineMatch = frontmatter.match(/^description:\s*["']?([^\n"']+)["']?\s*$/m);
  const descBlockMatch = frontmatter.match(/^description:\s*>\s*\r?\n([\s\S]*?)(?=\r?\n\w|\r?\n---$|$)/m);

  if (descBlockMatch) {
    // Fold the block scalar: join lines, collapse newlines into spaces
    description = descBlockMatch[1]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
  } else if (descInlineMatch) {
    description = descInlineMatch[1].trim();
  }

  // triggers: parse inline `[a, b]` or multi-line `- a` format
  const triggers: string[] = [];
  const triggersLineMatch = frontmatter.match(/^triggers:\s*(.*)$/m);
  if (triggersLineMatch) {
    const inlineValue = triggersLineMatch[1].trim();
    if (inlineValue.startsWith("[")) {
      // Inline array: [a, b, c]
      const inner = inlineValue.replace(/^\[|\]$/g, "");
      triggers.push(...inner.split(",").map((s) => s.trim()).filter(Boolean));
    } else {
      // Multi-line: collect all `- item` lines that follow the `triggers:` line
      // Find the position of `triggers:` in the frontmatter, then collect subsequent `- ` lines
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
            // New top-level key — end of triggers block
            break;
          }
        }
      }
    }
  }

  if (!name) return null;

  return { name, description, triggers, filePath: "" };
}

/**
 * Loads only frontmatter for all resolved skills. Returns SkillFrontmatter[].
 * Does not load skill body content.
 */
export function loadSkillFrontmatters(
  projectDir: string,
  config: ProjectConfig,
): SkillFrontmatter[] {
  const skillNames = resolveSkillNames(config);
  const frameworkSkillsDir = resolve(projectDir, "skills");
  const installedSkillsDir = resolve(projectDir, ".claude", "skills");

  const frontmatters: SkillFrontmatter[] = [];

  const allNames = [...skillNames, ...(config.skills?.custom ?? [])];

  for (const name of allNames) {
    if (!isValidSkillName(name)) continue;

    const frameworkPath = resolve(frameworkSkillsDir, `${name}.md`);
    const installedPath = resolve(installedSkillsDir, `${name}.md`);
    const filePath = existsSync(frameworkPath)
      ? frameworkPath
      : existsSync(installedPath)
        ? installedPath
        : null;

    if (!filePath) continue;

    const content = readFileSync(filePath, "utf-8");
    const fm = parseSkillFrontmatter(content);
    if (fm) {
      frontmatters.push({ ...fm, filePath });
    }
  }

  return frontmatters;
}

/**
 * Reads full file content for a skill by its absolute path.
 * Returns null if the file does not exist or cannot be read.
 */
export function loadSkillFull(filePath: string): string | null {
  if (!existsSync(filePath)) {
    logger.warn(`Skill file '${filePath}' does not exist — skipping.`);
    return null;
  }
  try {
    return readFileSync(filePath, "utf-8");
  } catch (err) {
    logger.warn({ err, filePath }, `Failed to read skill file — skipping.`);
    return null;
  }
}

/**
 * Loads full content for a single skill by name.
 * Searches framework dir first, then installed dir.
 */
export function loadSkillByName(projectDir: string, name: string): string | null {
  if (!isValidSkillName(name)) {
    logger.warn(`Skill name '${name}' contains invalid characters — skipping.`);
    return null;
  }
  const frameworkSkillsDir = resolve(projectDir, "skills");
  const installedSkillsDir = resolve(projectDir, ".claude", "skills");
  return loadSkillFile(name, frameworkSkillsDir, installedSkillsDir);
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

  // Build frontmatterIndex: compact listing of name + description for all loaded skills
  const frontmatterParts: string[] = [];
  let frontmatterCharCount = 0;
  let fullCharCount = 0;

  for (const [name, content] of skillContents) {
    const fm = parseSkillFrontmatter(content);
    const descLine = fm?.description
      ? `- ${name}: ${fm.description}`
      : `- ${name}`;
    frontmatterParts.push(descLine);
    frontmatterCharCount += descLine.length;
    fullCharCount += content.length;
  }

  const frontmatterIndex = frontmatterParts.join("\n");

  return {
    skillNames: [...skillContents.keys()],
    byRole,
    frontmatterIndex,
    totalFrontmatterTokens: Math.ceil(frontmatterCharCount / 4),
    totalFullTokens: Math.ceil(fullCharCount / 4),
  };
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
  validation?: { context: RuntimeContext },
): string | null {
  const frameworkPath = resolve(frameworkDir, `${name}.md`);
  let filePath: string | null = null;
  let content: string | null = null;
  if (existsSync(frameworkPath)) {
    filePath = frameworkPath;
    content = readFileSync(frameworkPath, "utf-8");
  } else {
    const installedPath = resolve(installedDir, `${name}.md`);
    if (existsSync(installedPath)) {
      filePath = installedPath;
      content = readFileSync(installedPath, "utf-8");
    }
  }
  if (!content || !filePath) return null;

  if (validation) {
    // Throws when mode is `fail` and applies_to is missing/mismatched.
    checkAppliesTo({ filePath, content, context: validation.context });
  }
  return content;
}

/**
 * Load skills and validate `applies_to:` against a runtime context.
 *
 * Wraps `loadSkills` with a validation pass that detects the repo flavour
 * from `projectDir` and rejects (or warns about, depending on `JS_APPLIES_TO_MODE`)
 * any skill whose declared scope doesn't match the runtime asking for it.
 *
 * Use this from `pipeline/run.ts` (runtime: "pipeline") and
 * `pipeline/lib/audit-runtime.ts` (runtime: "audit"). Subagent prompt
 * injection happens server-side in run.ts; the subagent never re-validates
 * the same skill file because it doesn't know its own runtime context with
 * the same precision the loader does.
 */
export function loadSkillsValidated(
  projectDir: string,
  config: ProjectConfig,
  runtime: RuntimeContext["runtime"],
): LoadedSkills {
  const context: RuntimeContext = {
    runtime,
    repo: detectRepoFlavour(projectDir),
  };

  const skillNames = resolveSkillNames(config);
  const frameworkSkillsDir = resolve(projectDir, "skills");
  const installedSkillsDir = resolve(projectDir, ".claude", "skills");

  // Pre-validate every resolvable skill file. Throws on the first mismatch
  // when in fail mode — the only way to surface a silent-skip bug is to
  // refuse to start.
  for (const name of skillNames) {
    if (!isValidSkillName(name)) continue;
    loadSkillFile(name, frameworkSkillsDir, installedSkillsDir, { context });
  }
  for (const name of config.skills?.custom ?? []) {
    if (!isValidSkillName(name)) continue;
    const customPath = resolve(projectDir, ".claude", "skills", `${name}.md`);
    if (existsSync(customPath)) {
      const content = readFileSync(customPath, "utf-8");
      checkAppliesTo({ filePath: customPath, content, context });
    }
  }

  const loaded = loadSkills(projectDir, config);

  // T-1023: every agent role that has a defined agent file MUST receive at
  // least one skill, otherwise subagents work as generic coders without their
  // domain skill. Silent skip is exactly the bug that ate the last two weeks.
  // Engine-repo defaults to fail; customer repos warn (until they configure
  // their own skill mapping). Override via JS_APPLIES_TO_MODE.
  const mode = resolveMode(context.repo);
  if (mode !== "off") {
    const missing = expectedAgentRolesForRepo(projectDir).filter(
      (role) => !loaded.byRole.has(role)
    );
    if (missing.length > 0) {
      const message = `loadSkillsValidated: agents have no domain skill assigned — ${missing.join(", ")}. Check SKILL_AGENT_MAP in pipeline/lib/load-skills.ts and skills.domain in project.json.`;
      if (mode === "fail") {
        throw new Error(message);
      } else {
        logger.warn({ missing, mode }, message);
      }
    }
  }

  return loaded;
}

/**
 * Roles for which an agent definition exists in the repo, excluding
 * orchestrator and triage (which are spawned via separate paths and their
 * skill content is added directly to their prompts in run.ts).
 *
 * Mirrors the filter in loadAgents() (load-agents.ts) so the hard-fail check
 * stays consistent with what actually gets spawned as a subagent.
 */
function expectedAgentRolesForRepo(projectDir: string): AgentRole[] {
  const agentsDir = resolve(projectDir, ".claude", "agents");
  if (!existsSync(agentsDir)) return [];
  const knownRoles: AgentRole[] = [
    "frontend",
    "backend",
    "data-engineer",
    "qa",
    "devops",
    "security",
  ];
  // Only require roles whose agent definition file actually exists. A repo
  // that doesn't define agents/security.md shouldn't be required to map
  // skills to a security role that won't spawn.
  return knownRoles.filter((role) =>
    existsSync(resolve(agentsDir, `${role}.md`))
  );
}

/**
 * Exposed for tests: read-only view of which roles each skill is delivered to.
 */
export function getSkillAgentMap(): Readonly<Record<string, readonly AgentRole[]>> {
  return SKILL_AGENT_MAP;
}
