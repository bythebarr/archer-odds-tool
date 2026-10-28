/**
 * "Did we already post this today?" — the idempotency guard behind the tick-based
 * schedule (see ./schedule).
 *
 * Posting is event-driven: the posting jobs run several times a day (see
 * lib/ops/schedule.ts) and most runs do nothing. Without a marker, the first run
 * past the lead window would post, and so would every run after it.
 *
 * The marker holds the last few ET dates posted (comma-separated, newest last),
 * not just one. The recap checks yesterday AND today on every run, so a single
 * date would flip: posting today's recap would make yesterday read "not posted"
 * and re-post it. A lone date from before this change still reads correctly.
 *
 * Rides on PollLog rather than a new table: same shape (one row per job, last
 * run + a status string), already provisioned in prod.
 */
import { prisma } from "@/lib/prisma";

export type PostJob = "post-card" | "post-results" | "post-tip";

/** How many recent dates the marker remembers. */
const KEEP_DATES = 7;

/** The dates a marker value records. Pure. */
export function postedDates(lastStatus: string | null | undefined): string[] {
  return (lastStatus ?? "").split(",").filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

/** The marker value after posting `dateEt`: added once, newest last, the last KEEP_DATES kept. Pure. */
export function withPostedDate(lastStatus: string | null | undefined, dateEt: string): string {
  return [...postedDates(lastStatus).filter((d) => d !== dateEt), dateEt].slice(-KEEP_DATES).join(",");
}

/** Has `job` already run for this ET date? */
export async function alreadyPosted(job: PostJob, dateEt: string): Promise<boolean> {
  const row = await prisma.pollLog.findUnique({ where: { jobName: job } });
  return postedDates(row?.lastStatus).includes(dateEt);
}

/**
 * When `job` posted for this ET date, or null if it hasn't. Exact for the most
 * recent date posted; an older date reads the latest post's time.
 */
export async function postedAt(job: PostJob, dateEt: string): Promise<Date | null> {
  const row = await prisma.pollLog.findUnique({ where: { jobName: job } });
  return postedDates(row?.lastStatus).includes(dateEt) ? row!.lastPolledAt : null;
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
  const row = await prisma.pollLog.findUnique({ where: { jobName: job } });
  const lastStatus = withPostedDate(row?.lastStatus, dateEt);
  await prisma.pollLog.upsert({
    where: { jobName: job },
    create: { jobName: job, lastPolledAt: new Date(), lastStatus },
    update: { lastPolledAt: new Date(), lastStatus },
  });
}
