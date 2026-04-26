import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkills, getSkillAgentMap, type AgentRole } from "./load-skills.js";
import type { ProjectConfig } from "./config.js";

/**
 * T-1023: regression test for the empty-SKILL_AGENT_MAP bug.
 *
 * Before T-1023 the map was empty and `project.json.skills.domain` was empty
 * by default. Result: `byRole` was always an empty Map, every subagent
 * started without its domain skill, no `⚡ Role joined` announcement.
 *
 * This test sets up a realistic engine-style fixture (real temp files for
 * skills + agents, no fs mocks) and verifies the load path produces non-empty
 * `byRole` for the four primary subagent roles, each containing the expected
 * `⚡ Role joined` announcement string from the skill body.
 */

const ROLE_ANNOUNCEMENT: Record<AgentRole, string> = {
  orchestrator: "",
  triage: "",
  frontend: "⚡ Frontend Designer joined",
  backend: "⚡ Backend Dev joined",
  "data-engineer": "⚡ Data Engineer joined",
  qa: "⚡ Testing Engineer joined",
  devops: "",
  security: "",
};

function makeSkill(name: string, announcement: string, appliesTo = "all-agents"): string {
  return `---
applies_to: ${appliesTo}
name: ${name}
description: Domain skill for ${name}
triggers:
  - ${name}
---

${announcement}

# ${name} body

This is the body of the ${name} skill.
`;
}

function makeAgent(name: string, appliesTo = "subagents-only"): string {
  return `---
applies_to: ${appliesTo}
name: ${name}
description: ${name} agent
tools: Read, Write, Edit, Bash, Grep, Glob
---

# ${name} agent body
`;
}

function setupFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "load-skills-mapping-"));

  // Engine-style: skills live in skills/<name>/SKILL.md
  mkdirSync(resolve(dir, "skills/backend"), { recursive: true });
  mkdirSync(resolve(dir, "skills/data-engineer"), { recursive: true });
  mkdirSync(resolve(dir, "skills/frontend-design"), { recursive: true });
  mkdirSync(resolve(dir, "skills/webapp-testing"), { recursive: true });
  mkdirSync(resolve(dir, "skills/verification-before-completion"), { recursive: true });
  // The current loader resolves `${name}.md` directly under `skills/`, not
  // `skills/<name>/SKILL.md`. Mirror what setup.sh installs.
  writeFileSync(resolve(dir, "skills/backend.md"), makeSkill("backend", ROLE_ANNOUNCEMENT.backend));
  writeFileSync(resolve(dir, "skills/data-engineer.md"), makeSkill("data-engineer", ROLE_ANNOUNCEMENT["data-engineer"]));
  writeFileSync(resolve(dir, "skills/frontend-design.md"), makeSkill("frontend-design", ROLE_ANNOUNCEMENT.frontend));
  writeFileSync(resolve(dir, "skills/webapp-testing.md"), makeSkill("webapp-testing", ROLE_ANNOUNCEMENT.qa));
  writeFileSync(resolve(dir, "skills/verification-before-completion.md"), makeSkill("verification-before-completion", ""));

  // Agents directory (.claude/agents/) — required for expectedAgentRolesForRepo()
  mkdirSync(resolve(dir, ".claude/agents"), { recursive: true });
  writeFileSync(resolve(dir, ".claude/agents/backend.md"), makeAgent("backend"));
  writeFileSync(resolve(dir, ".claude/agents/data-engineer.md"), makeAgent("data-engineer"));
  writeFileSync(resolve(dir, ".claude/agents/frontend.md"), makeAgent("frontend"));
  writeFileSync(resolve(dir, ".claude/agents/qa.md"), makeAgent("qa"));
  writeFileSync(resolve(dir, ".claude/agents/devops.md"), makeAgent("devops"));

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeConfig(domain: string[]): ProjectConfig {
  return ({
    name: "test-engine",
    stack: {
      language: "TypeScript",
      framework: "",
      backend: "",
      package_manager: "npm",
      platform: "",
      variant: "",
    } as unknown as ProjectConfig["stack"],
    build: { dev: "", web: "", install: "", verify: "", test: "" },
    hosting: { provider: "", project_id: "", team_id: "", coolify_url: "", coolify_app_uuid: "" },
    shopify: { store: "" },
    skills: { domain, custom: [] },
    paths: { src: "src/", tests: "tests/" },
    supabase: { project_id: "" },
    pipeline: { workspace_id: "", project_id: "" } as unknown as ProjectConfig["pipeline"],
    conventions: { branch_prefix: "feature/", commit_format: "conventional", language: "en" } as unknown as ProjectConfig["conventions"],
  } as unknown) as ProjectConfig;
}

describe("loadSkills — SKILL_AGENT_MAP wiring (T-1023)", () => {
  let fixture: ReturnType<typeof setupFixture>;

  beforeAll(() => {
    fixture = setupFixture();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it("SKILL_AGENT_MAP is non-empty (the bug was: it was empty)", () => {
    const map = getSkillAgentMap();
    expect(Object.keys(map).length).toBeGreaterThan(0);
    expect(map["backend"]).toContain("backend");
    expect(map["data-engineer"]).toContain("data-engineer");
    expect(map["frontend-design"]).toContain("frontend");
    expect(map["webapp-testing"]).toContain("qa");
  });

  it("SKILL_AGENT_MAP includes devops via verification-before-completion (T-1025)", () => {
    // T-1025: devops had no SKILL_AGENT_MAP entry, so loadSkillsValidated
    // crashed at startup with "agents have no domain skill assigned — devops".
    // The fix adds devops to the shared verification-before-completion entry.
    const map = getSkillAgentMap();
    expect(
      map["verification-before-completion"],
      "verification-before-completion must include devops as a target role"
    ).toContain("devops");
  });

  it("delivers backend skill to backend role with ⚡ announcement", () => {
    const config = makeConfig(["backend"]);
    const result = loadSkills(fixture.dir, config);
    const backendContent = result.byRole.get("backend");
    expect(backendContent, "byRole.get('backend') must be non-empty").toBeTruthy();
    expect(backendContent).toContain(ROLE_ANNOUNCEMENT.backend);
    expect(backendContent).toContain("# backend body");
  });

  it("delivers data-engineer skill to data-engineer role", () => {
    const config = makeConfig(["data-engineer"]);
    const result = loadSkills(fixture.dir, config);
    const content = result.byRole.get("data-engineer");
    expect(content).toBeTruthy();
    expect(content).toContain(ROLE_ANNOUNCEMENT["data-engineer"]);
  });

  it("delivers frontend-design skill to frontend role", () => {
    const config = makeConfig(["frontend-design"]);
    const result = loadSkills(fixture.dir, config);
    const content = result.byRole.get("frontend");
    expect(content).toBeTruthy();
    expect(content).toContain(ROLE_ANNOUNCEMENT.frontend);
  });

  it("delivers webapp-testing skill to qa role", () => {
    const config = makeConfig(["webapp-testing"]);
    const result = loadSkills(fixture.dir, config);
    const content = result.byRole.get("qa");
    expect(content).toBeTruthy();
    expect(content).toContain(ROLE_ANNOUNCEMENT.qa);
  });

  it("delivers verification-before-completion to devops role (T-1025)", () => {
    // T-1025: devops was the one agent role with an agent file but no skill
    // wired into byRole. With the shared entry on verification-before-completion,
    // loading just that skill must produce non-empty content for the devops role.
    const config = makeConfig(["verification-before-completion"]);
    const result = loadSkills(fixture.dir, config);
    const content = result.byRole.get("devops");
    expect(
      content,
      "byRole.get('devops') must be non-empty after T-1025 fix"
    ).toBeTruthy();
    expect(content).toContain("# verification-before-completion body");
  });

  it("realistic engine config: every primary role gets its skill", () => {
    const config = makeConfig([
      "backend",
      "data-engineer",
      "frontend-design",
      "webapp-testing",
      "verification-before-completion",
    ]);
    const result = loadSkills(fixture.dir, config);

    for (const role of [
      "backend",
      "data-engineer",
      "frontend",
      "qa",
      "devops",
    ] as AgentRole[]) {
      const content = result.byRole.get(role);
      expect(
        content,
        `byRole.get('${role}') must be non-empty — this is the regression`
      ).toBeTruthy();
    }
  });

  it("regression: empty domain config produces empty byRole (the original bug shape)", () => {
    const config = makeConfig([]);
    const result = loadSkills(fixture.dir, config);
    expect(result.byRole.size).toBe(0);
    expect(result.skillNames.length).toBe(0);
  });
});
