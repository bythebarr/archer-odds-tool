import { prisma } from "@/lib/prisma";

export type PollTier = "imminent" | "approaching" | "far";

export interface TierConfig {
  tier: PollTier;
  intervalMinutes: number;
}

/**
 * Tiered polling cadence, keyed off minutes until the nearest not-yet-started
 * game's first pitch. The Odds API bills per-call (markets x regions), not
 * per-game, so the only cost lever is how often we call it — this is that lever.
 * See plan doc's "Odds Ingestion & Polling" section for the table this encodes.
 */
export function determineTier(minutesToNearestFirstPitch: number | null): TierConfig {
  if (minutesToNearestFirstPitch !== null && minutesToNearestFirstPitch <= 60) {
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

  const nextGame = await prisma.game.findFirst({
    where: {
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

  const log = await prisma.pollLog.findUnique({ where: { jobName } });

  if (
    log?.creditsRemaining !== null &&
    log?.creditsRemaining !== undefined &&
    log.creditsRemaining < MIN_CREDITS_REMAINING_GUARDRAIL
  ) {
    return { shouldPoll: false, blockedReason: "low-credits", tier, intervalMinutes, minutesToNearestFirstPitch };
  }

  const isDue = shouldPollNow(log?.lastPolledAt ?? null, intervalMinutes, now);
  return {
    shouldPoll: isDue,
    blockedReason: isDue ? null : "not-due",
    tier,
    intervalMinutes,
    minutesToNearestFirstPitch,
  };
}

export async function recordPollLog(
  jobName: string,
  lastStatus: string,
  creditsUsed?: number | null,
  creditsRemaining?: number | null
): Promise<void> {
  await prisma.pollLog.upsert({
    where: { jobName },
    create: {
      jobName,
      lastPolledAt: new Date(),
      lastStatus,
      creditsUsed: creditsUsed ?? null,
      creditsRemaining: creditsRemaining ?? null,
    },
    update: {
      lastPolledAt: new Date(),
      lastStatus,
      creditsUsed: creditsUsed ?? null,
      creditsRemaining: creditsRemaining ?? null,
    },
  });
}
