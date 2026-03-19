export const TICKET_STATUSES = [
  "backlog",
  "ready_to_develop",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "medium", "high"] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const PIPELINE_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "paused",
] as const;

export const TICKETS_PER_COLUMN_PAGE = 20;

export const BOARD_COLUMNS: { status: TicketStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "ready_to_develop", label: "Ready" },
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "In Review" },
  { status: "done", label: "Done" },
];

export const STATUS_COLORS: Record<TicketStatus, string> = {
  backlog: "bg-gray-100 text-gray-700",
  ready_to_develop: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  in_review: "bg-purple-100 text-purple-700",
  done: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export const PRIORITY_COLORS: Record<TicketPriority, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-orange-100 text-orange-700",
  high: "bg-red-100 text-red-700",
};

export const AGENT_TYPES = [
  "orchestrator",
  "frontend",
  "backend",
  "data-engineer",
  "qa",
  "devops",
  "security",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const EVENT_TYPES = [
  "agent_started",
  "agent_completed",
  "agent_spawned",
  "tool_use",
  "log",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
