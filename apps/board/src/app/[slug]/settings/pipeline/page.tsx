import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PipelineSettings } from "@/components/settings/pipeline-settings";

export default async function PipelineSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug, created_by, created_at, updated_at, vps_url, vps_api_key")
    .eq("slug", slug)
    .single();

  if (!workspace) redirect("/");

  // Extract vps_api_key before passing workspace to client component
  const { vps_api_key, ...workspaceWithoutKey } = workspace;

  return (
    <PipelineSettings
      workspace={workspaceWithoutKey as typeof workspaceWithoutKey & { vps_url: string | null }}
      currentApiKey={vps_api_key}
    />
  );
}
