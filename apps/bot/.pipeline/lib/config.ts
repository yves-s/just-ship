import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface PipelineConfig {
  projectId: string;
  projectName: string;
  workspaceId: string;
  apiUrl: string;
  apiKey: string;
}

export interface ProjectConfig {
  name: string;
  description: string;
  conventions: { branch_prefix: string };
  pipeline: PipelineConfig;
}

export interface TicketArgs {
  ticketId: string;
  title: string;
  description: string;
  labels: string;
}

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const configPath = resolve(projectDir, "project.json");
  if (!existsSync(configPath)) {
    return {
      name: "project",
      description: "",
      conventions: { branch_prefix: "feature/" },
      pipeline: { projectId: "", projectName: "", workspaceId: "", apiUrl: "", apiKey: "" },
    };
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  return {
    name: raw.name ?? "project",
    description: raw.description ?? "",
    conventions: { branch_prefix: raw.conventions?.branch_prefix ?? "feature/" },
    pipeline: {
      projectId: raw.pipeline?.project_id ?? "",
      projectName: raw.pipeline?.project_name ?? "",
      workspaceId: raw.pipeline?.workspace_id ?? "",
      apiUrl: raw.pipeline?.api_url ?? "",
      apiKey: raw.pipeline?.api_key ?? "",
    },
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
