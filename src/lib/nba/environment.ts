/**
 * Tonight's game environment for an NBA prop, from the game lines:
 *
 * - Total: tonight's total against the totals his own logs were played in
 *   (his team's average combined points). A 240 game for a team that averages
 *   225 means more possessions and shots. Each stat moves with its own
 *   elasticity — scoring tracks the total almost one for one, rebounds much
 *   less (a high total is partly efficiency, i.e. fewer misses to rebound).
 * - Spread (blowout risk): starters lose fourth-quarter minutes in lopsided
 *   games and the bench gains them. Kicks in past a 6-point spread.
 *
 * Priors, regressed and capped; `npm run backtest:nba-props` reports the
 * projection error with and without them.
 */
import type { NbaPropStat } from "@/generated/prisma/client";
import { elasticFactor, teamSpread, type GameLines } from "@/lib/propModel/environment";

/** How much each stat moves with the game total (1 = proportionally). */
const TOTAL_ELASTICITY: Record<NbaPropStat, number> = {
  points: 0.9,
  threes: 0.9,
  assists: 0.75,
  rebounds: 0.35,
  steals: 0.5,
  blocks: 0.3,
  pointsReboundsAssists: 0.75,
  pointsRebounds: 0.75,
  pointsAssists: 0.85,
  reboundsAssists: 0.5,
  blocksSteals: 0.4,
  turnovers: 0.6,
  doubleDouble: 0,
  tripleDouble: 0,
};
const TOTAL_CAP = 0.1;
/** A baseline outside this range is a data gap (partial box scores), not an environment — ignored. */
const SANE_TOTAL = [180, 280] as const;

const BLOWOUT_FROM = 6;
/** Per point of spread past BLOWOUT_FROM: share of minutes a starter (30+ min) loses / a reserve (≤ 18) gains. */
const STARTER_LOSS = 0.004;
const RESERVE_GAIN = 0.006;
const BLOWOUT_CAP = 0.06;

export interface NbaEnvironment {
  /** On the per-minute production. */
  totalFactor: number;
  /** On expected minutes. */
  minutesFactor: number;
  /** The total and spread used, for display; null when the books haven't posted lines. */
  total: number | null;
  spread: number | null;
}

export const NEUTRAL_NBA_ENV: NbaEnvironment = { totalFactor: 1, minutesFactor: 1, total: null, spread: null };

/**
 * `baselineTotal`: the average combined score of the games his logs come from
 * (his team's), so the factor is tonight vs his normal.
 */
export function nbaEnvironment(
  lines: GameLines,
  isHome: boolean | null,
  stat: NbaPropStat,
  minutes: number,
  baselineTotal: number | null
): NbaEnvironment {
  const totalFactor =
    lines.total !== null && baselineTotal && baselineTotal >= SANE_TOTAL[0] && baselineTotal <= SANE_TOTAL[1]
      ? elasticFactor(lines.total / baselineTotal, TOTAL_ELASTICITY[stat], TOTAL_CAP)
      : 1;
  const spread = isHome === null ? null : teamSpread(lines, isHome);
  let minutesFactor = 1;
  if (spread !== null) {
    const past = Math.max(Math.abs(spread) - BLOWOUT_FROM, 0);
    if (minutes >= 30) minutesFactor = 1 - Math.min(past * STARTER_LOSS, BLOWOUT_CAP);
    else if (minutes <= 18) minutesFactor = 1 + Math.min(past * RESERVE_GAIN, BLOWOUT_CAP);
    else {
      // Between the two: slide linearly from the reserve's gain to the starter's loss.
      const t = (minutes - 18) / 12;
      minutesFactor = 1 + Math.min(past * RESERVE_GAIN, BLOWOUT_CAP) * (1 - t) - Math.min(past * STARTER_LOSS, BLOWOUT_CAP) * t;
    }
  }
  return { totalFactor, minutesFactor, total: lines.total, spread };
}
