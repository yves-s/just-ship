"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Clock, MoreHorizontal, Send, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { sendInviteEmail } from "@/lib/actions/send-invite-email";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InviteMemberDialog } from "./invite-member-dialog";
import type { WorkspaceMember, WorkspaceInvite } from "@/lib/types";

interface MembersViewProps {
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  workspaceId: string;
  currentUserRole: string;
}

function getInitials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function MembersView({
  members,
  invites,
  workspaceId,
  currentUserRole,
}: MembersViewProps) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingInvites, setPendingInvites] =
    useState<WorkspaceInvite[]>(invites);
  const [cancelTarget, setCancelTarget] = useState<WorkspaceInvite | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const canManageInvites = currentUserRole === "owner" || currentUserRole === "admin";
  const pendingOnly = pendingInvites.filter((i) => !i.accepted_at);

  async function handleCancel(invite: WorkspaceInvite) {
    setActionLoading(invite.id);
    const supabase = createClient();

    const { error } = await supabase
      .from("workspace_invites")
      .delete()
      .eq("id", invite.id);

    setActionLoading(null);
    setCancelTarget(null);

    if (error) {
      toast.error("Failed to cancel invite", { description: error.message });
      return;
    }

    setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
    toast.success("Invite cancelled", {
      description: `Invite for ${invite.email} has been cancelled.`,
    });
  }

  async function handleResend(invite: WorkspaceInvite) {
    setActionLoading(invite.id);
    const supabase = createClient();

    const newToken = generateToken();
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 7);

    const { error } = await supabase
      .from("workspace_invites")
      .update({
        token: newToken,
        expires_at: newExpiry.toISOString(),
      })
      .eq("id", invite.id);

    if (error) {
      setActionLoading(null);
      toast.error("Failed to resend invite", { description: error.message });
      return;
    }

    // Update local state
    setPendingInvites((prev) =>
      prev.map((i) =>
        i.id === invite.id
          ? { ...i, token: newToken, expires_at: newExpiry.toISOString() }
          : i
      )
    );

    const result = await sendInviteEmail({
      email: invite.email,
      token: newToken,
      workspaceId,
    });

    setActionLoading(null);

    if (result.success) {
      toast.success("Invite resent", {
        description: `A new invite email has been sent to ${invite.email}.`,
      });
    } else {
      toast.warning("Invite updated but email could not be sent", {
        description: "The invite link has been renewed. Share it manually if needed.",
      });
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              People who have access to this workspace.
            </CardDescription>
          </div>
          {canManageInvites && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Invite
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-3 px-6 py-3"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs">
                    {getInitials(member.user_email ?? "?")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">
                    {member.user_email ?? "Unknown"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Joined {formatDate(member.joined_at)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground capitalize">
                  {ROLE_LABELS[member.role] ?? member.role}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {pendingOnly.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>
              These invites have not been accepted yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {pendingOnly.map((invite) => {
                const expired = isExpired(invite.expires_at);
                return (
                  <li
                    key={invite.id}
                    className="flex items-center gap-3 px-6 py-3"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      {expired ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col">
                      <span className="text-sm font-medium">{invite.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {expired ? "Expired" : "Expires"} {formatDate(invite.expires_at)}
                      </span>
                    </div>
                    {expired ? (
                      <span className="text-xs text-destructive font-medium">Expired</span>
                    ) : (
                      <span className="text-xs text-amber-600">Pending</span>
                    )}
                    {canManageInvites && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            disabled={actionLoading === invite.id}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleResend(invite)}
                            disabled={actionLoading === invite.id}
                          >
                            <Send className="h-4 w-4" />
                            Resend invite
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setCancelTarget(invite)}
                            disabled={actionLoading === invite.id}
                          >
                            <X className="h-4 w-4" />
                            Cancel invite
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel invite?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke the invite for{" "}
              <strong>{cancelTarget?.email}</strong>. They will no longer be able
              to join the workspace with this link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading === cancelTarget?.id}>
              Keep invite
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelTarget && handleCancel(cancelTarget)}
              disabled={actionLoading === cancelTarget?.id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading === cancelTarget?.id ? "Cancelling..." : "Cancel invite"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspaceId={workspaceId}
        onInvited={() => {
          router.refresh();
        }}
      />
    </div>
  );
}
