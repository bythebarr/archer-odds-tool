/**
 * "Did we already post this today?" — the idempotency guard behind the tick-based
 * schedule (see ./schedule).
 *
 * Because posting is now event-driven, the crons fire every few minutes and most
 * ticks do nothing. Without a marker, the first tick past the lead window would
 * post, and so would every tick after it. The ET card date is stored as the
 * marker value, so the guard resets naturally at midnight ET with no cleanup job.
 *
 * Rides on PollLog rather than a new table: same shape (one row per job, last
 * run + a status string), already provisioned in prod.
 */
import { prisma } from "@/lib/prisma";

export type PostJob = "post-card" | "post-results";

/** Has `job` already run for this ET date? */
export async function alreadyPosted(job: PostJob, dateEt: string): Promise<boolean> {
  const row = await prisma.pollLog.findUnique({ where: { jobName: job } });
  return row?.lastStatus === dateEt;
}

/**
 * Record that `job` posted for this ET date.
 *
 * Callers MUST mark only after the webhook resolves. Marking first would make a
 * failed post permanent — the day would be skipped and no later tick could
 * recover it — whereas marking after means a mid-post crash simply retries on
 * the next tick. Duplicate-on-retry is the safer failure than silence.
 */
export async function markPosted(job: PostJob, dateEt: string): Promise<void> {
  await prisma.pollLog.upsert({
    where: { jobName: job },
    create: { jobName: job, lastPolledAt: new Date(), lastStatus: dateEt },
    update: { lastPolledAt: new Date(), lastStatus: dateEt },
  });
}
