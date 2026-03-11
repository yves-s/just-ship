import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");

  if (!slug) {
    return NextResponse.json({ error: "slug parameter required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Check if exact slug exists
  const { data: existing } = await supabase
    .from("workspaces")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ available: true });
  }

  // Find next available slug by checking slug, slug-2, slug-3, etc.
  // Query all workspaces matching the slug pattern
  const { data: similar } = await supabase
    .from("workspaces")
    .select("slug")
    .like("slug", `${slug}%`);

  const takenSlugs = new Set((similar ?? []).map((w) => w.slug));
  let suffix = 2;
  while (takenSlugs.has(`${slug}-${suffix}`)) {
    suffix++;
  }

  return NextResponse.json({
    available: false,
    suggestion: `${slug}-${suffix}`,
  });
}
