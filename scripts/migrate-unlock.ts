import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * Releases a leaked Prisma migrate lock (advisory lock 72707369). A migrate
 * command run through the Neon pooler takes the session-level lock on a pooled
 * server connection; the pooler then hands that connection back to the app
 * still holding it, and every later `prisma migrate deploy` times out (P1002).
 * Ends only sessions that hold that lock AND are idle (not mid-migration).
 * Run from the Model lab (script: migrate:unlock).
 */
const PRISMA_MIGRATE_LOCK = "72707369";

async function main() {
  const holders = await prisma.$queryRawUnsafe<{ pid: number; state: string | null; application_name: string | null; backend_start: string }[]>(`
    SELECT l.pid, a.state, a.application_name, a.backend_start::text AS backend_start
    FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory' AND l.granted AND l.objid::text = '${PRISMA_MIGRATE_LOCK}'`);
  if (!holders.length) return console.log("No session holds the Prisma migrate lock: nothing to do.");
  for (const h of holders) {
    console.log(`holder: ${JSON.stringify(h)}`);
    if (h.state !== "idle") {
      console.log(`  pid ${h.pid} is ${h.state}, possibly a migration in progress: left alone.`);
      process.exitCode = 1;
      continue;
    }
    const [r] = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT pg_terminate_backend(${Number(h.pid)}) AS ok`);
    console.log(`  terminated idle pid ${h.pid}: ${r?.ok}`);
  }
  const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND objid::text = '${PRISMA_MIGRATE_LOCK}'`);
  console.log(`holders left: ${left[0]?.n}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
