import type { CrossBout, UfcFighterHistory, UfcFightRecord } from "@/lib/queries/ufcMatchup";
import { resultQuality, decayWeight } from "./fighterStrength";
import { weightedAverage } from "@/lib/stats/weightedAverage";

/**
 * Layer 2 of "fighter math": "beat someone who beat someone." 1-hop is a
 * direct shared opponent (A and B both fought X) — the strong, standard
 * signal. 2-hop extends one link further (X, who A fought, also fought Z,
 * who B fought) and is weighted down hard per the user's explicit call,
 * both because it's a real evidentiary step removed and because Cito's
 * small fight-history depth per fighter makes deep chains statistically
 * fragile — see fighterMath.ts for how this combines with the other layers.
 */

/** 2-hop chains count for a fraction of a direct shared opponent's weight — "allow it, weighted down hard" per the user's explicit choice. */
const TWO_HOP_WEIGHT = 0.25;

/** Scales the averaged comparison (roughly [-1,1]) into a logit-space shift — same technique as archer/winProbability.ts's STRENGTH_SENSITIVITY. */
const COMMON_OPPONENT_SENSITIVITY = 1.5;

export interface SharedOpponentDetail {
  /** The shared opponent's name for 1-hop; "X (via Z)" for a 2-hop chain, naming both links. */
  label: string;
  hopDistance: 1 | 2;
  /** Signed, roughly [-1,1] — positive favors fighter A. */
  comparison: number;
  weight: number;
}

export interface CommonOpponentAdjustment {
  logitShift: number;
  details: SharedOpponentDetail[];
}

function mostRecentFightAgainst(history: UfcFighterHistory, opponentId: string): UfcFightRecord | undefined {
  // history.fights is already most-recent-first (see getUfcFightHistory).
  return history.fights.find((f) => f.opponentId === opponentId);
}

/** Direct (1-hop) shared opponents: fighters both A and B have faced. */
function computeDirectSharedOpponents(historyA: UfcFighterHistory, historyB: UfcFighterHistory, now: Date) {
  const bOpponentIds = new Set(historyB.fights.map((f) => f.opponentId));
  const details: SharedOpponentDetail[] = [];

  for (const aFight of historyA.fights) {
    if (!bOpponentIds.has(aFight.opponentId)) continue;
    const bFight = mostRecentFightAgainst(historyB, aFight.opponentId)!;

    const aQuality = resultQuality(aFight.result, aFight.method);
    const bQuality = resultQuality(bFight.result, bFight.method);
    const weight =
      (decayWeight(monthsAgo(aFight.eventDate, now)) + decayWeight(monthsAgo(bFight.eventDate, now))) / 2;

    details.push({
      label: aFight.opponentName,
      hopDistance: 1,
      comparison: aQuality - bQuality,
      weight,
    });
  }

  return details;
}

/**
 * 2-hop chains: for X (an A opponent) and Z (a B opponent) who fought each
 * other, "similarity" between A's result vs X and Z's result vs X gauges
 * whether Z is roughly A's tier — if so, B's actual result against Z
 * (already known from historyB) becomes a transitive signal about B
 * against "someone like A." Bounded to [-1,1] the same as the 1-hop case.
 */
function computeTwoHopChains(
  historyA: UfcFighterHistory,
  historyB: UfcFighterHistory,
  crossBouts: CrossBout[],
  now: Date
): SharedOpponentDetail[] {
  const aOpponentIds = new Set(historyA.fights.map((f) => f.opponentId));
  const bOpponentIds = new Set(historyB.fights.map((f) => f.opponentId));
  const details: SharedOpponentDetail[] = [];

  for (const cross of crossBouts) {
    // Orient the cross bout as X (A's opponent) vs Z (B's opponent) — skip
    // anything that isn't actually one-from-each-group (shouldn't happen
    // given getCrossBouts's query, but keeps this function defensive/pure).
    const [xId, zId] = aOpponentIds.has(cross.fighterOneId)
      ? [cross.fighterOneId, cross.fighterTwoId]
      : aOpponentIds.has(cross.fighterTwoId)
        ? [cross.fighterTwoId, cross.fighterOneId]
        : [null, null];
    if (!xId || !zId || !bOpponentIds.has(zId)) continue;

    // Degenerate case: if A and B have fought each other directly before,
    // B shows up in A's own opponent set (and vice versa) — without this
    // guard, that direct fight gets mistaken for a "2-hop chain" through
    // themselves (confirmed live: Islam Makhachev and Arman Tsarukyan
    // actually fought in 2019, which produced a nonsensical
    // "Tsarukyan (via Makhachev)" entry before this fix). A direct
    // head-to-head result isn't a transitive signal — it's out of scope
    // for this layer entirely.
    if (xId === historyB.fighterId || zId === historyA.fighterId) continue;

    const aFight = mostRecentFightAgainst(historyA, xId);
    const bFight = mostRecentFightAgainst(historyB, zId);
    if (!aFight || !bFight) continue;

    const aVsX = resultQuality(aFight.result, aFight.method);
    const zVsX = resultQuality(
      cross.winnerFighterId === zId ? "win" : cross.winnerFighterId === xId ? "loss" : "draw",
      cross.method
    );
    const bVsZ = resultQuality(bFight.result, bFight.method);

    const similarity = 1 - Math.abs(aVsX - zVsX);
    const comparison = similarity * (0.5 - bVsZ) * 2;
    const weight =
      TWO_HOP_WEIGHT *
      (decayWeight(monthsAgo(aFight.eventDate, now)) +
        decayWeight(monthsAgo(bFight.eventDate, now)) +
        decayWeight(monthsAgo(cross.eventDate, now))) /
      3;

    details.push({ label: `${aFight.opponentName} (via ${bFight.opponentName})`, hopDistance: 2, comparison, weight });
  }

  return details;
}

function monthsAgo(date: Date, now: Date): number {
  return Math.max(0, (now.getTime() - date.getTime()) / (30.44 * 24 * 3600 * 1000));
}

/**
 * Combines direct and 2-hop shared-opponent comparisons into one logit
 * shift. Zero shared opponents (common — different eras/weight classes)
 * just means zero shift, not a forced signal. crossBouts is optional so
 * this stays testable with just the 1-hop case using historyA/historyB
 * alone (see fighterMath.ts for where 2-hop's extra query gets supplied).
 */
export function computeCommonOpponentAdjustment(
  historyA: UfcFighterHistory,
  historyB: UfcFighterHistory,
  crossBouts: CrossBout[] = [],
  now: Date = new Date()
): CommonOpponentAdjustment {
  const details = [
    ...computeDirectSharedOpponents(historyA, historyB, now),
    ...computeTwoHopChains(historyA, historyB, crossBouts, now),
  ];

  const averaged = weightedAverage(details.map((d): [number, number] => [d.comparison, d.weight]));
  const logitShift = (averaged ?? 0) * COMMON_OPPONENT_SENSITIVITY;

  return { logitShift, details };
}
