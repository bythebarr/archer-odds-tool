import type { Handedness } from "@/generated/prisma/client";
import type { LineupHandednessMix } from "./lineupHandedness";
import { resolveEffectiveLeftShare } from "./lineupHandedness";
import { sampleConfidence, shrinkToward } from "@/lib/stats/weightedAverage";

/**
 * Pitcher-vs-lineup-handedness matchup shift — how much a starter's own
 * OPS-against-handedness split (source: pitcherForm-adjacent
 * PitcherHandednessSplit, MLB Stats API's free vl/vr splits, confirmed live
 * against the real API to have no era/earnedRuns field) should move the
 * expected-runs projection given TONIGHT's specific opposing lineup's
 * handedness mix, rather than the league-average mix his season OPS
 * numbers already assume.
 *
 * NOT a general "is this pitcher tough vs lefties" signal — that's already
 * priced by his overall ERA/recency terms. This isolates the RESIDUAL: is
 * he facing a friendlier-or-tougher-than-his-own-average mix tonight,
 * measured against his OWN season-blended OPS-against (his own
 * battersFaced-weighted average of both hands), not a league baseline —
 * avoiding double-counting general pitcher quality that ERA already
 * captures (the same double-counting risk docs/architecture/
 * MLB-MODEL-INVENTORY.md §3 already flags for pitcher-ERA vs. team-defense).
 *
 * CANNOT be backtested with today's data model: the MLB Stats API splits
 * endpoint is a live rolling-season aggregate with no historical time
 * series, so there is nothing to snapshot-and-replay for a past game the
 * way bullpen quality and pitcher recency can be (both reconstructed from
 * dated PlayerGameLog rows). PLATOON_OPS_TO_RUNS below is a documented,
 * unfit "v1 heuristic" guess, same spirit as this file's sibling
 * constants — but unlike those, it cannot be tuned against a lookahead-safe
 * backtest at all right now. Validate live, not by re-deriving a fitted
 * value that doesn't exist yet.
 */

/** A pitcher's OPS-against components for one batter-handedness split. */
export interface PitcherHandSplit {
  obp: number | null;
  slg: number | null;
  battersFaced: number;
}

/** Batters faced (the less-common of the two hands) needed before the platoon edge is trusted at full strength — mirrors this file's sibling shrink thresholds. Below this, the edge is shrunk toward zero (no adjustment) proportionally. */
const MIN_PLATOON_BATTERS_FACED_FULL = 150;

/** Rough OPS-to-expected-runs-per-9 scale — an explicitly unfit v1 heuristic (see file header: this cannot be backtested with today's data model, unlike every other constant in archer/). Revisit once a real backtest becomes possible (would need a historical splits time series this repo doesn't have). */
const PLATOON_OPS_TO_RUNS = 4.5;

function opsFromSplit(split: PitcherHandSplit | null): number | null {
  if (!split || split.obp === null || split.slg === null) return null;
  return split.obp + split.slg;
}

/**
 * Runs-per-9 shift for one team's expected runs, from the OPPOSING
 * starter's platoon split against THIS team's own batting handedness mix.
 * Positive = tonight's lineup mix is tougher on this pitcher than his own
 * season-average opponent, so expected runs against him go UP. Zero (never
 * null) when either the pitcher's splits or the lineup mix aren't
 * available yet — a shift, not a replacement, so missing platoon data
 * never nulls out an otherwise-computable projection.
 */
export function platoonRunsShift(
  pitcherHand: Handedness | null,
  vsLeft: PitcherHandSplit | null,
  vsRight: PitcherHandSplit | null,
  opposingMix: LineupHandednessMix | null
): number {
  if (!opposingMix) return 0;
  const opsVsL = opsFromSplit(vsLeft);
  const opsVsR = opsFromSplit(vsRight);
  if (opsVsL === null || opsVsR === null) return 0;

  const opposingLeftShare = resolveEffectiveLeftShare(opposingMix, pitcherHand);
  if (opposingLeftShare === null) return 0;

  const battersFacedL = vsLeft!.battersFaced;
  const battersFacedR = vsRight!.battersFaced;
  const totalFaced = battersFacedL + battersFacedR;
  if (totalFaced === 0) return 0;

  const pitcherEffectiveOps = opposingLeftShare * opsVsL + (1 - opposingLeftShare) * opsVsR;
  const pitcherOverallOps = (battersFacedL * opsVsL + battersFacedR * opsVsR) / totalFaced;
  const platoonOpsEdge = pitcherOverallOps - pitcherEffectiveOps;

  const confidence = sampleConfidence(Math.min(battersFacedL, battersFacedR), MIN_PLATOON_BATTERS_FACED_FULL);
  const shrunkEdge = shrinkToward(platoonOpsEdge, 0, confidence);

  return -PLATOON_OPS_TO_RUNS * shrunkEdge;
}
