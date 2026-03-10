import { createClient } from "@/lib/supabase/server";
import { BoardHeader } from "@/components/board/board-header";
import { BoardClient } from "@/components/board/board-client";
import type { Ticket } from "@/lib/types";

export default async function BoardPage({
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

  const tickets: Ticket[] = [];

  if (workspace) {
    const { data } = await supabase
      .from("tickets")
      .select("*, project:projects(id, name, description, workspace_id, created_at, updated_at)")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });

    if (data) tickets.push(...(data as Ticket[]));
  }

  return (
    <>
      <BoardHeader workspaceId={workspace?.id ?? ""} />
      <BoardClient
        initialTickets={tickets}
        workspaceId={workspace?.id ?? ""}
      />
    </>
  );
}
