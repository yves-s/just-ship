---
applies_to: top-level-only
---

Never invoke `superpowers:finishing-a-development-branch` more than once per session.

If the skill has already been invoked in the current conversation (the 4 options were already presented to the user), do not invoke it again — even if a parent skill (e.g. `executing-plans`) calls for it after a child skill (`subagent-driven-development`) already ran it.

**Why:** When `executing-plans` delegates to `subagent-driven-development`, both skills trigger `finishing-a-development-branch` at completion, causing the 4-option prompt to appear twice.

**How to apply:** Before invoking `finishing-a-development-branch`, check whether it was already presented in this session. If yes, skip it silently.
