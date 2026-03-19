import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectsSettingsView } from "@/components/settings/projects-settings-view";
import type { Project, WorkspaceMember } from "@/lib/types";

export interface ProjectWithStats extends Project {
  ticketStats: {
    open: number;
    done: number;
    total: number;
  };
}

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

  const wid = workspace.id;

  const [projectsResult, ticketsResult, apiKeyResult, membersResult, userResult] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("workspace_id", wid)
      .order("name"),
    supabase
      .from("tickets")
      .select("id, project_id, status")
      .eq("workspace_id", wid),
    supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", wid)
      .is("revoked_at", null),
    supabase
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", wid),
    supabase.auth.getUser(),
  ]);

  const projects = (projectsResult.data ?? []) as Project[];
  const tickets = ticketsResult.data ?? [];
  const hasApiKey = (apiKeyResult.count ?? 0) > 0;
  const workspaceMembers = (membersResult.data ?? []) as WorkspaceMember[];
  const currentUser = userResult.data.user;
  const currentMember = workspaceMembers.find((m) => m.user_id === currentUser?.id);
  const isAdmin = currentMember ? ["admin", "owner"].includes(currentMember.role) : false;

  // Aggregate ticket stats per project in a single pass
  const statsMap = new Map<string, { open: number; done: number }>();
  for (const ticket of tickets) {
    if (!ticket.project_id) continue;
    let entry = statsMap.get(ticket.project_id);
    if (!entry) {
      entry = { open: 0, done: 0 };
      statsMap.set(ticket.project_id, entry);
    }
    if (ticket.status === "done") {
      entry.done++;
    } else if (ticket.status !== "cancelled") {
      entry.open++;
    }
  }

  const projectsWithStats: ProjectWithStats[] = projects.map((project) => {
    const stats = statsMap.get(project.id) ?? { open: 0, done: 0 };
    return {
      ...project,
      ticketStats: {
        open: stats.open,
        done: stats.done,
        total: stats.open + stats.done,
      },
    };
  });

  const boardUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  return (
    <ProjectsSettingsView
      projects={projectsWithStats}
      workspaceId={workspace.id}
      workspaceSlug={slug}
      boardUrl={boardUrl}
      hasApiKey={hasApiKey}
      workspaceMembers={workspaceMembers}
      isAdmin={isAdmin}
    />
  );
}
