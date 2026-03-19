-- 007_human_in_the_loop.sql
-- Adds support for agent questions (human-in-the-loop) during pipeline execution

-- =============================================================================
-- 1. Extend pipeline_status CHECK to include 'paused'
-- =============================================================================
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_pipeline_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_pipeline_status_check
  CHECK (pipeline_status IS NULL OR pipeline_status IN ('queued','running','done','failed','paused'));

-- =============================================================================
-- 2. Add session_id column for session resume
-- =============================================================================
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS session_id TEXT;

-- =============================================================================
-- 3. Create ticket_questions table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ticket_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE NOT NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  question TEXT NOT NULL,
  options JSONB,
  context TEXT,
  answer TEXT,
  answered_via TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  answered_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ticket_questions_ticket ON public.ticket_questions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_questions_open ON public.ticket_questions(ticket_id) WHERE answer IS NULL;

-- =============================================================================
-- 4. RLS for ticket_questions
-- =============================================================================
ALTER TABLE public.ticket_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_questions_select_member" ON public.ticket_questions
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "ticket_questions_insert_member" ON public.ticket_questions
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "ticket_questions_update_member" ON public.ticket_questions
  FOR UPDATE USING (public.is_workspace_member(workspace_id));

CREATE POLICY "ticket_questions_delete_member" ON public.ticket_questions
  FOR DELETE USING (public.is_workspace_member(workspace_id));
