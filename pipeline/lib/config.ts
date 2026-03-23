import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

export interface PipelineConfig {
  projectId: string;
  projectName: string;
  workspaceId: string;
  apiUrl: string;
  apiKey: string;
}

export interface QaConfig {
  maxFixIterations: number;
  playwrightTimeoutMs: number;
  previewProvider: "vercel" | "none";
  vercelProjectId: string;
  vercelTeamId: string;
  vercelPreviewPollIntervalMs: number;
  vercelPreviewMaxWaitMs: number;
}

export interface ProjectConfig {
  name: string;
  description: string;
  conventions: { branch_prefix: string };
  pipeline: PipelineConfig;
  maxWorkers: number;
  qa: QaConfig;
  stack: { packageManager: string };
}

export interface TicketArgs {
  ticketId: string;
  title: string;
  description: string;
  labels: string;
}

interface WorkspaceEntry {
  board_url?: string;
  workspace_id?: string;
  api_key?: string;
}

interface GlobalConfig {
  workspaces: Record<string, WorkspaceEntry>;
  default_workspace: string | null;
}

function loadGlobalConfig(): GlobalConfig | null {
  const configPath = join(homedir(), ".just-ship", "config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

function buildPipelineConfig(
  rawPipeline: Record<string, unknown>,
  ws?: WorkspaceEntry,
): PipelineConfig {
  return {
    projectId:   (rawPipeline.project_id as string) ?? "",
    projectName: (rawPipeline.project_name as string) ?? "",
    workspaceId: ws?.workspace_id ?? (rawPipeline.workspace_id as string) ?? "",
    apiUrl:      ws?.board_url   ?? (rawPipeline.api_url as string) ?? "",
    apiKey:      ws?.api_key     ?? (rawPipeline.api_key as string) ?? "",
  };
}

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const configPath = resolve(projectDir, "project.json");
  if (!existsSync(configPath)) {
    return {
      name: "project",
      description: "",
      conventions: { branch_prefix: "feature/" },
      pipeline: buildPipelineConfig({}),
      maxWorkers: 1,
      qa: {
        maxFixIterations: 3,
        playwrightTimeoutMs: 60000,
        previewProvider: "none",
        vercelProjectId: "",
        vercelTeamId: "",
        vercelPreviewPollIntervalMs: 10000,
        vercelPreviewMaxWaitMs: 300000,
      },
      stack: { packageManager: "npm" },
    };
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));

  // --- Pipeline config resolution ---
  let pipeline: PipelineConfig;
  const rawPipeline = raw.pipeline ?? {};

  // Hoist: load global config once for all branches
  const globalConfig = loadGlobalConfig();

  // Check for old format (api_key directly in project.json)
  if (rawPipeline.api_key) {
    console.warn(
      "\u26a0 api_key in project.json is deprecated.\n" +
      "  Führe 'just-ship connect' im Terminal aus um zu migrieren"
    );

    // Try global config first (takes priority)
    const workspaceSlug = rawPipeline.workspace;
    if (globalConfig && workspaceSlug && globalConfig.workspaces[workspaceSlug]) {
      const ws = globalConfig.workspaces[workspaceSlug];
      pipeline = buildPipelineConfig(rawPipeline, ws);
    } else {
      // Fall back to old format
      pipeline = buildPipelineConfig(rawPipeline);
    }
  } else if (rawPipeline.workspace) {
    // New format: resolve from global config
    const slug = rawPipeline.workspace;

    if (!globalConfig) {
      console.warn(
        `\u26a0 Workspace '${slug}' configured but ~/.just-ship/config.json not found.\n` +
        `  Führe 'just-ship connect' im Terminal aus um die Verbindung einzurichten.`
      );
      pipeline = buildPipelineConfig(rawPipeline);
    } else {
      const ws = globalConfig.workspaces[slug];
      if (!ws) {
        console.error(
          `Workspace '${slug}' not found in ~/.just-ship/config.json.\n` +
          `Führe 'just-ship connect' im Terminal aus um die Verbindung einzurichten.`
        );
        pipeline = buildPipelineConfig(rawPipeline);
      } else {
        pipeline = buildPipelineConfig(rawPipeline, ws);
      }
    }
  } else {
    // No pipeline config at all — check for default workspace
    const defaultSlug = globalConfig?.default_workspace;
    const defaultWs = defaultSlug ? globalConfig?.workspaces[defaultSlug] : undefined;

    pipeline = buildPipelineConfig(rawPipeline, defaultWs);
  }

  const rawQa = rawPipeline.qa ?? {};
  const qa: QaConfig = {
    maxFixIterations: Number(rawQa.max_fix_iterations ?? 3),
    playwrightTimeoutMs: Number(rawQa.playwright_timeout_ms ?? 60000),
    previewProvider: (rawQa.preview_provider as "vercel" | "none") ?? "none",
    vercelProjectId: (rawQa.vercel_project_id as string) ?? "",
    vercelTeamId: (rawQa.vercel_team_id as string) ?? "",
    vercelPreviewPollIntervalMs: Number(rawQa.vercel_preview_poll_interval_ms ?? 10000),
    vercelPreviewMaxWaitMs: Number(rawQa.vercel_preview_max_wait_ms ?? 300000),
  };

  return {
    name: raw.name ?? "project",
    description: raw.description ?? "",
    conventions: { branch_prefix: raw.conventions?.branch_prefix ?? "feature/" },
    pipeline,
    maxWorkers: Number(rawPipeline.max_workers ?? 1),
    qa,
    stack: { packageManager: raw.stack?.package_manager ?? "npm" },
  };
}

export function parseCliArgs(args: string[]): TicketArgs {
  const [ticketId, title, description, labels] = args;
  if (!ticketId || !title) {
    console.error("Usage: run.ts <TICKET_ID> <TITLE> [DESCRIPTION] [LABELS]");
    process.exit(1);
  }
  return {
    ticketId,
    title,
    description: description ?? "No description provided",
    labels: labels ?? "",
  };
}
