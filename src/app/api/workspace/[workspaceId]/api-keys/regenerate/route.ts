import { createHash, randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { success, error, unauthorized } from "@/lib/api/error-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;

    // Session auth (Board UI only)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized();

    // Verify workspace membership
    const { data: member } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();
    if (!member) return unauthorized("Not a workspace member");

    const serviceClient = createServiceClient();

    // Generate new key FIRST (so user never has zero valid keys)
    const rawKey = "adp_" + randomBytes(32).toString("hex");
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);

    const { error: insertError } = await serviceClient
      .from("api_keys")
      .insert({
        workspace_id: workspaceId,
        name: "Pipeline",
        key_hash: keyHash,
        key_prefix: keyPrefix,
        created_by: user.id,
      });

    if (insertError) {
      return error("DB_ERROR", "Failed to create new key", 500);
    }

    // THEN revoke all OTHER active keys (the new one stays active)
    const { error: revokeError } = await serviceClient
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .is("revoked_at", null)
      .neq("key_hash", keyHash);

    if (revokeError) {
      // New key is already created, revocation failed -- log but don't fail
      console.error("Failed to revoke old keys:", revokeError);
    }

    return success({ api_key: rawKey, prefix: keyPrefix });
  } catch (err) {
    return error("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}
