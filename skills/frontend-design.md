---
name: frontend-design
description: Use when implementing frontend UI components or features within an existing design system or component library
---

# Frontend Implementation with Design Quality

## Overview

Frontend work is where design intent meets code reality. Your job is to make the design system work in every context, edge case included.

**Announce at start:** "Reading design system and existing component patterns before implementing."

## Step 1: Understand the Design System

Read the project's token/theme file before writing a single line:
- Token values (colors, spacing, typography, radius, shadows)
- Existing component library — what already exists?
- Naming conventions (CSS classes, component names, prop names)

## Step 2: Find the Right Pattern

Before creating a new component, check:
1. Does a component already exist for this use case?
2. Can an existing component be extended via shadcn/ui? (`npx shadcn@latest add <component>`)
3. What's the closest existing implementation to reference?

## Step 3: Implement — Component Checklist

### Structure
- [ ] Single responsibility — one component does one thing
- [ ] Props are typed and documented
- [ ] No inline styles — all from token system
- [ ] Variants via props, not separate components

### States (ALL required)
```
Default | Hover | Active | Focus | Disabled
Loading | Empty | Error  | Success
```
Empty and Error states ship with every data-displaying component.

### Responsive
```
Mobile base → md: tablet → lg: desktop
```
Touch targets: minimum 44×44px.

### Accessibility
- Semantic HTML first (`button` not `div onClick`)
- `aria-label` on icon-only buttons
- Focus visible and stylable

## Step 4: Shared vs. Local

| Where | What |
|-------|------|
| `paths.shared` (from project.json) | Hooks, types, utilities used by multiple apps |
| App directory | Components specific to one app |
| Design system / component lib | Purely presentational, no business logic |

Never put shared logic inside a single app's directory.

## Step 5: Verify

```bash
# Run from project.json build.web or build.test
pnpm run build   # or npm/yarn/bun equivalent
```

Check:
- No TypeScript errors
- No console errors/warnings for your changes
- Responsive layout at 375px, 768px, 1280px breakpoints

## shadcn/ui Patterns

When the project uses shadcn/ui (check `components/ui/` or `components.json`):

**Adding components:**
```bash
npx shadcn@latest add button card dialog form input select
```

**Form validation (zod + react-hook-form):**
```tsx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(2)
})

export function MyForm() {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", name: "" }
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl><Input type="email" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </form>
    </Form>
  )
}
```

**Dark mode (next-themes):**
```tsx
// layout.tsx — wrap app
import { ThemeProvider } from "next-themes"
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
</ThemeProvider>

// Use semantic colors — they switch automatically:
// bg-background, text-foreground, text-muted-foreground, bg-card, border
// Never use bg-white/bg-black — use bg-background instead
```

## Anti-Patterns

- `any` type — forbidden without comment explaining why
- Hardcoded colors/spacing — always use tokens
- Missing error state — always implement
- Business logic in components — extract to hooks
- `console.log` left in — remove before committing
- `bg-white dark:bg-gray-900` — use `bg-background` (semantic token)
- Building custom components when shadcn/ui has one — check first
