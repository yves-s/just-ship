import type { TicketStatus, TicketPriority } from "./constants";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  user_email?: string;
}

export interface WorkspaceInvite {
  id: string;
  workspace_id: string;
  email: string;
  invited_by: string | null;
  token: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface ApiKey {
  id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_by: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  id: string;
  ticket_id: string;
  project_id: string | null;
  agent_type: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TelegramConnection {
  id: string;
  user_id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  connected_at: string;
}

export interface TelegramAuthCode {
  id: string;
  user_id: string;
  code: string;
  expires_at: string;
  created_at: string;
}

export interface Ticket {
  id: string;
  workspace_id: string;
  number: number;
  title: string;
  body: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  tags: string[];
  project_id: string | null;
  parent_ticket_id: string | null;
  assignee_id: string | null;
  branch: string | null;
  pipeline_status: string | null;
  assigned_agents: string[];
  summary: string | null;
  test_results: string | null;
  total_tokens: number;
  preview_url: string | null;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  project?: Project | null;
}
