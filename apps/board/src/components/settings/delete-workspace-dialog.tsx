"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Workspace } from "@/lib/types";

interface DeleteWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
}

export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
}: DeleteWorkspaceDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const isConfirmed = confirmation === workspace.name;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setConfirmation("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleDelete() {
    if (!isConfirmed || isDeleting) return;

    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspace/${workspace.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body?.error?.message ?? "Failed to delete workspace. Please try again."
        );
        setIsDeleting(false);
        return;
      }

      // Redirect to home — workspace no longer exists
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete workspace</DialogTitle>
          <DialogDescription>
            This will permanently delete the workspace{" "}
            <span className="font-semibold text-foreground">
              &ldquo;{workspace.name}&rdquo;
            </span>{" "}
            and all its data, including projects, tickets, API keys, and
            members. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-name">
              Type <span className="font-semibold">{workspace.name}</span> to
              confirm
            </Label>
            <Input
              id="confirm-name"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={workspace.name}
              autoComplete="off"
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmed || isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
