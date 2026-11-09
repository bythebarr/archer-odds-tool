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
    // The Model lab (the weekly GitHub workflow that writes every /models
    // report card) is not a poll job and used to be invisible here — a
    // skipped or broken run aged the public page with zero in-app signal
    // (Decision 10). Derived from the report rows themselves: the newest
    // row's stamp is the last run; its sample data-as-of says whether the
    // graded data is actually moving.
    const [latestReport, latestPerModel] = await Promise.all([
      prisma.modelReport.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.modelReport.findMany({ distinct: ["model"], orderBy: [{ model: "asc" }, { createdAt: "desc" }], select: { model: true, extra: true } }),
    ]);
    const modelLab = {
      lastRunAt: latestReport?.createdAt.toISOString() ?? null,
      models: latestPerModel.length,
      latestDataAsOf: latestPerModel.reduce<string | null>((acc, r) => {
        const d = (r.extra as { sampleDataAsOf?: unknown } | null)?.sampleDataAsOf;
        return typeof d === "string" && (acc === null || d > acc) ? d : acc;
      }, null),
    };
    return Response.json({ compute, jobs, modelLab });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ compute, error: message }, { status: 503 });
  }
}
