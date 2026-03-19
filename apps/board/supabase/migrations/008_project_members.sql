-- 008_project_members.sql
-- Project-level access control with dedicated project_members table

-- =============================================================================
-- Project Members
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.project_members (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  added_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON public.project_members(user_id);

-- =============================================================================
-- Helper: check if current user is a workspace admin
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =============================================================================
-- Helper: check if current user is a project member
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_project_member(proj_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = proj_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
    WHERE p.id = proj_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('admin', 'owner')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =============================================================================
-- Enable RLS on project_members
-- =============================================================================
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Project Members policies
-- =============================================================================
CREATE POLICY "project_members_select" ON public.project_members
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY "project_members_insert" ON public.project_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('admin', 'owner')
    )
  );

CREATE POLICY "project_members_delete" ON public.project_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('admin', 'owner')
    )
  );

-- =============================================================================
-- Updated Projects policies (admin-only modifications)
-- =============================================================================
DROP POLICY IF EXISTS "projects_select_member" ON public.projects;
CREATE POLICY "projects_select_member" ON public.projects
  FOR SELECT USING (public.is_project_member(id));

DROP POLICY IF EXISTS "projects_insert_member" ON public.projects;
CREATE POLICY "projects_insert_admin" ON public.projects
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "projects_update_member" ON public.projects;
CREATE POLICY "projects_update_admin" ON public.projects
  FOR UPDATE USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "projects_delete_member" ON public.projects;
CREATE POLICY "projects_delete_admin" ON public.projects
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- =============================================================================
-- Updated Tickets policies (respect project membership)
-- =============================================================================
DROP POLICY IF EXISTS "tickets_select_member" ON public.tickets;
CREATE POLICY "tickets_select_member" ON public.tickets
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND (project_id IS NULL OR public.is_project_member(project_id))
  );

DROP POLICY IF EXISTS "tickets_insert_member" ON public.tickets;
CREATE POLICY "tickets_insert_member" ON public.tickets
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (project_id IS NULL OR public.is_project_member(project_id))
  );

DROP POLICY IF EXISTS "tickets_update_member" ON public.tickets;
CREATE POLICY "tickets_update_member" ON public.tickets
  FOR UPDATE USING (
    public.is_workspace_member(workspace_id)
    AND (project_id IS NULL OR public.is_project_member(project_id))
  );

DROP POLICY IF EXISTS "tickets_delete_member" ON public.tickets;
CREATE POLICY "tickets_delete_member" ON public.tickets
  FOR DELETE USING (
    public.is_workspace_member(workspace_id)
    AND (project_id IS NULL OR public.is_project_member(project_id))
  );
