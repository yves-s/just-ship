---
name: backend
description: Use when implementing API endpoints, server-side business logic, shared hooks, or backend integrations
---

# Backend Implementation Standards

## Overview

Backend code is the contract between client and data. Broken contracts break users.

**Core principle:** Every endpoint either succeeds with a predictable response or fails with a useful error. No silent failures. No leaking internals.

**Announce at start:** "Reading existing patterns and API conventions before implementing."

## Step 1: Understand the Context

Read before writing:
1. `CLAUDE.md` — backend stack, framework conventions, auth model
2. `project.json` — paths (backend, hooks, shared), build commands
3. Existing endpoints/handlers in the same area — match their patterns exactly

## Step 2: API Design

### Request / Response Contract

Every endpoint:
- Validates input before processing
- Returns consistent JSON structure
- Uses appropriate HTTP status codes

```
200 OK          — success with data
201 Created     — resource created
400 Bad Request — client error (validation)
401 Unauthorized — not authenticated
403 Forbidden   — authenticated but not authorized
404 Not Found   — resource doesn't exist
500 Internal    — server error (log, don't expose)
```

### Response Shape (consistent across project)

Read existing endpoints first — use whatever structure the project already uses. Don't invent a new shape.

## Step 3: Error Handling — Iron Law

```
NO HANDLER WITHOUT TRY/CATCH
```

```typescript
try {
  // business logic
  return { data, error: null }
} catch (error) {
  console.error('[HandlerName]', error)  // log with context
  return { data: null, error: 'Descriptive message for client' }
}
```

- Log errors server-side with context (which handler, relevant IDs)
- Return safe, descriptive messages to client — never stack traces
- Never swallow errors silently

## Step 4: Input Validation

Validate at the boundary — before any business logic:
- Required fields present
- Types correct (string, number, UUID format)
- Lengths within bounds
- Enum values valid

If invalid: return 400 immediately. Don't continue processing.

## Step 5: Security Checklist

- [ ] Auth check before any data access
- [ ] User can only access their own data (check ownership)
- [ ] Environment variables used for all secrets — never hardcoded
- [ ] No sensitive data in logs (passwords, tokens, PII)
- [ ] SQL: parameterized queries only — never string concatenation
- [ ] Rate limiting considered for public endpoints

## Step 6: Shared Logic Placement

| Where | What |
|-------|------|
| `paths.hooks` (from project.json) | Shared data-fetching hooks |
| `paths.shared` (from project.json) | Types, utilities, constants |
| `paths.backend` (from project.json) | API handlers, server-only logic |

Never import server-only code in client components.

## Step 7: Verify

```bash
# Run build or test command from project.json
```

Check:
- [ ] No TypeScript errors
- [ ] All edge cases handled (missing data, auth failure, DB error)
- [ ] No `console.log` with sensitive data
- [ ] No `any` types without justification

## Anti-Patterns

- Returning 200 with an error inside the body — use correct status codes
- Catching errors and doing nothing — always log and respond
- Hardcoded secrets — always environment variables
- Missing ownership check — always verify the user owns the resource
- `any` type — forbidden without comment
