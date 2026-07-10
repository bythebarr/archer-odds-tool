import type { MarketType } from "@/generated/prisma/client";
import type { ExpectedRuns } from "./expectedRuns";
import { normalCdf } from "@/lib/stats/normal";

/**
 * Turns the Archer Runs projection (see expectedRuns.ts) into P(cover) for a
 * given total or spread line, so it can feed calculateEv the same way the
 * moneyline's Archer win probability already does.
 *
 * The projected total (sum of the two teams' expected runs) and margin
 * (their difference) are each modeled as Normal around that mean. The
 * ORIGINAL v1 set the variance to the mean (a Poisson assumption). A
 * lookahead-safe backtest over 1,206 games showed that is badly wrong: actual
 * game totals scatter around the projection with a std of ~4.5 runs, not the
 * ~1.7 that variance=mean implies — MLB scoring is heavily over-dispersed vs
 * Poisson (big innings, blowouts, bullpen collapses), so the Poisson version
 * was wildly overconfident on P(over) (it said 75% where reality was 66%).
 * Swapping in the empirical variances below (validated on the same backtest:
 * the 65%+ over bucket went from 9pt overconfident to spot-on, 70.9% predicted
 * vs 71.0% actual) makes the total/spread probabilities honest. Held constant
 * rather than scaled with the projected mean because the measured dispersion
 * dwarfs any realistic mean and barely moves with it; revisit if a park/
 * weather-aware runs model ever gives the mean real spread. Still a Normal
 * approximation to a discrete, right-skewed outcome — some tail imprecision
 * remains, consistent with archer/'s "transparent heuristic" approach.
 */

/**
 * Empirical variance of the actual game total around the Archer Runs
 * projection (std ~4.53 runs), measured lookahead-safe over 1,206 games. See
 * the file header — replaces the original Poisson variance=mean, which was
 * ~2.6x too tight and made totals wildly overconfident.
 */
const TOTAL_RUNS_VARIANCE = 20.5;

/**
 * Empirical variance of the actual run margin around the projected margin
 * (std ~4.64 runs), measured the same way. Replaces the original
 * variance=projected-total for the spread's margin distribution.
 */
const MARGIN_RUNS_VARIANCE = 21.5;

/** P(actual combined score > point). */
export function archerTotalOverProb(point: number, runs: ExpectedRuns): number | null {
  if (runs.home === null || runs.away === null) return null;
  const mean = runs.home + runs.away;
  return 1 - normalCdf(point, mean, TOTAL_RUNS_VARIANCE);
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

  if (side === "home") return 1 - normalCdf(-point, mean, MARGIN_RUNS_VARIANCE);
  return normalCdf(point, mean, MARGIN_RUNS_VARIANCE);
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
