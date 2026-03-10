"use client";

import dynamic from "next/dynamic";
import type { Ticket } from "@/lib/types";

const Board = dynamic(() => import("./board").then((m) => m.Board), {
  ssr: false,
});

interface BoardClientProps {
  initialTickets: Ticket[];
  workspaceId: string;
}

export function BoardClient({ initialTickets, workspaceId }: BoardClientProps) {
  return <Board initialTickets={initialTickets} workspaceId={workspaceId} />;
}
