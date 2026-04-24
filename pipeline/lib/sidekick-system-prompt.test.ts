import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  SIDEKICK_PROMPT_VERSION,
  SIDEKICK_PROMPT_EXAMPLES,
  SIDEKICK_SYSTEM_PROMPT,
  buildSidekickSystemPrompt,
  type SidekickPromptExample,
} from "./sidekick-system-prompt.ts";
import {
  SIDEKICK_REASONING_TOOLS,
  EXPERT_SKILLS,
  type SidekickReasoningToolName,
} from "./sidekick-reasoning-tools.ts";
import { FORBIDDEN_QUESTION_TOPICS } from "./sidekick-policy.ts";

/**
 * Snapshot + structural tests for the Sidekick reasoning-first system prompt.
 *
 * The prompt is treated as code: any intentional change must update the
 * snapshot AND bump SIDEKICK_PROMPT_VERSION. The CI fails if either side
 * drifts.
 *
 * The hash-based snapshot is used instead of `toMatchSnapshot()` so the
 * locked digest lives inline in the test file (reviewable in PRs without
 * digging into a `__snapshots__` directory) and so a forgotten version bump
 * is one diff away from the prompt edit itself.
 */

// ---------------------------------------------------------------------------
// Locked digest of the base prompt body. Update both when the prompt changes:
//   1. Bump SIDEKICK_PROMPT_VERSION in sidekick-system-prompt.ts
//   2. Replace LOCKED_PROMPT_DIGEST below with the new sha256
// The test failure on either side prints the new digest so the reviewer can
// see exactly what to paste back in.
// ---------------------------------------------------------------------------

const LOCKED_PROMPT_DIGEST = "v1:9ed4938718379ae8999b207a721aacda7d070ef0bffb96f86b16110bd447cf91";

function digest(text: string): string {
  return `${SIDEKICK_PROMPT_VERSION}:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

describe("sidekick-system-prompt", () => {
  describe("version stamp", () => {
    it("uses the v{N} format and is non-empty", () => {
      expect(SIDEKICK_PROMPT_VERSION).toMatch(/^v\d+$/);
    });
  });

  describe("snapshot lock", () => {
    it("base prompt digest matches the locked value (bump version + digest together)", () => {
      const actual = digest(SIDEKICK_SYSTEM_PROMPT);
      // Helpful failure: print the new digest so the reviewer can update both
      // the version constant and the locked digest in one commit.
      if (actual !== LOCKED_PROMPT_DIGEST) {
        // eslint-disable-next-line no-console
        console.error(
          [
            "",
            "Sidekick system prompt changed.",
            `  expected: ${LOCKED_PROMPT_DIGEST}`,
            `  actual:   ${actual}`,
            "",
            "If the change is intentional:",
            "  1. Bump SIDEKICK_PROMPT_VERSION in pipeline/lib/sidekick-system-prompt.ts",
            "  2. Replace LOCKED_PROMPT_DIGEST in pipeline/lib/sidekick-system-prompt.test.ts",
            "     with the actual digest above (reflects the new version + content).",
            "",
          ].join("\n"),
        );
      }
      expect(actual).toBe(LOCKED_PROMPT_DIGEST);
    });
  });

  describe("tool roster coverage", () => {
    it("renders every registered tool with its docstring in the prompt", () => {
      for (const tool of Object.values(SIDEKICK_REASONING_TOOLS)) {
        expect(SIDEKICK_SYSTEM_PROMPT).toContain(tool.name);
        // First sentence of each docstring (up to the first period) — covers
        // the case where the description gets line-wrapped without breaking.
        const firstSentence = tool.description.split(".")[0]!.trim();
        expect(SIDEKICK_SYSTEM_PROMPT).toContain(firstSentence);
      }
    });

    it("documents the create_project confirmation rule", () => {
      // T-876/T-879 + plan section 3.4: create_project is the single artifact
      // tool that requires explicit user confirmation. The prompt must say so.
      expect(SIDEKICK_SYSTEM_PROMPT).toContain("create_project");
      expect(SIDEKICK_SYSTEM_PROMPT).toContain("confirmed: true");
      expect(SIDEKICK_SYSTEM_PROMPT.toLowerCase()).toContain("project");
      // The rule must be near the autonomy clause — not buried in a corner.
      const autonomySection = SIDEKICK_SYSTEM_PROMPT.split("Autonomy rule")[1] ?? "";
      expect(autonomySection).toContain("create_project");
    });
  });

  describe("decision-authority enforcement (T-871)", () => {
    it("forbids implementation questions and lists at least one allowed business topic", () => {
      const allowed = SIDEKICK_SYSTEM_PROMPT.toLowerCase();
      expect(allowed).toContain("implementation question");
      expect(allowed).toContain("forbidden");
      // Allowed topics — at least the named axes from the policy module.
      expect(allowed).toContain("audience");
      expect(allowed).toContain("scope");
      expect(allowed).toContain("timing");
    });

    it("does not itself contain any canonical forbidden phrasing", () => {
      // The policy module's FORBIDDEN_QUESTION_TOPICS list uses `or`/`oder`
      // connectors (e.g. "modal or sheet", "kanban oder liste") — those are
      // the exact phrasings the runtime leak detector watches for. The prompt
      // body must never reproduce them verbatim, even as a teaching example,
      // because few-shot examples are training signals: a model that sees
      // "modal or sheet" once in its prompt is more likely to ask it back.
      //
      // The prompt's prose deliberately uses `vs` style ("modal vs sheet")
      // when describing the prohibition list, so this `<= 0` bound currently
      // holds. If a future editor copies a phrase verbatim from the policy
      // (e.g. as a "what NOT to do" example), this test fails immediately.
      const lower = SIDEKICK_SYSTEM_PROMPT.toLowerCase();
      for (const topic of FORBIDDEN_QUESTION_TOPICS) {
        const count = lower.split(topic).length - 1;
        expect(count, `forbidden topic "${topic}" appears ${count}× in the prompt body — must be 0 (policy phrases are training signals, never reproduce them verbatim)`).toBe(0);
      }
    });

    it("does not exemplify the `vs`-style implementation-question phrasings beyond the prohibition list", () => {
      // The prompt's prohibition prose lists banned topic categories using
      // `vs`-style connectors ("layout (modal vs sheet, kanban vs list, …)").
      // Each phrase appears EXACTLY ONCE there as part of the "never ask"
      // enumeration. A second occurrence would mean an example or reminder is
      // demonstrating the forbidden form — which is what teaches the leak.
      //
      // The list mirrors the canonical `vs` pairings used in the prompt's
      // "Implementation questions are forbidden" sentence. Adding new pairs
      // there means extending this list too.
      const VS_STYLE_FORBIDDEN_PHRASES = [
        "modal vs sheet",
        "modal vs bottom-sheet",
        "kanban vs list",
        "kanban vs liste",
        "sidebar vs topbar",
        "click vs hover",
        "swipe vs tap",
      ];
      const lower = SIDEKICK_SYSTEM_PROMPT.toLowerCase();
      for (const phrase of VS_STYLE_FORBIDDEN_PHRASES) {
        const count = lower.split(phrase).length - 1;
        expect(count, `vs-style forbidden phrase "${phrase}" appears ${count}× — must be at most 1 (allowed once in the prohibition prose, never in an example)`).toBeLessThan(2);
      }
    });
  });

  describe("role-address heuristics", () => {
    it("documents the build / analysis / question verb split", () => {
      const lower = SIDEKICK_SYSTEM_PROMPT.toLowerCase();
      expect(lower).toContain("build verb");
      expect(lower).toContain("analysis verb");
      expect(lower).toContain("question verb");
      expect(lower).toContain("role-address");
    });
  });

  describe("few-shot corpus", () => {
    it("contains at least 15 examples (AC requirement)", () => {
      expect(SIDEKICK_PROMPT_EXAMPLES.length).toBeGreaterThanOrEqual(15);
    });

    it("covers every tool at least once", () => {
      const seen = new Set<SidekickReasoningToolName>();
      for (const ex of SIDEKICK_PROMPT_EXAMPLES) {
        if (ex.tool) seen.add(ex.tool);
      }
      const allTools = Object.keys(SIDEKICK_REASONING_TOOLS) as SidekickReasoningToolName[];
      const missing = allTools.filter((t) => !seen.has(t));
      expect(missing, `tools without an example: ${missing.join(", ")}`).toEqual([]);
    });

    it("covers all three role-address verb buckets (build / analysis / question)", () => {
      // We require at least one example per bucket where the input starts with
      // a role address. This locks the section "same role, three different
      // tools" into the corpus, not just the prose.
      const roleAddressed = SIDEKICK_PROMPT_EXAMPLES.filter((ex) => /^(design lead|cto|backend|frontend|pm|product manager|data engineer|ux lead|creative director),/i.test(ex.input));
      const buckets = {
        build: roleAddressed.filter((ex) => ex.tool === "create_ticket" || ex.tool === "create_epic" || ex.tool === "create_project"),
        analysis: roleAddressed.filter((ex) => ex.tool === "run_expert_audit"),
        question: roleAddressed.filter((ex) => ex.tool === "consult_expert"),
      };
      expect(buckets.build.length, "missing role-address build example").toBeGreaterThan(0);
      expect(buckets.analysis.length, "missing role-address analysis example").toBeGreaterThan(0);
      expect(buckets.question.length, "missing role-address question example").toBeGreaterThan(0);
    });

    it("each example's expert_skill argument refers to a registered expert", () => {
      // For expert tools, the args sketch contains expert_skill: "<name>".
      // The named skill must exist in EXPERT_SKILLS.
      const expertTools = new Set<SidekickReasoningToolName>([
        "run_expert_audit",
        "consult_expert",
        "start_sparring",
      ]);
      for (const ex of SIDEKICK_PROMPT_EXAMPLES) {
        if (!ex.tool || !expertTools.has(ex.tool)) continue;
        // start_sparring uses an array of experts; audit and consult use one.
        const matches = [...ex.args_sketch.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]!);
        const namedExperts = matches.filter((m) => (EXPERT_SKILLS as readonly string[]).includes(m));
        expect(namedExperts.length, `${ex.tool} example "${ex.input.slice(0, 40)}…" must reference a known expert_skill`).toBeGreaterThan(0);
      }
    });

    it("renders example bodies into the system prompt verbatim", () => {
      // Locks the corpus into the prompt — adding an example to the array
      // alone is not enough; it must reach the prompt body. Sample the first
      // and last entries (both ends of the rendered block) plus a middle one.
      const samples: SidekickPromptExample[] = [
        SIDEKICK_PROMPT_EXAMPLES[0]!,
        SIDEKICK_PROMPT_EXAMPLES[Math.floor(SIDEKICK_PROMPT_EXAMPLES.length / 2)]!,
        SIDEKICK_PROMPT_EXAMPLES[SIDEKICK_PROMPT_EXAMPLES.length - 1]!,
      ];
      for (const ex of samples) {
        expect(SIDEKICK_SYSTEM_PROMPT).toContain(ex.input);
      }
    });
  });

  describe("buildSidekickSystemPrompt", () => {
    it("returns the base prompt unchanged when no context is supplied", () => {
      expect(buildSidekickSystemPrompt()).toBe(SIDEKICK_SYSTEM_PROMPT);
      expect(buildSidekickSystemPrompt({})).toBe(SIDEKICK_SYSTEM_PROMPT);
    });

    it("appends a per-turn context block when project name or page URL is provided", () => {
      const out = buildSidekickSystemPrompt({
        projectName: "Just Ship",
        projectType: "platform",
        pageUrl: "https://board.just-ship.io/tickets/T-986",
      });
      expect(out.startsWith(SIDEKICK_SYSTEM_PROMPT)).toBe(true);
      expect(out).toContain("Per-turn context");
      expect(out).toContain("Just Ship");
      expect(out).toContain("(platform)");
      expect(out).toContain("https://board.just-ship.io/tickets/T-986");
    });

    it("omits empty fields cleanly (no orphan headers)", () => {
      const out = buildSidekickSystemPrompt({ projectName: "Just Ship" });
      expect(out).not.toContain("Page URL:");
      expect(out).not.toContain("Page title:");
    });
  });
});
