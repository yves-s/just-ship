import { validatePipelineAuth } from "@/lib/api/pipeline-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  success,
  error,
  unauthorized,
  notFound,
  validationError,
} from "@/lib/api/error-response";
import { updateTicketSchema } from "@/lib/validations/ticket";

async function getWorkspaceAndTicket(slug: string, ticketId: string) {
  const supabase = createServiceClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!workspace) return { workspace: null, ticket: null };

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*, project:projects(*)")
    .eq("id", ticketId)
    .eq("workspace_id", workspace.id)
    .single();

  return { workspace, ticket };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;

  const auth = await validatePipelineAuth(
    request.headers.get("Authorization")
  );
  if (auth.error) return unauthorized(auth.error);

  const { workspace, ticket } = await getWorkspaceAndTicket(slug, id);
  if (!workspace) return notFound("Workspace not found");
  if (auth.workspace_id !== workspace.id)
    return unauthorized("API key does not belong to this workspace");
  if (!ticket) return notFound("Ticket not found");

  return success(ticket);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;

  const auth = await validatePipelineAuth(
    request.headers.get("Authorization")
  );
  if (auth.error) return unauthorized(auth.error);

  const { workspace, ticket } = await getWorkspaceAndTicket(slug, id);
  if (!workspace) return notFound("Workspace not found");
  if (auth.workspace_id !== workspace.id)
    return unauthorized("API key does not belong to this workspace");
  if (!ticket) return notFound("Ticket not found");

  const body = await request.json();
  const parsed = updateTicketSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const supabase = createServiceClient();
  const { data: updated, error: dbError } = await supabase
    .from("tickets")
    .update(parsed.data)
    .eq("id", id)
    .select("*, project:projects(*)")
    .single();

  if (dbError) return error("DB_ERROR", dbError.message, 500);

  return success(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;

  const auth = await validatePipelineAuth(
    request.headers.get("Authorization")
  );
  if (auth.error) return unauthorized(auth.error);

  const { workspace, ticket } = await getWorkspaceAndTicket(slug, id);
  if (!workspace) return notFound("Workspace not found");
  if (auth.workspace_id !== workspace.id)
    return unauthorized("API key does not belong to this workspace");
  if (!ticket) return notFound("Ticket not found");

  const supabase = createServiceClient();
  const { error: dbError } = await supabase
    .from("tickets")
    .delete()
    .eq("id", id);

  if (dbError) return error("DB_ERROR", dbError.message, 500);

  return success({ deleted: true });
}
