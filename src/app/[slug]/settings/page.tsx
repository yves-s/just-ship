import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsGeneral } from "@/components/settings/settings-general";

export default async function SettingsPage({
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

  return <SettingsGeneral workspace={workspace} />;
}
