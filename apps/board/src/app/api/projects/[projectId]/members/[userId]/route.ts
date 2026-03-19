import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  success,
  error,
  unauthorized,
  forbidden,
  notFound,
} from "@/lib/api/error-response";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; userId: string }> }
) {
  try {
    const { projectId, userId } = await params;

    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return unauthorized();

    // Fetch the project (RLS ensures user can only see projects they have access to)
    const { data: project } = await supabase
      .from("projects")
      .select("id, workspace_id")
      .eq("id", projectId)
      .single();

    if (!project) return notFound("Project not found");

    // Check that the current user is an admin or owner in this workspace
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", project.workspace_id)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["admin", "owner"].includes(membership.role)) {
      return forbidden("Only workspace admins can manage project members");
    }

    // Remove the project member using service client
    const service = createServiceClient();
    const { error: dbError } = await service
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", userId);

    if (dbError) {
      return error("DB_ERROR", dbError.message, 500);
    }

    return success({ removed: true });
  } catch (err) {
    console.error("Project members DELETE crashed:", err);
    return error("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}
