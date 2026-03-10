import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("slug")
    .order("created_at")
    .limit(1);

  if (workspaces && workspaces.length > 0) {
    redirect(`/${workspaces[0].slug}/board`);
  }

  redirect("/new-workspace");
}
