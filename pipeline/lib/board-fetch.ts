// Board API helpers used by the local-mode CLI subcommands. The VPS path
// (`pipeline/server.ts`) has its own `fetchTicket` / `patchTicket` wrappers;
// these here are deliberately narrower — only what the local triggers need —
// and live in `pipeline/lib/` so `bun run pipeline/run.ts ...` can use them
// without pulling in the whole server runtime.

import { logger } from "./logger.ts";
import type { TicketArgs } from "./config.ts";

export interface BoardCredentials {
  apiUrl: string;
  apiKey: string;
}

export interface BoardTicketLite {
  number: number;
  title: string;
  body: string;
  tags: string[];
  status?: string;
  pipeline_status?: string | null;
  ticket_type?: string;
}

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch a ticket by number from the board API. Returns null on any failure
 * (network error, 4xx/5xx, malformed body, missing credentials). The caller
 * decides what to do with null — usually fall back to placeholder ticket data
 * so the pipeline can still run in standalone mode.
 */
export async function fetchTicketFromBoard(
  ticketNumber: string,
  credentials: BoardCredentials,
): Promise<BoardTicketLite | null> {
  const { apiUrl, apiKey } = credentials;
  if (!apiUrl || !apiKey) {
    logger.warn(
      { hasApiUrl: !!apiUrl, hasApiKey: !!apiKey },
      "Board credentials missing — skipping ticket fetch",
    );
    return null;
  }

  if (!/^\d+$/.test(ticketNumber)) {
    logger.error({ ticketNumber }, "Invalid ticket number for board fetch");
    return null;
  }

  try {
    const res = await fetch(`${apiUrl}/api/tickets/${ticketNumber}`, {
      headers: {
        "X-Pipeline-Key": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(
        { ticketNumber, status: res.status },
        "Board ticket fetch returned non-OK",
      );
      return null;
    }
    const json = (await res.json()) as { data?: Record<string, unknown> } | Record<string, unknown>;
    const raw = (("data" in json && json.data && typeof json.data === "object")
      ? (json.data as Record<string, unknown>)
      : (json as Record<string, unknown>));
    const number = Number(raw.number);
    if (!Number.isFinite(number)) return null;
    return {
      number,
      title: typeof raw.title === "string" ? raw.title : "",
      body: typeof raw.body === "string" ? raw.body : "",
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
      status: typeof raw.status === "string" ? raw.status : undefined,
      pipeline_status:
        typeof raw.pipeline_status === "string"
          ? raw.pipeline_status
          : raw.pipeline_status === null
            ? null
            : undefined,
      ticket_type: typeof raw.ticket_type === "string" ? raw.ticket_type : undefined,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), ticketNumber },
      "Board ticket fetch errored",
    );
    return null;
  }
}

/**
 * Convert a `BoardTicketLite` to the `TicketArgs` shape that `executePipeline`
 * consumes. Falls back to placeholder strings for missing fields so the
 * pipeline can still run.
 */
export function ticketArgsFromBoard(t: BoardTicketLite): TicketArgs {
  return {
    ticketId: String(t.number),
    title: t.title || `Ticket T-${t.number}`,
    description: t.body || "No description provided",
    labels: t.tags.join(","),
  };
}

/**
 * PATCH a ticket on the board. Best-effort — returns false on any failure but
 * never throws. Used by local ship/recover to keep board state in sync.
 */
export async function patchTicketOnBoard(
  ticketNumber: string,
  body: Record<string, unknown>,
  credentials: BoardCredentials,
): Promise<boolean> {
  const { apiUrl, apiKey } = credentials;
  if (!apiUrl || !apiKey) return false;
  try {
    const res = await fetch(`${apiUrl}/api/tickets/${ticketNumber}`, {
      method: "PATCH",
      headers: {
        "X-Pipeline-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(
        { ticketNumber, status: res.status },
        "Board ticket patch returned non-OK",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), ticketNumber },
      "Board ticket patch errored",
    );
    return false;
  }
}
