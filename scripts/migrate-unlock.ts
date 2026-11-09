import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { unlockExitCode } from "./migrateUnlock";

/**
 * Releases a leaked Prisma migrate lock (advisory lock 72707369). A migrate
 * command run through the Neon pooler takes the session-level lock on a pooled
 * server connection; the pooler then hands that connection back to the app
 * still holding it, and every later `prisma migrate deploy` times out (P1002).
 * Ends only pooled (pgbouncer) sessions that hold that lock, and only at a
 * moment they're idle; never a session touching the migrations table.
 * Run from the Model lab (script: migrate:unlock).
 */
const PRISMA_MIGRATE_LOCK = "72707369";

type Holder = { pid: number; state: string | null; application_name: string | null; backend_start: string; query: string | null };
const holdersNow = () =>
  prisma.$queryRawUnsafe<Holder[]>(`
    SELECT l.pid, a.state, a.application_name, a.backend_start::text AS backend_start, left(a.query, 120) AS query
    FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory' AND l.granted AND l.objid::text = '${PRISMA_MIGRATE_LOCK}'`);

async function main() {
  const first = await holdersNow();
  if (!first.length) return console.log("No session holds the Prisma migrate lock: nothing to do.");
  for (const h of first) console.log(`holder: ${JSON.stringify(h)}`);
  // A leaked lock sits on a pooled connection that also serves app queries: wait (up to ~60s)
  // for a moment it's idle, so no app query is cut off. Never touch a session working on migrations.
  for (let tries = 0; tries < 300; tries++) {
    const holders = await holdersNow();
    if (!holders.length) break;
    for (const h of holders) {
      if (/_prisma_migrations/i.test(h.query ?? "") || h.application_name !== "pgbouncer") {
        console.log(`  pid ${h.pid} looks like a live migrate session (${h.application_name}): left alone.`);
        process.exitCode = 1;
        return;
      }
      if (h.state !== "idle") continue;
      const [r] = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT pg_terminate_backend(${Number(h.pid)}) AS ok`);
      console.log(`  terminated idle pooled pid ${h.pid} (try ${tries + 1}): ${r?.ok}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND objid::text = '${PRISMA_MIGRATE_LOCK}'`);
  const holdersLeft = Number(left[0]?.n ?? 0);
  console.log(`holders left: ${holdersLeft}`);
  if (holdersLeft > 0) {
    // Still locked after waiting: fail, so the workflow cannot report
    // success on a state in which the next deploy will time out again.
    console.log("lock still held: exiting 1.");
  }
  process.exitCode = unlockExitCode(holdersLeft);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
