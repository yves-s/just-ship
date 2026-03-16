"use client";

import { useWorkspace } from "@/lib/workspace-context";
import { useDesktopNotifications } from "@/lib/hooks/use-desktop-notifications";

export function DesktopNotificationListener() {
  const workspace = useWorkspace();
  useDesktopNotifications(workspace.id, workspace.slug);
  return null;
}
