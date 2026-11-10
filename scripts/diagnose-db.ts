import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * Read-only: what the production database is doing right now. Sessions by
 * state and client, the longest-running queries, sessions waiting on locks,
 * advisory locks, connection headroom, and the biggest tables. Run from the
 * Model lab (script: diagnose:db) when the site is slow.
 */
const q = <T,>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const show = (title: string, rows: unknown[]) => {
  console.log(`\n== ${title} (${rows.length}) ==`);
  for (const r of rows) console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
};

async function main() {
  const t = Date.now();
  await q(`SELECT 1`);
  console.log(`round trip: ${Date.now() - t} ms`);
  show("connections", await q(`SELECT current_setting('max_connections')::int AS max, count(*)::int AS used FROM pg_stat_activity`));
  show(
    "sessions by state / client",
    await q(`SELECT state, application_name, wait_event_type, count(*)::int AS n FROM pg_stat_activity
             WHERE datname = current_database() GROUP BY 1, 2, 3 ORDER BY n DESC`)
  );
  show(
    "longest-running active queries",
    await q(`SELECT pid, application_name, now() - query_start AS running, wait_event_type, wait_event, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) AS query
             FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid() ORDER BY query_start LIMIT 15`)
  );
  show(
    "idle in transaction",
    await q(`SELECT pid, application_name, now() - state_change AS idle_for, left(query, 160) AS last_query
             FROM pg_stat_activity WHERE state LIKE 'idle in transaction%' ORDER BY state_change LIMIT 10`)
  );
  show(
    "sessions waiting on locks",
    await q(`SELECT a.pid, pg_blocking_pids(a.pid) AS blocked_by, now() - a.query_start AS waiting, left(a.query, 160) AS query
             FROM pg_stat_activity a WHERE cardinality(pg_blocking_pids(a.pid)) > 0`)
  );
  show("advisory locks", await q(`SELECT pid, granted, objid::text FROM pg_locks WHERE locktype = 'advisory'`));
  show(
    "biggest tables",
    await q(`SELECT relname, n_live_tup::bigint AS rows, pg_size_pretty(pg_total_relation_size(relid)) AS size
             FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`)
  );
  show("database size", await q(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
