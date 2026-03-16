"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskEvent } from "@/lib/types";

const STORAGE_KEY = "notifications-enabled";

function getStoredPreference(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function setStoredPreference(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

function deriveNotificationType(
  eventType: string
): "completed" | "failed" | null {
  const lower = eventType.toLowerCase();
  if (
    lower.includes("complet") ||
    lower.includes("done") ||
    lower.includes("finish")
  )
    return "completed";
  if (lower.includes("fail") || lower.includes("error")) return "failed";
  return null;
}

export function useDesktopNotifications(
  workspaceId: string,
  workspaceSlug: string
) {
  const [enabled, setEnabledState] = useState(false);
  const [permissionState, setPermissionState] =
    useState<NotificationPermission>("default");
  const initialLoadDoneRef = useRef(false);

  // Initialize state from localStorage and browser permission
  useEffect(() => {
    setEnabledState(getStoredPreference());
    if (typeof Notification !== "undefined") {
      setPermissionState(Notification.permission);
    }
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    setStoredPreference(value);
  }, []);

  const requestPermission =
    useCallback(async (): Promise<NotificationPermission> => {
      if (typeof Notification === "undefined") return "denied";
      const result = await Notification.requestPermission();
      setPermissionState(result);
      if (result === "granted") {
        setEnabled(true);
      }
      return result;
    }, [setEnabled]);

  const sendNotification = useCallback(
    (title: string, body: string, ticketNumber?: number) => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      if (document.hasFocus()) return;

      const notification = new Notification(title, {
        body,
        icon: "/brand/logos/app-icon/app-icon-192.png",
        tag: ticketNumber ? `ticket-${ticketNumber}` : undefined,
      });

      if (ticketNumber) {
        notification.onclick = () => {
          window.focus();
          window.location.href = `/${workspaceSlug}/board?ticket=T-${ticketNumber}`;
          notification.close();
        };
      }
    },
    [workspaceSlug]
  );

  // Subscribe to task_events and fire notifications for completed/failed
  useEffect(() => {
    if (!enabled || permissionState !== "granted") return;

    const supabase = createClient();

    const channel = supabase
      .channel(`desktop-notifications-${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_events",
        },
        async (payload) => {
          if (!initialLoadDoneRef.current) return;

          const event = payload.new as TaskEvent;
          const notifType = deriveNotificationType(event.event_type);
          if (!notifType) return;

          // Resolve ticket number for the notification
          const { data: ticket } = await supabase
            .from("tickets")
            .select("number, title")
            .eq("id", event.ticket_id)
            .single();

          if (!ticket) return;

          const title =
            notifType === "completed"
              ? `T-${ticket.number} — Agent completed`
              : `T-${ticket.number} — Agent failed`;

          const message =
            (event.metadata?.message as string) ||
            `${event.agent_type} ${notifType === "completed" ? "finished successfully" : "encountered an error"}`;

          sendNotification(title, message, ticket.number);
        }
      )
      .subscribe();

    // Mark initial load as done after a short delay to skip any buffered events
    const timer = setTimeout(() => {
      initialLoadDoneRef.current = true;
    }, 2000);

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
      initialLoadDoneRef.current = false;
    };
  }, [workspaceId, enabled, permissionState, sendNotification]);

  return {
    enabled,
    setEnabled,
    permissionState,
    requestPermission,
  };
}
