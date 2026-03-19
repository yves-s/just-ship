import { validatePipelineKey } from "@/lib/api/pipeline-key-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import {
  success,
  error,
  unauthorized,
  notFound,
} from "@/lib/api/error-response";
import { z } from "zod";

const answerQuestionSchema = z.object({
  answer: z.string().min(1).max(5000),
  answered_via: z.enum(["telegram", "board"]).default("board"),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ number: string; id: string }> }
) {
  const { number, id: questionId } = await params;
  const ticketNumber = parseInt(number);
  if (isNaN(ticketNumber)) return notFound("Invalid ticket number");

  // Dual auth: try Pipeline-Key first, then Supabase session
  let workspaceId: string | null = null;

  const pipelineAuth = await validatePipelineKey(request);
  if (!pipelineAuth.error) {
    workspaceId = pipelineAuth.workspace_id;
  } else {
    // Try Supabase session auth
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized("Authentication required");

    // Get workspace from ticket
    const serviceClient = createServiceClient();
    const { data: ticket } = await serviceClient
      .from("tickets")
      .select("workspace_id")
      .eq("number", ticketNumber)
      .single();

    if (ticket) workspaceId = ticket.workspace_id;
  }

  if (!workspaceId) return unauthorized("Could not determine workspace");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("PARSE_ERROR", "Invalid JSON body", 400);
  }

  const parsed = answerQuestionSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", "Invalid answer", 400);

  // Atomic update: only answer if not already answered
  const supabase = createServiceClient();
  const { data: question, error: dbError } = await supabase
    .from("ticket_questions")
    .update({
      answer: parsed.data.answer,
      answered_via: parsed.data.answered_via,
      answered_at: new Date().toISOString(),
    })
    .eq("id", questionId)
    .is("answer", null) // Guard: only answer if not already answered
    .select()
    .single();

  if (dbError) {
    if (dbError.code === "PGRST116") {
      return error(
        "ALREADY_ANSWERED",
        "Question was already answered",
        409
      );
    }
    return error("DB_ERROR", dbError.message, 500);
  }

  if (!question) {
    return error(
      "ALREADY_ANSWERED",
      "Question was already answered or not found",
      409
    );
  }

  // Get ticket for webhook info
  const { data: ticket } = await supabase
    .from("tickets")
    .select("number, session_id")
    .eq("workspace_id", workspaceId)
    .eq("number", ticketNumber)
    .single();

  // Fire webhook to pipeline server (fire and forget)
  if (ticket?.session_id) {
    // Read workspace VPS URL for webhook
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("vps_url, vps_api_key")
      .eq("id", workspaceId)
      .single();

    if (workspace?.vps_url) {
      fetch(`${workspace.vps_url}/api/answer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pipeline-Key": workspace.vps_api_key ?? "",
        },
        body: JSON.stringify({
          ticket_number: ticketNumber,
          question_id: questionId,
          answer: parsed.data.answer,
        }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {
        // Silent fail -- user can manually retry
      });
    }
  }

  return success(question);
}
