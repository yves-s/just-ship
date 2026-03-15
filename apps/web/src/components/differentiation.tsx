const painSteps = [
  {
    title: "Start with Cursor or Windsurf",
    description: "great for coding, but no workflow",
    highlight: null,
  },
  {
    title: "Add project management",
    description: "connect Notion or Linear via MCP",
    highlight: "MCPs are unstable. Notion's crashes constantly.",
  },
  {
    title: "Build your agents",
    description: "weeks of prompt engineering until they work reliably",
    highlight: null,
  },
  {
    title: "Create skills & workflows",
    description: "TDD, code review, design patterns... trial and error",
    highlight: null,
  },
  {
    title: "Want autonomous work?",
    description: "no board, no tracking, no pipeline",
    highlight: null,
  },
];

const solutionItems = [
  {
    title: "7 battle-tested agents",
    description: "optimized across real production projects, not tutorials",
  },
  {
    title: "17 proven skills",
    description: "TDD, debugging, code review, design, planning. Ready to use.",
  },
  {
    title: "Live Board included",
    description: "Kanban with real-time agent tracking. No Notion needed.",
  },
  {
    title: "Autonomous pipeline",
    description: "VPS worker processes tickets 24/7. Deploy and sleep.",
  },
  {
    title: "Portable",
    description: "install in any project, any stack. Config preserved on updates.",
  },
];

const competitors = [
  {
    name: "Cursor / Windsurf",
    badge: "IDE",
    tagline: "Helps you code",
    accent: false,
  },
  {
    name: "Devin",
    badge: "SAAS",
    tagline: "Proprietary, $500/mo",
    accent: false,
  },
  {
    name: "Claude Code",
    badge: "CLI",
    tagline: "Powerful, no workflow",
    accent: false,
  },
  {
    name: "just-ship",
    badge: "FRAMEWORK",
    tagline: "End-to-end autonomous",
    accent: true,
  },
];

export function Differentiation() {
  return (
    <section className="bg-brand-950 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-4 text-center text-3xl font-bold text-white sm:text-4xl">
          Every project. From scratch?
        </h2>
        <p className="mx-auto mb-16 max-w-xl text-center text-brand-400">
          Most AI tools help you code. None of them set up a production-grade
          autonomous workflow for you.
        </p>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Left column — The usual setup */}
          <div className="rounded-2xl border border-brand-800 bg-brand-900 p-8">
            <h3 className="mb-6 text-base font-semibold text-brand-400">
              The usual setup
            </h3>
            <ol className="flex flex-col gap-4">
              {painSteps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-xs font-bold text-brand-500">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-200">
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-sm text-brand-500">
                      {step.description}
                    </p>
                    {step.highlight && (
                      <p className="mt-1 text-xs font-semibold text-danger">
                        {step.highlight}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 rounded-[10px] border border-danger/15 bg-danger/5 p-3 text-center text-sm font-semibold text-danger">
              Repeat for every new project.
            </div>
          </div>

          {/* Right column — With just-ship */}
          <div
            className="rounded-2xl border border-accent/30 bg-brand-900 p-8"
            style={{
              background:
                "linear-gradient(180deg, rgba(59,130,246,0.04) 0%, transparent 100%)",
            }}
          >
            <h3 className="mb-6 text-base font-semibold text-accent">
              With just-ship
            </h3>
            <ul className="flex flex-col gap-4">
              {solutionItems.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-sm font-bold text-success">
                    ✓
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-200">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-sm text-brand-500">
                      {item.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-[10px] border border-accent/15 bg-accent/5 p-3 text-center">
              <code className="font-mono text-sm font-bold text-accent">
                ./setup.sh
              </code>
              <p className="mt-1 text-sm text-brand-400">
                One command. 60 seconds. Everything included.
              </p>
            </div>
          </div>
        </div>

        {/* Competitor chips */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          {competitors.map((c) => (
            <div
              key={c.name}
              className={`flex items-center gap-2.5 rounded-xl border px-5 py-2.5 text-sm ${
                c.accent
                  ? "border-accent/30 bg-accent/5"
                  : "border-brand-800 bg-brand-900"
              }`}
            >
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                  c.accent
                    ? "bg-accent text-white"
                    : "bg-brand-800 text-brand-500"
                }`}
              >
                {c.badge}
              </span>
              <span
                className={c.accent ? "font-semibold text-white" : "text-brand-300"}
              >
                {c.name}
              </span>
              <span className="text-brand-500">{c.tagline}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
