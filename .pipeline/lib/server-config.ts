import { readFileSync, existsSync } from "node:fs";

export interface ServerProjectConfig {
  project_id: string;
  repo_url: string;
  project_dir: string;
  env_file: string;
  installation_id?: number;  // per-project GitHub App installation override
}

export interface ServerConfig {
  server: {
    port: number;
    pipeline_key: string;
    update_secret?: string;
  };
  workspace: {
    workspace_id: string;
    board_url: string;
    api_key: string;
    github_app?: {
      app_id: string;
      private_key_path: string;
      installation_id?: number;  // default for all projects
    };
  };
  projects: Record<string, ServerProjectConfig>;
}

export function loadServerConfig(configPath: string): ServerConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Server config not found: ${configPath}`);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

export function findProjectByProjectId(
  config: ServerConfig,
  projectId: string,
): { slug: string; project: ServerProjectConfig } | null {
  for (const [slug, project] of Object.entries(config.projects)) {
    if (project.project_id === projectId) {
      return { slug, project };
    }
  }
  return null;
}

export function loadProjectEnv(envFilePath: string): Record<string, string> {
  if (!envFilePath || !existsSync(envFilePath)) return {};
  const content = readFileSync(envFilePath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env[key] = value;
  }
  return env;
}
