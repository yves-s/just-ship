const frameworkSkills = [
  { name: "ticket-writer", desc: "Structured tickets for bugs, features, and improvements" },
  { name: "frontend-design", desc: "UI components with design system consistency" },
  { name: "creative-design", desc: "Bold, distinctive UIs for greenfield work" },
  { name: "ux-planning", desc: "User flows, screen inventory, information architecture" },
  { name: "backend", desc: "API endpoints, business logic, validation" },
  { name: "data-engineer", desc: "Migrations, RLS policies, schema changes" },
  { name: "design", desc: "Visual and UX decisions, design system enforcement" },
  { name: "webapp-testing", desc: "Visual verification via Playwright" },
];

const superpowers = [
  { name: "brainstorming", desc: "Explore intent and requirements before building" },
  { name: "test-driven-development", desc: "Write tests first, then implementation" },
  { name: "systematic-debugging", desc: "Root-cause analysis before proposing fixes" },
  { name: "writing-plans", desc: "Architecture specs for multi-step tasks" },
  { name: "executing-plans", desc: "Execute plans with review checkpoints" },
  { name: "verification-before-completion", desc: "Prove it works before claiming done" },
  { name: "code-review", desc: "Automated review against plan and standards" },
  { name: "parallel-agents", desc: "Parallelize independent tasks across agents" },
  { name: "git-worktrees", desc: "Isolated feature branches with smart cleanup" },
];

export function Skills() {
  return (
    <section id="skills" className="bg-brand-900 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-4 text-center text-3xl font-bold text-white sm:text-4xl">
          Battle-tested Workflows
        </h2>
        <p className="mx-auto mb-16 max-w-xl text-center text-brand-400">
          Pre-built skills for every stage of development. No prompt engineering,
          no duct tape — just invoke and ship.
        </p>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Framework Skills */}
          <div>
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                >
                  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white">
                Framework Skills
              </h3>
              <span className="rounded-full bg-brand-800 px-2.5 py-0.5 text-xs text-brand-400">
                {frameworkSkills.length}
              </span>
            </div>
            <div className="space-y-2">
              {frameworkSkills.map((skill) => (
                <div
                  key={skill.name}
                  className="rounded-xl border border-brand-800 bg-brand-950 px-4 py-3"
                >
                  <span className="block font-mono text-sm text-accent">
                    {skill.name}
                  </span>
                  <span className="text-sm text-brand-400">{skill.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Superpowers */}
          <div>
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white">
                Superpowers
              </h3>
              <span className="rounded-full bg-brand-800 px-2.5 py-0.5 text-xs text-brand-400">
                {superpowers.length}
              </span>
            </div>
            <div className="space-y-2">
              {superpowers.map((skill) => (
                <div
                  key={skill.name}
                  className="rounded-xl border border-brand-800 bg-brand-950 px-4 py-3"
                >
                  <span className="block font-mono text-sm text-accent">
                    {skill.name}
                  </span>
                  <span className="text-sm text-brand-400">{skill.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
