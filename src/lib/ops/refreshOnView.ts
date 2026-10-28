/**
 * Freshness at no extra wake-up: when someone opens a page, the database is
 * already awake for them, so any job behind that page that's gone stale runs
 * right after the response (its own function call, as the tick would make it).
 * It shares the tick's `tick:<path>` record, so the tick then sees it as fresh,
 * and claims it before starting, so a burst of viewers starts it once.
 */
import { after } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { recordPollLog } from "@/lib/pollingPolicy";

/** [cron path, minutes after which it's stale]. */
export type ViewJob = [path: string, staleMinutes: number];

export async function refreshOnView(jobs: ViewJob[]): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !jobs.length) return;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return;
  const origin = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  after(async () => {
    try {
      const logs = await prisma.pollLog.findMany({ where: { jobName: { in: jobs.map(([p]) => `tick:${p}`) } }, select: { jobName: true, lastPolledAt: true } });
      const last = new Map(logs.map((l) => [l.jobName.slice(5), l.lastPolledAt.getTime()]));
      const stale = jobs.filter(([p, m]) => Date.now() - (last.get(p) ?? 0) > m * 60_000);
      await Promise.all(
        stale.map(async ([p]) => {
          await recordPollLog(`tick:${p}`, "running (on view)");
          const res = await fetch(`${origin}/api/cron/${p}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(55_000) }).catch(() => null);
          await recordPollLog(`tick:${p}`, res ? `${res.ok ? "ok" : "error"} ${res.status} (on view)` : "still running at the view's deadline");
        }),
      );
    } catch {
      // Best effort: the tick covers it.
    }
  });
}
