import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectsSettingsView } from "@/components/settings/projects-settings-view";
import type { Project } from "@/lib/types";

export default async function ProjectsSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!workspace) redirect("/");

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("name");

  const boardUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  return (
    <ProjectsSettingsView
      projects={(projects ?? []) as Project[]}
      workspaceId={workspace.id}
      workspaceSlug={slug}
      boardUrl={boardUrl}
    />
  );
}
