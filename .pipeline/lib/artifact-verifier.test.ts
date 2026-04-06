import { describe, it, expect } from "vitest";
import {
  checkLevel1Exists,
  checkLevel2Substantive,
  checkLevel3Wired,
} from "./artifact-verifier.ts";

describe("checkLevel1Exists", () => {
  it("fails when git diff is empty", () => {
    const result = checkLevel1Exists("");
    expect(result.passed).toBe(false);
    expect(result.level).toBe(1);
    expect(result.files).toEqual([]);
    expect(result.message).toContain("No files changed");
  });

  it("fails when git diff is only whitespace", () => {
    const result = checkLevel1Exists("  \n  \n  ");
    expect(result.passed).toBe(false);
    expect(result.files).toEqual([]);
  });

  it("passes when git diff has content and extracts file names correctly", () => {
    const diff = [
      "M\tsrc/components/Button.tsx",
      "A\tsrc/lib/utils.ts",
      "D\tsrc/old-file.ts",
    ].join("\n");

    const result = checkLevel1Exists(diff);

    expect(result.passed).toBe(true);
    expect(result.level).toBe(1);
    expect(result.files).toEqual([
      "src/components/Button.tsx",
      "src/lib/utils.ts",
      "src/old-file.ts",
    ]);
    expect(result.message).toContain("3 file(s) changed");
  });

  it("handles rename status lines (R prefix)", () => {
    const diff = "R100\told-name.ts\tnew-name.ts";
    const result = checkLevel1Exists(diff);

    expect(result.passed).toBe(true);
    expect(result.files).toEqual(["new-name.ts"]);
  });

  it("handles copy status lines (C prefix)", () => {
    const diff = "C090\toriginal.ts\tcopy.ts";
    const result = checkLevel1Exists(diff);

    expect(result.passed).toBe(true);
    expect(result.files).toEqual(["copy.ts"]);
  });
});

describe("checkLevel2Substantive", () => {
  it("fails when file contains TODO markers", () => {
    const files = new Map([
      ["src/handler.ts", "export function handle() {\n  // TODO: implement this\n  return null;\n}"],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(false);
    expect(result.level).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues![0].file).toBe("src/handler.ts");
    expect(result.issues![0].pattern).toBe("TODO");
    expect(result.issues![0].line).toBe(2);
  });

  it("fails when file contains 'placeholder'", () => {
    const files = new Map([
      ["src/config.ts", 'const name = "placeholder value";'],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(false);
    expect(result.issues!.some((i) => i.pattern === "placeholder")).toBe(true);
  });

  it("fails when file contains FIXME", () => {
    const files = new Map([
      ["src/utils.ts", "// FIXME: this is broken\nfunction broken() {}"],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(false);
    expect(result.issues!.some((i) => i.pattern === "FIXME")).toBe(true);
  });

  it("fails when file contains 'not implemented' throw", () => {
    const files = new Map([
      ["src/service.ts", 'export function run() {\n  throw new Error("not implemented");\n}'],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(false);
    expect(result.issues!.length).toBeGreaterThanOrEqual(1);
  });

  it("fails when file contains 'return null; //' stub", () => {
    const files = new Map([
      ["src/handler.ts", "function process() {\n  return null; // stub\n}"],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(false);
    expect(result.issues!.some((i) => i.pattern === "return null; //")).toBe(true);
  });

  it("passes when file has real implementation", () => {
    const files = new Map([
      [
        "src/handler.ts",
        [
          "export function handle(input: string): string {",
          "  const trimmed = input.trim();",
          "  if (!trimmed) throw new Error('Input required');",
          "  return trimmed.toUpperCase();",
          "}",
        ].join("\n"),
      ],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(true);
    expect(result.level).toBe(2);
    expect(result.issues).toEqual([]);
    expect(result.message).toContain("No stubs");
  });

  it("ignores TODO in test files (.test.ts)", () => {
    const files = new Map([
      ["src/handler.test.ts", "// TODO: add more test cases\nit('works', () => {});"],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("ignores TODO in spec files (.spec.ts)", () => {
    const files = new Map([
      ["src/handler.spec.ts", "// TODO: add edge case tests"],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(true);
  });

  it("reports multiple issues across multiple files", () => {
    const files = new Map([
      ["src/a.ts", "// TODO: wire up\nconst x = 'placeholder';"],
      ["src/b.ts", "// FIXME: broken"],
    ]);

    const result = checkLevel2Substantive(files);

    expect(result.passed).toBe(false);
    expect(result.issues!.length).toBe(3);
  });
});

describe("checkLevel3Wired", () => {
  it("fails when exported function has no importer", () => {
    const newExports = [{ file: "src/utils.ts", name: "formatDate" }];
    const allFiles = new Map([
      ["src/utils.ts", "export function formatDate() { return new Date(); }"],
      ["src/index.ts", "import { something } from './other.ts';"],
    ]);

    const result = checkLevel3Wired(newExports, allFiles);

    expect(result.passed).toBe(false);
    expect(result.level).toBe(3);
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans![0].name).toBe("formatDate");
    expect(result.orphans![0].file).toBe("src/utils.ts");
    expect(result.message).toContain("orphaned export");
  });

  it("passes when exported function is imported", () => {
    const newExports = [{ file: "src/utils.ts", name: "formatDate" }];
    const allFiles = new Map([
      ["src/utils.ts", "export function formatDate() { return new Date(); }"],
      ["src/index.ts", "import { formatDate } from './utils.ts';\nformatDate();"],
    ]);

    const result = checkLevel3Wired(newExports, allFiles);

    expect(result.passed).toBe(true);
    expect(result.level).toBe(3);
    expect(result.orphans).toEqual([]);
    expect(result.message).toContain("All new exports are imported");
  });

  it("passes when no new exports (empty array)", () => {
    const allFiles = new Map([
      ["src/index.ts", "console.log('hello');"],
    ]);

    const result = checkLevel3Wired([], allFiles);

    expect(result.passed).toBe(true);
    expect(result.level).toBe(3);
    expect(result.orphans).toEqual([]);
    expect(result.message).toContain("No new exports");
  });

  it("detects multiple orphans", () => {
    const newExports = [
      { file: "src/a.ts", name: "helperA" },
      { file: "src/b.ts", name: "helperB" },
    ];
    const allFiles = new Map([
      ["src/a.ts", "export function helperA() {}"],
      ["src/b.ts", "export function helperB() {}"],
      ["src/index.ts", "// nothing imported"],
    ]);

    const result = checkLevel3Wired(newExports, allFiles);

    expect(result.passed).toBe(false);
    expect(result.orphans).toHaveLength(2);
  });

  it("passes when export is referenced (not necessarily via import statement)", () => {
    const newExports = [{ file: "src/utils.ts", name: "calculate" }];
    const allFiles = new Map([
      ["src/utils.ts", "export function calculate() { return 42; }"],
      ["src/runner.ts", "const fn = modules.calculate;"],
    ]);

    const result = checkLevel3Wired(newExports, allFiles);

    expect(result.passed).toBe(true);
  });
});
