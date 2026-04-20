-- 005_sidekick_threads.sql
-- T-924 — Engine becomes Owner of Sidekick conversation + thread data.
--
-- Mirrors the Board-DB schema 1:1 for the four chat-history tables so the
-- Engine can serve the same Sidekick experience to both the Board widget
-- and the Terminal Sidekick.
--
-- Schema parity targets (verified against Board migrations 011_sidekick.sql,
-- 030_threads.sql, 036 image_urls, 037 ticket_id cascade):
--   - sidekick_conversations  (1:1)
--   - sidekick_messages       (1:1 incl. image_urls TEXT[], ticket_id SET NULL)
--   - threads                 (1:1 — 9 status enum, 6 classification enum, pending_questions JSONB)
--   - thread_messages         (1:1 — 3 roles, attachments/metadata JSONB)
--
-- Deliberate deviations from Board-DB (approved by CTO on Engine-Ownership
-- decision):
--   - workspace_id is a plain UUID column, not a FK. Engine-DB is single-tenant
--     from the DB's point of view; multi-tenancy is enforced at the Engine
--     endpoint layer (X-Pipeline-Key + optional Authorization: Bearer) —
--     matching the existing tickets/projects pattern in 004_enable_rls.sql.
--   - RLS = service_role full access + authenticated read. User-scoped writes
--     flow through Engine endpoints that carry a user bearer; endpoints do the
--     authZ check before calling Supabase with the service key.
--   - ticket_id references tickets(id) — Engine has its own tickets table
--     (migration 001), so the FK is preserved natively.
--
-- Run via: mcp__claude_ai_Supabase__apply_migration
-- Idempotent: safe to re-apply.

-- =============================================================================
-- Table: sidekick_conversations
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sidekick_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id   UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  title        TEXT,
  page_url     TEXT,
  page_title   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sidekick_conversations_user_project
  ON public.sidekick_conversations (user_id, project_id);

CREATE INDEX IF NOT EXISTS idx_sidekick_conversations_updated
  ON public.sidekick_conversations (updated_at DESC);

-- =============================================================================
-- Table: sidekick_messages
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sidekick_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.sidekick_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  context         JSONB,
  ticket_id       UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  search_results  JSONB,
  image_urls      TEXT[] DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sidekick_messages_conversation
  ON public.sidekick_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_sidekick_messages_with_images
  ON public.sidekick_messages (conversation_id, created_at)
  WHERE image_urls IS NOT NULL;

-- =============================================================================
-- Table: threads
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN (
                        'draft', 'waiting_for_input', 'ready_to_plan',
                        'planned', 'approved', 'in_progress',
                        'delivered', 'closed', 'parked'
                      )),
  classification    TEXT
                      CHECK (classification IN ('xs', 's', 'm', 'l', 'xl', 'status_query')),
  pending_questions JSONB DEFAULT '[]'::jsonb,
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_reminder_at  TIMESTAMPTZ,
  reminder_count    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_threads_project_status
  ON public.threads (project_id, status);

CREATE INDEX IF NOT EXISTS idx_threads_user
  ON public.threads (user_id);

-- =============================================================================
-- Table: thread_messages
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.thread_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('ceo', 'pm', 'system')),
  content     TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thread_messages_thread
  ON public.thread_messages (thread_id, created_at);

-- =============================================================================
-- Triggers: bump parent timestamps on child insert (1:1 with Board-DB behavior)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.bump_sidekick_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.sidekick_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sidekick_conversation_bump'
  ) THEN
    CREATE TRIGGER trg_sidekick_conversation_bump
      AFTER INSERT ON public.sidekick_messages
      FOR EACH ROW
      EXECUTE FUNCTION public.bump_sidekick_conversation_timestamp();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_thread_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.threads
  SET updated_at = now(), last_activity_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_thread_message_bump'
  ) THEN
    CREATE TRIGGER trg_thread_message_bump
      AFTER INSERT ON public.thread_messages
      FOR EACH ROW
      EXECUTE FUNCTION public.bump_thread_timestamp();
  END IF;
END;
$$;

-- =============================================================================
-- updated_at triggers (reuse shared update_updated_at() from migration 001)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_sidekick_conversations'
  ) THEN
    CREATE TRIGGER set_updated_at_sidekick_conversations
      BEFORE UPDATE ON public.sidekick_conversations
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_threads'
  ) THEN
    CREATE TRIGGER set_updated_at_threads
      BEFORE UPDATE ON public.threads
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Mirrors the tickets/projects pattern (migration 004): service_role full
-- access, authenticated read-only. User authZ happens at the Engine endpoint
-- layer via X-Pipeline-Key + optional user bearer — Supabase is only ever
-- called server-side with the service key.

ALTER TABLE public.sidekick_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidekick_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threads                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_messages        ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sidekick_conversations'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.sidekick_conversations
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sidekick_conversations'
      AND policyname = 'authenticated_read'
  ) THEN
    CREATE POLICY "authenticated_read" ON public.sidekick_conversations
      FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sidekick_messages'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.sidekick_messages
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sidekick_messages'
      AND policyname = 'authenticated_read'
  ) THEN
    CREATE POLICY "authenticated_read" ON public.sidekick_messages
      FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'threads'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.threads
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'threads'
      AND policyname = 'authenticated_read'
  ) THEN
    CREATE POLICY "authenticated_read" ON public.threads
      FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'thread_messages'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.thread_messages
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'thread_messages'
      AND policyname = 'authenticated_read'
  ) THEN
    CREATE POLICY "authenticated_read" ON public.thread_messages
      FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END;
$$;
