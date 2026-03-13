-- 002_telegram_users.sql
-- Maps Telegram users to workspace members for bot authentication
-- Run via: mcp__claude_ai_Supabase__apply_migration

-- =============================================================================
-- Telegram Users
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  telegram_username TEXT,
  workspace_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(telegram_user_id, workspace_id)
);

-- RLS
ALTER TABLE public.telegram_users ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Service role (bot) can authenticate any telegram user
-- No select permission for regular users (authentication is service-role only)
CREATE POLICY "Service role can read all telegram users"
ON public.telegram_users FOR SELECT
USING (auth.role() = 'service_role');

CREATE POLICY "Service role can insert telegram users"
ON public.telegram_users FOR INSERT
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update telegram users"
ON public.telegram_users FOR UPDATE
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
