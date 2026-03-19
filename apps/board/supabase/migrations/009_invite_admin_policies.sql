-- 009_invite_admin_policies.sql
-- Restrict invite cancel/resend to workspace admins/owners
-- Add UPDATE policy for resend functionality

-- =============================================================================
-- Tighten DELETE policy: only admin/owner can cancel invites
-- =============================================================================
DROP POLICY IF EXISTS "invites_delete_member" ON public.workspace_invites;

CREATE POLICY "invites_delete_admin" ON public.workspace_invites
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- =============================================================================
-- Add UPDATE policy: only admin/owner can resend (update token/expires_at)
-- =============================================================================
CREATE POLICY "invites_update_admin" ON public.workspace_invites
  FOR UPDATE USING (public.is_workspace_admin(workspace_id));
