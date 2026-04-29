// CLI argument parsing for `bun run pipeline/run.ts {develop|ship|recover|resume}`.
//
// Supports two shapes for backwards-compat with the legacy positional CLI:
//
//   Legacy (still supported, no subcommand):
//     bun run pipeline/run.ts <ticketId> <title> [description] [labels]
//
//   New (subcommand-driven, used by local /develop, /ship, /recover triggers):
//     bun run pipeline/run.ts develop --ticket=42 --mode=local [--worktree=/abs/path]
//     bun run pipeline/run.ts ship    --ticket=42 --mode=local
//     bun run pipeline/run.ts recover --ticket=42 --mode=local
//
// The parser is hand-rolled to avoid adding a new dependency. Flags accept
// both `--key=value` and `--key value`. All flags are optional except `--ticket`
// when a subcommand is used.

import { logger } from "./logger.ts";
import type { TicketArgs } from "./config.ts";

export type Subcommand = "develop" | "ship" | "recover" | "resume";
export type Mode = "local" | "vps";

export interface SubcommandArgs {
  subcommand: Subcommand;
  ticketId: string;        // Numeric string, e.g. "42"
  mode: Mode;              // "local" | "vps"
  worktree?: string;       // Absolute path to the worktree (local mode)
  // Resume-only:
  sessionId?: string;
  answer?: string;
}

export interface ParsedCliArgs {
  kind: "legacy";
  ticket: TicketArgs;
}

export interface ParsedSubcommandArgs {
  kind: "subcommand";
  args: SubcommandArgs;
}

export type CliArgs = ParsedCliArgs | ParsedSubcommandArgs;

const SUBCOMMANDS: ReadonlySet<string> = new Set(["develop", "ship", "recover", "resume"]);
const MODES: ReadonlySet<string> = new Set(["local", "vps"]);

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) {
      // --key=value
      const key = a.slice(2, eq);
      const value = a.slice(eq + 1);
      out[key] = value;
    } else {
      // --key value (or boolean flag)
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

/**
 * Parse CLI arguments. Returns either:
 *  - { kind: "legacy", ticket } for the historical positional shape, or
 *  - { kind: "subcommand", args } for the new subcommand-driven shape.
 *
 * Throws on validation errors.
 */
export function parseArgs(rawArgs: string[]): CliArgs {
  if (rawArgs.length === 0) {
    throw new Error(
      "Usage: pipeline/run.ts <subcommand> --ticket=<N> --mode=local [--worktree=<path>]\n" +
      "       pipeline/run.ts <ticketId> <title> [description] [labels]   (legacy)",
    );
  }

  const first = rawArgs[0];

  // ── Subcommand path ──
  if (SUBCOMMANDS.has(first)) {
    const subcommand = first as Subcommand;
    const flags = parseFlags(rawArgs.slice(1));

    const ticketId = flags.ticket ?? flags.ticketId ?? "";
    if (!ticketId) {
      throw new Error(
        `Subcommand "${subcommand}" requires --ticket=<N>. ` +
        `Got args: ${JSON.stringify(rawArgs)}`,
      );
    }
    if (!/^\d+$/.test(ticketId)) {
      throw new Error(
        `--ticket must be a numeric ticket id (e.g. --ticket=42). Got: "${ticketId}"`,
      );
    }

    const mode = (flags.mode ?? "local") as string;
    if (!MODES.has(mode)) {
      throw new Error(
        `--mode must be "local" or "vps". Got: "${mode}"`,
      );
    }

    const worktree = flags.worktree?.trim() || undefined;

    // Resume-specific
    const sessionId = flags["session-id"] ?? flags.sessionId;
    const answer = flags.answer;

    if (subcommand === "resume" && (!sessionId || !answer)) {
      throw new Error(
        `Subcommand "resume" requires --session-id=<id> and --answer="<text>"`,
      );
    }

    return {
      kind: "subcommand",
      args: {
        subcommand,
        ticketId,
        mode: mode as Mode,
        worktree,
        sessionId,
        answer,
      },
    };
  }

  // ── Legacy positional path ──
  const [ticketId, title, description, labels] = rawArgs;
  if (!ticketId || !title) {
    throw new Error(
      "Usage: run.ts <TICKET_ID> <TITLE> [DESCRIPTION] [LABELS]\n" +
      "  or: run.ts <subcommand> --ticket=<N> --mode=local [--worktree=<path>]",
    );
  }
  if (rawArgs.length > 4) {
    logger.warn(
      { argsLength: rawArgs.length },
      "Legacy CLI received more than 4 positional args — ignoring extras",
    );
  }
  return {
    kind: "legacy",
    ticket: {
      ticketId,
      title,
      description: description ?? "No description provided",
      labels: labels ?? "",
    },
  };
}
