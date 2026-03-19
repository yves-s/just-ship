"use server";

import { resend } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

interface SendInviteEmailParams {
  email: string;
  token: string;
  workspaceId: string;
}

export async function sendInviteEmail({
  email,
  token,
  workspaceId,
}: SendInviteEmailParams): Promise<{ success: boolean; inviteUrl: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
  const inviteUrl = `${appUrl}/invite/${token}`;

  if (!resend) {
    return { success: false, inviteUrl };
  }

  const supabase = await createClient();

  const [{ data: userData }, { data: workspace }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("workspaces")
      .select("name")
      .eq("id", workspaceId)
      .single(),
  ]);

  const inviterEmail = userData?.user?.email ?? "A team member";
  const workspaceName = workspace?.name ?? "a workspace";

  const { error } = await resend.emails.send({
    from: `Just Ship <${process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"}>`,
    to: email,
    subject: `You've been invited to ${workspaceName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>You've been invited</h2>
        <p>${inviterEmail} invited you to join <strong>${workspaceName}</strong>.</p>
        <p>
          <a href="${inviteUrl}"
             style="display: inline-block; padding: 10px 20px; background: #171717; color: #fff; text-decoration: none; border-radius: 6px;">
            Accept invite
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          Or copy this link: ${inviteUrl}
        </p>
        <p style="color: #999; font-size: 12px;">This invite expires in 7 days.</p>
      </div>
    `,
  });

  if (error) {
    console.error("Failed to send invite email:", error);
    return { success: false, inviteUrl };
  }

  return { success: true, inviteUrl };
}
