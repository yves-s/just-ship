"use client";

import { useState } from "react";
import { UserPlus, Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { InviteMemberDialog } from "./invite-member-dialog";
import type { WorkspaceMember, WorkspaceInvite } from "@/lib/types";

interface MembersViewProps {
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  workspaceId: string;
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

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function MembersView({
  members,
  invites,
  workspaceId,
}: MembersViewProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingInvites, setPendingInvites] =
    useState<WorkspaceInvite[]>(invites);

  const pendingOnly = pendingInvites.filter((i) => !i.accepted_at);

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
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Invite
          </Button>
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
              {pendingOnly.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center gap-3 px-6 py-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm font-medium">{invite.email}</span>
                    <span className="text-xs text-muted-foreground">
                      Expires {formatDate(invite.expires_at)}
                    </span>
                  </div>
                  <span className="text-xs text-amber-600">Pending</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspaceId={workspaceId}
        onInvited={() => {
          // Refresh invites list optimistically — parent can refetch via router.refresh()
        }}
      />
    </div>
  );
}
