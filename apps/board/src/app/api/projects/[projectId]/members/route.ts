import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  success,
  error,
  unauthorized,
  forbidden,
  notFound,
} from "@/lib/api/error-response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

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

    // Fetch project members using service client to resolve emails from auth.users
    const service = createServiceClient();
    const { data: members, error: membersError } = await service
      .from("project_members")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at");

    if (membersError) {
      return error("DB_ERROR", membersError.message, 500);
    }

    // Enrich each member with their email from auth.users
    const membersWithEmail = await Promise.all(
      (members ?? []).map(async (m) => {
        const {
          data: { user: authUser },
        } = await service.auth.admin.getUserById(m.user_id);
        return { ...m, user_email: authUser?.email ?? null };
      })
    );

    return success(membersWithEmail);
  } catch (err) {
    console.error("Project members GET crashed:", err);
    return error("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

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

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error("INVALID_JSON", "Request body must be valid JSON", 400);
    }

    const { user_id } = body as { user_id?: unknown };
    if (!user_id || typeof user_id !== "string" || user_id.trim() === "") {
      return error("VALIDATION_ERROR", "user_id must be a non-empty string", 400);
    }

    const service = createServiceClient();

    // Verify that the target user is a member of this workspace
    const { data: targetMember } = await service
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", project.workspace_id)
      .eq("user_id", user_id)
      .single();

    if (!targetMember) {
      return error("VALIDATION_ERROR", "User is not a workspace member", 400);
    }

    // Insert the new project member
    const { data: pm, error: dbError } = await service
      .from("project_members")
      .insert({ project_id: projectId, user_id, added_by: user.id })
      .select("*")
      .single();

    if (dbError) {
      // Unique constraint violation — user already a project member
      if (dbError.code === "23505") {
        return error("CONFLICT", "User is already a project member", 409);
      }
      return error("DB_ERROR", dbError.message, 500);
    }

    return success(pm, 201);
  } catch (err) {
    console.error("Project members POST crashed:", err);
    return error("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}
