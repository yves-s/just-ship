"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CreateTicketDialog } from "@/components/tickets/create-ticket-dialog";
import type { Ticket } from "@/lib/types";

interface BoardHeaderProps {
  workspaceId: string;
}

export function BoardHeader({ workspaceId }: BoardHeaderProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function handleCreated(_ticket: Ticket) {
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between border-b px-3 sm:px-6 py-3 sm:py-4">
      <h1 className="text-sm font-semibold">Board</h1>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New ticket
      </Button>
      <CreateTicketDialog
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
        onCreated={handleCreated}
      />
    </div>
  );
}
