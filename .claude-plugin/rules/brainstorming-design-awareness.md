When brainstorming involves visual, UI, or UX topics — especially when the Visual Companion is active — apply the project's design skills before generating mockups.

**Before writing any HTML mockup**, read the relevant skills from `skills/`:

| Topic | Read |
|---|---|
| Greenfield / creative aesthetics | `skills/creative-design.md` |
| Component patterns, states, design tokens | `skills/frontend-design.md` |
| User flows, screens, IA | `skills/ux-planning.md` |

**Why:** The Visual Companion generates generic wireframes without design expertise. The project has dedicated design skills that define quality standards, anti-patterns (Anti-AI-Slop), and UX methodology — but they're not automatically loaded during brainstorming.

**How to apply:**
1. At the start of brainstorming, assess whether the topic involves UI/UX
2. If yes, read the relevant skill files before the first visual question
3. Apply Anti-AI-Slop rules from `creative-design.md` to every mockup: no generic fonts, no purple gradients, no centered-everything layouts, distinctive typography
4. Apply UX planning principles: map user flows before designing screens, define all states (empty, loading, error), information architecture before visual polish
5. If the target project has an existing design system (shadcn/ui, tailwind, theme files), read `frontend-design.md` and use the project's actual tokens/components in mockups
