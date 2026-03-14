import type { Workspace } from "./types.js";

const BOARD_API_URL = process.env.BOARD_API_URL!;
const TELEGRAM_BOT_SECRET = process.env.TELEGRAM_BOT_SECRET!;

export async function getUserWorkspaces(
  telegramUserId: number,
): Promise<Workspace[] | null> {
  const url = `${BOARD_API_URL}/api/v1/telegram/workspaces?telegram_user_id=${telegramUserId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TELEGRAM_BOT_SECRET}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Board API error: ${response.status}`);
  }
  const data = await response.json();
  // Handle both array response and {workspaces: [...]} response
  return Array.isArray(data) ? data : (data.workspaces ?? data.data ?? []);
}
