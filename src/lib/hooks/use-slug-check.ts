import { useState, useEffect, useRef } from "react";

interface SlugCheckResult {
  isChecking: boolean;
  isAvailable: boolean | null;
  suggestion: string | null;
}

export function useSlugCheck(slug: string, debounceMs = 300): SlugCheckResult {
  const [isChecking, setIsChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset if slug is empty or too short
    if (!slug || slug.length < 2) {
      setIsAvailable(null);
      setSuggestion(null);
      setIsChecking(false);
      return;
    }

    // Validate slug format before checking
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      setIsAvailable(null);
      setSuggestion(null);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);

    const timer = setTimeout(async () => {
      // Abort previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/check-slug?slug=${encodeURIComponent(slug)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();

        if (!controller.signal.aborted) {
          setIsAvailable(data.available);
          setSuggestion(data.suggestion ?? null);
          setIsChecking(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsChecking(false);
        }
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [slug, debounceMs]);

  return { isChecking, isAvailable, suggestion };
}
