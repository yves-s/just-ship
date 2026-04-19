import { describe, it, expect } from "vitest";
import {
  FORBIDDEN_QUESTION_TOPICS,
  ALLOWED_QUESTION_TOPICS,
  detectImplementationLeak,
} from "./sidekick-policy.ts";

// ---------------------------------------------------------------------------
// Static shape
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

  it("covers every category named in the T-879 skill policy", () => {
    const joined = FORBIDDEN_QUESTION_TOPICS.join(" ").toLowerCase();
    // Tech-Stack / Framework
    expect(joined).toMatch(/framework|stack/);
    // Datenbank
    expect(joined).toMatch(/database|postgres|sqlite/);
    // API-Design
    expect(joined).toMatch(/api shape|rest or graphql|endpoint/);
    // Hosting / Deployment
    expect(joined).toMatch(/hosting|deployment/);
    // Visual Design
    expect(joined).toMatch(/color|font/);
    // Layout / IA
    expect(joined).toMatch(/layout|navigation|sidebar|topbar/);
    // Component-Wahl
    expect(joined).toMatch(/modal|sheet|kanban|list|component library/);
    // Interaction
    expect(joined).toMatch(/interaction/);
    // Auth
    expect(joined).toMatch(/auth/);
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

  it("does not flag clean business questions", () => {
    const cleanCases = [
      "Für wen genau ist das — für User oder Admins?",
      "Muss das noch vor Launch stehen oder danach?",
      "Ist das eine Änderung oder mehrere zusammen?",
      "Soll das die bestehende Suche ersetzen oder daneben leben?",
      "Was merkt der User konkret, wenn das da ist?",
      "Is this replacing the old checkout or running alongside it?",
      "Who is the primary audience — end users or internal staff?",
    ];
    for (const msg of cleanCases) {
      const r = detectImplementationLeak(msg);
      expect(r.leak, `should not flag: ${msg}`).toBe(false);
    }
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
// Curated corpus — 20+ scenarios from T-879 AC
// ---------------------------------------------------------------------------

interface PolicyScenario {
  /** User-facing phrasing of the idea — what came into the Sidekick. */
  userInput: string;
  /** The tech/design question the Sidekick might be tempted to ask. Forbidden. */
  temptedToAsk: string;
  /** Short rationale for why this is forbidden — documents the expected expert. */
  delegatesTo: string;
}

const SCENARIOS: PolicyScenario[] = [
  // --- Tech stack / framework (3) ---
  {
    userInput: "Ich will eine Notifications-Seite bauen",
    temptedToAsk: "Welches Framework nehmen wir dafür — React oder Vue?",
    delegatesTo: "product-cto / frontend-design",
  },
  {
    userInput: "Wir brauchen einen Import-Flow für CSV",
    temptedToAsk: "Which stack should power the CSV parser?",
    delegatesTo: "product-cto / backend",
  },
  {
    userInput: "Kannst du ein kleines Dashboard bauen?",
    temptedToAsk: "React or Vue for the dashboard shell?",
    delegatesTo: "product-cto / frontend-design",
  },

  // --- Database / storage / caching (3) ---
  {
    userInput: "Wir brauchen eine History-Ansicht für Tickets",
    temptedToAsk: "Which database should we store the history in — Postgres or SQLite?",
    delegatesTo: "product-cto / data-engineer",
  },
  {
    userInput: "Kann der Sidekick sich an frühere Sessions erinnern?",
    temptedToAsk: "Which caching layer do you want for the session memory?",
    delegatesTo: "product-cto",
  },
  {
    userInput: "Füg bitte Search zur Kanban-Ansicht hinzu",
    temptedToAsk: "Postgres or SQLite for the search index?",
    delegatesTo: "data-engineer",
  },

  // --- Hosting / deployment / ops (2) ---
  {
    userInput: "Wir brauchen einen separaten Worker für lange Jobs",
    temptedToAsk: "Coolify or Vercel for the worker?",
    delegatesTo: "product-cto",
  },
  {
    userInput: "Kann man die App auch als PWA installieren?",
    temptedToAsk: "Which hosting do we target for the PWA build?",
    delegatesTo: "product-cto",
  },

  // --- API / auth (3) ---
  {
    userInput: "Externe Clients sollen Tickets lesen können",
    temptedToAsk: "Which API shape should we expose — REST or GraphQL?",
    delegatesTo: "backend",
  },
  {
    userInput: "Setup-Flow soll den User nicht auf eine zweite Seite schicken",
    temptedToAsk: "Which auth flow for inline sign-in?",
    delegatesTo: "backend",
  },
  {
    userInput: "Wir wollen Board-Events an Webhooks senden",
    temptedToAsk: "REST or GraphQL for the webhook delivery?",
    delegatesTo: "backend",
  },

  // --- Visual / typography / color (3) ---
  {
    userInput: "Der Preview-Badge soll auffälliger sein",
    temptedToAsk: "What colors should the badge use?",
    delegatesTo: "design-lead / frontend-design",
  },
  {
    userInput: "Mach bitte den Onboarding-Screen schöner",
    temptedToAsk: "Which font pairs well with the logo?",
    delegatesTo: "design-lead",
  },
  {
    userInput: "Die Kanban-Karten wirken etwas langweilig",
    temptedToAsk: "Which visual hierarchy do you want on the card?",
    delegatesTo: "design-lead",
  },

  // --- Layout / IA / navigation (4) ---
  {
    userInput: "Der Sidekick soll auch auf dem Handy gut funktionieren",
    temptedToAsk: "Modal or bottom-sheet for the mobile Sidekick?",
    delegatesTo: "design-lead / frontend-design",
  },
  {
    userInput: "Wir wollen die Tickets anders anzeigen können",
    temptedToAsk: "Kanban or list as the default view?",
    delegatesTo: "design-lead / ux-planning",
  },
  {
    userInput: "Die Navigation fühlt sich irgendwie klobig an",
    temptedToAsk: "Sidebar or topbar for the main nav?",
    delegatesTo: "design-lead",
  },
  {
    userInput: "Ich hätte gern einen Detail-View für Tickets",
    temptedToAsk: "Which layout works best for the detail view?",
    delegatesTo: "design-lead / frontend-design",
  },

  // --- Component library / interaction (2) ---
  {
    userInput: "Baus bitte mit konsistenten UI-Komponenten",
    temptedToAsk: "Which component library should we pick?",
    delegatesTo: "frontend-design",
  },
  {
    userInput: "Die Ticket-Aktionen sollen schneller greifbar sein",
    temptedToAsk: "Which interaction pattern — click-to-expand or hover?",
    delegatesTo: "design-lead",
  },

  // --- Implementation-framed user inputs that should stay business-scoped (2) ---
  {
    userInput: "Bau mir den Sidekick in React mit Postgres als DB",
    temptedToAsk: "Which framework is preferred — React or Next?",
    delegatesTo: "product-cto (classifier must IGNORE the user's stack hint)",
  },
  {
    userInput: "Lass uns das über einen Webhook lösen",
    temptedToAsk: "Which API shape for the webhook — REST or GraphQL?",
    delegatesTo: "backend (classifier must IGNORE the user's webhook framing)",
  },
];

describe("policy corpus — canonical forbidden phrasings are flagged", () => {
  it("has at least 20 scenarios (T-879 AC)", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20);
  });

  for (const sc of SCENARIOS) {
    it(`flags a tempted question for input "${sc.userInput.slice(0, 60)}…"`, () => {
      const r = detectImplementationLeak(sc.temptedToAsk);
      expect(
        r.leak,
        `expected leak detection on "${sc.temptedToAsk}" (delegates to: ${sc.delegatesTo})`,
      ).toBe(true);
      expect(r.matched.length).toBeGreaterThan(0);
    });
  }

  it("does NOT flag a user input just because it contains implementation words", () => {
    // This is the critical inverse: the detector runs on ASSISTANT questions,
    // not on USER inputs. A user saying "React" or "Postgres" in their idea
    // is fine — the classifier is instructed to ignore it. But we should not
    // rely on detectImplementationLeak to be *called* on user input. These
    // two assertions document that: the detector will happily flag a user
    // input if it's called with one (it's a pure substring check), so the
    // integration must only apply it to assistant-generated questions.
    const impLikeUser = "I want it built in React with Postgres";
    const result = detectImplementationLeak(impLikeUser);
    // Substring matcher does not key on these exact canonical forms, so a
    // pure stack-name mention in a user input is NOT flagged. That is the
    // right default: we only catch questions framed the canonical forbidden
    // way ("which framework", "postgres or sqlite", ...).
    expect(result.leak).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-file invariant: converse still exports the same list
// ---------------------------------------------------------------------------

describe("cross-file invariant", () => {
  it("sidekick-converse re-exports the same FORBIDDEN_QUESTION_TOPICS reference", async () => {
    // Ensure downstream consumers (test suites, server wiring) see a single
    // source of truth. If someone later clones the list in converse.ts, this
    // test breaks and they are forced to import from sidekick-policy.
    const converse = await import("./sidekick-converse.ts");
    expect(converse.FORBIDDEN_QUESTION_TOPICS).toBe(FORBIDDEN_QUESTION_TOPICS);
  });
});
