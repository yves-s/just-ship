import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  success,
  error,
  unauthorized,
  notFound,
} from "@/lib/api/error-response";
import { z } from "zod";

const acceptSchema = z.object({
  token: z.string().min(1),
});

export async function POST(request: Request) {
  // User must be authenticated
  const userSupabase = await createClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) return unauthorized("You must be logged in to accept an invite");

  const body = await request.json();
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", "Invalid token", 400);

  // Use service client to bypass RLS (invited user is not yet a member)
  const supabase = createServiceClient();

  const { data: invite } = await supabase
    .from("workspace_invites")
    .select("*")
    .eq("token", parsed.data.token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!invite) return notFound("This invite is invalid or has expired");

  // Add member to workspace
  const { error: memberError } = await supabase
    .from("workspace_members")
    .insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: "member",
    });

  if (memberError && memberError.code !== "23505") {
    return error("DB_ERROR", memberError.message, 500);
  }

  // Mark invite as accepted
  await supabase
    .from("workspace_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  return success({ workspace_id: invite.workspace_id });
}
