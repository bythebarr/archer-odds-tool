/**
 * Ballpark multipliers for the MLB props projection (propProjection.ts):
 * what a park does to strikeouts and to hits, from its trailing rates.
 *
 * The board model has priced a park K term for a while (props/parkKRate.ts,
 * an additive shift on K lines, fitted by scripts/matchup-park.ts); the
 * finder projection took parkK / parkHits inputs that nothing supplied, so
 * it priced every park neutral and the two surfaces disagreed. These are
 * the same trailing rates in the projection's multiplier form: the park's
 * batter-K rate and hit rate against the league's, half-regressed and
 * capped — the projection's own regress shape for platoon and matchup.
 * A park is its home team; rates are season-to-date strictly before the
 * slate date, and a park under MIN_PARK_PA plate appearances stays neutral.
 */
import { MIN_PARK_PA } from "@/lib/props/parkKRate";

export interface ParkRates {
  /** Batter strikeouts per plate appearance at the park (both lineups). */
  kRate: number | null;
  /** Hits per plate appearance at the park (both lineups). */
  hitRate: number | null;
}

/** The most a park may move a rate, either way. */
export const PARK_FACTOR_CAP = 0.1;

/** Trailing rates from summed batter lines; null under the PA floor (MIN_PARK_PA). */
export function parkRatesFromSums(sums: { strikeouts: number | null; hits: number | null; plateAppearances: number | null }): ParkRates {
  const pa = sums.plateAppearances ?? 0;
  if (pa < MIN_PARK_PA) return { kRate: null, hitRate: null };
  return { kRate: (sums.strikeouts ?? 0) / pa, hitRate: (sums.hits ?? 0) / pa };
}

/** Half-regressed league-relative ratio, capped; neutral without both rates. */
function factor(rate: number | null, league: number | null): number {
  if (rate === null || league === null || league <= 0) return 1;
  const f = 1 + (rate / league - 1) * 0.5;
  return Math.min(1 + PARK_FACTOR_CAP, Math.max(1 - PARK_FACTOR_CAP, f));
}

/** The park multipliers a projection context takes (1 = neutral). */
export function parkFactors(park: ParkRates, league: ParkRates): { parkK: number; parkHits: number } {
  return { parkK: factor(park.kRate, league.kRate), parkHits: factor(park.hitRate, league.hitRate) };
}
