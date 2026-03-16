import { NewsletterForm } from "./newsletter-form";

export function Newsletter() {
  return (
    <section className="border-t border-brand-800 bg-brand-950 py-24">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <p className="mb-3 text-sm font-medium uppercase tracking-widest text-accent">
          Newsletter
        </p>
        <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Stay in the loop
        </h2>
        <p className="mx-auto mb-10 max-w-lg text-base leading-relaxed text-brand-400">
          Updates on agentic development, multi-agent workflows, and everything
          we&apos;re building with Just Ship. No noise — just signal.
        </p>
        <div className="mx-auto max-w-md">
          <NewsletterForm />
        </div>
      </div>
    </section>
  );
}
