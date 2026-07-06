import type { MarketType } from "@/generated/prisma/client";
import type { ExpectedRuns } from "./expectedRuns";
import { normalCdf } from "@/lib/stats/normal";

/**
 * Turns the Archer Runs projection (see expectedRuns.ts) into P(cover) for a
 * given total or spread line, so it can feed calculateEv the same way the
 * moneyline's Archer win probability already does.
 *
 * Each team's runs are treated as roughly Poisson (mean = variance); the
 * total is their sum and the spread margin is their difference, both
 * approximated as Normal rather than an exact Poisson-sum/Skellam
 * calculation — simpler and consistent with this project's "transparent
 * heuristic, not a fitted model" approach elsewhere in archer/, at the cost
 * of some tail-probability precision.
 */

/** P(actual combined score > point). */
export function archerTotalOverProb(point: number, runs: ExpectedRuns): number | null {
  if (runs.home === null || runs.away === null) return null;
  const mean = runs.home + runs.away;
  const variance = mean;
  return 1 - normalCdf(point, mean, variance);
}

/** P(actual combined score < point) — the complement of archerTotalOverProb (a push at the line is essentially impossible since MLB totals are always X.5). */
export function archerTotalUnderProb(point: number, runs: ExpectedRuns): number | null {
  const over = archerTotalOverProb(point, runs);
  return over !== null ? 1 - over : null;
}

/**
 * P(this side covers a spread of `point`), where `point` is that side's own
 * signed line exactly as stored on the row (home -1.5 / away +1.5, or the
 * mirrored values for an alt line). Home covers iff (home runs + point) >
 * away runs, i.e. margin > -point; away covers iff (away runs + point) >
 * home runs, i.e. margin < point — so the same margin distribution serves
 * both sides, just evaluated on either side of its own line.
 */
export function archerSpreadCoverProb(
  side: "home" | "away",
  point: number,
  runs: ExpectedRuns
): number | null {
  if (runs.home === null || runs.away === null) return null;
  const mean = runs.home - runs.away;
  const variance = runs.home + runs.away;

  if (side === "home") return 1 - normalCdf(-point, mean, variance);
  return normalCdf(point, mean, variance);
}

export interface ArcherWinProb {
  home: number | null;
  away: number | null;
}

/**
 * The one Archer probability lookup shared by every market-scoped view
 * (GameLinesView, SlateLinesView): win probability for h2h, expected-runs-
 * derived cover probability for spreads/totals. Null wherever the model has
 * no applicable input yet, or the side/point combination doesn't apply to
 * this market.
 */
export function archerProbForRow(
  market: MarketType,
  side: string,
  point: number | null,
  archerWinProb: ArcherWinProb | null,
  archerRuns: ExpectedRuns | null
): number | null {
  if (market === "h2h") {
    if (!archerWinProb) return null;
    return side === "home" ? archerWinProb.home : side === "away" ? archerWinProb.away : null;
  }
  if (!archerRuns || point === null) return null;
  if (market === "spreads") {
    return side === "home" || side === "away" ? archerSpreadCoverProb(side, point, archerRuns) : null;
  }
  if (market === "totals") {
    if (side === "over") return archerTotalOverProb(point, archerRuns);
    if (side === "under") return archerTotalUnderProb(point, archerRuns);
  }
  return null;
}
