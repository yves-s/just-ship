-- 001_core_tables.sql
-- Core schema for app.just-ship.io

-- =============================================================================
-- Workspaces (tenants)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.workspaces (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON public.workspaces(slug);

-- =============================================================================
-- Workspace Members
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  joined_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON public.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id);

-- =============================================================================
-- Workspace Invites
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  email         TEXT NOT NULL,
  invited_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  accepted_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ DEFAULT (now() + interval '7 days') NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_token ON public.workspace_invites(token);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON public.workspace_invites(email);

-- =============================================================================
-- API Keys (for pipeline auth)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.api_keys (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  key_prefix    TEXT NOT NULL,
  last_used_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON public.api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);

-- =============================================================================
-- Projects (scoped to workspace)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON public.projects(workspace_id);

-- =============================================================================
-- Tickets (scoped to workspace)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tickets (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id      UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  number            INTEGER NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  status            TEXT NOT NULL DEFAULT 'backlog'
                    CHECK (status IN ('backlog','ready_to_develop','in_progress','in_review','done','cancelled')),
  priority          TEXT DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high')),
  tags              TEXT[] DEFAULT '{}',
  project_id        UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  parent_ticket_id  UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  assignee_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  branch            TEXT,
  pipeline_status   TEXT CHECK (pipeline_status IS NULL OR pipeline_status IN ('queued','running','done','failed')),
  assigned_agents   TEXT[] DEFAULT '{}',
  summary           TEXT,
  test_results      TEXT,
  preview_url       TEXT,
  due_date          DATE,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_workspace ON public.tickets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tickets_workspace_status ON public.tickets(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_workspace_number ON public.tickets(workspace_id, number);
CREATE INDEX IF NOT EXISTS idx_tickets_project ON public.tickets(project_id);

-- =============================================================================
-- Ticket number auto-increment per workspace
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(MAX(number), 0) + 1 INTO NEW.number
  FROM public.tickets
  WHERE workspace_id = NEW.workspace_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_ticket_number ON public.tickets;
CREATE TRIGGER trg_set_ticket_number
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_ticket_number();

-- =============================================================================
-- Updated_at trigger (shared)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_workspaces') THEN
    CREATE TRIGGER set_updated_at_workspaces BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_projects') THEN
    CREATE TRIGGER set_updated_at_projects BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_tickets') THEN
    CREATE TRIGGER set_updated_at_tickets BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;
