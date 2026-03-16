import { createClient } from "@/lib/supabase/server";
import {
  success,
  error,
  unauthorized,
  forbidden,
  notFound,
} from "@/lib/api/error-response";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return unauthorized();

    // Verify workspace exists and user is the creator
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id, created_by")
      .eq("id", workspaceId)
      .single();

    if (!workspace) return notFound("Workspace not found");

    if (workspace.created_by !== user.id) {
      return forbidden("Only the workspace creator can delete it");
    }

    // Delete workspace (CASCADE handles members, invites, api_keys, projects, tickets)
    const { error: deleteError } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", workspaceId);

    if (deleteError) {
      return error("DELETE_FAILED", deleteError.message, 500);
    }

    return success({ deleted: workspaceId });
  } catch {
    return error("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}
