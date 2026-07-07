import type { UfcMatchup } from "@/lib/queries/ufcMatchup";
import { computeFighterStrength } from "./fighterStrength";
import { computeCommonOpponentAdjustment, type CommonOpponentAdjustment } from "./commonOpponents";
import { computeStyleAdjustment, computeStyleProfile, type StyleAdjustment } from "./styleMatchup";

/**
 * "Fighter math": a transparent, documented, tunable v1 heuristic for a
 * head-to-head UFC win probability — same philosophy and technique as
 * archer/winProbability.ts (MLB), not a fitted/backtested model. Combines
 * three independently-computed layers (see fighterStrength.ts,
 * commonOpponents.ts, styleMatchup.ts) as additive shifts in logit space,
 * mirroring how MLB's HOME_FIELD_LOGIT sits alongside its strength
 * differential.
 */

/** Scales the (roughly -0.5..0.5) strength differential into logit space — UFC's own constant, not reused from MLB's STRENGTH_SENSITIVITY since the [0,1] strength scores mean something different per sport. */
const STRENGTH_SENSITIVITY = 4;

/**
 * Ceiling/floor on the final win probability — tighter than MLB's 0.85.
 * A single MMA fight can end in one strike or submission attempt, higher
 * single-event variance than a 9-inning baseball game, so this model
 * shouldn't claim more confidence than MLB's even when every layer agrees.
 * An explicit, easily-revisited guess, not a derived number.
 */
const PROB_CEILING = 0.8;
const PROB_FLOOR = 1 - PROB_CEILING;

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export interface UfcMatchupProjection {
  fighterAProb: number | null;
  fighterBProb: number | null;
  fighterAStrength: number | null;
  fighterBStrength: number | null;
  commonOpponentAdjustment: CommonOpponentAdjustment;
  styleAdjustment: StyleAdjustment;
}

/**
 * Computes fighter A's (and B's) win probability for a matchup, plus every
 * intermediate value used to get there — the reasoning trail isn't bolted
 * on afterward, it's just surfacing what was already computed, the same
 * way ArcherWinProbability already returns homeStrength/awayStrength
 * alongside the final probability.
 */
export function computeUfcWinProbability(matchup: UfcMatchup, now: Date = new Date()): UfcMatchupProjection {
  const fighterAStrength = computeFighterStrength(matchup.fighterA, now);
  const fighterBStrength = computeFighterStrength(matchup.fighterB, now);

  const commonOpponentAdjustment = computeCommonOpponentAdjustment(
    matchup.fighterA,
    matchup.fighterB,
    matchup.crossBouts,
    now
  );

  const styleAdjustment = computeStyleAdjustment(
    computeStyleProfile(matchup.fighterA, now),
    computeStyleProfile(matchup.fighterB, now)
  );

  if (fighterAStrength === null || fighterBStrength === null) {
    return {
      fighterAProb: null,
      fighterBProb: null,
      fighterAStrength,
      fighterBStrength,
      commonOpponentAdjustment,
      styleAdjustment,
    };
  }

  const logit =
    (fighterAStrength - fighterBStrength) * STRENGTH_SENSITIVITY +
    commonOpponentAdjustment.logitShift +
    styleAdjustment.logitShift;

  const rawProb = logistic(logit);
  const fighterAProb = Math.min(Math.max(rawProb, PROB_FLOOR), PROB_CEILING);

  return {
    fighterAProb,
    fighterBProb: 1 - fighterAProb,
    fighterAStrength,
    fighterBStrength,
    commonOpponentAdjustment,
    styleAdjustment,
  };
}
