export function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-950">
      {/* Radial gradient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 45%, rgba(59,130,246,0.1) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-32 text-center sm:py-40">
        {/* Badge */}
        <div className="mb-10 flex justify-center">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-brand-700 px-5 py-2 text-sm font-medium text-brand-300">
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-40"
                style={{
                  animation: "chip-pulse 2s ease-in-out infinite",
                }}
              />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Multi-Agent Framework for Claude Code
          </div>
        </div>

        {/* Logo — mark + HTML wordmark (Sora loaded via next/font) */}
        <div className="mb-12 flex items-center justify-center gap-4">
          <img
            src="/logos/svg/mark-outline-white.svg"
            alt=""
            className="h-11 w-11"
          />
          <span className="text-[32px] font-extrabold tracking-tight text-white">
            just<span className="text-[#93bbfc]">ship</span>
          </span>
        </div>

        {/* Headline — two lines */}
        <h1 className="mb-8 text-[clamp(2.5rem,8vw,5rem)] font-extrabold leading-[1.05] tracking-[-0.04em]">
          <span className="bg-gradient-to-br from-[#60a5fa] to-[#3b82f6] bg-clip-text text-transparent">
            From ticket to merge.
          </span>
          <br />
          <span className="text-white">Autonomously.</span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mb-14 max-w-[620px] text-[clamp(1rem,2.2vw,1.2rem)] font-normal leading-[1.65] text-brand-400">
          A portable multi-agent framework for autonomous software development.
          Ship complex projects from ticket to merge — fully autonomous.
        </p>

        {/* CTAs */}
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <a
            href="https://github.com/yves-s/just-ship"
            className="inline-flex h-[52px] items-center gap-2 rounded-xl bg-accent px-8 text-base font-semibold text-white shadow-[0_4px_20px_rgba(59,130,246,0.3)] transition-all duration-200 hover:shadow-[0_8px_30px_rgba(59,130,246,0.4)] hover:-translate-y-0.5"
          >
            Start Shipping
            <span aria-hidden="true">&rarr;</span>
          </a>
          <span className="inline-flex h-[52px] items-center rounded-xl border border-brand-700 px-7 font-mono text-[15px] text-brand-300 transition-colors duration-200 hover:border-brand-600 hover:text-brand-200">
            npx just-ship init
          </span>
        </div>
      </div>

      {/* Pulse keyframes */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes chip-pulse {
              0%, 100% { transform: scale(1); opacity: 0.4; }
              50% { transform: scale(1.8); opacity: 0; }
            }
          `,
        }}
      />
    </section>
  );
}
