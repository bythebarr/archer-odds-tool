import { prisma } from "@/lib/prisma";

export type PollTier = "imminent" | "approaching" | "far";

export interface TierConfig {
  tier: PollTier;
  intervalMinutes: number;
}

export const IMMINENT_THRESHOLD_MINUTES = 60;

/**
 * Tiered polling cadence, keyed off minutes until the nearest not-yet-started
 * game's first pitch. The Odds API bills per-call (markets x regions), not
 * per-game, so the only cost lever is how often we call it — this is that lever.
 * See plan doc's "Odds Ingestion & Polling" section for the table this encodes.
 */
export function determineTier(minutesToNearestFirstPitch: number | null): TierConfig {
  if (minutesToNearestFirstPitch !== null && minutesToNearestFirstPitch <= IMMINENT_THRESHOLD_MINUTES) {
    return { tier: "imminent", intervalMinutes: 5 };
  }
  if (minutesToNearestFirstPitch !== null && minutesToNearestFirstPitch <= 240) {
    return { tier: "approaching", intervalMinutes: 20 };
  }
  return { tier: "far", intervalMinutes: 60 };
}

export function shouldPollNow(
  lastPolledAt: Date | null,
  intervalMinutes: number,
  now: Date = new Date()
): boolean {
  if (!lastPolledAt) return true;
  const elapsedMinutes = (now.getTime() - lastPolledAt.getTime()) / 60_000;
  return elapsedMinutes >= intervalMinutes;
}

/** Minutes until the soonest not-yet-started game today/tomorrow, or null if none. */
export async function getMinutesToNearestFirstPitch(now: Date = new Date()): Promise<number | null> {
  const lookahead = new Date(now.getTime() + 24 * 3_600_000);

  // sport: "mlb" is required, not cosmetic — without it, a soon-starting
  // tennis match would skew MLB's own cadence math once tennis Game rows exist.
  const nextGame = await prisma.game.findFirst({
    where: {
      sport: "mlb",
      status: "scheduled",
      scheduledStartUtc: { gte: now, lte: lookahead },
    },
    orderBy: { scheduledStartUtc: "asc" },
  });

  if (!nextGame) return null;
  return (nextGame.scheduledStartUtc.getTime() - now.getTime()) / 60_000;
}

/**
 * Hard stop once the Odds API's last-reported remaining credits drops below
 * this — a safety net so a mis-tuned cadence (or an unexpectedly expensive
 * plan change) can't silently run the account to zero credits or into an
 * unexpected overage. Below this, poll-odds refuses to spend more credits
 * until the account's quota resets or the plan is upgraded.
 */
export const MIN_CREDITS_REMAINING_GUARDRAIL = 20;

/**
 * The most recently observed credits-remaining figure across every job's
 * PollLog row — credits are account-wide, not per-job. Reading only the
 * current jobName's own row (the original implementation) meant a
 * brand-new job's first-ever run found no row of its own and skipped the
 * guardrail entirely, blind to another job (e.g. MLB's) having already
 * spent most of the month's budget — a real bug surfaced while adding
 * tennis polling as a second job. lastPolledAt-based cadence timing stays
 * correctly per-jobName; only the credits check is account-wide.
 */
async function getLatestCreditsRemaining(): Promise<number | null> {
  const latest = await prisma.pollLog.findFirst({
    where: { creditsRemaining: { not: null } },
    orderBy: { lastPolledAt: "desc" },
  });
  return latest?.creditsRemaining ?? null;
}

/** Account-wide credits guardrail — shared by every sport's poll decision, not just MLB's. */
export async function hasCreditsHeadroom(): Promise<boolean> {
  const latestCreditsRemaining = await getLatestCreditsRemaining();
  return latestCreditsRemaining === null || latestCreditsRemaining >= MIN_CREDITS_REMAINING_GUARDRAIL;
}

export interface PollDecision {
  shouldPoll: boolean;
  blockedReason: "not-due" | "low-credits" | null;
  tier: PollTier;
  intervalMinutes: number;
  minutesToNearestFirstPitch: number | null;
}

/** Combines the tier lookup, PollLog check, and credits guardrail into the single decision poll-odds needs. */
export async function decidePollOdds(jobName: string, now: Date = new Date()): Promise<PollDecision> {
  const minutesToNearestFirstPitch = await getMinutesToNearestFirstPitch(now);
  const { tier, intervalMinutes } = determineTier(minutesToNearestFirstPitch);

  if (!(await hasCreditsHeadroom())) {
    return { shouldPoll: false, blockedReason: "low-credits", tier, intervalMinutes, minutesToNearestFirstPitch };
  }

  const log = await prisma.pollLog.findUnique({ where: { jobName } });
  const isDue = shouldPollNow(log?.lastPolledAt ?? null, intervalMinutes, now);
  return {
    shouldPoll: isDue,
    blockedReason: isDue ? null : "not-due",
    tier,
    intervalMinutes,
    minutesToNearestFirstPitch,
  };
}

export interface SimplePollDecision {
  shouldPoll: boolean;
  blockedReason: "not-due" | "low-credits" | null;
}

/**
 * Poll decision for jobs on a fixed external cadence (e.g. tennis's 1x/day
 * GitHub Actions schedule) rather than MLB's proximity-to-first-pitch tiers
 * — just the account-wide credits guardrail plus a minimum-interval
 * anti-duplicate guard (protects against a manual trigger landing too close
 * to the scheduled one, not the primary cadence control — that's GH
 * Actions' own schedule).
 */
export async function decideFixedCadencePoll(
  jobName: string,
  minIntervalMinutes: number,
  now: Date = new Date()
): Promise<SimplePollDecision> {
  if (!(await hasCreditsHeadroom())) {
    return { shouldPoll: false, blockedReason: "low-credits" };
  }
  const log = await prisma.pollLog.findUnique({ where: { jobName } });
  const isDue = shouldPollNow(log?.lastPolledAt ?? null, minIntervalMinutes, now);
  return { shouldPoll: isDue, blockedReason: isDue ? null : "not-due" };
}

/**
 * Self-heal fallback for when the external GH Actions schedule misses BOTH
 * daily poll-odds runs — confirmed happening live (see poll-odds.yml's
 * comment): scheduled triggers can silently not fire at all, with no error
 * to alert on. sync-results runs every 15 min on its own free cron, so
 * routing a check through there catches a fully-missed cycle within ~15 min
 * instead of leaving odds stale for up to a full day.
 *
 * Threshold sits above the schedule's own worst-case healthy gap (22:30 UTC
 * -> next day's 14:05 UTC = ~15h35m) so a merely-delayed run doesn't trigger
 * a redundant extra poll.
 */
export const POLL_ODDS_STALE_MINUTES = 20 * 60;

export async function isPollOddsStale(jobName: string, now: Date = new Date()): Promise<boolean> {
  if (!(await hasCreditsHeadroom())) return false;
  const log = await prisma.pollLog.findUnique({ where: { jobName } });
  if (!log?.lastPolledAt) return true;
  const elapsedMinutes = (now.getTime() - log.lastPolledAt.getTime()) / 60_000;
  return elapsedMinutes >= POLL_ODDS_STALE_MINUTES;
}

export async function recordPollLog(
  jobName: string,
  lastStatus: string,
  creditsUsed?: number | null,
  creditsRemaining?: number | null
): Promise<void> {
  const now = new Date();
  await prisma.pollLog.upsert({
    where: { jobName },
    create: {
      jobName,
      lastPolledAt: now,
      lastStatus,
      creditsUsed: creditsUsed ?? null,
      creditsRemaining: creditsRemaining ?? null,
    },
    update: {
      lastPolledAt: now,
      lastStatus,
      creditsUsed: creditsUsed ?? null,
      creditsRemaining: creditsRemaining ?? null,
    },
  });

  // PollLog only keeps the latest row per job (needed for O(1) cadence
  // checks), so it can't answer "how has credit usage trended over time" —
  // this append-only table exists purely for that. Skipped for jobs that
  // never spend credits (creditsUsed/creditsRemaining both null) so it only
  // grows for the jobs a credit trend is actually meaningful for.
  if (creditsUsed != null || creditsRemaining != null) {
    await prisma.pollCreditLog.create({
      data: {
        jobName,
        polledAt: now,
        creditsUsed: creditsUsed ?? null,
        creditsRemaining: creditsRemaining ?? null,
      },
    });
  }
}
