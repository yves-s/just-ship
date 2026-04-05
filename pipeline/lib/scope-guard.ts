export interface ScopeMarker {
  pattern: string;
  line: string;
  index: number;
}

export interface ScopeReductionResult {
  detected: boolean;
  markers: ScopeMarker[];
  message: string;
}

/**
 * Scope-reduction patterns that indicate an agent silently dropped requirements.
 * Each pattern is case-insensitive.
 */
const SCOPE_PATTERNS: RegExp[] = [
  /\bplaceholder\b/i,
  /\bsimplified\s+(?:version|implementation|approach)\b/i,
  /\bwill\s+be\s+wired\s+(?:later|soon|in)\b/i,
  /\bhardcoded\b/i,
  /\bnot\s+wired\s+to\b/i,
  /\bbasic\s+version\b/i,
  /\bv1\s+(?:implementation|version|approach)\b/i,
  /\bfuture\s+enhancement\b/i,
  /\bfill\s+in\s+later\b/i,
  /\bstubbed\s+(?:out|implementation|for\s+now)\b/i,
  /\bnot\s+yet\s+(?:implemented|connected|integrated)\b/i,
  /\bcan\s+(?:add|make|implement)\b.+?\blater\b/i,
  /\bfor\s+now\b.+?\b(?:later|eventually|v2)\b/i,
];

/**
 * Lines starting with removal-related words followed by a scope keyword
 * are false positives — the agent is describing removal of old code.
 */
const REMOVAL_PREFIX = /^\s*(?:removed\s+the|replaced|deleted)\b/i;
const REMOVAL_KEYWORDS = /\b(?:placeholder|todo|hardcoded)\b/i;

/**
 * Returns true if the line is inside a fenced code block (``` ... ```)
 * or is a 4-space / tab indented code line.
 */
function isCodeLine(line: string): boolean {
  return /^\s{4,}\S/.test(line) || /^```/.test(line.trimStart());
}

/**
 * Returns true if the match position sits inside inline backtick-quoted code.
 * We count backticks before the match — an odd count means we are inside a pair.
 */
function isInsideInlineCode(line: string, matchIndex: number): boolean {
  const before = line.slice(0, matchIndex);
  const backtickCount = (before.match(/`/g) ?? []).length;
  return backtickCount % 2 === 1;
}

/**
 * Scan agent output for signs of silent scope reduction.
 *
 * Returns detected: true when at least one scope-reduction marker is found,
 * after filtering out false positives (code blocks, inline code, removal descriptions).
 */
export function detectScopeReduction(agentOutput: string): ScopeReductionResult {
  const lines = agentOutput.split("\n");
  const markers: ScopeMarker[] = [];
  let inFencedBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Track fenced code blocks
    if (trimmed.startsWith("```")) {
      inFencedBlock = !inFencedBlock;
      continue;
    }

    // Skip lines inside fenced code blocks
    if (inFencedBlock) continue;

    // Skip 4-space indented code lines
    if (isCodeLine(line)) continue;

    // Skip false-positive removal lines
    if (REMOVAL_PREFIX.test(trimmed) && REMOVAL_KEYWORDS.test(trimmed)) {
      continue;
    }

    // Check each pattern — max 1 match per line
    for (const pattern of SCOPE_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        // Skip if inside inline backtick code
        if (isInsideInlineCode(line, match.index)) continue;

        markers.push({
          pattern: match[0],
          line: line.trim(),
          index: i,
        });
        break; // max 1 match per line
      }
    }
  }

  const detected = markers.length > 0;
  const message = detected
    ? `Scope reduction detected: ${markers.length} marker(s) found — ${markers.map((m) => `"${m.pattern}"`).join(", ")}`
    : "No scope reduction detected";

  return { detected, markers, message };
}
