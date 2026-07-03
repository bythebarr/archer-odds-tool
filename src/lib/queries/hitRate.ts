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
 * Reduces a team's outcomes (already ordered most-recent-first) to a hit-rate
 * over the first `window` of them. `flip` mirrors results for the Under side
 * of a totals market, since GameOutcome.result is stored from the Over's
 * perspective (see gradeOutcomes.ts).
 */
function reduceHitRate(
  outcomes: { result: OutcomeResult }[],
  window: number,
  flip: boolean
): HitRateResult {
  const sliced = outcomes.slice(0, window);

  let hits = 0;
  let misses = 0;
  let pushes = 0;

  for (const o of sliced) {
    const result = flip ? flipForUnder(o.result) : o.result;
    if (result === "hit") hits++;
    else if (result === "miss") misses++;
    else pushes++;
  }

  const decided = hits + misses;

  return {
    window,
    gamesFound: sliced.length,
    hits,
    misses,
    pushes,
    hitRate: decided > 0 ? hits / decided : null,
    record: pushes > 0 ? `${hits}-${misses}-${pushes}` : `${hits}-${misses}`,
  };
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
    orderBy: { game: { scheduledStartUtc: "desc" } },
    take: window,
  });

  return reduceHitRate(outcomes, window, marketType === "totals" && side === "under");
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

function groupByTeam<T extends { teamId: string }>(rows: T[]): Map<string, T[]> {
  const byTeam = new Map<string, T[]>();
  for (const row of rows) {
    const rows = byTeam.get(row.teamId) ?? [];
    rows.push(row);
    byTeam.set(row.teamId, rows);
  }
  return byTeam;
}

/**
 * Same hit-rate views as getTeamHitRates, for many teams at once — 3 queries
 * total (one per market type; totals is fetched once and reduced twice, for
 * over and under) instead of 4 queries per team.
 */
export async function getTeamHitRatesBatch(
  teamIds: string[],
  window = DEFAULT_WINDOW
): Promise<Record<string, TeamHitRates>> {
  const uniqueIds = [...new Set(teamIds)];

  const [h2hRows, spreadRows, totalsRows] = await Promise.all([
    prisma.gameOutcome.findMany({
      where: { teamId: { in: uniqueIds }, marketType: "h2h" },
      orderBy: { game: { scheduledStartUtc: "desc" } },
    }),
    prisma.gameOutcome.findMany({
      where: { teamId: { in: uniqueIds }, marketType: "spreads" },
      orderBy: { game: { scheduledStartUtc: "desc" } },
    }),
    prisma.gameOutcome.findMany({
      where: { teamId: { in: uniqueIds }, marketType: "totals" },
      orderBy: { game: { scheduledStartUtc: "desc" } },
    }),
  ]);

  const h2hByTeam = groupByTeam(h2hRows);
  const spreadByTeam = groupByTeam(spreadRows);
  const totalsByTeam = groupByTeam(totalsRows);

  const result: Record<string, TeamHitRates> = {};
  for (const teamId of uniqueIds) {
    result[teamId] = {
      h2h: reduceHitRate(h2hByTeam.get(teamId) ?? [], window, false),
      spreads: reduceHitRate(spreadByTeam.get(teamId) ?? [], window, false),
      totalsOver: reduceHitRate(totalsByTeam.get(teamId) ?? [], window, false),
      totalsUnder: reduceHitRate(totalsByTeam.get(teamId) ?? [], window, true),
    };
  }
  return result;
}
