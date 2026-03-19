import { createServiceClient } from "@/lib/supabase/service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AcceptInviteButton } from "./accept-invite-button";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: invite } = await supabase
    .from("workspace_invites")
    .select("*, workspace:workspaces(id, name, slug)")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!invite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Invalid invite</CardTitle>
            <CardDescription>
              This invite link is invalid or has expired. Please ask for a new
              invite.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const workspace = invite.workspace as { id: string; name: string; slug: string } | null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">You&apos;ve been invited</CardTitle>
          <CardDescription>
            You&apos;ve been invited to join{" "}
            <strong>{workspace?.name ?? "a workspace"}</strong>. Accept the invite to
            get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptInviteButton
            token={token}
            workspaceSlug={workspace?.slug ?? ""}
          />
        </CardContent>
      </Card>
    </div>
  );
}
