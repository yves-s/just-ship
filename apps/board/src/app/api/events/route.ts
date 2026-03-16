import { validatePipelineKey } from "@/lib/api/pipeline-key-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  success,
  error,
  unauthorized,
  notFound,
  validationError,
} from "@/lib/api/error-response";
import { z } from "zod";

const createEventSchema = z.object({
  ticket_number: z.number().int().positive(),
  agent_type: z.string().min(1),
  event_type: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function POST(request: Request) {
  const auth = await validatePipelineKey(request);
  if (auth.error) return unauthorized(auth.error);

  const body = await request.json();
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const supabase = createServiceClient();

  // Resolve ticket by number within workspace
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, project_id")
    .eq("workspace_id", auth.workspace_id!)
    .eq("number", parsed.data.ticket_number)
    .single();

  if (!ticket) return notFound("Ticket not found in this workspace");

  const { data: event, error: dbError } = await supabase
    .from("task_events")
    .insert({
      ticket_id: ticket.id,
      project_id: ticket.project_id,
      agent_type: parsed.data.agent_type,
      event_type: parsed.data.event_type,
      metadata: parsed.data.metadata,
    })
    .select()
    .single();

  if (dbError) return error("DB_ERROR", dbError.message, 500);

  // Accumulate token usage on ticket when agent completes
  const tokensUsed = typeof parsed.data.metadata.tokens_used === "number"
    ? parsed.data.metadata.tokens_used
    : 0;
  if (tokensUsed > 0) {
    await supabase.rpc("increment_ticket_tokens", {
      ticket_id_param: ticket.id,
      tokens_param: tokensUsed,
    });
  }

  return success(event, 201);
}
