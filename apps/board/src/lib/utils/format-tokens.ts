/**
 * Format a token count into a human-readable string.
 * Examples: 450 → "450", 12400 → "12.4k", 1500000 → "1.5M"
 */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const val = count / 1_000_000;
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const val = count / 1_000;
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}k`;
  }
  return String(count);
}
