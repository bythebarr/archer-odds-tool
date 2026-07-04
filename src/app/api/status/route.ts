import { prisma } from "@/lib/prisma";

/**
 * Public, read-only cron health check — no CRON_SECRET required, unlike
 * /api/cron/*. Lets anyone (a monitoring script, a scheduled check, or just
 * you in a browser) confirm each polling job's lastPolledAt without DB
 * access, since there's no other way to see this from outside a running
 * deployment (see sync-schedule's route comment on Vercel "Sensitive" env vars).
 */
export async function GET() {
  try {
    const jobs = await prisma.pollLog.findMany({
      orderBy: { jobName: "asc" },
    });
    return Response.json({ jobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 503 });
  }
}
