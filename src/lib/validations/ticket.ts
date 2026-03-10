import { z } from "zod";
import { TICKET_STATUSES, TICKET_PRIORITIES, PIPELINE_STATUSES } from "../constants";

export const createTicketSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  body: z.string().max(10000).optional(),
  status: z.enum(TICKET_STATUSES).default("backlog"),
  priority: z.enum(TICKET_PRIORITIES).default("medium"),
  tags: z.array(z.string().max(50)).max(10).default([]),
  project_id: z.string().uuid().nullable().optional(),
  parent_ticket_id: z.string().uuid().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export const updateTicketSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(10000).nullable().optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  project_id: z.string().uuid().nullable().optional(),
  parent_ticket_id: z.string().uuid().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  branch: z.string().max(200).nullable().optional(),
  pipeline_status: z.enum(PIPELINE_STATUSES).nullable().optional(),
  assigned_agents: z.array(z.string().max(100)).max(10).optional(),
  summary: z.string().max(5000).nullable().optional(),
  test_results: z.string().max(10000).nullable().optional(),
  preview_url: z.string().url().max(500).nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
