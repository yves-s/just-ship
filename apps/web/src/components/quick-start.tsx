const lines = [
  { type: "comment" as const, text: "# Install just-ship" },
  {
    type: "command" as const,
    text: "curl -fsSL https://just-ship.io/install | bash",
  },
  { type: "blank" as const, text: "" },
  { type: "comment" as const, text: "# Set up in your project" },
  {
    type: "command" as const,
    text: "cd your-project && just-ship setup",
  },
  { type: "blank" as const, text: "" },
  { type: "comment" as const, text: "# Start shipping" },
  { type: "command" as const, text: "claude" },
  {
    type: "input" as const,
    text: "> /ticket Add user authentication",
  },
  { type: "input" as const, text: "> /develop T-1" },
];

function lineColor(type: "comment" | "command" | "blank" | "input") {
  switch (type) {
    case "comment":
      return "text-brand-500";
    case "command":
      return "text-accent";
    case "input":
      return "text-green-400";
    default:
      return "";
  }
}

export function QuickStart() {
  return (
    <section className="bg-brand-900 py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="mb-16 text-center text-3xl font-bold text-white sm:text-4xl">
          Get Started in 60 Seconds
        </h2>

        <div className="overflow-hidden rounded-2xl border border-brand-800 bg-brand-950">
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-brand-800 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-brand-700" />
            <span className="h-3 w-3 rounded-full bg-brand-700" />
            <span className="h-3 w-3 rounded-full bg-brand-700" />
            <span className="ml-3 font-mono text-xs text-brand-500">
              bash
            </span>
          </div>

          {/* Code block */}
          <pre className="overflow-x-auto p-6 font-mono text-sm leading-relaxed sm:text-base">
            {lines.map((line, i) => (
              <div key={i} className={lineColor(line.type)}>
                {line.type === "blank" ? "\u00A0" : line.text}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </section>
  );
}
