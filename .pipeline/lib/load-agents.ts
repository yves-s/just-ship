import { readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.ts";

export type { AgentDefinition };

interface AgentFrontmatter {
  name: string;
  description: string;
  tools: string;
  model: string;
  permissionMode: string;
}

function parseFrontmatter(content: string): { frontmatter: Partial<AgentFrontmatter>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (value.startsWith("\n") || value === "") continue;
    // Handle simple YAML arrays (indented with -)
    frontmatter[key] = value;
  }

  return { frontmatter: frontmatter as unknown as Partial<AgentFrontmatter>, body: match[2] };
}

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

export function loadAgents(projectDir: string): Record<string, AgentDefinition> {
  const agentsDir = resolve(projectDir, ".claude", "agents");
  const agents: Record<string, AgentDefinition> = {};

  let files: string[];
  try {
    files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  } catch {
    logger.error({ agentsDir }, "No agents directory found");
    return agents;
  }

  for (const file of files) {
    const name = basename(file, ".md");

    // Skip orchestrator and triage — they're called directly, not as sub-agents
    if (name === "orchestrator" || name === "triage") continue;

    const content = readFileSync(resolve(agentsDir, file), "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    const tools = frontmatter.tools
      ? String(frontmatter.tools).split(",").map((t) => t.trim())
      : DEFAULT_TOOLS;

    const model = frontmatter.model as AgentDefinition["model"];
    agents[name] = {
      description: String(frontmatter.description ?? `${name} agent`),
      prompt: body.trim(),
      tools,
      ...(model && model !== "inherit" ? { model } : {}),
    };
  }

  return agents;
}

export function loadOrchestratorPrompt(projectDir: string): string {
  const orchestratorPath = resolve(projectDir, ".claude", "agents", "orchestrator.md");
  const content = readFileSync(orchestratorPath, "utf-8");
  const { body } = parseFrontmatter(content);
  return body.trim();
}

export function loadTriagePrompt(projectDir: string): string | null {
  const triagePath = resolve(projectDir, ".claude", "agents", "triage.md");
  try {
    const content = readFileSync(triagePath, "utf-8");
    const { body } = parseFrontmatter(content);
    return body.trim();
  } catch {
    // Optional: triage agent definition may not exist in all projects
    return null;
  }
}

export function loadEnrichmentPrompt(projectDir: string): string | null {
  const enrichmentPath = resolve(projectDir, ".claude", "agents", "triage-enrichment.md");
  try {
    const content = readFileSync(enrichmentPath, "utf-8");
    const { body } = parseFrontmatter(content);
    return body.trim();
  } catch {
    // Optional: enrichment agent definition may not exist in all projects
    return null;
  }
}
