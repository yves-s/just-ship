"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, X, UserPlus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectMember, WorkspaceMember } from "@/lib/types";

interface ProjectMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  workspaceMembers: WorkspaceMember[];
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

export function ProjectMembersDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  workspaceMembers,
}: ProjectMembersDialogProps) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`);
      const json = await res.json();
      if (json.data) setMembers(json.data);
    } catch {
      setError("Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      fetchMembers();
      setError(null);
      setSelectedUserId("");
    }
  }, [open, fetchMembers]);

  const availableMembers = workspaceMembers.filter(
    (wm) => !members.some((pm) => pm.user_id === wm.user_id)
  );

  async function handleAdd() {
    if (!selectedUserId) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId }),
      });
      const json = await res.json();
      if (res.ok && json.data) {
        const wm = workspaceMembers.find((m) => m.user_id === selectedUserId);
        setMembers((prev) => [
          ...prev,
          { ...json.data, user_email: wm?.user_email },
        ]);
        setSelectedUserId("");
      } else {
        setError(json.error?.message || "Failed to add member");
      }
    } catch {
      setError("Failed to add member");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${userId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      } else {
        const json = await res.json();
        setError(json.error?.message || "Failed to remove member");
      }
    } catch {
      setError("Failed to remove member");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Members — {projectName}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Current members */}
        <div className="flex flex-col gap-1">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No members yet. Add workspace members to this project.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-xs">
                      {getInitials(member.user_email ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 flex-col min-w-0">
                    <span className="truncate text-sm">
                      {member.user_email ?? "Unknown"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added {formatDate(member.created_at)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(member.user_id)}
                    disabled={removingId === member.user_id}
                  >
                    {removingId === member.user_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add member */}
        {availableMembers.length > 0 && (
          <div className="flex items-center gap-2 border-t pt-3">
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select member..." />
              </SelectTrigger>
              <SelectContent>
                {availableMembers.map((wm) => (
                  <SelectItem key={wm.user_id} value={wm.user_id}>
                    {wm.user_email ?? wm.user_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!selectedUserId || adding}
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Add
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
