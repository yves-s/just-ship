import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApiKeysView } from "@/components/settings/api-keys-view";
import type { ApiKey } from "@/lib/types";

export default async function ApiKeysPage({
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

  const { data: apiKeys } = await supabase
    .from("api_keys")
    .select("*")
    .eq("workspace_id", workspace.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return (
    <ApiKeysView
      apiKeys={(apiKeys ?? []) as ApiKey[]}
      workspaceId={workspace.id}
    />
  );
}
