import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(50)
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Slug must be lowercase alphanumeric with hyphens"
    ),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(50).optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
