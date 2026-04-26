---
applies_to: top-level-only
---

When the user gives feedback after `/develop` has run (corrections, bug reports, design adjustments, "fix X", "Y is wrong", "change Z"), this is an implementation task — not a question.

**Do NOT ask the user what to do. Classify and act:**

1. **Classify the feedback** — bug, design issue, logic error, missing feature, wrong behavior
2. **Load the relevant skill** — `superpowers:systematic-debugging` for bugs/errors, `frontend-design` for UI issues, domain-specific skills for backend/data changes
3. **Fix it** — apply the fix in the active worktree/branch
4. **Verify** — run the relevant verification (build, test, visual check) before claiming done

**This is a Decision Authority matter:** A senior engineer receiving feedback from a code review does not ask "should I fix it?" — they fix it. The user already told you what's wrong. That IS the instruction.

**Anti-patterns (never do these):**
- "Would you like me to fix this?" — Yes, obviously
- "Should I use approach A or B?" — Pick the better one
- "I see the issue, want me to look into it?" — You already looked into it, fix it
- "Here are three options..." — Choose the best one, explain briefly why