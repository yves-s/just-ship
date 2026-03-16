import { WaitlistForm } from "./waitlist-form";

const links = [
  { label: "GitHub", href: "https://github.com/yves-s/just-ship" },
  { label: "Board", href: "https://board.just-ship.io" },
  { label: "Docs", href: "https://github.com/yves-s/just-ship#readme" },
];

export function Footer() {
  return (
    <footer className="border-t border-brand-800 bg-brand-950 py-16">
      <div className="mx-auto max-w-6xl px-6">
        {/* Built with Just Ship — prominent */}
        <div className="mb-12 flex flex-col items-center gap-4">
          <p className="text-sm font-medium uppercase tracking-widest text-brand-500">
            This website was built with
          </p>
          <div className="flex items-center gap-3">
            <img
              src="/logos/svg/mark-outline-white.svg"
              alt=""
              className="h-8 w-8"
            />
            <span className="text-2xl font-extrabold tracking-tight text-white">
              just<span className="text-[#93bbfc]">ship</span>
            </span>
          </div>
        </div>

        {/* Waitlist CTA */}
        <div className="mb-12 flex justify-center">
          <div className="w-full max-w-md">
            <p className="mb-5 text-center text-sm font-medium text-brand-400">
              Get early access — be the first to know when it ships.
            </p>
            <WaitlistForm />
          </div>
        </div>

        {/* Divider */}
        <div className="mb-8 border-t border-brand-800" />

        {/* Links */}
        <nav className="mb-6 flex items-center justify-center gap-8">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm text-brand-500 transition-colors duration-200 hover:text-brand-300"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <p className="text-center text-sm text-brand-600">
          2026 Just Ship
        </p>
      </div>
    </footer>
  );
}
