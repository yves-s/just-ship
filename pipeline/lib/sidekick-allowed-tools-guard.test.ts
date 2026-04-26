import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildSidekickAllowedTools } from "./sidekick-chat.ts";

/**
 * CI grep-guard for T-1020.
 *
 * Acceptance criterion: "Kein produktiver Build-Path mehr, der mit
 * `allowedTools: []` an SDK calls geht. Grep-Test in CI: `allowedTools:\s*\[\s*\]`
 * darf null Treffer liefern in `pipeline/`."
 *
 * Strict zero-hits would also break two legitimate single-shot agents
 * (the triage classifier and the legacy converse classifier). We allow
 * those by requiring an explicit `// CI-AUDIT-EXEMPT:` annotation on the
 * preceding line — making every empty `allowedTools` an intentional
 * decision, code-reviewable, and grep-discoverable.
 *
 * The reasoning-first chat path (`sidekick-chat.ts`) MUST never appear in
 * the unannotated-hits list — that was the original bug.
 */

const PIPELINE_DIR = join(__dirname, "..");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip node_modules, build artefacts, and dotfolders.
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      out.push(...listTsFiles(full));
      continue;
    }
    // .test.ts files are excluded — fixtures inside test code legitimately
    // exercise the empty-tools path. The CI rule is about production paths.
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    if (entry.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  text: string;
  precedingComment: string | null;
}

function findEmptyAllowedToolsHits(): Hit[] {
  const hits: Hit[] = [];
  const re = /allowedTools\s*:\s*\[\s*\]/;
  for (const file of listTsFiles(PIPELINE_DIR)) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i]!)) continue;
      // Walk upward through every consecutive `//`-comment line so a
      // multi-line annotation block ("// CI-AUDIT-EXEMPT: ...\n// continued
      // explanation\n") still counts. Stop at the first non-comment line.
      const commentBlock: string[] = [];
      for (let j = i - 1; j >= 0; j--) {
        const trimmed = lines[j]!.trim();
        if (trimmed.length === 0) continue;
        if (!trimmed.startsWith("//")) break;
        commentBlock.unshift(trimmed);
      }
      hits.push({
        file: relative(PIPELINE_DIR, file),
        line: i + 1,
        text: lines[i]!.trim(),
        precedingComment: commentBlock.length > 0 ? commentBlock.join(" ") : null,
      });
    }
  }
  return hits;
}

describe("CI grep-guard: empty allowedTools (T-1020)", () => {
  it("every `allowedTools: []` in production code carries a // CI-AUDIT-EXEMPT marker", () => {
    const hits = findEmptyAllowedToolsHits();
    const unannotated = hits.filter(
      (h) => !h.precedingComment || !h.precedingComment.includes("CI-AUDIT-EXEMPT"),
    );
    if (unannotated.length > 0) {
      const msg = unannotated
        .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
        .join("\n");
      throw new Error(
        `Found ${unannotated.length} unannotated empty allowedTools occurrence(s):\n${msg}\n\n` +
          `Either wire real tools, or annotate with a preceding "// CI-AUDIT-EXEMPT: <why>" line.`,
      );
    }
    expect(unannotated).toEqual([]);
  });

  it("the reasoning-first chat path (sidekick-chat.ts) exposes a non-empty tool surface", () => {
    const allowed = buildSidekickAllowedTools();
    expect(allowed.length).toBeGreaterThan(0);
    // The eight reasoning tools must all surface as MCP-prefixed names.
    expect(allowed).toContain("mcp__sidekick__create_ticket");
    expect(allowed).toContain("mcp__sidekick__update_thread_status");
    expect(allowed).toContain("mcp__sidekick__run_expert_audit");
  });
});
