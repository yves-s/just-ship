"use client";

import { useDesktopNotifications } from "@/lib/hooks/use-desktop-notifications";
import { useWorkspace } from "@/lib/workspace-context";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, ShieldAlert } from "lucide-react";

export function NotificationSettings() {
  const workspace = useWorkspace();
  const { enabled, setEnabled, permissionState, requestPermission } =
    useDesktopNotifications(workspace.id, workspace.slug);

  const isSupported =
    typeof window !== "undefined" && "Notification" in window;

  if (!isSupported) {
    return (
      <div className="rounded-lg border p-6">
        <div className="flex items-start gap-3">
          <BellOff className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="font-medium">Notifications not supported</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your browser does not support desktop notifications.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {permissionState === "denied" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <h3 className="font-medium text-destructive">
                Notifications blocked
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                You have blocked notifications for this site. Please enable them
                in your browser settings to receive agent notifications.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="font-medium">Desktop Notifications</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Receive desktop notifications for ticket status changes and
                agent events. Notifications only appear when the board tab is
                not focused.
              </p>
            </div>
          </div>
          <Switch
            checked={enabled && permissionState === "granted"}
            onCheckedChange={(checked) => {
              if (checked && permissionState === "default") {
                requestPermission();
              } else {
                setEnabled(checked);
              }
            }}
            disabled={permissionState === "denied"}
          />
        </div>
      </div>

      {permissionState === "default" && !enabled && (
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Click the toggle above or the button to enable notifications. Your
              browser will ask for permission.
            </p>
            <Button variant="outline" size="sm" onClick={requestPermission}>
              Enable
            </Button>
          </div>
        </div>
      )}

      <div className="text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">
          You will be notified when:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>A ticket is ready for review</li>
          <li>A ticket is marked as done</li>
          <li>An agent completes work on a ticket</li>
          <li>An agent encounters an error</li>
        </ul>
        <p className="mt-3">
          Click on a notification to jump directly to the ticket in your board.
        </p>
      </div>
    </div>
  );
}
