"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  inviteMemberSchema,
  type InviteMemberInput,
} from "@/lib/validations/workspace";
import { sendInviteEmail } from "@/lib/actions/send-invite-email";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onInvited: () => void;
}

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  onInvited,
}: InviteMemberDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
  });

  async function onSubmit(data: InviteMemberInput) {
    setServerError(null);
    setInviteLink(null);
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();

    const token = generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const { error } = await supabase.from("workspace_invites").insert({
      workspace_id: workspaceId,
      email: data.email,
      invited_by: user?.id ?? null,
      token,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    onInvited();

    const result = await sendInviteEmail({
      email: data.email,
      token,
      workspaceId,
    });

    if (result.success) {
      reset();
      onOpenChange(false);
    } else {
      setInviteLink(result.inviteUrl);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      reset();
      setServerError(null);
      setInviteLink(null);
      setCopied(false);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {serverError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}
          {inviteLink && (
            <div className="flex flex-col gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <p>Invite created, but the email could not be sent. Share this link manually:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-amber-100 px-2 py-1 text-xs dark:bg-amber-900/40">
                  {inviteLink}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0"
                  onClick={copyLink}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@example.com"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => handleOpenChange(false)}
            >
              {inviteLink ? "Done" : "Cancel"}
            </Button>
            {!inviteLink && (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send invite"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
