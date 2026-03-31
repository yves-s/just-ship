import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

export interface PipelineConfig {
  projectId: string;
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
  pipeline: PipelineConfig & { skipAgents?: string[]; maxAutonomousComplexity?: string };
  maxWorkers: number;
  qa: QaConfig;
  stack: {
    packageManager: string;
    buildCommand?: string;
    testCommand?: string;
    verifyCommand?: string;
    platform?: string;
    variant?: string;
  };
  skills?: {
    domain?: string[];
    custom?: string[];
  };
}

export interface TicketArgs {
  ticketId: string;
  title: string;
  description: string;
  labels: string;
}

interface WorkspaceEntry {
  slug?: string;
  api_key?: string;
}

interface GlobalConfig {
  board_url?: string;
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
  globalConfig?: GlobalConfig | null,
  ws?: WorkspaceEntry,
): PipelineConfig {
  return {
    projectId:   (rawPipeline.project_id as string) ?? "",
    workspaceId: (rawPipeline.workspace_id as string) ?? "",
    apiUrl:      globalConfig?.board_url ?? "",
    apiKey:      ws?.api_key ?? "",
  };
}

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const configPath = resolve(projectDir, "project.json");
  if (!existsSync(configPath)) {
    return {
      name: "project",
      description: "",
      conventions: { branch_prefix: "feature/" },
      pipeline: { ...buildPipelineConfig({}), skipAgents: [] },
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
      skills: undefined,
    };
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));

  // --- Pipeline config resolution ---
  let pipeline: PipelineConfig;
  const rawPipeline = raw.pipeline ?? {};

  // Hoist: load global config once for all branches
  const globalConfig = loadGlobalConfig();

  if (rawPipeline.api_key) {
    // Old format: credentials in project.json
    console.warn(
      "\u26a0 api_key in project.json is deprecated.\n" +
      "  Run 'just-ship connect' or '.claude/scripts/write-config.sh migrate' to upgrade."
    );
    pipeline = buildPipelineConfig(rawPipeline, globalConfig);
    if (!pipeline.apiUrl) pipeline.apiUrl = (rawPipeline.api_url as string) ?? "";
    if (!pipeline.apiKey) pipeline.apiKey = (rawPipeline.api_key as string) ?? "";

  } else if (rawPipeline.workspace_id) {
    // New format: UUID-based lookup
    const wsId = rawPipeline.workspace_id as string;
    if (!globalConfig) {
      // In multi-project mode (VPS), credentials come from server-config.json, not ~/.just-ship/config.json
      if (process.env.SERVER_CONFIG_PATH) {
        // Read board_url and api_key from server-config.json
        const serverConfigPath = process.env.SERVER_CONFIG_PATH;
        try {
          const serverConfig = JSON.parse(readFileSync(serverConfigPath, "utf-8"));
          const boardUrl = serverConfig?.workspace?.board_url ?? "";
          const apiKey = serverConfig?.workspace?.api_key ?? "";
          pipeline = {
            projectId: (rawPipeline.project_id as string) ?? "",
            workspaceId: wsId,
            apiUrl: boardUrl,
            apiKey: apiKey,
          };
        } catch {
          console.warn(`\u26a0 Could not read server-config.json at ${serverConfigPath}`);
          pipeline = buildPipelineConfig(rawPipeline, null);
        }
      } else {
        console.warn(
          `\u26a0 workspace_id '${wsId}' configured but ~/.just-ship/config.json not found.\n` +
          `  Run 'just-ship connect' to set up the connection.`
        );
        pipeline = buildPipelineConfig(rawPipeline, null);
      }
    } else {
      const ws = globalConfig.workspaces[wsId];
      if (!ws) {
        console.error(
          `Workspace '${wsId}' not found in ~/.just-ship/config.json.\n` +
          `Run 'just-ship connect' to set up the connection.`
        );
        pipeline = buildPipelineConfig(rawPipeline, globalConfig);
      } else {
        pipeline = buildPipelineConfig(rawPipeline, globalConfig, ws);
      }
    }

  } else if (rawPipeline.workspace) {
    // Intermediate format: slug-based (deprecated)
    console.warn(
      `\u26a0 pipeline.workspace (slug) is deprecated.\n` +
      `  Run '.claude/scripts/write-config.sh migrate' to upgrade.`
    );
    const slug = rawPipeline.workspace as string;
    let ws: WorkspaceEntry | undefined;
    if (globalConfig) {
      for (const [, entry] of Object.entries(globalConfig.workspaces)) {
        if (entry.slug === slug) { ws = entry; break; }
      }
    }
    pipeline = buildPipelineConfig(rawPipeline, globalConfig, ws);

  } else {
    // No pipeline config — check for default workspace
    const defaultId = globalConfig?.default_workspace;
    const defaultWs = defaultId ? globalConfig?.workspaces[defaultId] : undefined;
    pipeline = buildPipelineConfig(rawPipeline, globalConfig, defaultWs);
  }

  const rawQa = rawPipeline.qa ?? {};
  // Infer preview provider from pipeline.hosting if not explicitly set in qa config
  const hosting = rawPipeline.hosting as string | undefined;
  const inferredProvider = hosting === "vercel" ? "vercel" : "none";
  const qa: QaConfig = {
    maxFixIterations: Number(rawQa.max_fix_iterations ?? 3),
    playwrightTimeoutMs: Number(rawQa.playwright_timeout_ms ?? 60000),
    previewProvider: (rawQa.preview_provider as "vercel" | "none") ?? inferredProvider,
    vercelProjectId: (rawQa.vercel_project_id as string) ?? "",
    vercelTeamId: (rawQa.vercel_team_id as string) ?? "",
    vercelPreviewPollIntervalMs: Number(rawQa.vercel_preview_poll_interval_ms ?? 10000),
    vercelPreviewMaxWaitMs: Number(rawQa.vercel_preview_max_wait_ms ?? 300000),
  };

  return {
    name: raw.name ?? "project",
    description: raw.description ?? "",
    conventions: { branch_prefix: raw.conventions?.branch_prefix ?? "feature/" },
    pipeline: {
      ...pipeline,
      skipAgents: (rawPipeline.skip_agents as string[]) ?? [],
      maxAutonomousComplexity: (rawPipeline.max_autonomous_complexity as string) ?? "medium",
    },
    maxWorkers: Number(rawPipeline.max_workers ?? 1),
    qa,
    stack: {
      packageManager: raw.stack?.package_manager ?? "npm",
      buildCommand: raw.build?.web as string | undefined,
      testCommand: raw.build?.test as string | undefined,
      verifyCommand: raw.build?.verify as string | undefined,
      platform: raw.stack?.platform as string | undefined,
      variant: raw.stack?.variant as string | undefined,
    },
    skills: raw.skills as { domain?: string[]; custom?: string[] } | undefined,
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
