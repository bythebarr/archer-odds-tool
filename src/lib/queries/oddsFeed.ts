import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { CREDITS_GUARDRAIL_JOB, PAID_ODDS_JOBS, oddsFeedState, pricesFromLabel, type OddsFeedState } from "@/lib/oddsFeedState";

/** What a row needs to show a frozen price: the date the prices are from. Null while the feed is live. */
export type FrozenPrices = { asOf: string } | null;

/** The odds feed's live/frozen state from PollLog, once per request. */
export const getOddsFeedState = cache(async (): Promise<OddsFeedState> => {
  const rows = await prisma.pollLog.findMany({
    where: { jobName: { in: [...PAID_ODDS_JOBS, CREDITS_GUARDRAIL_JOB] } },
    select: { jobName: true, lastPolledAt: true, lastStatus: true },
  });
  return oddsFeedState(rows);
});

/** The row-level form: null when live, else "Prices from <date>" material. */
export const getFrozenPrices = cache(async (): Promise<FrozenPrices> => {
  const s = await getOddsFeedState().catch(() => null);
  if (!s || !s.frozen) return null;
  return { asOf: s.pricesAsOf ? pricesFromLabel(s.pricesAsOf) : "an earlier poll" };
});
