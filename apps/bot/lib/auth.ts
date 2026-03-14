import { getUserWorkspaces } from "./boardApi.js";
import type { Workspace } from "./types.js";

export async function getAuthorizedUser(
  telegramUserId: number,
): Promise<Workspace[] | null> {
  return await getUserWorkspaces(telegramUserId);
}
