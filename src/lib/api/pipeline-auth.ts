import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";

interface PipelineAuthResult {
  workspace_id: string | null;
  error: string | null;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function validatePipelineAuth(
  authHeader: string | null
): Promise<PipelineAuthResult> {
  if (!authHeader?.startsWith("Bearer adp_")) {
    return { workspace_id: null, error: "Missing or invalid API key" };
  }

  const key = authHeader.slice(7); // Remove "Bearer "
  const keyHash = sha256(key);

  const supabase = createServiceClient();
  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .select("id, workspace_id, revoked_at")
    .eq("key_hash", keyHash)
    .single();

  if (error || !apiKey) {
    return { workspace_id: null, error: "Invalid API key" };
  }

  if (apiKey.revoked_at) {
    return { workspace_id: null, error: "API key has been revoked" };
  }

  // Update last_used_at (fire and forget)
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then();

  return { workspace_id: apiKey.workspace_id, error: null };
}
