import { describe, it, expect } from "vitest";
import { parseSkillFrontmatter } from "./load-skills.ts";

describe("parseSkillFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const content = `---
name: test-skill
description: A test skill
---

# Test Skill`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test-skill");
    expect(result!.description).toBe("A test skill");
    expect(result!.triggers).toEqual([]);
  });

  it("parses inline triggers array", () => {
    const content = `---
name: test-skill
description: A test skill
triggers: [security, audit, review]
---

# Test`;

    const result = parseSkillFrontmatter(content);
    expect(result!.triggers).toEqual(["security", "audit", "review"]);
  });

  it("parses multi-line triggers", () => {
    const content = `---
name: test-skill
description: A test skill
triggers:
  - security
  - audit
---

# Test`;

    const result = parseSkillFrontmatter(content);
    expect(result!.triggers).toEqual(["security", "audit"]);
  });

  it("parses block scalar description", () => {
    const content = `---
name: test-skill
description: >
  This is a long
  description that spans
  multiple lines
---

# Test`;

    const result = parseSkillFrontmatter(content);
    expect(result!.description).toBe("This is a long description that spans multiple lines");
  });

  it("returns null for content without frontmatter", () => {
    const result = parseSkillFrontmatter("# Just a heading\nSome content");
    expect(result).toBeNull();
  });

  it("returns null when name is missing", () => {
    const content = `---
description: No name here
---

# Test`;

    const result = parseSkillFrontmatter(content);
    expect(result).toBeNull();
  });
});

describe("parseSkillFrontmatter - audit fields", () => {
  it("parses category and audit_scope from frontmatter", () => {
    const content = `---
name: security-review
description: OWASP security analysis
category: audit
audit_scope: full
---

# Security Review
Body content here.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.category).toBe("audit");
    expect(result!.auditScope).toBe("full");
  });

  it("defaults auditScope to 'both' when category is audit but audit_scope is missing", () => {
    const content = `---
name: find-bugs
description: Find bugs
category: audit
---

# Find Bugs`;

    const result = parseSkillFrontmatter(content);
    expect(result!.category).toBe("audit");
    expect(result!.auditScope).toBe("both");
  });

  it("returns undefined category and auditScope when not set", () => {
    const content = `---
name: frontend-design
description: Design skill
---

# Frontend Design`;

    const result = parseSkillFrontmatter(content);
    expect(result!.category).toBeUndefined();
    expect(result!.auditScope).toBeUndefined();
  });

  it("parses audit_scope diff", () => {
    const content = `---
name: find-bugs
description: Find bugs
category: audit
audit_scope: diff
---

# Find Bugs`;

    const result = parseSkillFrontmatter(content);
    expect(result!.auditScope).toBe("diff");
  });

  it("parses audit_scope both explicitly", () => {
    const content = `---
name: code-review
description: Code review
category: audit
audit_scope: both
---

# Code Review`;

    const result = parseSkillFrontmatter(content);
    expect(result!.auditScope).toBe("both");
  });

  it("ignores audit_scope when category is not audit", () => {
    const content = `---
name: some-skill
description: Not an audit skill
audit_scope: full
---

# Some Skill`;

    const result = parseSkillFrontmatter(content);
    expect(result!.category).toBeUndefined();
    expect(result!.auditScope).toBeUndefined();
  });
});
