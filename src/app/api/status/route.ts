import { prisma } from "@/lib/prisma";
import { getComputeBudget } from "@/lib/ops/computeBudget";

/**
 * Public, read-only cron health check — no CRON_SECRET required, unlike
 * /api/cron/*. Lets anyone (a monitoring script, a scheduled check, or just
 * you in a browser) confirm each polling job's lastPolledAt without DB
 * access, since there's no other way to see this from outside a running
 * deployment (see sync-schedule's route comment on Vercel "Sensitive" env vars).
 */
export async function GET() {
  // Read first and reported either way: when the database is refusing queries,
  // the budget is usually why.
  const compute = await getComputeBudget();
  try {
    const jobs = await prisma.pollLog.findMany({
      orderBy: { jobName: "asc" },
    });
    return Response.json({ compute, jobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ compute, error: message }, { status: 503 });
  }
}
