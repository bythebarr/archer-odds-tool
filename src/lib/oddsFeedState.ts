/**
 * Is the multi-book odds feed live, or frozen? Display only: this decides how
 * a price is shown (a live edge, or a greyed one dated "Prices from Nov 1"),
 * never what is priced or posted.
 *
 * The feed is FROZEN when either:
 *   - quota dry: the credits guardrail is blocking (its PollLog status reads
 *     "blocked…", see pollingPolicy.ts), so no paid poll will run; or
 *   - too old: no credit-spending odds job has polled within its own
 *     scheduled gap (lib/ops/schedule), plus pollingPolicy's far-tier
 *     interval as grace for a late tick.
 *
 * "Prices from" is the newest of those jobs' successful polls: a real date
 * from the data, never a guess. Pure; the server reader is getOddsFeedState.
 */
import { JOBS } from "@/lib/ops/schedule";
import { determineTier } from "@/lib/pollingPolicy";

/** The jobs that buy multi-book prices. The free ESPN feeds carry one book and don't make "every book" true. */
export const PAID_ODDS_JOBS = ["poll-odds", "poll-odds-nba", "poll-odds-nfl", "poll-odds-nhl"] as const;
export const CREDITS_GUARDRAIL_JOB = "credits-guardrail";

export interface PollRow {
  jobName: string;
  lastPolledAt: Date;
  lastStatus: string;
}

export interface OddsFeedState {
  frozen: boolean;
  /** Why it's frozen, in plain words; null when live. */
  reason: string | null;
  /** The newest multi-book poll; null when none has ever run. */
  pricesAsOf: Date | null;
}

/** The longest stretch a job's schedule leaves between runs, in minutes. */
export function scheduledGapMinutes(jobPath: string): number | null {
  const job = JOBS.find((j) => j.path === jobPath);
  if (!job) return null;
  if (job.every) return job.every;
  if (!job.hours?.length) return null;
  const hours = [...new Set(job.hours)].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 0; i < hours.length; i++) {
    const next = i + 1 < hours.length ? hours[i + 1] : hours[0] + 24;
    gap = Math.max(gap, next - hours[i]);
  }
  return gap * 60;
}

/** Grace on top of a schedule gap: pollingPolicy's far-tier interval. */
const GRACE_MINUTES = determineTier(null).intervalMinutes;

export function oddsFeedState(rows: PollRow[], now: Date = new Date()): OddsFeedState {
  const paid = rows.filter((r) => (PAID_ODDS_JOBS as readonly string[]).includes(r.jobName));
  const ok = paid.filter((r) => !r.lastStatus.toLowerCase().startsWith("error") && !r.lastStatus.toLowerCase().startsWith("blocked"));
  const pricesAsOf = ok.length ? new Date(Math.max(...ok.map((r) => r.lastPolledAt.getTime()))) : null;

  const guardrail = rows.find((r) => r.jobName === CREDITS_GUARDRAIL_JOB);
  if (guardrail && guardrail.lastStatus.toLowerCase().startsWith("blocked")) return { frozen: true, reason: "odds quota is used up", pricesAsOf };
  if (paid.some((r) => r.lastStatus.toLowerCase().startsWith("blocked"))) return { frozen: true, reason: "odds quota is used up", pricesAsOf };

  const fresh = ok.some((r) => {
    const gap = scheduledGapMinutes(r.jobName);
    return gap !== null && (now.getTime() - r.lastPolledAt.getTime()) / 60_000 <= gap + GRACE_MINUTES;
  });
  if (!fresh) return { frozen: true, reason: pricesAsOf ? "no multi-book poll since then" : "no multi-book poll on record", pricesAsOf };
  return { frozen: false, reason: null, pricesAsOf };
}

/** "Nov 1" in Eastern time: the date the frozen prices are from. */
export function pricesFromLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(d);
}
