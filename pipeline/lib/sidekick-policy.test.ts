import { describe, it, expect } from "vitest";
import {
  FORBIDDEN_QUESTION_TOPICS,
  ALLOWED_QUESTION_TOPICS,
  detectImplementationLeak,
} from "./sidekick-policy.ts";
import {
  SIDEKICK_REASONING_TOOLS,
  type SidekickReasoningToolName,
} from "./sidekick-reasoning-tools.ts";

/**
 * Policy corpus for the reasoning-first Sidekick (T-980).
 *
 * The Sidekick is no longer a classifier — it picks one of seven tools by
 * reasoning about the user's verb and role address. This corpus encodes the
 * behaviour we actually want: the right tool is chosen, no implementation
 * question leaks on any tool's finalization path, and business questions
 * (audience, scope, timing, success criteria) are allowed.
 *
 * The old category-based corpus (four-bucket classifier) has been deleted —
 * it asserted a world that no longer exists.
 */

// ---------------------------------------------------------------------------
// Static shape — policy lists stay valid independently of the reasoning model
// ---------------------------------------------------------------------------

describe("sidekick-policy constants", () => {
  it("FORBIDDEN_QUESTION_TOPICS is a frozen non-empty list", () => {
    expect(Array.isArray(FORBIDDEN_QUESTION_TOPICS)).toBe(true);
    expect(FORBIDDEN_QUESTION_TOPICS.length).toBeGreaterThan(10);
    expect(Object.isFrozen(FORBIDDEN_QUESTION_TOPICS)).toBe(true);
  });

  it("ALLOWED_QUESTION_TOPICS is a frozen non-empty list", () => {
    expect(Array.isArray(ALLOWED_QUESTION_TOPICS)).toBe(true);
    expect(ALLOWED_QUESTION_TOPICS.length).toBeGreaterThan(3);
    expect(Object.isFrozen(ALLOWED_QUESTION_TOPICS)).toBe(true);
  });

  it("covers every implementation category the reasoning-first Sidekick must not leak", () => {
    // The categories mirror the enumeration in the Sidekick system prompt's
    // "Implementation questions are forbidden" sentence
    // (sidekick-system-prompt.ts) — if that prose grows a new category, this
    // test should grow too so the policy and the prompt never drift apart.
    const joined = FORBIDDEN_QUESTION_TOPICS.join(" ").toLowerCase();
    // Tech-Stack / Framework
    expect(joined).toMatch(/framework|stack/);
    // Datenbank / Storage
    expect(joined).toMatch(/database|postgres|sqlite/);
    // API-Design / Auth
    expect(joined).toMatch(/api shape|rest or graphql|endpoint/);
    expect(joined).toMatch(/auth/);
    // Hosting / Deployment
    expect(joined).toMatch(/hosting|deployment/);
    // Visual Design
    expect(joined).toMatch(/color|font/);
    // Layout / IA
    expect(joined).toMatch(/layout|navigation|sidebar|topbar/);
    // Component-Wahl / Interaction
    expect(joined).toMatch(/modal|sheet|kanban|list|component library/);
    expect(joined).toMatch(/interaction/);
    // Caching
    expect(joined).toMatch(/caching/);
  });
});

// ---------------------------------------------------------------------------
// detectImplementationLeak — edge cases
// ---------------------------------------------------------------------------

describe("detectImplementationLeak", () => {
  it("returns leak:false for empty or whitespace input", () => {
    expect(detectImplementationLeak("")).toEqual({ leak: false, matched: [] });
    expect(detectImplementationLeak("   ")).toEqual({ leak: false, matched: [] });
  });

  it("returns leak:false for non-string input", () => {
    expect(detectImplementationLeak(undefined as unknown as string)).toEqual({ leak: false, matched: [] });
    expect(detectImplementationLeak(null as unknown as string)).toEqual({ leak: false, matched: [] });
    expect(detectImplementationLeak(42 as unknown as string)).toEqual({ leak: false, matched: [] });
  });

  it("is case-insensitive", () => {
    const upper = detectImplementationLeak("WHICH FRAMEWORK should we use?");
    expect(upper.leak).toBe(true);
    expect(upper.matched).toContain("which framework");

    const mixed = detectImplementationLeak("Which Framework do you prefer?");
    expect(mixed.leak).toBe(true);
  });

  it("reports all matched topics, not just the first", () => {
    const r = detectImplementationLeak(
      "Which framework and which database? Modal or sheet for details?",
    );
    expect(r.leak).toBe(true);
    expect(r.matched).toEqual(expect.arrayContaining(["which framework", "which database", "modal or sheet"]));
    expect(r.matched.length).toBeGreaterThanOrEqual(3);
  });

  it("does not flag word-boundary false positives on legitimate creative questions", () => {
    // Sub-word false positives caught during T-879 review:
    //   "welche schrift" substring-matches inside "welche Schriftsteller"
    //   "welche farbe"   substring-matches inside "welche farbenfrohe"
    //   "welche farben"  substring-matches inside "welche Farbenpsychologie"
    // Those are legitimate creative / brand questions that belong to the CEO
    // (brand direction), NOT implementation. A naive includes() matcher
    // misclassifies them as leaks and pollutes the telemetry signal.
    const creativeButNotLeaky = [
      "Welche Schriftsteller haben dich inspiriert?",
      "Welche farbenfrohe Idee hast du dafür?",
      "Welche Farbenpsychologie findest du interessant?",
    ];
    for (const msg of creativeButNotLeaky) {
      const r = detectImplementationLeak(msg);
      expect(r.leak, `should not flag sub-word match: ${msg}`).toBe(false);
    }
  });

  it("requires a word boundary at the start of the match", () => {
    // If a topic is glued to a preceding word (no whitespace/punctuation),
    // it must not be treated as a match — that is a different token entirely.
    const r = detectImplementationLeak("Whichframework should we use?");
    expect(r.leak).toBe(false);
  });

  it("allows canonical plural / inflection suffixes (e.g. -s, -en)", () => {
    // Plurals of a forbidden root are still the same forbidden topic — we
    // accept a short inflection suffix so "which frameworks" still leaks.
    const pluralEn = detectImplementationLeak("Which frameworks should we use?");
    expect(pluralEn.leak).toBe(true);
    expect(pluralEn.matched).toContain("which framework");

    const pluralDe = detectImplementationLeak("Welche Farben sollen wir verwenden?");
    expect(pluralDe.leak).toBe(true);
    expect(pluralDe.matched).toContain("welche farbe");

    const colorsEn = detectImplementationLeak("Which colors for the badge?");
    expect(colorsEn.leak).toBe(true);
    expect(colorsEn.matched).toContain("which color");
  });
});

// ---------------------------------------------------------------------------
// Tool-selection corpus — reasoning-first scenarios
// ---------------------------------------------------------------------------

/**
 * A corpus scenario for the reasoning-first Sidekick. Each entry pairs a
 * user input with the tool the Sidekick should pick. We do not invoke the
 * LLM here — the Sidekick's actual tool-choice behaviour is verified by
 * `sidekick-system-prompt.test.ts` (few-shot corpus + structural invariants)
 * and by the runtime tests in `sidekick-reasoning-tools.test.ts`. What this
 * corpus pins down is the *policy*: for every (input, expected_tool) pair,
 *
 *   a) the forbidden finalization question paired with it MUST leak, and
 *   b) the business follow-up question paired with it MUST NOT leak.
 *
 * Together (a) + (b) assert that no matter which of the seven tools the
 * Sidekick picks, there is a crisp boundary between implementation leaks
 * (banned) and business questions (allowed) on that tool's finalization path.
 */
interface ToolCorpusScenario {
  /** The user's input — the trigger the Sidekick sees. */
  userInput: string;
  /** The tool the Sidekick should reach for. */
  expectedTool: SidekickReasoningToolName;
  /** A canonical forbidden question the Sidekick might be tempted to ask while
   * finalising this tool call. Must trigger `detectImplementationLeak`. */
  forbiddenFinalization: string;
  /** A canonical business question the Sidekick legitimately may ask while
   * finalising this tool call. Must NOT trigger `detectImplementationLeak`. */
  businessFollowUp: string;
  /** Short note for the reviewer — documents why this tool fits. */
  notes: string;
}

const TOOL_CORPUS: ToolCorpusScenario[] = [
  // --- create_ticket (3) — single concrete change ---
  {
    userInput: "Fix the typo in the header on /pricing — says 'recieve' instead of 'receive'.",
    expectedTool: "create_ticket",
    forbiddenFinalization: "Which framework should I target for the fix?",
    businessFollowUp: "Muss das noch vor dem nächsten Release raus oder ist es unkritisch?",
    notes: "Single concrete fix with a clear outcome → create_ticket.",
  },
  {
    userInput: "Füg bitte einen Copy-Link-Button zum Ticket-Header hinzu.",
    expectedTool: "create_ticket",
    forbiddenFinalization: "Welche Component Library nutzen wir für den Button?",
    businessFollowUp: "Wer genau braucht den Link — interne User oder auch Kunden?",
    notes: "Single feature add, well-scoped → create_ticket.",
  },
  {
    userInput: "Der Toggle im Settings-Sheet schließt sich nach Klick nicht mehr.",
    expectedTool: "create_ticket",
    forbiddenFinalization: "Modal or sheet for the settings UI going forward?",
    businessFollowUp: "Ist das ein Regression oder war das schon immer so?",
    notes: "Bug report on one component → create_ticket.",
  },

  // --- create_epic (2) — multi-part connected work ---
  {
    userInput: "Build notifications: bell icon, settings page, email digest, in-app inbox.",
    expectedTool: "create_epic",
    forbiddenFinalization: "Which database should store the digest history — Postgres or SQLite?",
    businessFollowUp: "Sollen alle vier Teile im ersten Rollout live gehen oder phasenweise?",
    notes: "User explicitly listed 4 connected pieces → create_epic with children.",
  },
  {
    userInput: "Wir brauchen Workspace-Billing: Pricing-Seite, Stripe, Plan-Limits, Customer-Portal.",
    expectedTool: "create_epic",
    forbiddenFinalization: "REST or GraphQL for the Stripe webhook endpoint?",
    businessFollowUp: "Ist das für MVP oder kommt das erst nach Public Beta?",
    notes: "Feature with several named subsystems → create_epic.",
  },

  // --- create_project (2) — genuinely new product / audience ---
  {
    userInput: "Ich will Aime Coach bauen — AI-Accountability-App für Therapeut:innen.",
    expectedTool: "create_project",
    forbiddenFinalization: "Which hosting should we target for the Aime deployment?",
    businessFollowUp: "Soll das ein eigenständiger Workspace sein oder im bestehenden mitlaufen?",
    notes: "New product, new audience → create_project (requires confirmed: true).",
  },
  {
    userInput: "Neues Shopify-Tool für Fashion-Brands — eigenes Produkt, anderer Markt.",
    expectedTool: "create_project",
    forbiddenFinalization: "Welches Framework nehmen wir — React oder Vue?",
    businessFollowUp: "Ist die Zielgruppe DTC-Brands oder auch klassische Retailer?",
    notes: "New audience + explicit 'eigenes Produkt' → create_project.",
  },

  // --- start_conversation_thread (2) — fuzzy / speculative direction ---
  {
    userInput: "Ich hab da eine Idee für besseres Onboarding, weiß aber noch nicht wie.",
    expectedTool: "start_conversation_thread",
    forbiddenFinalization: "Kanban or list for the onboarding progress view?",
    businessFollowUp: "Für welche User-Gruppe ist das — Trial-User, neue Teams oder beide?",
    notes: "Idea without clear scope → open a thread, don't speculate an artifact.",
  },
  {
    userInput: "Sollen wir vielleicht Analytics einbauen?",
    expectedTool: "start_conversation_thread",
    forbiddenFinalization: "Welches Caching-Layer für die Analytics-Events?",
    businessFollowUp: "Wofür soll das Analytics dienen — Produkt-Entscheidungen oder Kunden-Reporting?",
    notes: "Speculative 'sollen wir' → thread. Direction IS the question.",
  },

  // --- run_expert_audit (3) — analysis / review / consistency ---
  {
    userInput: "Design Lead, mach ein Audit der Mobile Experience auf dem Board.",
    expectedTool: "run_expert_audit",
    forbiddenFinalization: "Sidebar or topbar for the mobile nav while I audit?",
    businessFollowUp: "Auf welche Zielgruppe soll der Audit fokussieren — Power-User oder Einsteiger?",
    notes: "Role + analysis verb ('mach Audit') → audit. Findings first, tickets later.",
  },
  {
    userInput: "Backend, review die letzten Migrations auf Performance-Risiken.",
    expectedTool: "run_expert_audit",
    forbiddenFinalization: "Postgres or SQLite for the benchmark harness?",
    businessFollowUp: "Soll sich der Review auf Prod-Migrations beschränken oder auch Dev-Branches?",
    notes: "Role + 'review' → audit. Read-only specialist work.",
  },
  {
    userInput: "Schau dir die API-Endpoints in pipeline/server.ts an — sind die konsistent?",
    expectedTool: "run_expert_audit",
    forbiddenFinalization: "Which API shape do we prefer going forward — REST or GraphQL?",
    businessFollowUp: "Soll der Audit nur die Sidekick-Endpoints abdecken oder den kompletten Server?",
    notes: "'Schau dir X an' + consistency question → audit.",
  },

  // --- consult_expert (3) — knowledge / diagnosis questions ---
  {
    userInput: "CTO, wie denkst du über den aktuellen Pipeline-Aufbau?",
    expectedTool: "consult_expert",
    forbiddenFinalization: "Coolify or Vercel for the pipeline runners?",
    businessFollowUp: "Was ist dein Erfolgskriterium für 'aufgeräumter Aufbau' — Velocity, Kosten, Reliability?",
    notes: "Role + 'wie denkst du' → consult. User wants the expert's take.",
  },
  {
    userInput: "Design Lead, wie funktioniert unser Theme-System eigentlich?",
    expectedTool: "consult_expert",
    forbiddenFinalization: "Welche Farben sollen wir als neue Primary setzen?",
    businessFollowUp: "Brauchst du die Erklärung für neue Teammitglieder oder für eine Redesign-Diskussion?",
    notes: "'Wie funktioniert' = pure knowledge question → consult.",
  },
  {
    userInput: "Backend, warum hängt der Worker manchmal beim Polling?",
    expectedTool: "consult_expert",
    forbiddenFinalization: "Welcher Auth-Flow wäre der richtige für den Worker?",
    businessFollowUp: "Wie oft tritt das auf — bei jedem Run, unter Last oder nur sporadisch?",
    notes: "Diagnosis question ('warum') → consult; fix ticket comes after if needed.",
  },

  // --- start_sparring (2) — strategic thinking with multiple experts ---
  {
    userInput: "Lass uns durchdenken: eigene Mobile-App oder reicht eine PWA? Hol Design Lead und CTO dazu.",
    expectedTool: "start_sparring",
    forbiddenFinalization: "Which framework for the mobile build — React Native or Flutter?",
    businessFollowUp: "Für welche User-Segmente ist Mobile am kritischsten — Power-User oder neue Signups?",
    notes: "Strategic trade-off with named peers → sparring.",
  },
  {
    userInput: "Ich überlege, ob Analytics jetzt oder nach Launch kommt — Backend und Design Lead gemeinsam.",
    expectedTool: "start_sparring",
    forbiddenFinalization: "Welche Component Library für das Analytics-Dashboard?",
    businessFollowUp: "Was wäre für dich das klare Ja-Signal, Analytics JETZT zu bauen?",
    notes: "Trade-off discussion with multiple experts requested → sparring.",
  },

  // --- Role-address × verb disambiguation — Design Lead ---
  {
    userInput: "Design Lead, bau mal ein neues Empty-State-Pattern für /tickets.",
    expectedTool: "create_ticket",
    forbiddenFinalization: "Brauchen wir einen Empty-State oder nicht?",
    businessFollowUp: "Soll das Empty-State-Pattern für alle Listen gelten oder nur /tickets?",
    notes: "Role + BUILD verb ('bau mal') → create_ticket. Role is expertise hint, verb decides.",
  },
  {
    userInput: "Design Lead, ist das Empty-State auf /tickets konsistent mit dem Rest der App?",
    expectedTool: "run_expert_audit",
    forbiddenFinalization: "Which visual hierarchy should the empty state use?",
    businessFollowUp: "Sollen wir die Konsistenz-Prüfung auf /tickets beschränken oder auch /epics und /threads?",
    notes: "Same role, ANALYSIS verb ('ist das konsistent') → audit.",
  },
  {
    userInput: "Design Lead, was ist unser aktueller Empty-State-Standard eigentlich?",
    expectedTool: "consult_expert",
    forbiddenFinalization: "Welche Farbe soll der Empty-State-Illustration-Background haben?",
    businessFollowUp: "Brauchst du den Standard dokumentiert oder nur mündlich erklärt?",
    notes: "Same role, QUESTION verb ('was ist') → consult. Knowledge, no work.",
  },

  // --- Role-address × verb disambiguation — CTO ---
  {
    userInput: "CTO, bau einen Rate-Limiter vor die Chat-API.",
    expectedTool: "create_ticket",
    forbiddenFinalization: "Welches Caching nutzen wir für die Rate-Limiter-State?",
    businessFollowUp: "Gibt es ein akutes Limit, das uns jetzt drückt, oder ist das proaktiv?",
    notes: "Role + BUILD verb ('bau') → create_ticket.",
  },
  {
    userInput: "CTO, audit die Auth-Flows auf Security-Lücken.",
    expectedTool: "run_expert_audit",
    forbiddenFinalization: "Welcher Auth-Flow wäre am sichersten — OAuth oder Magic Link?",
    businessFollowUp: "Soll der Audit nur den Kunden-Flow abdecken oder auch interne Admin-Accounts?",
    notes: "Role + ANALYSIS verb ('audit') → run_expert_audit.",
  },
  {
    userInput: "CTO, warum nutzen wir eigentlich keinen Service Worker?",
    expectedTool: "consult_expert",
    forbiddenFinalization: "Welches Hosting unterstützt Service Worker am besten?",
    businessFollowUp: "Hast du konkrete User-Beschwerden im Kopf oder ist das mehr eine Zukunfts-Überlegung?",
    notes: "Role + QUESTION verb ('warum') → consult_expert.",
  },

  // --- Role-address × verb disambiguation — Backend ---
  {
    userInput: "Backend, füge einen POST /api/sidekick/feedback Endpoint hinzu.",
    expectedTool: "create_ticket",
    forbiddenFinalization: "REST or GraphQL for the feedback endpoint?",
    businessFollowUp: "Soll das Feedback anonym sein oder an den User gekoppelt?",
    notes: "Role + BUILD verb ('füge hinzu') → create_ticket.",
  },
  {
    userInput: "Backend, review alle Board-Event-Handler auf doppelte Writes.",
    expectedTool: "run_expert_audit",
    forbiddenFinalization: "Which database index should we add for dedup?",
    businessFollowUp: "Soll der Review auch historische Events abdecken oder nur neue?",
    notes: "Role + ANALYSIS verb ('review') → run_expert_audit.",
  },
  {
    userInput: "Backend, wie funktioniert der Retry-Mechanismus beim Worker?",
    expectedTool: "consult_expert",
    forbiddenFinalization: "Which caching layer should we use for retries — Redis or in-memory?",
    businessFollowUp: "Brauchst du das für ein konkretes Debugging oder generelle Übersicht?",
    notes: "Role + QUESTION verb ('wie funktioniert') → consult_expert.",
  },
];

describe("tool-selection corpus — reasoning-first (T-980)", () => {
  it("covers at least 20 scenarios (AC from ticket)", () => {
    expect(TOOL_CORPUS.length).toBeGreaterThanOrEqual(20);
  });

  it("exercises all seven tools from the reasoning-first roster", () => {
    const registryNames = Object.keys(SIDEKICK_REASONING_TOOLS) as SidekickReasoningToolName[];
    expect(registryNames.length).toBe(7);
    const seen = new Set<SidekickReasoningToolName>(TOOL_CORPUS.map((s) => s.expectedTool));
    const missing = registryNames.filter((t) => !seen.has(t));
    expect(missing, `tools without a corpus scenario: ${missing.join(", ")}`).toEqual([]);
  });

  it("every expectedTool refers to a tool that actually exists in the registry", () => {
    // Catches typos in the corpus — if a scenario points at a tool name that
    // doesn't exist, we want the test to fail loudly rather than silently
    // accepting phantom coverage.
    for (const sc of TOOL_CORPUS) {
      expect(
        Object.prototype.hasOwnProperty.call(SIDEKICK_REASONING_TOOLS, sc.expectedTool),
        `expectedTool "${sc.expectedTool}" missing from registry for input "${sc.userInput.slice(0, 40)}…"`,
      ).toBe(true);
    }
  });

  describe("role-address disambiguation — same role, three tools", () => {
    // The plan's central claim (section 3.4): role is expertise signal, verb
    // decides the tool. Locks the Design Lead × {build, analysis, question}
    // matrix into the corpus and repeats it for CTO and Backend.
    const rolePrefix = (input: string, role: string) =>
      new RegExp(`^${role}\\s*,`, "i").test(input);

    for (const role of ["Design Lead", "CTO", "Backend"]) {
      describe(role, () => {
        it(`has a ${role} + build-verb scenario → create_ticket|create_epic|create_project`, () => {
          const matches = TOOL_CORPUS.filter(
            (s) =>
              rolePrefix(s.userInput, role) &&
              (s.expectedTool === "create_ticket" ||
                s.expectedTool === "create_epic" ||
                s.expectedTool === "create_project"),
          );
          expect(
            matches.length,
            `no ${role} build-verb scenario found`,
          ).toBeGreaterThan(0);
        });

        it(`has a ${role} + analysis-verb scenario → run_expert_audit`, () => {
          const matches = TOOL_CORPUS.filter(
            (s) => rolePrefix(s.userInput, role) && s.expectedTool === "run_expert_audit",
          );
          expect(
            matches.length,
            `no ${role} analysis-verb scenario found`,
          ).toBeGreaterThan(0);
        });

        it(`has a ${role} + question-verb scenario → consult_expert`, () => {
          const matches = TOOL_CORPUS.filter(
            (s) => rolePrefix(s.userInput, role) && s.expectedTool === "consult_expert",
          );
          expect(
            matches.length,
            `no ${role} question-verb scenario found`,
          ).toBeGreaterThan(0);
        });
      });
    }
  });

  describe("implementation-leak detection — fires on each tool's finalization path", () => {
    // Every scenario pairs its tool with a canonical forbidden finalization
    // question. No matter which tool the Sidekick reaches for, if it draws
    // from the forbidden pool on its way to the tool call, we catch it.
    for (const sc of TOOL_CORPUS) {
      it(`[${sc.expectedTool}] flags the tempted finalization for "${sc.userInput.slice(0, 48)}…"`, () => {
        const r = detectImplementationLeak(sc.forbiddenFinalization);
        expect(
          r.leak,
          `expected leak on "${sc.forbiddenFinalization}" (tool: ${sc.expectedTool})`,
        ).toBe(true);
        expect(r.matched.length).toBeGreaterThan(0);
      });
    }

    it("covers every tool with at least one leak test", () => {
      // Defensive: make sure no tool is silently missing its leak-path assertion.
      const leakTestedTools = new Set<SidekickReasoningToolName>(TOOL_CORPUS.map((s) => s.expectedTool));
      const allTools = Object.keys(SIDEKICK_REASONING_TOOLS) as SidekickReasoningToolName[];
      for (const tool of allTools) {
        expect(
          leakTestedTools.has(tool),
          `tool ${tool} has no forbidden-finalization leak test`,
        ).toBe(true);
      }
    });
  });

  describe("business-question allowance — never flagged as leak", () => {
    for (const sc of TOOL_CORPUS) {
      it(`[${sc.expectedTool}] allows the business follow-up for "${sc.userInput.slice(0, 48)}…"`, () => {
        const r = detectImplementationLeak(sc.businessFollowUp);
        expect(
          r.leak,
          `business question wrongly flagged as leak: "${sc.businessFollowUp}" — matched: ${r.matched.join(", ")}`,
        ).toBe(false);
      });
    }

    it("canonical business-question axes stay allowed", () => {
      // Explicit allow-list from the system prompt: target audience, timing,
      // scope, replaces-vs-augments, success criteria, priority. These are the
      // axes the Sidekick IS allowed to probe — flagging any of them as a leak
      // would break the product's core interaction model.
      const canonicalBusinessQuestions = [
        // target audience
        "Für wen genau ist das — für User oder Admins?",
        "Who is the primary audience — end users or internal staff?",
        // timing / urgency
        "Muss das noch vor Launch stehen oder danach?",
        "Is this urgent or nice-to-have?",
        // scope boundary
        "Ist das eine Änderung oder mehrere zusammen?",
        "Should this cover just mobile or also desktop?",
        // replaces vs augments
        "Soll das die bestehende Suche ersetzen oder daneben leben?",
        "Is this replacing the old checkout or running alongside it?",
        // success criteria
        "Was merkt der User konkret, wenn das da ist?",
        "How would we know this is working after launch?",
        // priority
        "Wo priorisierst du das — vor oder nach dem Billing-Epic?",
      ];
      for (const q of canonicalBusinessQuestions) {
        const r = detectImplementationLeak(q);
        expect(
          r.leak,
          `business-axis question wrongly flagged: "${q}" — matched: ${r.matched.join(", ")}`,
        ).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-file invariant: converse still re-exports the same list
// ---------------------------------------------------------------------------

describe("cross-file invariant", () => {
  it("sidekick-converse re-exports the same FORBIDDEN_QUESTION_TOPICS reference", async () => {
    // Downstream consumers (chat endpoint, telemetry) import from converse for
    // historical reasons. If someone later clones the list in converse.ts, this
    // test breaks and they are forced to import from sidekick-policy directly.
    const converse = await import("./sidekick-converse.ts");
    expect(converse.FORBIDDEN_QUESTION_TOPICS).toBe(FORBIDDEN_QUESTION_TOPICS);
  });
});
