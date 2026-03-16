import { WaitlistForm } from "./waitlist-form";

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
            From ticket to ship.
          </span>
          <br />
          <span className="text-white">Autonomously.</span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mb-12 max-w-[620px] text-[clamp(1rem,2.2vw,1.2rem)] font-normal leading-[1.65] text-brand-400">
          A portable multi-agent framework for autonomous software development.
          Ship complex projects from ticket to ship — fully autonomous.
        </p>

        {/* Waitlist form — primary CTA */}
        <div className="mx-auto mb-8 max-w-md">
          <WaitlistForm />
        </div>

        {/* GitHub — secondary CTA */}
        <a
          href="https://github.com/yves-s/just-ship"
          className="inline-flex items-center gap-2 text-sm text-brand-500 transition-colors duration-200 hover:text-brand-300"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          View on GitHub
        </a>
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
