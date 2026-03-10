import { validatePipelineAuth } from "@/lib/api/pipeline-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  success,
  error,
  unauthorized,
  notFound,
  validationError,
} from "@/lib/api/error-response";
import { createTicketSchema } from "@/lib/validations/ticket";

async function getWorkspace(slug: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .single();
  return data;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const auth = await validatePipelineAuth(
    request.headers.get("Authorization")
  );
  if (auth.error) return unauthorized(auth.error);

  const workspace = await getWorkspace(slug);
  if (!workspace) return notFound("Workspace not found");

  if (auth.workspace_id !== workspace.id)
    return unauthorized("API key does not belong to this workspace");

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);

  let query = supabase
    .from("tickets")
    .select("*, project:projects(*)")
    .eq("workspace_id", workspace.id)
    .order("number", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data: tickets, error: dbError } = await query;
  if (dbError) return error("DB_ERROR", dbError.message, 500);

  return success(tickets);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const auth = await validatePipelineAuth(
    request.headers.get("Authorization")
  );
  if (auth.error) return unauthorized(auth.error);

  const workspace = await getWorkspace(slug);
  if (!workspace) return notFound("Workspace not found");

  if (auth.workspace_id !== workspace.id)
    return unauthorized("API key does not belong to this workspace");

  const body = await request.json();
  const parsed = createTicketSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const supabase = createServiceClient();
  const { data: ticket, error: dbError } = await supabase
    .from("tickets")
    .insert({ ...parsed.data, workspace_id: workspace.id })
    .select("*, project:projects(*)")
    .single();

  if (dbError) return error("DB_ERROR", dbError.message, 500);

  return success(ticket, 201);
}
