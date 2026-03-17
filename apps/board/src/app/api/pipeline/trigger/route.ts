import { createClient } from "@/lib/supabase/server";
import {
  success,
  error,
  unauthorized,
  notFound,
} from "@/lib/api/error-response";
import { z } from "zod";

const triggerSchema = z.object({
  ticket_number: z.number().int().positive(),
  action: z.enum(["launch", "ship"]),
  workspace_id: z.string().uuid(),
});

export async function POST(request: Request) {
  // 1. Auth: verify user is logged in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  // 2. Parse body
  const body = await request.json();
  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      "VALIDATION_ERROR",
      parsed.error.issues.map((e) => e.message).join(", "),
      400
    );
  }

  const { ticket_number, action, workspace_id } = parsed.data;

  // 3. Verify user is member of workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) return unauthorized("Not a member of this workspace");

  // 4. Get workspace VPS config
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("vps_url, vps_api_key")
    .eq("id", workspace_id)
    .single();

  if (!workspace) return notFound("Workspace not found");
  if (!workspace.vps_url || !workspace.vps_api_key) {
    return error(
      "VPS_NOT_CONFIGURED",
      "VPS server is not configured for this workspace. Go to Settings → Pipeline to configure it.",
      400
    );
  }

  // 5. Determine VPS endpoint
  const vpsEndpoint =
    action === "launch"
      ? `${workspace.vps_url}/api/launch`
      : `${workspace.vps_url}/api/ship`;

  // 6. Proxy to VPS
  try {
    const vpsRes = await fetch(vpsEndpoint, {
      method: "POST",
      headers: {
        "X-Pipeline-Key": workspace.vps_api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ticket_number }),
      signal: AbortSignal.timeout(15000),
    });

    const vpsData = await vpsRes.json();

    if (!vpsRes.ok) {
      const message =
        ((vpsData as Record<string, unknown>).message as string) ??
        "VPS request failed";
      return error(
        "VPS_ERROR",
        message,
        vpsRes.status >= 500 ? 502 : vpsRes.status
      );
    }

    return success(vpsData);
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return error("VPS_TIMEOUT", "VPS server did not respond in time", 504);
    }
    return error("VPS_UNREACHABLE", "Could not connect to VPS server", 502);
  }
}
