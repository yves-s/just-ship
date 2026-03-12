import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Reads the project's .claude/settings.json and extracts MCP tool patterns
 * (e.g. "mcp__claude_ai_Supabase__*") so the SDK pipeline can use them.
 */
export function loadMcpTools(projectDir: string): string[] {
  const settingsPath = resolve(projectDir, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return [];

  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const allow: string[] = raw?.permissions?.allow ?? [];
    return allow.filter((tool) => tool.startsWith("mcp__"));
  } catch {
    return [];
  }
}
