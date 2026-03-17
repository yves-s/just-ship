"use client";

import { Bot, CheckCircle2, XCircle, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActiveAgent } from "@/lib/hooks/use-agent-activity";
import type { Ticket } from "@/lib/types";

interface AgentPanelProps {
  activeAgents: ActiveAgent[];
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
  hasHadEvents: (ticketId: string) => boolean;
}

const STATUS_CONFIG = {
  running: {
    Icon: Loader2,
    className: "text-amber-500 animate-spin",
  },
  completed: {
    Icon: CheckCircle2,
    className: "text-emerald-500",
  },
  failed: {
    Icon: XCircle,
    className: "text-red-500",
  },
  log: {
    Icon: FileText,
    className: "text-blue-500",
  },
} as const;

const AGENT_TYPE_COLOR: Record<string, string> = {
  frontend: "bg-violet-100 text-violet-700",
  backend: "bg-sky-100 text-sky-700",
  qa: "bg-emerald-100 text-emerald-700",
  devops: "bg-orange-100 text-orange-700",
  "data-engineer": "bg-amber-100 text-amber-700",
  security: "bg-red-100 text-red-700",
  orchestrator: "bg-indigo-100 text-indigo-700",
  plan: "bg-purple-100 text-purple-700",
};

export function AgentPanel({
  activeAgents,
  tickets,
  onTicketClick,
  hasHadEvents,
}: AgentPanelProps) {
  // Tickets genuinely waiting to start: pipeline running/queued, no events ever
  const pendingTickets = tickets.filter(
    (t) =>
      t.status === "in_progress" &&
      (t.pipeline_status === "queued" || t.pipeline_status === "running") &&
      !activeAgents.some((a) => a.ticket_id === t.id) &&
      !hasHadEvents(t.id)
  );

  // Tickets where pipeline is running but between agent calls (events expired)
  const idleTickets = tickets.filter(
    (t) =>
      t.status === "in_progress" &&
      t.pipeline_status === "running" &&
      !activeAgents.some((a) => a.ticket_id === t.id) &&
      hasHadEvents(t.id)
  );

  // Tickets in progress without pipeline (manual / local work)
  const manualTickets = tickets.filter(
    (t) =>
      t.status === "in_progress" &&
      !t.pipeline_status &&
      !activeAgents.some((a) => a.ticket_id === t.id)
  );

  if (activeAgents.length === 0 && pendingTickets.length === 0 && idleTickets.length === 0 && manualTickets.length === 0) return null;

  return (
    <div className="border-b bg-muted/20 px-6 py-2.5">
      <div className="flex items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-medium text-muted-foreground">
          <Bot className="h-3.5 w-3.5" />
          <span>Agents</span>
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
            {activeAgents.length + pendingTickets.length + idleTickets.length + manualTickets.length}
          </span>
        </div>

        <div className="w-px h-4 bg-border shrink-0" />

        <div className="flex items-center gap-2">
          {activeAgents.map((agent) => {
            const ticket = tickets.find((t) => t.id === agent.ticket_id);
            const { Icon, className } = STATUS_CONFIG[agent.status];
            const typeColor =
              AGENT_TYPE_COLOR[agent.agent_type.toLowerCase()] ??
              "bg-slate-100 text-slate-600";

            return (
              <button
                key={`${agent.ticket_id}-${agent.agent_type}`}
                onClick={() => ticket && onTicketClick(ticket)}
                disabled={!ticket}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[11px] shrink-0",
                  "transition-shadow hover:shadow-sm",
                  ticket ? "cursor-pointer" : "cursor-default opacity-70"
                )}
              >
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0 text-[10px] font-semibold leading-4",
                    typeColor
                  )}
                >
                  {agent.agent_type}
                </span>
                {ticket && (
                  <span className="font-mono text-muted-foreground">
                    T-{ticket.number}
                  </span>
                )}
                {agent.status === "log" && !!agent.metadata?.message && (
                  <span className="text-muted-foreground truncate max-w-[200px]">
                    {String(agent.metadata!.message)}
                  </span>
                )}
                <Icon className={cn("h-3 w-3 shrink-0", className)} />
              </button>
            );
          })}
          {pendingTickets.map((ticket) => (
            <button
              key={`pending-${ticket.id}`}
              onClick={() => onTicketClick(ticket)}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] shrink-0 cursor-pointer transition-shadow hover:shadow-sm"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="font-mono text-muted-foreground">
                T-{ticket.number}
              </span>
              <span className="text-emerald-600">
                Pipeline wird gestartet...
              </span>
            </button>
          ))}
          {idleTickets.map((ticket) => (
            <button
              key={`idle-${ticket.id}`}
              onClick={() => onTicketClick(ticket)}
              className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] shrink-0 cursor-pointer transition-shadow hover:shadow-sm"
            >
              <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
              <span className="font-mono text-muted-foreground">
                T-{ticket.number}
              </span>
              <span className="text-amber-600">
                Pipeline läuft...
              </span>
            </button>
          ))}
          {manualTickets.map((ticket) => (
            <button
              key={`manual-${ticket.id}`}
              onClick={() => onTicketClick(ticket)}
              className="flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] shrink-0 cursor-pointer transition-shadow hover:shadow-sm"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="font-mono text-muted-foreground">
                T-{ticket.number}
              </span>
              <span className="text-emerald-600">
                In Bearbeitung
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
