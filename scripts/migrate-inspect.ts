import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * Read-only: why `prisma migrate deploy` can't take its lock (P1002). Prints
 * every advisory lock held or awaited and the session behind it, the
 * migration history for the NHL migrations, and whether the corrected NHL
 * constraint is in place. Run from the Model lab (script: migrate:inspect).
 */
async function main() {
  const locks = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT l.pid, l.granted, l.objid::text AS objid, a.state, a.application_name, a.client_addr::text AS client,
           a.backend_start::text AS backend_start, a.state_change::text AS state_change, left(a.query, 120) AS query
    FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory'`);
  console.log(`== advisory locks (${locks.length}) ==`);
  for (const l of locks) console.log(JSON.stringify(l));

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT migration_name, started_at::text, finished_at::text, rolled_back_at::text, applied_steps_count, left(coalesce(logs, ''), 300) AS logs
    FROM _prisma_migrations WHERE migration_name LIKE '%nhl%' ORDER BY started_at`);
  console.log(`== NHL migration records (${rows.length}) ==`);
  for (const r of rows) console.log(JSON.stringify(r));

  const check = await prisma.$queryRawUnsafe<{ def: string }[]>(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'game_sport_competitor_check'`);
  console.log(`== game_sport_competitor_check ==`);
  console.log(check[0]?.def ?? "(missing)");
  console.log(`includes nhl: ${check[0]?.def.includes("'nhl'") ?? false}`);

  // Rows the corrected constraint would reject: if any, applying it would fail and block deploys again.
  const bad = await prisma.$queryRawUnsafe<{ sport: string; n: bigint }[]>(`
    SELECT sport, count(*) AS n FROM "Game" WHERE NOT (
      (sport IN ('mlb', 'soccer', 'nfl', 'nba', 'nhl') AND "homeTeamId" IS NOT NULL AND "awayTeamId" IS NOT NULL AND "homePlayerId" IS NULL AND "awayPlayerId" IS NULL)
      OR (sport = 'tennis' AND "homePlayerId" IS NOT NULL AND "awayPlayerId" IS NOT NULL AND "homeTeamId" IS NULL AND "awayTeamId" IS NULL)
    ) GROUP BY sport`);
  console.log(`== Game rows the corrected constraint would reject (${bad.length} sports) ==`);
  for (const b of bad) console.log(`${b.sport}: ${b.n}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
