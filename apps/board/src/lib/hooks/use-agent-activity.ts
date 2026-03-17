"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskEvent } from "@/lib/types";

const ACTIVITY_WINDOW_MS = 60_000; // 60 seconds for completed/failed events
const RUNNING_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours max for running agents (crash safety)
const INITIAL_LOAD_WINDOW_MS = 2 * 60 * 60 * 1000; // load last 2h on mount

interface AgentActivity {
  agent_type: string;
  event_type: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface ActiveAgent {
  ticket_id: string;
  agent_type: string;
  event_type: string;
  created_at: string;
  status: "running" | "completed" | "failed" | "log";
  metadata?: Record<string, unknown>;
}

function deriveStatus(eventType: string): "running" | "completed" | "failed" | "log" {
  const lower = eventType.toLowerCase();
  if (lower === "log") return "log";
  if (
    lower.includes("complet") ||
    lower.includes("done") ||
    lower.includes("finish")
  )
    return "completed";
  if (lower.includes("fail") || lower.includes("error")) return "failed";
  return "running";
}

/**
 * Tracks which tickets have recent agent activity (events within last 60s).
 * Subscribes to Supabase Realtime INSERT events on task_events.
 * Uses composite key (ticket_id::agent_type) to support multiple agents per ticket.
 */
export function useAgentActivity(workspaceId: string, ticketIds?: string[], doneTicketIds?: Set<string>) {
  // Map of "ticket_id::agent_type" → activity (supports multiple agents per ticket)
  const [activityMap, setActivityMap] = useState<
    Map<string, AgentActivity & { ticket_id: string }>
  >(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track ticket IDs that have ever received events (survives event expiry)
  const ticketsWithHistoryRef = useRef<Set<string>>(new Set());

  const isActive = useCallback(
    (ticketId: string) => {
      if (doneTicketIds?.has(ticketId)) return false;
      const now = Date.now();
      for (const [key, activity] of activityMap) {
        if (!key.startsWith(`${ticketId}::`)) continue;
        const status = deriveStatus(activity.event_type);
        const age = now - new Date(activity.created_at).getTime();
        if (status === "running" || status === "log" || age < ACTIVITY_WINDOW_MS) {
          return true;
        }
      }
      return false;
    },
    [activityMap, doneTicketIds]
  );

  const getActivity = useCallback(
    (ticketId: string): AgentActivity | null => {
      if (doneTicketIds?.has(ticketId)) return null;
      const now = Date.now();
      let latest: (AgentActivity & { ticket_id: string }) | null = null;
      for (const [key, activity] of activityMap) {
        if (!key.startsWith(`${ticketId}::`)) continue;
        const status = deriveStatus(activity.event_type);
        const age = now - new Date(activity.created_at).getTime();
        if (status === "running" || status === "log" || age < ACTIVITY_WINDOW_MS) {
          if (!latest || activity.created_at > latest.created_at) {
            latest = activity;
          }
        }
      }
      return latest;
    },
    [activityMap, doneTicketIds]
  );

  const activeAgents = useMemo((): ActiveAgent[] => {
    const now = Date.now();
    const result: ActiveAgent[] = [];
    for (const [, activity] of activityMap) {
      if (doneTicketIds?.has(activity.ticket_id)) continue;
      const status = deriveStatus(activity.event_type);
      const age = now - new Date(activity.created_at).getTime();
      // Running agents: show until replaced by completed/failed (or 2h crash safety TTL)
      // Completed/failed/tool_use: show for 60s
      if (status === "log" || status === "running" || age < ACTIVITY_WINDOW_MS) {
        result.push({
          ticket_id: activity.ticket_id,
          agent_type: activity.agent_type,
          event_type: activity.event_type,
          created_at: activity.created_at,
          status,
          metadata: activity.metadata,
        });
      }
    }
    return result;
  }, [activityMap, doneTicketIds]);

  // Load recent events on mount for initial state
  useEffect(() => {
    if (!ticketIds?.length) return;
    const supabase = createClient();
    const cutoff = new Date(Date.now() - INITIAL_LOAD_WINDOW_MS).toISOString();
    supabase
      .from("task_events")
      .select("*")
      .in("ticket_id", ticketIds)
      .or(`created_at.gte.${cutoff},event_type.eq.log`)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!data?.length) return;
        setActivityMap((prev) => {
          const next = new Map(prev);
          for (const event of data as TaskEvent[]) {
            ticketsWithHistoryRef.current.add(event.ticket_id);
            const key = event.event_type === "log"
              ? `${event.ticket_id}::log::${event.id}`
              : `${event.ticket_id}::${event.agent_type}`;
            next.set(key, {
              ticket_id: event.ticket_id,
              agent_type: event.agent_type,
              event_type: event.event_type,
              created_at: event.created_at,
              metadata: event.metadata,
            });
          }
          return next;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  useEffect(() => {
    const supabase = createClient();

    // Subscribe to new task_events
    const channel = supabase
      .channel("task-events-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_events",
        },
        (payload) => {
          const event = payload.new as TaskEvent;
          ticketsWithHistoryRef.current.add(event.ticket_id);
          const key = event.event_type === "log"
            ? `${event.ticket_id}::log::${event.id}`
            : `${event.ticket_id}::${event.agent_type}`;
          setActivityMap((prev) => {
            const next = new Map(prev);
            next.set(key, {
              ticket_id: event.ticket_id,
              agent_type: event.agent_type,
              event_type: event.event_type,
              created_at: event.created_at,
              metadata: event.metadata,
            });
            return next;
          });
        }
      )
      .subscribe();

    // Periodically clean up stale entries to trigger re-renders
    timerRef.current = setInterval(() => {
      setActivityMap((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [key, activity] of next) {
          if (activity.event_type === "log") continue;
          const status = deriveStatus(activity.event_type);
          const age = now - new Date(activity.created_at).getTime();
          // Running agents: keep until replaced by completed/failed, max 2h (crash safety)
          if (status === "running" && age < RUNNING_TTL_MS) continue;
          // Completed/failed/tool_use: expire after 60s
          if (status !== "running" && age < ACTIVITY_WINDOW_MS) continue;
          next.delete(key);
          changed = true;
        }
        return changed ? next : prev;
      });
    }, 10_000);

    return () => {
      supabase.removeChannel(channel);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [workspaceId]);

  const hasHadEvents = useCallback(
    (ticketId: string) => ticketsWithHistoryRef.current.has(ticketId),
    [] // ref is stable; consumers re-evaluate when activityMap changes
  );

  return { isActive, getActivity, activeAgents, hasHadEvents };
}
