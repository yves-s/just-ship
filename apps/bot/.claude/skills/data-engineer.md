---
name: data-engineer
description: Use when making database schema changes, writing migrations, configuring RLS policies, or syncing TypeScript types — enforces safe, reversible, and secure database operations
---

# Database Engineering Standards

## Overview

Database changes are the most dangerous changes in any system. They affect all users, are hard to reverse, and can silently corrupt data.

**Core principle:** Every migration is idempotent, every table has RLS, every change is reviewable.

**Announce at start:** "Reading existing schema and migrations before making any changes."

## Step 1: Understand the Current Schema

Before writing any migration:
1. Read `CLAUDE.md` — DB stack (Supabase/Postgres/etc.), naming conventions, existing patterns
2. Read `project.json` — `paths.migrations`, `paths.types`
3. Read the latest migrations — understand current state
4. Read existing TypeScript types — understand what the client expects

Never guess the schema. Read it.

## Step 2: Migration File

### Naming
```
{migrations_path}/{YYYYMMDDHHMMSS}_{short-description}.sql
```

Example: `20240315143022_add_user_preferences.sql`

### Always Idempotent

```sql
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
DROP TABLE IF EXISTS ...
```

If a migration fails halfway and is re-run, it must not cause errors.

### Standard Table Structure

```sql
-- Migration: {Description}

CREATE TABLE IF NOT EXISTS public.{table_name} (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL
  -- domain columns here
);

-- Indexes on foreign keys and frequently queried columns
CREATE INDEX IF NOT EXISTS idx_{table}_{column} ON public.{table_name}({column});

-- RLS — mandatory
ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;

CREATE POLICY "{table}_select_own" ON public.{table_name}
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "{table}_insert_own" ON public.{table_name}
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "{table}_update_own" ON public.{table_name}
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "{table}_delete_own" ON public.{table_name}
  FOR DELETE USING (auth.uid() = user_id);
```

## Step 3: RLS — Iron Law

```
EVERY PUBLIC TABLE MUST HAVE RLS ENABLED AND POLICIES DEFINED
```

No exceptions. A table without RLS is a data breach waiting to happen.

RLS policy checklist:
- [ ] `ENABLE ROW LEVEL SECURITY` set
- [ ] SELECT policy — who can read?
- [ ] INSERT policy — who can create?
- [ ] UPDATE policy — who can modify?
- [ ] DELETE policy — who can remove?
- [ ] Admin/service role access considered (if needed)

## Step 4: TypeScript Types Sync

After every schema change, update the TypeScript types at `paths.types` (from `project.json`):

- Add/remove/rename columns → update the corresponding interface
- New table → add new interface
- Changed relationships → update nested types
- Keep types in sync with the actual schema — drift causes runtime errors

## Step 5: Safety Checklist

- [ ] Migration is idempotent (`IF NOT EXISTS`, `IF EXISTS`)
- [ ] RLS enabled and all 4 policies defined
- [ ] Indexes on all foreign keys
- [ ] `created_at` + `updated_at` on every table
- [ ] UUIDs as primary keys (`gen_random_uuid()`)
- [ ] TypeScript types updated
- [ ] No data deleted without explicit instruction
- [ ] No destructive change (`DROP COLUMN`, `DROP TABLE`) without confirming with orchestrator

## Anti-Patterns

- `CREATE TABLE` without `IF NOT EXISTS` — not idempotent
- Table without `ENABLE ROW LEVEL SECURITY` — security hole
- Missing index on foreign key — performance issue at scale
- `ALTER TABLE ... DROP COLUMN` without backup strategy — data loss risk
- TypeScript types not updated after schema change — runtime errors
- Hardcoded user IDs or values in policies — always use `auth.uid()`
