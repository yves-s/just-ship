import { randomBytes, createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  success,
  error,
  unauthorized,
  validationError,
} from "@/lib/api/error-response";
import { createApiKeySchema } from "@/lib/validations/api-key";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  // Authenticate user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorized();

  // Verify workspace membership (RLS will enforce this, but explicit check for clarity)
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!member) return unauthorized("Not a workspace member");

  // Validate body
  const body = await request.json();
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  // Generate key: adp_ + 32 random bytes as hex
  const rawKey = "adp_" + randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12); // "adp_" + first 8 chars

  const serviceClient = createServiceClient();
  const { data: apiKey, error: dbError } = await serviceClient
    .from("api_keys")
    .insert({
      workspace_id: workspaceId,
      name: parsed.data.name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      created_by: user.id,
    })
    .select("id, name, key_prefix, last_used_at, revoked_at, created_at")
    .single();

  if (dbError) return error("DB_ERROR", dbError.message, 500);

  return success({ key: apiKey, plaintext: rawKey }, 201);
}
