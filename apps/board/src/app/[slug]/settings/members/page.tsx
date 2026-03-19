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

  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: membersData }, { data: invitesData }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("joined_at"),
    supabase
      .from("workspace_invites")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }),
  ]);

  const members = (membersData ?? []) as WorkspaceMember[];
  const currentMember = members.find((m) => m.user_id === user?.id);
  const currentUserRole = currentMember?.role ?? "member";

  return (
    <MembersView
      members={members}
      invites={(invitesData ?? []) as WorkspaceInvite[]}
      workspaceId={workspace.id}
      currentUserRole={currentUserRole}
    />
  );
}
