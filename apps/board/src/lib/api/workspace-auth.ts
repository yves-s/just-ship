import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/lib/types";

interface WorkspaceAuthResult {
  user_id: string;
  workspace: Workspace;
}

/**
 * Validates that the current authenticated user is a member of the workspace.
 * Returns the user ID and workspace, or throws.
 */
export async function requireWorkspaceMember(
  slug: string
): Promise<WorkspaceAuthResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new AuthError("Not authenticated", 401);
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug, created_by, created_at, updated_at, vps_url")
    .eq("slug", slug)
    .single();

  if (!workspace) {
    throw new AuthError("Workspace not found", 404);
  }

  // RLS already enforces membership via is_workspace_member,
  // so if we got the workspace, the user is a member.

  return { user_id: user.id, workspace };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
