import { prisma } from "@/lib/prisma";
import type { MarketType, OutcomeResult } from "@/generated/prisma/client";

export interface HitRateResult {
  window: number;
  gamesFound: number;
  hits: number;
  misses: number;
  pushes: number;
  hitRate: number | null;
  record: string;
}

function flipForUnder(result: OutcomeResult): OutcomeResult {
  if (result === "hit") return "miss";
  if (result === "miss") return "hit";
  return "push";
}

/**
 * Rolling hit-rate for a team over its last `window` graded games in a market.
 * For "totals", GameOutcome.result is stored from the Over's perspective
 * (see gradeOutcomes.ts) — pass side: "under" to flip it.
 */
export async function getTeamHitRate(
  teamId: string,
  marketType: MarketType,
  window: number,
  side?: "over" | "under"
): Promise<HitRateResult> {
  const outcomes = await prisma.gameOutcome.findMany({
    where: { teamId, marketType },
    include: { game: true },
    orderBy: { game: { scheduledStartUtc: "desc" } },
    take: window,
  });

  let hits = 0;
  let misses = 0;
  let pushes = 0;

  for (const o of outcomes) {
    const result = marketType === "totals" && side === "under" ? flipForUnder(o.result) : o.result;
    if (result === "hit") hits++;
    else if (result === "miss") misses++;
    else pushes++;
  }

  const decided = hits + misses;

  return {
    window,
    gamesFound: outcomes.length,
    hits,
    misses,
    pushes,
    hitRate: decided > 0 ? hits / decided : null,
    record: pushes > 0 ? `${hits}-${misses}-${pushes}` : `${hits}-${misses}`,
  };
}

export interface TeamHitRates {
  h2h: HitRateResult;
  spreads: HitRateResult;
  totalsOver: HitRateResult;
  totalsUnder: HitRateResult;
}

const DEFAULT_WINDOW = 10;

/** All the hit-rate views the bet-detail UI needs for one team, in one call. */
export async function getTeamHitRates(teamId: string, window = DEFAULT_WINDOW): Promise<TeamHitRates> {
  const [h2h, spreads, totalsOver, totalsUnder] = await Promise.all([
    getTeamHitRate(teamId, "h2h", window),
    getTeamHitRate(teamId, "spreads", window),
    getTeamHitRate(teamId, "totals", window, "over"),
    getTeamHitRate(teamId, "totals", window, "under"),
  ]);
  return { h2h, spreads, totalsOver, totalsUnder };
}
