import { createServiceClient } from "@/lib/supabase/service";
import { success, error, unauthorized, notFound } from "@/lib/api/error-response";

export async function GET(request: Request) {
  try {
    // Verify bot secret
    const authHeader = request.headers.get("authorization");
    const botSecret = process.env.TELEGRAM_BOT_SECRET;

    if (!botSecret || authHeader !== `Bearer ${botSecret}`) {
      return unauthorized("Invalid bot secret");
    }

    // Validate query parameter
    const { searchParams } = new URL(request.url);
    const telegramUserId = searchParams.get("telegram_user_id");

    if (!telegramUserId) {
      return error(
        "VALIDATION_ERROR",
        "telegram_user_id query parameter is required",
        400
      );
    }

    // INPUT VALIDATION: telegram_user_id must be a valid integer
    const telegramUserIdNum = Number(telegramUserId);
    if (!Number.isInteger(telegramUserIdNum) || telegramUserIdNum <= 0) {
      return error(
        "VALIDATION_ERROR",
        "telegram_user_id must be a positive integer",
        400
      );
    }

    const supabase = createServiceClient();

    // 1. Find user_id from telegram_connections
    const { data: connection, error: connectionError } = await supabase
      .from("telegram_connections")
      .select("user_id")
      .eq("telegram_user_id", telegramUserIdNum)
      .single();

    if (connectionError && connectionError.code !== "PGRST116") {
      return error("DB_ERROR", connectionError.message, 500);
    }

    if (!connection) {
      return notFound("No user found for this Telegram account");
    }

    const userId = connection.user_id;

    // 2. Get all workspaces for this user via workspace_members
    const { data: members, error: membersError } = await supabase
      .from("workspace_members")
      .select("workspace_id, workspaces(id, name, slug)")
      .eq("user_id", userId);

    if (membersError) {
      return error("DB_ERROR", membersError.message, 500);
    }

    if (!members || members.length === 0) {
      return success([]);
    }

    // 3. For each workspace, fetch projects filtered by membership
    const workspaces = await Promise.all(
      members.map(async (member) => {
        // workspaces comes back as a single object from the join
        const workspace = member.workspaces as unknown as {
          id: string;
          name: string;
          slug: string;
        };

        // Get user's role in this workspace to determine project visibility
        const { data: memberRole } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", workspace.id)
          .eq("user_id", userId)
          .single();

        const isAdmin =
          memberRole && ["admin", "owner"].includes(memberRole.role);

        let projects: { id: string; name: string }[];
        if (isAdmin) {
          // Admins see all projects in the workspace
          const { data } = await supabase
            .from("projects")
            .select("id, name")
            .eq("workspace_id", workspace.id);
          projects = data || [];
        } else {
          // Regular members see only projects they are explicitly assigned to
          const { data: projectMembers } = await supabase
            .from("project_members")
            .select("project_id, project:projects(id, name)")
            .eq("user_id", userId);

          projects = (projectMembers || [])
            .map((pm) => pm.project as unknown as { id: string; name: string })
            .filter((p) => p !== null);
        }

        return {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          projects,
        };
      })
    );

    return success(workspaces);
  } catch (err) {
    console.error("Telegram workspaces crashed:", err);
    return error(
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : "Unknown error",
      500
    );
  }
}
