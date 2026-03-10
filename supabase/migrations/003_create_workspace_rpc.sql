-- 003_create_workspace_rpc.sql
-- Atomic workspace creation: insert workspace + add creator as owner in one transaction.
-- Runs as SECURITY DEFINER to bypass RLS (auth check done inside).

CREATE OR REPLACE FUNCTION public.create_workspace(ws_name TEXT, ws_slug TEXT)
RETURNS public.workspaces AS $$
DECLARE
  ws public.workspaces;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.workspaces (name, slug, created_by)
  VALUES (ws_name, ws_slug, auth.uid())
  RETURNING * INTO ws;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (ws.id, auth.uid(), 'owner');

  RETURN ws;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
