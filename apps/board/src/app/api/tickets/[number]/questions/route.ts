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

const createQuestionSchema = z.object({
  question: z.string().min(1).max(2000),
  options: z
    .array(
      z.object({
        key: z.string().max(10),
        label: z.string().max(200),
      })
    )
    .max(10)
    .optional(),
  context: z.string().max(2000).optional(),
});

async function getTicketByNumber(workspaceId: string, number: number) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("tickets")
    .select("id, workspace_id, number, title")
    .eq("workspace_id", workspaceId)
    .eq("number", number)
    .single();
  return data;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ number: string }> }
) {
  const { number } = await params;
  const ticketNumber = parseInt(number);
  if (isNaN(ticketNumber)) return notFound("Invalid ticket number");

  const auth = await validatePipelineKey(request);
  if (auth.error) return unauthorized(auth.error);

  const ticket = await getTicketByNumber(auth.workspace_id!, ticketNumber);
  if (!ticket) return notFound("Ticket not found");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("PARSE_ERROR", "Invalid JSON body", 400);
  }

  const parsed = createQuestionSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const supabase = createServiceClient();
  const { data: question, error: dbError } = await supabase
    .from("ticket_questions")
    .insert({
      ticket_id: ticket.id,
      workspace_id: auth.workspace_id!,
      question: parsed.data.question,
      options: parsed.data.options ?? null,
      context: parsed.data.context ?? null,
    })
    .select()
    .single();

  if (dbError) return error("DB_ERROR", dbError.message, 500);

  return success(question, 201);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ number: string }> }
) {
  const { number } = await params;
  const ticketNumber = parseInt(number);
  if (isNaN(ticketNumber)) return notFound("Invalid ticket number");

  const auth = await validatePipelineKey(request);
  if (auth.error) return unauthorized(auth.error);

  const ticket = await getTicketByNumber(auth.workspace_id!, ticketNumber);
  if (!ticket) return notFound("Ticket not found");

  const supabase = createServiceClient();
  const { data: questions, error: dbError } = await supabase
    .from("ticket_questions")
    .select()
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: false });

  if (dbError) return error("DB_ERROR", dbError.message, 500);

  return success(questions);
}
