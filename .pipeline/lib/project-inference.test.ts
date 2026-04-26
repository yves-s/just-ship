import { describe, it, expect } from "vitest";
import {
  inferChildProject,
  classifyEpicScope,
  DEFAULT_JUST_SHIP_SIGNALS,
  type ProjectSignals,
} from "./project-inference.ts";

// Reference project set used by every signal test below. IDs are stable so
// the assertions don't have to thread them through.
const ENGINE_ID = "proj-engine";
const BOARD_ID = "proj-board";
const PROJECTS: ProjectSignals[] = [
  { id: ENGINE_ID, name: "just-ship", signals: [...DEFAULT_JUST_SHIP_SIGNALS.engine] },
  { id: BOARD_ID, name: "just-ship-board", signals: [...DEFAULT_JUST_SHIP_SIGNALS.board] },
];

describe("inferChildProject", () => {
  it("routes an engine-signal body to the engine project", () => {
    const result = inferChildProject({
      title: "Wire reasoning tools into terminal intent routing",
      body: "Update the reasoning tools in pipeline/lib/sidekick-reasoning-tools.ts so the /api/sidekick endpoint handles the new scenario.",
      projects: PROJECTS,
      defaultProjectId: null,
    });
    expect(result.projectId).toBe(ENGINE_ID);
    expect(result.reason).toBe("signal");
  });

  it("routes a board-signal body to the board project", () => {
    const result = inferChildProject({
      title: "Swimlane renders cross-project chip",
      body: "Update the Board UI: the Swimlane header gets a new chip component in src/components/board/",
      projects: PROJECTS,
      defaultProjectId: null,
    });
    expect(result.projectId).toBe(BOARD_ID);
    expect(result.reason).toBe("signal");
  });

  it("gives titles extra weight over body (2x multiplier)", () => {
    // Body has one engine signal ("agent"), title has one board signal.
    // Title weight (2x) wins.
    const result = inferChildProject({
      title: "Widget: close state",
      body: "The agent needs to handle this correctly",
      projects: PROJECTS,
      defaultProjectId: null,
    });
    expect(result.projectId).toBe(BOARD_ID);
    expect(result.reason).toBe("signal");
  });

  it("falls back to the default when no signals match", () => {
    const result = inferChildProject({
      title: "Improve copy",
      body: "The empty state text should be more friendly.",
      projects: PROJECTS,
      defaultProjectId: ENGINE_ID,
    });
    expect(result.projectId).toBe(ENGINE_ID);
    expect(result.reason).toBe("default");
  });

  it("returns null with no-signal-no-default reason when both are missing", () => {
    const result = inferChildProject({
      title: "Improve copy",
      body: "Something vague.",
      projects: PROJECTS,
      defaultProjectId: null,
    });
    expect(result.projectId).toBe(null);
    expect(result.reason).toBe("no-signal-no-default");
  });

  it("on a tie, falls back to default with tie-broken-by-default reason", () => {
    // One engine signal and one board signal — body has one of each.
    const result = inferChildProject({
      title: "",
      body: "Touches the agent and the Widget.",
      projects: PROJECTS,
      defaultProjectId: ENGINE_ID,
    });
    expect(result.projectId).toBe(ENGINE_ID);
    expect(result.reason).toBe("tie-broken-by-default");
  });

  it("does not match signal tokens inside other words (boundary check)", () => {
    // "agent" is an engine signal — "management" must not trigger it.
    const result = inferChildProject({
      title: "Management dashboard",
      body: "Build the management dashboard for users. Use Widget library.",
      projects: PROJECTS,
      defaultProjectId: null,
    });
    // The only real signal is "Widget" → board wins.
    expect(result.projectId).toBe(BOARD_ID);
  });

  it("handles regex metacharacters in signal tokens safely", () => {
    // Custom signals contain `.` and `()` — must be escaped.
    const projects: ProjectSignals[] = [
      { id: "p1", name: "p1", signals: ["v2.0", "foo()"] },
    ];
    expect(() =>
      inferChildProject({
        title: "",
        body: "This mentions v2.0 and foo() call",
        projects,
        defaultProjectId: null,
      }),
    ).not.toThrow();
    const r = inferChildProject({
      title: "",
      body: "This mentions v2.0 and foo() call",
      projects,
      defaultProjectId: null,
    });
    expect(r.projectId).toBe("p1");
    expect(r.reason).toBe("signal");
  });

  it("populates scores for every project, including zero-score ones", () => {
    const result = inferChildProject({
      title: "",
      body: "pure engine work on the pipeline",
      projects: PROJECTS,
      defaultProjectId: null,
    });
    expect(result.scores[ENGINE_ID]).toBeGreaterThan(0);
    expect(result.scores[BOARD_ID]).toBe(0);
  });

  it("prefers body over default when body has a strong signal", () => {
    // Default says engine, but body clearly names board-only artifacts.
    const result = inferChildProject({
      title: "New swimlane chip",
      body: "Add a cross-project chip to the Swimlane header in src/components/board/.",
      projects: PROJECTS,
      defaultProjectId: ENGINE_ID,
    });
    expect(result.projectId).toBe(BOARD_ID);
    expect(result.reason).toBe("signal");
  });
});

describe("classifyEpicScope", () => {
  it("returns single-project when all children share one project", () => {
    expect(classifyEpicScope([ENGINE_ID, ENGINE_ID, ENGINE_ID])).toBe("single-project");
  });

  it("returns cross-project when children span two projects", () => {
    expect(classifyEpicScope([ENGINE_ID, BOARD_ID, ENGINE_ID])).toBe("cross-project");
  });

  it("returns unresolved if any child has null project_id", () => {
    expect(classifyEpicScope([ENGINE_ID, null, BOARD_ID])).toBe("unresolved");
  });

  it("treats a single-child unresolved list as unresolved (not single-project)", () => {
    // If a lone child has no project, the caller cannot safely create it —
    // we surface it as unresolved so the caller handles it explicitly.
    expect(classifyEpicScope([null])).toBe("unresolved");
  });

  it("returns single-project for an empty list (no children to disagree)", () => {
    // Edge case — no children at all. Epic with zero children is allowed
    // server-side, but classifyEpicScope never sees this in the split flow.
    // Documenting the behaviour here so a regression is obvious.
    expect(classifyEpicScope([])).toBe("single-project");
  });
});
