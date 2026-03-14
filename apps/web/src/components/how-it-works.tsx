const steps = [
  {
    number: "01",
    title: "Write a Ticket",
    description:
      "Describe what you need. Bug, feature, or improvement.",
  },
  {
    number: "02",
    title: "Agents Take Over",
    description:
      "Orchestrator plans. Specialists implement. Autonomously.",
  },
  {
    number: "03",
    title: "Pull Request",
    description:
      "Code reviewed, tested, and pushed. Ready for your approval.",
  },
  {
    number: "04",
    title: "Merge & Ship",
    description:
      "One command. Branch deleted. Ticket closed. Done.",
  },
];

function Arrow() {
  return (
    <div className="hidden items-center lg:flex">
      <svg
        width="40"
        height="16"
        viewBox="0 0 40 16"
        fill="none"
        className="text-brand-600"
      >
        <path
          d="M0 8h36m0 0l-6-6m6 6l-6 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section className="bg-brand-900 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-16 text-center text-3xl font-bold text-white sm:text-4xl">
          How it Works
        </h2>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.number}
              className="flex flex-col rounded-2xl border border-brand-800 bg-brand-950 p-6"
            >
              <span className="mb-3 font-mono text-sm text-accent">
                {step.number}
              </span>
              <h3 className="mb-2 text-lg font-semibold text-white">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-brand-400">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
