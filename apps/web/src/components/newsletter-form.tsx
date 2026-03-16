"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type State = "idle" | "loading" | "success" | "duplicate" | "error";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [validationError, setValidationError] = useState("");

  function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");

    if (!email.trim()) {
      setValidationError("Please enter your email address.");
      return;
    }
    if (!isValidEmail(email)) {
      setValidationError("Please enter a valid email address.");
      return;
    }

    setState("loading");

    const { error } = await supabase
      .from("waitlist_signups")
      .insert({ email: email.trim().toLowerCase() });

    if (!error) {
      setState("success");
      return;
    }

    if (error.code === "23505") {
      setState("duplicate");
      return;
    }

    setState("error");
  }

  if (state === "success" || state === "duplicate") {
    return (
      <div
        className="flex flex-col items-center gap-3"
        style={{ animation: "nl-fadein 0.35s ease both" }}
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15"
          style={{ animation: "nl-scalein 0.4s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          <svg
            className="h-6 w-6 text-green-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <p className="text-base font-semibold text-green-400">
          {state === "success" ? "You're subscribed!" : "You're already subscribed!"}
        </p>
        <p className="text-sm text-brand-500">
          {state === "success"
            ? "We'll keep you in the loop."
            : "We already have your email — stay tuned."}
        </p>

        <style
          dangerouslySetInnerHTML={{
            __html: `
              @keyframes nl-fadein {
                from { opacity: 0; transform: translateY(6px); }
                to   { opacity: 1; transform: translateY(0); }
              }
              @keyframes nl-scalein {
                from { transform: scale(0.5); opacity: 0; }
                to   { transform: scale(1);   opacity: 1; }
              }
            `,
          }}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex w-full flex-col gap-3 sm:flex-row sm:gap-2"
      >
        <input
          id="newsletter-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (validationError) setValidationError("");
            if (state === "error") setState("idle");
          }}
          placeholder="Enter your email"
          disabled={state === "loading"}
          className="h-[52px] flex-1 rounded-xl border border-brand-700 bg-brand-900 px-4 text-[15px] text-white placeholder-brand-600 outline-none ring-0 transition-colors duration-200 focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-60"
          autoComplete="email"
          inputMode="email"
          aria-label="Email address"
          aria-invalid={validationError ? "true" : "false"}
          aria-describedby={validationError ? "newsletter-error" : undefined}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="inline-flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-[15px] font-semibold text-white shadow-[0_4px_20px_rgba(59,130,246,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(59,130,246,0.4)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none disabled:translate-y-0 sm:px-7"
        >
          {state === "loading" ? (
            <>
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Subscribing&hellip;
            </>
          ) : (
            "Subscribe"
          )}
        </button>
      </form>

      <div className="mt-2 min-h-[20px]">
        {validationError && (
          <p id="newsletter-error" className="text-sm text-red-400" role="alert">
            {validationError}
          </p>
        )}
        {state === "error" && !validationError && (
          <p className="text-sm text-red-400" role="alert">
            Something went wrong. Please try again.
          </p>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-brand-500 sm:text-left">
        No spam. Unsubscribe anytime.
      </p>
    </div>
  );
}
