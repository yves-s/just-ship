import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { CommandPalette } from "@/components/shared/command-palette";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!workspace) redirect("/");

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .single();

  if (!member) redirect("/");

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name, slug, created_by, created_at, updated_at")
    .order("created_at");

  return (
    <WorkspaceProvider workspace={workspace}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          workspace={workspace}
          userEmail={user.email!}
          workspaces={workspaces ?? []}
        />
        <main className="relative flex flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
      <CommandPalette workspaceId={workspace.id} workspaceSlug={workspace.slug} />
    </WorkspaceProvider>
  );
}
