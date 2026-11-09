/**
 * Staleness gate for fitted parameters (Phase 4, Decision 9).
 *
 * Every number the backtests fit and the live app reads back — spread/total
 * SDs, blend weights, calibration factors, UFC coefficients, F1 learning
 * rates — used to be newest-row-wins with at most a sample-size gate: a fit
 * of ANY age priced at full strength, so a Model lab that silently stopped
 * running (as it did while the odds sample froze) would keep pricing off
 * months-old parameters forever. Past the cap, a fitted read now reverts
 * to the baked defaults, exactly as if the fit had never run — the same
 * failure shape as a too-small sample, and for the same reason: an old fit
 * is evidence about a league that may no longer exist.
 *
 * 45 days: the lab runs weekly, so a healthy fit is never more than ~7
 * days old; 45 days is six missed runs — unambiguously broken, never a
 * rounding error — while short enough that a stale fit can't price a
 * whole season.
 */
export const FIT_MAX_AGE_DAYS = 45;

const DAY_MS = 86_400_000;

/** Whole days between a fit's run and now (negative if the fit is dated in the future). */
export function fitAgeDays(fitAt: Date, now: Date): number {
  return Math.floor((now.getTime() - fitAt.getTime()) / DAY_MS);
}

/** Whether a fitted parameter set is fresh enough to price with. */
export function isFitFresh(fitAt: Date, now: Date, maxAgeDays: number = FIT_MAX_AGE_DAYS): boolean {
  const age = fitAgeDays(fitAt, now);
  return age >= 0 && age <= maxAgeDays;
}
