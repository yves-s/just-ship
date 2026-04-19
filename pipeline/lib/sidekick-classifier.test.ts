import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK BEFORE importing the classifier
const mockQueryYields: Array<unknown[]> = [];
let queryCallCount = 0;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    const idx = queryCallCount++;
    const messages = mockQueryYields[idx] ?? [];
    return (async function* () {
      for (const m of messages) yield m;
    })();
  }),
}));

import {
  classify,
  buildPrompt,
  parseResponse,
  applyConfidenceFallback,
  type ClassificationInput,
} from "./sidekick-classifier.ts";

beforeEach(() => {
  mockQueryYields.length = 0;
  queryCallCount = 0;
});

function mockResult(jsonString: string) {
  mockQueryYields.push([
    {
      type: "result",
      subtype: "success",
      duration_ms: 100,
      duration_api_ms: 50,
      is_error: false,
      num_turns: 1,
      result: jsonString,
      stop_reason: "end_turn",
      total_cost_usd: 0.001,
      usage: {},
      modelUsage: {},
      permission_denials: [],
    },
  ]);
}

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  it("includes the user input verbatim", () => {
    const prompt = buildPrompt({ text: "Add dark mode toggle to settings page" });
    expect(prompt).toContain("Add dark mode toggle to settings page");
  });

  it("includes the four category names", () => {
    const prompt = buildPrompt({ text: "anything" });
    expect(prompt).toContain("**ticket**");
    expect(prompt).toContain("**epic**");
    expect(prompt).toContain("**conversation**");
    expect(prompt).toContain("**project**");
  });

  it("includes the Decision Authority rule (business signals only)", () => {
    const prompt = buildPrompt({ text: "anything" });
    expect(prompt.toLowerCase()).toContain("business signals");
    expect(prompt.toLowerCase()).toContain("never weigh implementation signals");
  });

  it("includes project context when provided", () => {
    const prompt = buildPrompt({
      text: "anything",
      projectContext: { projectName: "just-ship", projectType: "framework" },
    });
    expect(prompt).toContain("just-ship");
    expect(prompt).toContain("framework");
  });

  it("includes existing tickets when provided", () => {
    const prompt = buildPrompt({
      text: "anything",
      projectContext: {
        existingTickets: [
          { number: 871, title: "Decision Authority" },
          { number: 875, title: "Sidekick Classifier" },
        ],
      },
    });
    expect(prompt).toContain("T-871: Decision Authority");
    expect(prompt).toContain("T-875: Sidekick Classifier");
  });

  it("instructs the model to output JSON only", () => {
    const prompt = buildPrompt({ text: "x" });
    expect(prompt.toLowerCase()).toContain("json");
  });
});

// ---------------------------------------------------------------------------
// parseResponse
// ---------------------------------------------------------------------------

describe("parseResponse", () => {
  it("parses a clean JSON response", () => {
    const result = parseResponse('{"category":"ticket","confidence":0.9,"reasoning":"clear bug fix"}');
    expect(result.category).toBe("ticket");
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toBe("clear bug fix");
  });

  it("tolerates code fences around JSON", () => {
    const raw = '```json\n{"category":"epic","confidence":0.85,"reasoning":"multi-screen feature"}\n```';
    const result = parseResponse(raw);
    expect(result.category).toBe("epic");
  });

  it("tolerates leading prose before JSON", () => {
    const raw = 'Here is my classification: {"category":"project","confidence":0.95,"reasoning":"new product"}';
    const result = parseResponse(raw);
    expect(result.category).toBe("project");
  });

  it("throws on missing JSON", () => {
    expect(() => parseResponse("just some prose, no JSON")).toThrow(/JSON object/);
  });

  it("throws on invalid category", () => {
    expect(() => parseResponse('{"category":"feature","confidence":0.9,"reasoning":"x"}')).toThrow(/invalid category/);
  });

  it("throws on out-of-range confidence", () => {
    expect(() => parseResponse('{"category":"ticket","confidence":1.5,"reasoning":"x"}')).toThrow(/invalid confidence/);
    expect(() => parseResponse('{"category":"ticket","confidence":-0.1,"reasoning":"x"}')).toThrow(/invalid confidence/);
  });

  it("throws on missing reasoning", () => {
    expect(() => parseResponse('{"category":"ticket","confidence":0.9}')).toThrow(/reasoning/);
  });

  it("caps reasoning at 500 chars", () => {
    const longReason = "x".repeat(1000);
    const result = parseResponse(JSON.stringify({ category: "ticket", confidence: 0.8, reasoning: longReason }));
    expect(result.reasoning.length).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// applyConfidenceFallback
// ---------------------------------------------------------------------------

describe("applyConfidenceFallback", () => {
  it("passes through high-confidence results unchanged", () => {
    const result = applyConfidenceFallback({ category: "ticket", confidence: 0.9, reasoning: "clear" });
    expect(result.category).toBe("ticket");
    expect(result.confidence).toBe(0.9);
    expect(result.fallback_applied).toBe(false);
  });

  it("forces conversation when confidence is below floor", () => {
    const result = applyConfidenceFallback({ category: "ticket", confidence: 0.5, reasoning: "ambiguous" });
    expect(result.category).toBe("conversation");
    expect(result.confidence).toBe(0.5); // preserved
    expect(result.fallback_applied).toBe(true);
    expect(result.reasoning).toContain("low-confidence fallback");
    expect(result.reasoning).toContain("ticket"); // original category mentioned
  });

  it("does not flag fallback when low-confidence result is already conversation", () => {
    const result = applyConfidenceFallback({ category: "conversation", confidence: 0.4, reasoning: "exploring" });
    expect(result.category).toBe("conversation");
    expect(result.fallback_applied).toBe(false);
  });

  it("treats exactly 0.7 as above the floor", () => {
    const result = applyConfidenceFallback({ category: "ticket", confidence: 0.7, reasoning: "borderline" });
    expect(result.category).toBe("ticket");
    expect(result.fallback_applied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classify — integration via mocked SDK, ≥12 example inputs across 4 categories
// ---------------------------------------------------------------------------

interface Example {
  name: string;
  input: ClassificationInput;
  modelSays: { category: "ticket" | "epic" | "conversation" | "project"; confidence: number; reasoning: string };
  expectedCategory: "ticket" | "epic" | "conversation" | "project";
}

const EXAMPLES: Example[] = [
  // --- TICKET (3) ---
  {
    name: "single bug report",
    input: { text: "The sidekick toggle on the board doesn't reopen after closing it once" },
    modelSays: { category: "ticket", confidence: 0.92, reasoning: "concrete bug, clear scope" },
    expectedCategory: "ticket",
  },
  {
    name: "single copy change",
    input: { text: "Change the empty-state text on the tickets page from 'Nothing here' to 'No tickets yet'" },
    modelSays: { category: "ticket", confidence: 0.95, reasoning: "single copy edit" },
    expectedCategory: "ticket",
  },
  {
    name: "small feature add to existing surface",
    input: { text: "Add a copy-link button next to each ticket title in the kanban view" },
    modelSays: { category: "ticket", confidence: 0.88, reasoning: "one button on existing screen" },
    expectedCategory: "ticket",
  },

  // --- EPIC (3) ---
  {
    name: "named feature spanning multiple screens",
    input: { text: "We need a Notifications system across the board — settings page, bell icon, email digest, and in-app inbox" },
    modelSays: { category: "epic", confidence: 0.93, reasoning: "named feature, multiple surfaces" },
    expectedCategory: "epic",
  },
  {
    name: "subsystem with several flows",
    input: { text: "Build out the Workspace billing feature — usage page, invoices, plan switcher, and payment-method management" },
    modelSays: { category: "epic", confidence: 0.9, reasoning: "billing subsystem with multiple flows" },
    expectedCategory: "epic",
  },
  {
    name: "we-need-X-in-Y phrasing",
    input: { text: "We need full keyboard navigation in the board — j/k for tickets, c for create, / for search, and shortcuts in detail view" },
    modelSays: { category: "epic", confidence: 0.87, reasoning: "multi-shortcut feature" },
    expectedCategory: "epic",
  },

  // --- CONVERSATION (3) ---
  {
    name: "exploration / sollen-wir",
    input: { text: "Should we maybe add some kind of analytics dashboard? I'm not sure if it's worth it yet" },
    modelSays: { category: "conversation", confidence: 0.88, reasoning: "exploring, no clear scope" },
    expectedCategory: "conversation",
  },
  {
    name: "vague direction question",
    input: { text: "What do you think about reworking how onboarding feels?" },
    modelSays: { category: "conversation", confidence: 0.82, reasoning: "open question, no scope" },
    expectedCategory: "conversation",
  },
  {
    name: "missing business context",
    input: { text: "I have an idea for something cool but I don't know how to describe it yet" },
    modelSays: { category: "conversation", confidence: 0.95, reasoning: "no concrete request" },
    expectedCategory: "conversation",
  },

  // --- PROJECT (3) ---
  {
    name: "new product name",
    input: { text: "I want to build Aime Coach — an AI accountability buddy app for therapists" },
    modelSays: { category: "project", confidence: 0.94, reasoning: "new product name, distinct audience" },
    expectedCategory: "project",
  },
  {
    name: "I-want-to-build-X new product",
    input: { text: "I want to build a new shopify analytics tool for fashion brands, separate from anything we have" },
    modelSays: { category: "project", confidence: 0.9, reasoning: "new product for new audience" },
    expectedCategory: "project",
  },
  {
    name: "new audience, new surface",
    input: { text: "Let's set up Just Ship Edu — a guided coding curriculum for high schoolers, totally separate workspace" },
    modelSays: { category: "project", confidence: 0.92, reasoning: "new product, new audience, separate workspace" },
    expectedCategory: "project",
  },
];

describe("classify (12+ examples, mocked SDK)", () => {
  for (const ex of EXAMPLES) {
    it(`classifies "${ex.name}" as ${ex.expectedCategory}`, async () => {
      mockResult(JSON.stringify(ex.modelSays));
      const result = await classify(ex.input);
      expect(result.category).toBe(ex.expectedCategory);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.reasoning.length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// classify — fallback + error paths
// ---------------------------------------------------------------------------

describe("classify (fallback + error paths)", () => {
  it("forces conversation when model returns low-confidence non-conversation", async () => {
    mockResult(JSON.stringify({ category: "ticket", confidence: 0.5, reasoning: "unsure" }));
    const result = await classify({ text: "hmm something about the page maybe" });
    expect(result.category).toBe("conversation");
    expect(result.fallback_applied).toBe(true);
    expect(result.confidence).toBe(0.5);
  });

  it("returns conversation fallback on parse failure", async () => {
    mockResult("not valid json at all");
    const result = await classify({ text: "anything" });
    expect(result.category).toBe("conversation");
    expect(result.confidence).toBe(0);
    expect(result.fallback_applied).toBe(true);
    expect(result.reasoning).toContain("parse error");
  });

  it("returns conversation fallback when SDK yields no result", async () => {
    mockQueryYields.push([]); // no messages
    const result = await classify({ text: "anything" });
    expect(result.category).toBe("conversation");
    expect(result.confidence).toBe(0);
    expect(result.fallback_applied).toBe(true);
    expect(result.reasoning).toContain("no output");
  });

  it("rejects empty input", async () => {
    await expect(classify({ text: "" })).rejects.toThrow(/non-empty/);
    await expect(classify({ text: "   " })).rejects.toThrow(/non-empty/);
  });
});
