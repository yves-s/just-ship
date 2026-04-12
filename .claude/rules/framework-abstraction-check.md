Before writing code, determine which abstraction level you are working on. The level dictates the solution approach.

| Level | You are building... | Solution pattern |
|---|---|---|
| **Framework** (just-ship engine) | Mechanisms that projects consume | Declarative fields in project.json, setup.sh steps, skill formats, agent definitions |
| **Project** (installed project) | Configurations using framework mechanisms | Fill project.json fields, activate skills, write project-specific code |
| **Runtime** (agent at execution time) | Agent behavior during a session | Load skills, process results, make decisions |

**Self-check (MANDATORY before first code edit):** "Am I solving this at the right level?" If the task is about the framework but your solution only works for one project, you are on the wrong level.

**Anti-patterns:**

| Wrong | Right | Why |
|---|---|---|
| Copy external files into the repo | Declare them as dependencies in project.json | Framework distributes mechanisms, not vendor code |
| Hardcode a path that only works locally | Use project.json config that setup.sh resolves | Framework must work on any machine |
| Write a one-off script for a repeating need | Add a setup.sh step or project.json field | Framework automates, projects configure |
| Build a feature inline that other projects need too | Extract to a skill, agent, or setup.sh function | Framework provides, projects consume |

**The npm analogy:** project.json is to Just Ship what package.json is to Node. External dependencies are declared, not vendored. setup.sh is the install step. Skills are the modules.
