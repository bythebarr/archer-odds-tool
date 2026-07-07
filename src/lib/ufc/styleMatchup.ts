import type { UfcFighterHistory } from "@/lib/queries/ufcMatchup";
import { decayWeight } from "./fighterStrength";
import { weightedAverage } from "@/lib/stats/weightedAverage";

/**
 * Layer 3 of "fighter math": not a discrete "striker"/"wrestler" label
 * (Cito has no such field, and most fighters are a blend anyway), but a
 * small set of continuous style metrics derived from Phase 1's bout stats,
 * compared via specific, explainable checks rather than one opaque
 * vector-distance number — see fighterMath.ts for how this combines with
 * the other layers.
 */

/** "What counts as a meaningful edge" for squashing raw differentials into a bounded [-1,1] comparison — documented guesses, tunable. */
const TAKEDOWN_EDGE_SCALE = 2; // takedowns/fight
const STRIKE_MARGIN_SCALE = 30; // significant strikes/fight

function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max);
}

function squash(diff: number, scale: number): number {
  return clamp(diff / scale, -1, 1);
}

export interface StyleProfile {
  /** Decay-weighted average takedowns landed per fight — null if no bouts have stats yet. */
  takedownOutputPerFight: number | null;
  /** Decay-weighted average takedowns landed AGAINST this fighter per fight — the defense proxy (lower is better defense). */
  takedownsAbsorbedPerFight: number | null;
  /** Decay-weighted average (significant strikes landed - absorbed) per fight — a fighter's typical striking margin, not raw volume. */
  strikeMargin: number | null;
}

/** Derives one fighter's style profile from whichever of their bouts have stats — gracefully all-null if none do. */
export function computeStyleProfile(history: UfcFighterHistory, now: Date = new Date()): StyleProfile {
  const statFights = history.fights.filter((f) => f.myStats && f.opponentStats);
  const weights = statFights.map((f) => decayWeight(monthsAgo(f.eventDate, now)));

  const takedownOutputPerFight = weightedAverage(
    statFights.map((f, i): [number, number] => [f.myStats!.takedownsLanded, weights[i]])
  );
  const takedownsAbsorbedPerFight = weightedAverage(
    statFights.map((f, i): [number, number] => [f.opponentStats!.takedownsLanded, weights[i]])
  );
  const strikeMargin = weightedAverage(
    statFights.map((f, i): [number, number] => [
      f.myStats!.significantStrikesLanded - f.opponentStats!.significantStrikesLanded,
      weights[i],
    ])
  );

  return { takedownOutputPerFight, takedownsAbsorbedPerFight, strikeMargin };
}

function monthsAgo(date: Date, now: Date): number {
  return Math.max(0, (now.getTime() - date.getTime()) / (30.44 * 24 * 3600 * 1000));
}

export interface StyleMatchupDetail {
  label: string;
  /** Signed, roughly [-1,1] — positive favors fighter A. */
  comparison: number;
}

export interface StyleAdjustment {
  logitShift: number;
  details: StyleMatchupDetail[];
}

/** Scales the averaged style comparison into a logit-space shift — same technique as the other two layers' sensitivity constants. */
const STYLE_SENSITIVITY = 1.2;

/**
 * Compares two style profiles via specific, named checks — not a single
 * fuzzy "compatibility" score. Any check missing data on either side is
 * simply omitted (weightedAverage's null-handling), so a matchup with
 * sparse stats degrades gracefully rather than forcing a number.
 */
export function computeStyleAdjustment(profileA: StyleProfile, profileB: StyleProfile): StyleAdjustment {
  const details: StyleMatchupDetail[] = [];

  if (
    profileA.takedownOutputPerFight !== null &&
    profileA.takedownsAbsorbedPerFight !== null &&
    profileB.takedownOutputPerFight !== null &&
    profileB.takedownsAbsorbedPerFight !== null
  ) {
    // A's typical takedown output vs. what B typically allows, and vice
    // versa — offense and defense are distinct skills, so both directions
    // matter, not just a single output comparison.
    const aThreat = squash(profileA.takedownOutputPerFight - profileB.takedownsAbsorbedPerFight, TAKEDOWN_EDGE_SCALE);
    const bThreat = squash(profileB.takedownOutputPerFight - profileA.takedownsAbsorbedPerFight, TAKEDOWN_EDGE_SCALE);
    details.push({ label: "Takedown offense vs. defense", comparison: aThreat - bThreat });
  }

  if (profileA.strikeMargin !== null && profileB.strikeMargin !== null) {
    details.push({
      label: "Striking output differential",
      comparison: squash(profileA.strikeMargin - profileB.strikeMargin, STRIKE_MARGIN_SCALE),
    });
  }

  const averaged = weightedAverage(details.map((d): [number, number] => [d.comparison, 1]));
  const logitShift = (averaged ?? 0) * STYLE_SENSITIVITY;

  return { logitShift, details };
}
