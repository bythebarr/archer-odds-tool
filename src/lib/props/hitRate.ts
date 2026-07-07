import { prisma } from "@/lib/prisma";
import { Prisma, type StatCategory, type Handedness } from "@/generated/prisma/client";

export type PropWindow = 3 | 5 | 10 | 15 | "season";
export type PropDirection = "over" | "under";

type StatColumn =
  | "hits"
  | "totalBases"
  | "homeRuns"
  | "rbi"
  | "runs"
  | "strikeoutsBatting"
  | "strikeoutsPitching"
  | "earnedRuns"
  | "hitsAllowed"
  | "walksAllowed"
  | "outsRecorded";

/** Maps a prop's stat category to the PlayerGameLog column it lives in. */
const STAT_COLUMN: Record<StatCategory, StatColumn> = {
  hits: "hits",
  totalBases: "totalBases",
  homeRuns: "homeRuns",
  rbi: "rbi",
  runs: "runs",
  battingStrikeouts: "strikeoutsBatting",
  pitcherStrikeouts: "strikeoutsPitching",
  earnedRuns: "earnedRuns",
  hitsAllowed: "hitsAllowed",
  walksAllowed: "walksAllowed",
  outsRecorded: "outsRecorded",
};

export interface PropHitRateParams {
  mlbPlayerId: string;
  statCategory: StatCategory;
  /** The prop's threshold, e.g. 1.5 for "Over 1.5 Hits". */
  line: number;
  direction: PropDirection;
  window: PropWindow;
  /** Vs-LHP/RHP split — omit or null for no filter. */
  opposingHand?: Handedness | null;
}

export interface PropHitRateResult {
  hits: number;
  /** Games actually found — may be less than the requested window (e.g. early season, or a tight hand-split filter). */
  sampleSize: number;
  /** null when sampleSize is 0 — nothing to compute a rate from. */
  hitRate: number | null;
}

/**
 * Pure hit-counting core, split out from computePropHitRate so it's testable
 * without a database — given the already-fetched stat values for whichever
 * games qualified (window + hand-filter already applied), just counts
 * over/under against the line.
 */
export function tallyPropHits(values: number[], line: number, direction: PropDirection): PropHitRateResult {
  const hits = values.filter((v) => (direction === "over" ? v > line : v < line)).length;
  return {
    hits,
    sampleSize: values.length,
    hitRate: values.length > 0 ? hits / values.length : null,
  };
}

/**
 * Games where the relevant stat is null (e.g. a DH's pitching-stat columns,
 * or a pinch-hitter-only game for a batting stat that genuinely wasn't
 * recorded) are excluded from the sample entirely — they're not a "miss",
 * they're not a data point for this prop at all. This is why the column
 * filter is `{ not: null }` rather than treating null as 0.
 */
export async function computePropHitRate(params: PropHitRateParams): Promise<PropHitRateResult> {
  const column = STAT_COLUMN[params.statCategory];

  const where: Prisma.PlayerGameLogWhereInput = {
    mlbPlayerId: params.mlbPlayerId,
    [column]: { not: null },
  };
  if (params.opposingHand) {
    where.opposingStarterHand = params.opposingHand;
  }
  if (params.window === "season") {
    // MLB seasons never cross a calendar-year boundary, so "this season" is
    // simply "this calendar year" — no separate stored season field needed.
    const year = new Date().getUTCFullYear();
    where.gameDate = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
  }

  const rows = await prisma.playerGameLog.findMany({
    where,
    orderBy: { gameDate: "desc" },
    take: params.window === "season" ? undefined : params.window,
  });

  // The `{ not: null }` filter above guarantees this column is non-null on
  // every returned row, for whichever column this stat category maps to.
  const values = rows.map((r) => (r as unknown as Record<StatColumn, number>)[column]);
  return tallyPropHits(values, params.line, params.direction);
}

export interface PropHitRateSplits {
  l3: PropHitRateResult;
  l5: PropHitRateResult;
  l10: PropHitRateResult;
  l15: PropHitRateResult;
  season: PropHitRateResult;
  vsLhp: PropHitRateResult;
  vsRhp: PropHitRateResult;
}

/** Every window + the LHP/RHP split in one call, for the prop-detail view. */
export async function computePropHitRateSplits(
  params: Omit<PropHitRateParams, "window" | "opposingHand">
): Promise<PropHitRateSplits> {
  const [l3, l5, l10, l15, season, vsLhp, vsRhp] = await Promise.all([
    computePropHitRate({ ...params, window: 3 }),
    computePropHitRate({ ...params, window: 5 }),
    computePropHitRate({ ...params, window: 10 }),
    computePropHitRate({ ...params, window: 15 }),
    computePropHitRate({ ...params, window: "season" }),
    computePropHitRate({ ...params, window: "season", opposingHand: "L" }),
    computePropHitRate({ ...params, window: "season", opposingHand: "R" }),
  ]);
  return { l3, l5, l10, l15, season, vsLhp, vsRhp };
}
