import { checkCronAuth } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { recordPollLog } from "@/lib/pollingPolicy";
import { getComputeBudget } from "@/lib/ops/computeBudget";
import { dueJobs, tickRuns, type Job } from "@/lib/ops/schedule";

/**
 * The one scheduled cron (lib/ops/schedule.ts): wakes the database once, runs
 * every job that's due — each as its own function call, phase 1 together, then
 * phase 2 — and records when each ran. `?force=<path>` runs one job now.
 */
export const maxDuration = 60;

const DEADLINE_MS = 52_000;
const PHASE2_AFTER_MS = 25_000;

export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const started = Date.now();
  const now = new Date();
  const url = new URL(request.url);
  const force = url.searchParams.get("force");
  const budget = await getComputeBudget();
  if (!force && !tickRuns(now, budget.ratio)) return Response.json({ ran: [], skipped: "not a tick hour (or thinned for the compute budget)", budget: budget.ratio });

  const logs = await prisma.pollLog.findMany({ where: { jobName: { startsWith: "tick:" } }, select: { jobName: true, lastPolledAt: true } });
  const last = new Map(logs.map((l) => [l.jobName.slice(5), l.lastPolledAt.getTime()]));
  const due = force ? [{ path: force }] : dueJobs(now, (p) => last.get(p));

  const run = async (job: Job) => {
    // Claim it first, so an overlapping tick doesn't start it twice.
    await recordPollLog(`tick:${job.path}`, "running");
    const t = Date.now();
    try {
      const res = await fetch(`${url.origin}/api/cron/${job.path}`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        signal: AbortSignal.timeout(Math.max(1000, DEADLINE_MS - (Date.now() - started))),
      });
      const status = `${res.status} in ${((Date.now() - t) / 1000).toFixed(1)}s`;
      await recordPollLog(`tick:${job.path}`, res.ok ? `ok ${status}` : `error ${status}`);
      return { path: job.path, status };
    } catch (error) {
      // Timed out on our side: the job's own call keeps running to its limit.
      const status = error instanceof Error && error.name === "TimeoutError" ? "still running at the tick's deadline" : `error: ${error instanceof Error ? error.message : String(error)}`;
      await recordPollLog(`tick:${job.path}`, status);
      return { path: job.path, status };
    }
  };

  const first = Promise.all(due.filter((j) => (j.phase ?? 1) === 1).map(run));
  // Phase 2 (the Discord card, the recap) after phase 1 — or after 25s, so a slow crawl can't make it miss its hour.
  await Promise.race([first, new Promise((r) => setTimeout(r, PHASE2_AFTER_MS))]);
  const [phase1, phase2] = await Promise.all([first, Promise.all(due.filter((j) => j.phase === 2).map(run))]);
  const out = { ran: [...phase1, ...phase2], budget: budget.ratio, seconds: (Date.now() - started) / 1000 };
  await recordPollLog("tick", `ok: ${out.ran.length} jobs`);
  return Response.json(out);
}

export async function POST(request: Request) {
  return GET(request);
}
