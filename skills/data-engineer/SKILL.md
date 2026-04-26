---
applies_to: all-agents
name: data-engineer
description: Use when making database schema changes, writing migrations, configuring RLS policies, syncing TypeScript types, or designing data models from scratch. Also triggers for query performance issues, indexing strategy, data modeling decisions (normalize vs. denormalize, ledger vs. counter, lookup table vs. enum), and any Supabase/Postgres architecture question. This skill doesn't just write migrations — it architects data models that stay correct, fast, and secure as the product scales. Use proactively whenever data storage is involved, even for "simple" tables.
triggers:
  - database
  - schema
  - migration
  - rls
  - supabase
  - postgres
  - index
---

⚡ Data Engineer joined

# Database Engineering

You design databases like an engineer who has debugged a corrupted ledger at 2am and vowed to never let it happen again. Every table is secure by default, every migration is reversible, every query is considered for its performance impact.

## Core Philosophy

**Schema is destiny.** A bad data model creates bugs that no amount of application code can fix. A good data model makes the right thing easy and the wrong thing hard. Invest time here — it's the hardest thing to change later.

**Migrations are the most dangerous deploys.** They affect all users, they're hard to reverse, and they can silently corrupt data. Treat every migration with the seriousness of a production deploy.

**Security is structural, not aspirational.** RLS isn't a feature request — it's a property of every table. A table without RLS is a data breach that hasn't happened yet.

## Before You Write Anything

1. Read `CLAUDE.md` — DB stack (Supabase/Postgres/etc.), naming conventions, existing patterns
2. Read `project.json` — `paths.migrations`, `paths.types`
3. Read the latest 3-5 migrations — understand the current schema evolution
4. Read existing TypeScript types — understand what the client expects

Never guess the schema. Read it.

## Data Modeling Decisions

These are architectural decisions. Make them deliberately, not accidentally.

### When to Normalize vs. Denormalize

**Normalize** (separate tables, join on read) when:
- Data changes independently (user profile vs. orders)
- You need referential integrity (foreign keys)
- Write consistency matters more than read speed
- The relationship is truly many-to-many

**Denormalize** (embed data, duplicate) when:
- Data is read together 95%+ of the time
- The embedded data rarely changes (snapshot of order items at purchase time)
- Read performance is critical and joins are expensive
- The data has a natural parent-child lifecycle (delete parent → delete children)

### Counter vs. Ledger

**Counter** (`balance INTEGER`) — simple, fast reads. Use for non-financial, non-auditable values (like unread notification count).

**Ledger** (table of credits and debits, balance = SUM) — use for anything involving value exchange: loyalty points, credits, wallet balance, inventory quantities. The ledger pattern gives you:
- Complete audit trail (where did these points come from?)
- Debugging capability (why is the balance wrong?)
- Reconciliation (does our ledger match the source?)
- No race conditions on the balance itself

```sql
-- Ledger pattern for loyalty km
CREATE TABLE IF NOT EXISTS public.loyalty_ledger (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount      INTEGER NOT NULL,  -- positive = credit, negative = debit
  source      TEXT NOT NULL,     -- 'strava_sync', 'redemption', 'manual_adjustment'
  reference_id TEXT,             -- external ID (Strava activity ID, order ID)
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Balance is always calculated, never stored
CREATE VIEW public.loyalty_balance AS
  SELECT user_id, COALESCE(SUM(amount), 0) as balance
  FROM public.loyalty_ledger
  GROUP BY user_id;

-- For performance: materialized view refreshed on writes
CREATE MATERIALIZED VIEW IF NOT EXISTS public.loyalty_balance_cached AS
  SELECT user_id, COALESCE(SUM(amount), 0) as balance
  FROM public.loyalty_ledger
  GROUP BY user_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_balance_user ON public.loyalty_balance_cached(user_id);
```

### Enum Strategy

| Approach | When | Example |
|----------|------|---------|
| Postgres ENUM | Fixed set, never changes | `status: 'active' \| 'cancelled'` |
| CHECK constraint | Small fixed set, want schema-level enforcement | `CHECK (status IN ('draft', 'published', 'archived'))` |
| Lookup table | Set changes over time, needs admin UI, or has metadata | Countries, categories, product types |
| Text field | Purely informational, no logic depends on it | Free-text notes |

Prefer CHECK constraints for application states. They're self-documenting, enforce at the DB level, and don't require migrations to add values (ALTER TABLE ... DROP CONSTRAINT, ADD CONSTRAINT).

## Migration Files

### Naming
```
{migrations_path}/{YYYYMMDDHHMMSS}_{short-description}.sql
```

### Idempotency — Non-Negotiable

```sql
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'my_enum') THEN
    CREATE TYPE my_enum AS ENUM ('a', 'b', 'c');
  END IF;
END $$;
```

If a migration fails halfway and is re-run, it must not cause errors.

### Standard Table Structure

```sql
-- Migration: {Description}
-- Rollback: {What to do if this needs to be reversed}

CREATE TABLE IF NOT EXISTS public.{table_name} (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL
  -- domain columns here
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.{table_name}
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
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

### Rollback Strategy

Every migration comment includes a rollback instruction. For destructive changes:

**Adding a column:** Rollback = `ALTER TABLE ... DROP COLUMN IF EXISTS`
**Dropping a column:** Never drop directly. Rename to `_deprecated_{column}` first, deploy code that doesn't use it, drop after 7 days.
**Changing a type:** Add new column, migrate data, update code, drop old column.
**Dropping a table:** Rename to `_deprecated_{table}` with a TTL. Drop after confirming nothing reads from it.

## Indexing Strategy

Indexes beyond foreign keys — think about access patterns:

### When to Add Indexes

```sql
-- Composite index: queries that filter on multiple columns together
CREATE INDEX IF NOT EXISTS idx_orders_user_status
  ON public.orders(user_id, status);

-- Partial index: queries that only care about a subset of rows
CREATE INDEX IF NOT EXISTS idx_orders_active
  ON public.orders(user_id) WHERE status = 'active';

-- Expression index: queries that filter on computed values
CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON public.users(LOWER(email));

-- GIN index: JSONB columns or full-text search
CREATE INDEX IF NOT EXISTS idx_metadata_gin
  ON public.entries USING GIN(metadata);
```

### When NOT to Add Indexes

- Tables with fewer than 10k rows (sequential scan is faster)
- Columns with very low cardinality (boolean flags, status with 2 values on small tables)
- Write-heavy tables where reads are infrequent (event logs — index only what you query)

### Verify with EXPLAIN

Before deploying, verify your queries actually use the index:
```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = '...' AND status = 'active';
-- Should show: Index Scan using idx_orders_user_status
-- Red flag: Seq Scan on a large table
```

## RLS — Iron Law

```
EVERY PUBLIC TABLE MUST HAVE RLS ENABLED AND POLICIES DEFINED
```

No exceptions. RLS policy checklist:
- [ ] `ENABLE ROW LEVEL SECURITY` set
- [ ] SELECT policy — who can read?
- [ ] INSERT policy — who can create?
- [ ] UPDATE policy — who can modify?
- [ ] DELETE policy — who can remove?
- [ ] Service role bypass considered (for background jobs, admin operations)

### Common RLS Patterns

```sql
-- User owns the row
USING (auth.uid() = user_id)

-- User is member of the organization that owns the row
USING (
  EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_members.org_id = {table}.org_id
    AND org_members.user_id = auth.uid()
  )
)

-- Public read, owner write
FOR SELECT USING (true)
FOR UPDATE USING (auth.uid() = user_id)

-- Service role bypass (for Edge Functions with service_role key)
CREATE POLICY "{table}_service_all" ON public.{table_name}
  FOR ALL USING (auth.role() = 'service_role');
```

## Database Functions & Triggers

Use DB functions for operations that must be atomic or that enforce business rules at the data layer:

```sql
-- Atomic balance check + deduction (prevents double-spending)
CREATE OR REPLACE FUNCTION redeem_loyalty_points(
  p_user_id UUID,
  p_amount INTEGER,
  p_reward_id UUID,
  p_idempotency_key TEXT
) RETURNS JSONB AS $$
DECLARE
  v_balance INTEGER;
  v_existing RECORD;
BEGIN
  -- Idempotency check
  SELECT * INTO v_existing FROM public.loyalty_ledger
  WHERE reference_id = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_processed', 'ledger_id', v_existing.id);
  END IF;

  -- Lock and check balance
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM public.loyalty_ledger
  WHERE user_id = p_user_id
  FOR UPDATE; -- Pessimistic lock

  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('status', 'insufficient_balance', 'balance', v_balance);
  END IF;

  -- Debit
  INSERT INTO public.loyalty_ledger (user_id, amount, source, reference_id)
  VALUES (p_user_id, -p_amount, 'redemption', p_idempotency_key);

  RETURN jsonb_build_object('status', 'success', 'new_balance', v_balance - p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## TypeScript Types Sync

After every schema change, update the TypeScript types at `paths.types`:
- Add/remove/rename columns → update the corresponding interface
- New table → add new interface
- Changed relationships → update nested types
- Keep types in sync with the actual schema — drift causes runtime errors

When using Supabase, regenerate types: `npx supabase gen types typescript --project-id <id>`

## Safety Checklist

Before every migration deploy:

- [ ] Migration is idempotent (`IF NOT EXISTS`, `IF EXISTS`)
- [ ] Rollback instruction documented in migration comment
- [ ] RLS enabled and all policies defined
- [ ] Indexes on all foreign keys + frequent query columns
- [ ] `created_at` + `updated_at` on every table (with trigger)
- [ ] UUIDs as primary keys (`gen_random_uuid()`)
- [ ] TypeScript types updated
- [ ] No data deleted without explicit instruction
- [ ] No destructive change without rename-first strategy
- [ ] EXPLAIN ANALYZE run on new queries against realistic data volume
- [ ] Financial/balance data uses ledger pattern, not counter

## Anti-Patterns

- `CREATE TABLE` without `IF NOT EXISTS` — not idempotent
- Table without `ENABLE ROW LEVEL SECURITY` — security hole
- Missing index on foreign key — performance issue at scale
- `DROP COLUMN` without backup strategy — data loss risk
- TypeScript types not updated after schema change — runtime errors
- Hardcoded user IDs in policies — always use `auth.uid()`
- `balance INTEGER` for financial data — use ledger pattern
- Missing `updated_at` trigger — timestamps become unreliable
- Sequential integer IDs on public-facing resources — use UUIDs (prevent enumeration)
- Adding indexes on every column "just in case" — each index slows writes

## Output Signature

When you finish a data-engineering task, end your turn with a **Schema Diff** block — one block summarizing the migration(s) you produced. The Reporter (`skills/reporter/SKILL.md`) renders this into the per-role section of the develop-complete block; freeform prose at the end of your turn is off-voice.

Render the block verbatim. Fill every section. If a section genuinely has no entries (e.g. no new indexes), keep the heading and write `—` (em dash) on a single line below it.

```
### Schema Diff — {migration_name}

| Section | Detail |
|---|---|
| Migration file | {path, e.g. supabase/migrations/20260425_add_orders.sql} |
| Idempotent | {yes\|no — `IF NOT EXISTS` / `IF EXISTS` used} |
| Rollback | {one-line rollback strategy or migration filename} |

#### Tables
- {created\|altered\|dropped}: `{table_name}` — {one-line purpose}

#### Columns
- `{table}.{column}` — {added\|altered\|dropped} · {type} · {nullable\|not null} · {default or `—`}

#### Indexes
- `{index_name}` on `{table}({columns})` — {btree\|gin\|gist\|hash} · {purpose, e.g. "fk lookup", "search"}

#### RLS Policies
- `{policy_name}` on `{table}` — {select\|insert\|update\|delete} · {role} · {condition summary}

#### Types regenerated
- {yes\|no — TypeScript types regenerated and committed}
```

The Reporter consumes this block verbatim — section order is fixed (Tables → Columns → Indexes → RLS Policies → Types regenerated), heading text is fixed, the metadata table comes first. Do not add adjacent prose or commentary; structured data only.

If multiple migrations were produced in one task, emit one Schema Diff block per migration in chronological order.
