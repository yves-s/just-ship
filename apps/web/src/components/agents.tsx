const agents = [
  {
    name: "Orchestrator",
    role: "Plans, delegates, and reviews the full ticket lifecycle",
    model: "Opus" as const,
    featured: true,
  },
  {
    name: "Backend",
    role: "API endpoints, business logic, shared hooks",
    model: "Sonnet" as const,
    featured: false,
  },
  {
    name: "Frontend",
    role: "UI components with high design quality",
    model: "Sonnet" as const,
    featured: false,
  },
  {
    name: "Data Engineer",
    role: "Migrations, RLS policies, schema changes",
    model: "Haiku" as const,
    featured: false,
  },
  {
    name: "DevOps",
    role: "Build checks, TypeScript compilation, lint fixes",
    model: "Haiku" as const,
    featured: false,
  },
  {
    name: "QA",
    role: "Acceptance criteria verification and tests",
    model: "Haiku" as const,
    featured: false,
  },
  {
    name: "Security",
    role: "Auth, RLS, input validation, secrets review",
    model: "Haiku" as const,
    featured: false,
  },
];

const modelBadge: Record<"Opus" | "Sonnet" | "Haiku", string> = {
  Opus: "bg-accent text-white",
  Sonnet: "bg-brand-700 text-brand-300",
  Haiku: "bg-brand-800 text-brand-400",
};

export function Agents() {
  const orchestrator = agents[0];
  const rest = agents.slice(1);

  return (
    <section className="bg-brand-950 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-16 text-center text-3xl font-bold text-white sm:text-4xl">
          Seven Agents. One Mission.
        </h2>

        {/* Orchestrator -- full width, highlighted */}
        <div className="mb-6 rounded-2xl border border-accent/30 bg-brand-900 p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-3">
                <h3 className="text-xl font-bold text-white">
                  {orchestrator.name}
                </h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${modelBadge[orchestrator.model]}`}
                >
                  {orchestrator.model}
                </span>
              </div>
              <p className="text-brand-400">{orchestrator.role}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-brand-500">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="text-accent"
              >
                <circle cx="8" cy="8" r="3" fill="currentColor" />
                <circle
                  cx="8"
                  cy="8"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  opacity="0.3"
                />
              </svg>
              Orchestrates all agents
            </div>
          </div>
        </div>

        {/* Specialist agents grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((agent) => (
            <div
              key={agent.name}
              className="rounded-2xl border border-brand-800 bg-brand-900 p-6"
            >
              <div className="mb-1 flex items-center gap-3">
                <h3 className="font-semibold text-white">{agent.name}</h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${modelBadge[agent.model]}`}
                >
                  {agent.model}
                </span>
              </div>
              <p className="text-sm text-brand-400">{agent.role}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
