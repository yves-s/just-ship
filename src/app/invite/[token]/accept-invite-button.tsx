"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

interface AcceptInviteButtonProps {
  token: string;
  workspaceSlug: string;
}

export function AcceptInviteButton({
  token,
  workspaceSlug,
}: AcceptInviteButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push(`/login?next=/invite/${token}`);
        return;
      }

      // Fetch the invite
      const { data: invite, error: inviteError } = await supabase
        .from("workspace_invites")
        .select("*")
        .eq("token", token)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (inviteError || !invite) {
        setError("This invite is invalid or has expired.");
        return;
      }

      // Add member to workspace
      const { error: memberError } = await supabase
        .from("workspace_members")
        .insert({
          workspace_id: invite.workspace_id,
          user_id: user.id,
          role: "member",
        });

      if (memberError && memberError.code !== "23505") {
        // 23505 = unique violation (already a member)
        setError(memberError.message);
        return;
      }

      // Mark invite as accepted
      await supabase
        .from("workspace_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);

      router.push(`/${workspaceSlug}/board`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button onClick={handleAccept} disabled={loading} className="w-full">
        {loading ? "Accepting…" : "Accept invite"}
      </Button>
    </div>
  );
}
