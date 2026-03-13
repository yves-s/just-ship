import { supabase } from "./supabase.js";
import type { TelegramUser } from "./types.js";

export async function getAuthorizedUser(
  telegramUserId: number,
): Promise<TelegramUser | null> {
  const workspaceId = process.env.WORKSPACE_ID;

  const { data, error } = await supabase
    .from("telegram_users")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !data) return null;
  return data as TelegramUser;
}
