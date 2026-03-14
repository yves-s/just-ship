const commands = [
  { cmd: "/ticket", comment: "Describe what you need" },
  { cmd: "/develop", comment: "Agents start building" },
  { cmd: "/ship", comment: "Merge, deploy, done" },
];

export function Commands() {
  return (
    <section className="bg-brand-900 py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-6">
        <h2 className="mb-16 text-center text-3xl font-bold text-white sm:text-4xl">
          Three Commands. Full Lifecycle.
        </h2>

        {/* Terminal window */}
        <div className="overflow-hidden rounded-2xl border border-brand-800 bg-brand-950">
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-brand-800 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-brand-700" />
            <span className="h-3 w-3 rounded-full bg-brand-700" />
            <span className="h-3 w-3 rounded-full bg-brand-700" />
            <span className="ml-3 font-mono text-xs text-brand-500">
              terminal
            </span>
          </div>

          {/* Command lines */}
          <div className="space-y-0 p-6 font-mono text-sm leading-loose sm:text-base">
            {commands.map((line) => (
              <div key={line.cmd} className="flex flex-wrap gap-x-3">
                <span className="text-brand-500">$</span>
                <span className="text-accent">{line.cmd}</span>
                <span className="text-brand-600">
                  {"#"} {line.comment}
                </span>
              </div>
            ))}
          </div>

          {/* Conversational triggers */}
          <div className="border-t border-brand-800 px-6 py-4">
            <p className="text-sm text-brand-500">
              Or just say{" "}
              <span className="font-mono text-brand-300">
                {'"passt"'}
              </span>
              ,{" "}
              <span className="font-mono text-brand-300">
                {'"ship it"'}
              </span>
              , or{" "}
              <span className="font-mono text-brand-300">
                {'"sieht gut aus"'}
              </span>{" "}
              — auto-triggers{" "}
              <span className="font-mono text-accent">/ship</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
