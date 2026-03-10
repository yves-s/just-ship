"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { createClient } from "@/lib/supabase/client";
import { BOARD_COLUMNS } from "@/lib/constants";
import type { TicketStatus } from "@/lib/constants";
import type { Ticket } from "@/lib/types";
import { BoardColumn } from "./board-column";
import { TicketCard } from "./ticket-card";
import { TicketDetailSheet } from "@/components/tickets/ticket-detail-sheet";

interface BoardProps {
  initialTickets: Ticket[];
  workspaceId: string;
}

export function Board({ initialTickets, workspaceId }: BoardProps) {
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  function getTicketsForColumn(status: TicketStatus): Ticket[] {
    return tickets.filter((t) => t.status === status);
  }

  function handleDragStart(event: DragStartEvent) {
    const ticket = tickets.find((t) => t.id === event.active.id);
    setActiveTicket(ticket ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTicket = tickets.find((t) => t.id === activeId);
    if (!activeTicket) return;

    // Determine the target column
    const targetStatus = BOARD_COLUMNS.find(
      (col) => col.status === overId
    )?.status;
    const overTicket = tickets.find((t) => t.id === overId);
    const targetCol = targetStatus ?? overTicket?.status;

    if (!targetCol || targetCol === activeTicket.status) return;

    setTickets((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, status: targetCol as TicketStatus } : t
      )
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTicket(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTicket = tickets.find((t) => t.id === activeId);
    if (!activeTicket) return;

    // Update in DB
    const supabase = createClient();
    supabase
      .from("tickets")
      .update({ status: activeTicket.status })
      .eq("id", activeId)
      .then(({ error }) => {
        if (error) {
          console.error("Failed to update ticket status:", error);
        }
      });

    // Handle reordering within same column
    if (activeId !== overId) {
      const overTicket = tickets.find((t) => t.id === overId);
      if (overTicket && overTicket.status === activeTicket.status) {
        setTickets((prev) => {
          const activeIndex = prev.findIndex((t) => t.id === activeId);
          const overIndex = prev.findIndex((t) => t.id === overId);
          return arrayMove(prev, activeIndex, overIndex);
        });
      }
    }
  }

  function handleTicketClick(ticket: Ticket) {
    setSelectedTicket(ticket);
    setSheetOpen(true);
  }

  function handleUpdated(updated: Ticket) {
    setTickets((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t))
    );
    setSelectedTicket(updated);
  }

  function handleDeleted(id: string) {
    setTickets((prev) => prev.filter((t) => t.id !== id));
    setSheetOpen(false);
    setSelectedTicket(null);
  }

  return (
    <>
      <div className="flex-1 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex h-full gap-4 p-6">
            {BOARD_COLUMNS.map((col) => (
              <BoardColumn
                key={col.status}
                status={col.status}
                label={col.label}
                tickets={getTicketsForColumn(col.status)}
                onTicketClick={handleTicketClick}
              />
            ))}
          </div>

          <DragOverlay>
            {activeTicket && (
              <TicketCard
                ticket={activeTicket}
                onClick={() => {}}
                isDragOverlay
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <TicketDetailSheet
        ticket={selectedTicket}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />
    </>
  );
}
