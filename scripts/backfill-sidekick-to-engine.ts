/**
 * Backfill sidekick_conversations, sidekick_messages, threads, and thread_messages
 * from the Board-DB into the Engine-DB (T-924).
 *
 * Board-DB is authoritative. Rows are copied verbatim and upserted by id
 * (Engine-DB PostgREST with `Prefer: resolution=merge-duplicates`), so this
 * script is idempotent when run multiple times with --apply.
 *
 * Usage:
 *
 *   # Dry-run (default): count rows, show first 3 of each table, verify target.
 *   npx tsx scripts/backfill-sidekick-to-engine.ts --dry-run
 *
 *   # Apply: copy rows from Board to Engine in FK-safe order, 100 rows at a time.
 *   BOARD_SUPABASE_URL=... BOARD_SUPABASE_SERVICE_KEY=... \
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *     npx tsx scripts/backfill-sidekick-to-engine.ts --apply
 *
 *   # Rollback (Engine-DB only — never touches Board-DB):
 *   npx tsx scripts/backfill-sidekick-to-engine.ts --rollback --confirm
 *
 * Exit codes: 0 on success, 1 on any Board GET failure or Engine write failure.
 */

const TABLES = [
  "sidekick_conversations",
  "sidekick_messages",
  "threads",
  "thread_messages",
] as const;
type Table = (typeof TABLES)[number];

const PAGE_SIZE = 1000;
const BATCH_SIZE = 100;

function log(msg: string): void {
  console.log(`[backfill] ${msg}`);
}

function err(msg: string): void {
  console.error(`[backfill] ERROR: ${msg}`);
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    err(`missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

interface Creds {
  url: string;
  key: string;
}

function boardCreds(): Creds {
  return { url: getEnv("BOARD_SUPABASE_URL"), key: getEnv("BOARD_SUPABASE_SERVICE_KEY") };
}

function engineCreds(): Creds {
  return { url: getEnv("SUPABASE_URL"), key: getEnv("SUPABASE_SERVICE_KEY") };
}

function headers(creds: Creds, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: creds.key,
    Authorization: `Bearer ${creds.key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function getRows(creds: Creds, table: Table, limit: number, offset: number): Promise<unknown[]> {
  const path = `/rest/v1/${table}?order=created_at.asc&limit=${limit}&offset=${offset}`;
  const res = await fetch(`${creds.url}${path}`, { headers: headers(creds) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${table} offset=${offset} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as unknown[];
}

async function countRows(creds: Creds, table: Table): Promise<number> {
  const path = `/rest/v1/${table}?select=id`;
  const res = await fetch(`${creds.url}${path}`, {
    headers: headers(creds, { Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HEAD-count ${table} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const contentRange = res.headers.get("content-range") ?? "";
  const total = contentRange.split("/")[1];
  if (total && total !== "*") {
    return Number(total);
  }
  // Fallback: if the server did not return a total, stream pages and count.
  let n = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await getRows(creds, table, PAGE_SIZE, offset);
    n += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  return n;
}

async function upsertBatch(creds: Creds, table: Table, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  const path = `/rest/v1/${table}`;
  const res = await fetch(`${creds.url}${path}`, {
    method: "POST",
    headers: headers(creds, {
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST ${table} batch (${rows.length} rows) failed: ${res.status} ${body.slice(0, 500)}`);
  }
}

async function deleteAll(creds: Creds, table: Table): Promise<number> {
  const path = `/rest/v1/${table}?id=neq.00000000-0000-0000-0000-000000000000`;
  const res = await fetch(`${creds.url}${path}`, {
    method: "DELETE",
    headers: headers(creds, { Prefer: "count=exact,return=minimal" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DELETE ${table} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const contentRange = res.headers.get("content-range") ?? "";
  const deleted = contentRange.split("/")[0]?.split("-")[1];
  return deleted ? Number(deleted) + 1 : 0;
}

async function runDryRun(): Promise<void> {
  log("mode: --dry-run (no writes)");
  const board = boardCreds();
  const engine = engineCreds();

  log("Board-DB source counts:");
  for (const table of TABLES) {
    const count = await countRows(board, table);
    log(`  ${table}: ${count} rows`);
    const sample = await getRows(board, table, 3, 0);
    for (let i = 0; i < sample.length; i++) {
      const id = (sample[i] as { id?: string }).id ?? "<no-id>";
      log(`    [${i}] id=${id}`);
    }
  }

  log("Engine-DB target table reachability:");
  for (const table of TABLES) {
    try {
      const rows = await getRows(engine, table, 1, 0);
      log(`  ${table}: reachable (current rows sampled: ${rows.length})`);
    } catch (e) {
      err(`  ${table}: NOT reachable — ${(e as Error).message}`);
      process.exit(1);
    }
  }

  log("dry-run complete — re-run with --apply to copy rows");
}

async function runApply(): Promise<void> {
  log("mode: --apply (writing to Engine-DB)");
  const board = boardCreds();
  const engine = engineCreds();

  for (const table of TABLES) {
    log(`copying ${table} ...`);
    let copied = 0;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let page: unknown[];
      try {
        page = await getRows(board, table, PAGE_SIZE, offset);
      } catch (e) {
        err(`Board GET failed for ${table} at offset=${offset}: ${(e as Error).message}`);
        process.exit(1);
      }
      if (page.length === 0) break;

      for (let i = 0; i < page.length; i += BATCH_SIZE) {
        const batch = page.slice(i, i + BATCH_SIZE);
        try {
          await upsertBatch(engine, table, batch);
        } catch (e) {
          err(`Engine upsert failed for ${table} at offset=${offset + i} (batch size ${batch.length}): ${(e as Error).message}`);
          err(`Fail-fast. Completed tables/rows so far are NOT rolled back automatically.`);
          err(`To undo a partial run, use: npx tsx scripts/backfill-sidekick-to-engine.ts --rollback --confirm`);
          process.exit(1);
        }
        copied += batch.length;
        log(`  ${table}: copied ${copied} rows`);
      }

      if (page.length < PAGE_SIZE) break;
    }
    log(`  ${table}: DONE — ${copied} rows copied`);
  }

  log("apply complete — all 4 tables copied successfully");
}

async function runRollback(confirm: boolean): Promise<void> {
  log("mode: --rollback (Engine-DB ONLY — Board-DB is never touched)");

  const engine = engineCreds();

  // Reverse FK order so children are deleted before parents.
  const reverseOrder: Table[] = ["thread_messages", "threads", "sidekick_messages", "sidekick_conversations"];

  if (!confirm) {
    log("DRY rollback (no --confirm flag): would delete all rows from these Engine-DB tables in order:");
    for (const table of reverseOrder) {
      try {
        const count = await countRows(engine, table);
        log(`  ${table}: ${count} rows would be deleted`);
      } catch (e) {
        err(`  ${table}: count failed — ${(e as Error).message}`);
      }
    }
    log("re-run with --confirm to actually delete");
    return;
  }

  log("DELETING rows from Engine-DB (irreversible)");
  for (const table of reverseOrder) {
    try {
      const deleted = await deleteAll(engine, table);
      log(`  ${table}: deleted ${deleted} rows`);
    } catch (e) {
      err(`Rollback failed for ${table}: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  log("rollback complete");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const rollback = args.includes("--rollback");
  const confirm = args.includes("--confirm");

  if (apply && rollback) {
    err("--apply and --rollback are mutually exclusive");
    process.exit(1);
  }

  if (rollback) {
    await runRollback(confirm);
    return;
  }

  if (apply) {
    await runApply();
    return;
  }

  await runDryRun();
}

main().catch((e) => {
  err((e as Error).message);
  process.exit(1);
});
