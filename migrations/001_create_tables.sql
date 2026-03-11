-- 001_create_tables.sql
-- Idempotent migration: creates projects and tickets tables for agentic-dev-pipeline
-- Run via: /setup-pipeline → mcp__claude_ai_Supabase__apply_migration

-- =============================================================================
-- Projects
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- =============================================================================
-- Tickets
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  number INTEGER GENERATED ALWAYS AS IDENTITY,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT DEFAULT 'medium',
  tags TEXT[] DEFAULT '{}',
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  parent_ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  branch TEXT,
  pipeline_status TEXT,
  assigned_agents TEXT[] DEFAULT '{}',
  summary TEXT,
  test_results TEXT,
  preview_url TEXT,
  due_date DATE,
  notion_page_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- =============================================================================
-- Updated_at trigger function (shared)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Triggers
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_projects'
  ) THEN
    CREATE TRIGGER set_updated_at_projects
      BEFORE UPDATE ON public.projects
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_tickets'
  ) THEN
    CREATE TRIGGER set_updated_at_tickets
      BEFORE UPDATE ON public.tickets
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;
