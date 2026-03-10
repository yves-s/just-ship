-- 002_rls_policies.sql
-- Row Level Security for multi-tenant isolation

-- =============================================================================
-- Enable RLS on all tables
-- =============================================================================
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Helper: check if current user is a member of a workspace
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =============================================================================
-- Workspaces
-- =============================================================================
CREATE POLICY "workspace_select_member" ON public.workspaces
  FOR SELECT USING (public.is_workspace_member(id));

CREATE POLICY "workspace_insert_authenticated" ON public.workspaces
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "workspace_update_member" ON public.workspaces
  FOR UPDATE USING (public.is_workspace_member(id));

CREATE POLICY "workspace_delete_creator" ON public.workspaces
  FOR DELETE USING (created_by = auth.uid());

-- =============================================================================
-- Workspace Members
-- =============================================================================
CREATE POLICY "members_select_same_workspace" ON public.workspace_members
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members_insert_self" ON public.workspace_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "members_delete_member" ON public.workspace_members
  FOR DELETE USING (
    user_id = auth.uid()
    OR public.is_workspace_member(workspace_id)
  );

-- =============================================================================
-- Workspace Invites
-- =============================================================================
CREATE POLICY "invites_select_member" ON public.workspace_invites
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "invites_insert_member" ON public.workspace_invites
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "invites_delete_member" ON public.workspace_invites
  FOR DELETE USING (public.is_workspace_member(workspace_id));

-- =============================================================================
-- API Keys
-- =============================================================================
CREATE POLICY "api_keys_select_member" ON public.api_keys
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "api_keys_insert_member" ON public.api_keys
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "api_keys_update_member" ON public.api_keys
  FOR UPDATE USING (public.is_workspace_member(workspace_id));

-- =============================================================================
-- Projects
-- =============================================================================
CREATE POLICY "projects_select_member" ON public.projects
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "projects_insert_member" ON public.projects
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "projects_update_member" ON public.projects
  FOR UPDATE USING (public.is_workspace_member(workspace_id));

CREATE POLICY "projects_delete_member" ON public.projects
  FOR DELETE USING (public.is_workspace_member(workspace_id));

-- =============================================================================
-- Tickets
-- =============================================================================
CREATE POLICY "tickets_select_member" ON public.tickets
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "tickets_insert_member" ON public.tickets
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "tickets_update_member" ON public.tickets
  FOR UPDATE USING (public.is_workspace_member(workspace_id));

CREATE POLICY "tickets_delete_member" ON public.tickets
  FOR DELETE USING (public.is_workspace_member(workspace_id));
