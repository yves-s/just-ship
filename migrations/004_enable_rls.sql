-- 004_enable_rls.sql
-- Enable Row Level Security on projects and tickets tables
-- These were created in 001_create_tables.sql without RLS enabled.
-- The pipeline worker uses SUPABASE_SERVICE_KEY (service_role) which bypasses
-- RLS, so a service_role policy grants full access for pipeline operations.
-- Authenticated users get read access for Board/API usage.

-- =============================================================================
-- Enable RLS
-- =============================================================================

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Service role policies (pipeline worker, server, bot)
-- =============================================================================
-- The service_role bypasses RLS by default in Supabase, but explicit policies
-- ensure correct behavior if "bypass RLS" is ever revoked at the role level.

CREATE POLICY "service_role_all" ON public.projects
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON public.tickets
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =============================================================================
-- Authenticated user policies
-- =============================================================================
-- Authenticated users (Board UI, Sidekick) can read projects and tickets.
-- Write operations go through the pipeline (service_role) or Board API.

CREATE POLICY "authenticated_read_projects" ON public.projects
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_read_tickets" ON public.tickets
  FOR SELECT
  USING (auth.role() = 'authenticated');
