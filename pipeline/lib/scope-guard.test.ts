import { describe, it, expect } from "vitest";
import { detectScopeReduction } from "./scope-guard.ts";

describe("detectScopeReduction", () => {
  it("detects 'placeholder' in agent output", () => {
    const result = detectScopeReduction(
      "Added a placeholder for the authentication module.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0].pattern).toMatch(/placeholder/i);
  });

  it("detects 'simplified version'", () => {
    const result = detectScopeReduction(
      "I created a simplified version of the payment flow.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0].pattern).toMatch(/simplified version/i);
  });

  it("detects 'will be wired later'", () => {
    const result = detectScopeReduction(
      "The event handler will be wired later when the SDK is ready.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0].pattern).toMatch(/will be wired later/i);
  });

  it("detects 'hardcoded'", () => {
    const result = detectScopeReduction(
      "I hardcoded the API endpoint for now.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0].pattern).toMatch(/hardcoded/i);
  });

  it("detects 'v1 implementation'", () => {
    const result = detectScopeReduction(
      "This is the v1 implementation that covers the basic cases.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0].pattern).toMatch(/v1 implementation/i);
  });

  it("detects 'not wired to'", () => {
    const result = detectScopeReduction(
      "The button is not wired to the backend yet.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0].pattern).toMatch(/not wired to/i);
  });

  it("detects 'future enhancement'", () => {
    const result = detectScopeReduction(
      "Pagination is a future enhancement we can add.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0].pattern).toMatch(/future enhancement/i);
  });

  it("passes clean agent output (real implementation description)", () => {
    const cleanOutput = [
      "Implemented the full authentication flow with JWT tokens.",
      "Added error handling for all API endpoints.",
      "Created unit tests covering edge cases.",
      "Wired the payment webhook to the order processing service.",
      "The database migration adds the required indexes.",
    ].join("\n");

    const result = detectScopeReduction(cleanOutput);

    expect(result.detected).toBe(false);
    expect(result.markers).toHaveLength(0);
    expect(result.message).toBe("No scope reduction detected");
  });

  it("ignores scope markers in backtick-quoted inline code", () => {
    const result = detectScopeReduction(
      "I removed the `placeholder` text from the template.",
    );

    expect(result.detected).toBe(false);
    expect(result.markers).toHaveLength(0);
  });

  it("ignores when agent says 'removed the placeholder' (false positive)", () => {
    const result = detectScopeReduction(
      "Removed the placeholder values and replaced with real config.",
    );

    expect(result.detected).toBe(false);
    expect(result.markers).toHaveLength(0);
  });

  // --- Additional coverage ---

  it("detects 'basic version'", () => {
    const result = detectScopeReduction(
      "Shipped a basic version without the drag-and-drop feature.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers[0].pattern).toMatch(/basic version/i);
  });

  it("detects 'stubbed out'", () => {
    const result = detectScopeReduction(
      "The notification service is stubbed out for this PR.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers[0].pattern).toMatch(/stubbed out/i);
  });

  it("detects 'not yet implemented'", () => {
    const result = detectScopeReduction(
      "The export feature is not yet implemented.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers[0].pattern).toMatch(/not yet implemented/i);
  });

  it("detects 'can add ... later'", () => {
    const result = detectScopeReduction(
      "We can add caching later once we measure performance.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
  });

  it("detects 'for now ... later'", () => {
    const result = detectScopeReduction(
      "For now I used a static list, we can fetch from the API later.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
  });

  it("ignores markers inside fenced code blocks", () => {
    const output = [
      "Here is the implementation:",
      "```",
      "const placeholder = 'test';",
      "```",
      "The code above replaces the old logic.",
    ].join("\n");

    const result = detectScopeReduction(output);

    expect(result.detected).toBe(false);
    expect(result.markers).toHaveLength(0);
  });

  it("ignores markers on 4-space indented code lines", () => {
    const output = [
      "Updated the config module:",
      "    const hardcoded = false;",
      "This ensures dynamic values are used.",
    ].join("\n");

    const result = detectScopeReduction(output);

    expect(result.detected).toBe(false);
    expect(result.markers).toHaveLength(0);
  });

  it("ignores 'replaced ... hardcoded' removal false positive", () => {
    const result = detectScopeReduction(
      "Replaced the hardcoded URL with an environment variable.",
    );

    expect(result.detected).toBe(false);
    expect(result.markers).toHaveLength(0);
  });

  it("ignores 'deleted ... todo' removal false positive", () => {
    const result = detectScopeReduction(
      "Deleted the todo comments from the codebase.",
    );

    expect(result.detected).toBe(false);
    expect(result.markers).toHaveLength(0);
  });

  it("returns max 1 marker per line", () => {
    const result = detectScopeReduction(
      "Added a placeholder as a simplified version for now.",
    );

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(1);
  });

  it("detects multiple markers across different lines", () => {
    const output = [
      "I used a placeholder for the icon.",
      "The API call is hardcoded to localhost.",
      "Export is a future enhancement.",
    ].join("\n");

    const result = detectScopeReduction(output);

    expect(result.detected).toBe(true);
    expect(result.markers).toHaveLength(3);
  });

  it("includes marker details in message", () => {
    const result = detectScopeReduction(
      "Added a placeholder for the logo.",
    );

    expect(result.message).toContain("Scope reduction detected");
    expect(result.message).toContain("1 marker(s)");
    expect(result.message).toContain("placeholder");
  });
});
