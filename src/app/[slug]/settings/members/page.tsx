import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MembersView } from "@/components/settings/members-view";
import type { WorkspaceMember, WorkspaceInvite } from "@/lib/types";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!workspace) redirect("/");

  // Fetch members — join with auth.users via user_email stored on member or via a view
  const { data: membersData } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("joined_at");

  const { data: invitesData } = await supabase
    .from("workspace_invites")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <MembersView
      members={(membersData ?? []) as WorkspaceMember[]}
      invites={(invitesData ?? []) as WorkspaceInvite[]}
      workspaceId={workspace.id}
    />
  );
}
