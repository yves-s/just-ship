import { describe, it, expect } from "vitest";
import { parseArgs } from "./cli-args.ts";
import { ticketArgsFromBoard } from "./board-fetch.ts";

/**
 * Unit tests for the local-mode CLI surface added in T-1060.
 *
 * What is covered here:
 *  - The subcommand parser (`parseArgs`) — recognises develop/ship/recover/resume,
 *    enforces --ticket, defaults --mode to local, accepts --worktree.
 *  - Backwards compat — the legacy positional CLI shape still parses.
 *  - The board-ticket → TicketArgs adapter — empty/partial board responses
 *    don't break the pipeline.
 *
 * What is intentionally NOT covered here:
 *  - The actual pipeline run (would require spinning up the SDK + a fake
 *    board API; that is a smoke-test concern, not a unit-test concern).
 *  - The board-fetch network path (tested via integration when available).
 */

describe("parseArgs — subcommand shape", () => {
  it("parses `develop --ticket=42 --mode=local`", () => {
    const r = parseArgs(["develop", "--ticket=42", "--mode=local"]);
    expect(r.kind).toBe("subcommand");
    if (r.kind !== "subcommand") return;
    expect(r.args.subcommand).toBe("develop");
    expect(r.args.ticketId).toBe("42");
    expect(r.args.mode).toBe("local");
    expect(r.args.worktree).toBeUndefined();
  });

  it("defaults --mode to local when omitted", () => {
    const r = parseArgs(["develop", "--ticket=7"]);
    expect(r.kind).toBe("subcommand");
    if (r.kind !== "subcommand") return;
    expect(r.args.mode).toBe("local");
  });

  it("accepts space-separated flags too: `--ticket 42 --mode local`", () => {
    const r = parseArgs(["develop", "--ticket", "42", "--mode", "local"]);
    expect(r.kind).toBe("subcommand");
    if (r.kind !== "subcommand") return;
    expect(r.args.ticketId).toBe("42");
    expect(r.args.mode).toBe("local");
  });

  it("captures --worktree", () => {
    const r = parseArgs([
      "develop",
      "--ticket=42",
      "--mode=local",
      "--worktree=/tmp/.worktrees/T-42",
    ]);
    expect(r.kind).toBe("subcommand");
    if (r.kind !== "subcommand") return;
    expect(r.args.worktree).toBe("/tmp/.worktrees/T-42");
  });

  it("recognises ship and recover subcommands", () => {
    const ship = parseArgs(["ship", "--ticket=1"]);
    expect(ship.kind).toBe("subcommand");
    if (ship.kind === "subcommand") {
      expect(ship.args.subcommand).toBe("ship");
    }
    const recover = parseArgs(["recover", "--ticket=2"]);
    expect(recover.kind).toBe("subcommand");
    if (recover.kind === "subcommand") {
      expect(recover.args.subcommand).toBe("recover");
    }
  });

  it("rejects subcommand without --ticket", () => {
    expect(() => parseArgs(["develop", "--mode=local"])).toThrow(/--ticket/);
  });

  it("rejects non-numeric ticket id", () => {
    expect(() => parseArgs(["develop", "--ticket=abc"])).toThrow(/numeric/);
  });

  it("rejects unknown --mode value", () => {
    expect(() => parseArgs(["develop", "--ticket=1", "--mode=clouds"])).toThrow(/local.*vps/);
  });

  it("requires --session-id and --answer for resume", () => {
    expect(() => parseArgs(["resume", "--ticket=1"])).toThrow(/session-id/);
    expect(() =>
      parseArgs(["resume", "--ticket=1", "--session-id=abc"]),
    ).toThrow(/session-id/);
    const r = parseArgs([
      "resume",
      "--ticket=1",
      "--session-id=abc",
      "--answer=continue please",
    ]);
    expect(r.kind).toBe("subcommand");
    if (r.kind !== "subcommand") return;
    expect(r.args.sessionId).toBe("abc");
    expect(r.args.answer).toBe("continue please");
  });
});

describe("parseArgs — legacy positional shape", () => {
  it("parses `<ticketId> <title> <description> <labels>`", () => {
    const r = parseArgs(["42", "Add login", "Body text", "feat,bug"]);
    expect(r.kind).toBe("legacy");
    if (r.kind !== "legacy") return;
    expect(r.ticket.ticketId).toBe("42");
    expect(r.ticket.title).toBe("Add login");
    expect(r.ticket.description).toBe("Body text");
    expect(r.ticket.labels).toBe("feat,bug");
  });

  it("requires at least ticketId + title", () => {
    expect(() => parseArgs(["42"])).toThrow();
  });

  it("uses defaults for missing description and labels", () => {
    const r = parseArgs(["42", "Just title"]);
    expect(r.kind).toBe("legacy");
    if (r.kind !== "legacy") return;
    expect(r.ticket.description).toBe("No description provided");
    expect(r.ticket.labels).toBe("");
  });

  it("rejects empty args", () => {
    expect(() => parseArgs([])).toThrow();
  });
});

describe("ticketArgsFromBoard adapter", () => {
  it("happy path: maps title/body/tags directly", () => {
    const out = ticketArgsFromBoard({
      number: 42,
      title: "Add login",
      body: "User story...",
      tags: ["feat", "auth"],
    });
    expect(out).toEqual({
      ticketId: "42",
      title: "Add login",
      description: "User story...",
      labels: "feat,auth",
    });
  });

  it("falls back to placeholders when title/body are empty", () => {
    const out = ticketArgsFromBoard({
      number: 7,
      title: "",
      body: "",
      tags: [],
    });
    expect(out.title).toBe("Ticket T-7");
    expect(out.description).toBe("No description provided");
    expect(out.labels).toBe("");
  });
});
