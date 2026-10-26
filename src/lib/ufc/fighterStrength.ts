import type { UfcFighterHistory, UfcFightRecord, UfcFightResult } from "@/lib/queries/ufcMatchup";
import { weightedAverage, sampleConfidence, shrinkToward } from "@/lib/stats/weightedAverage";

/**
 * Layer 1 of "fighter math": a decay-weighted [0,1] strength score per
 * fighter, blending result quality (win/loss + how dominant) with a
 * stat-differential refinement where Cito has enriched the bout with
 * stats. Shrunk toward neutral (0.5) both for small career sample size and
 * for a long layoff — see fighterMath.ts for how this combines with the
 * common-opponent and style layers into a final win probability.
 */

/** A fight's weight halves every this many months — "what have you done for me lately" per the user's explicit choice over a longer/slower decay. */
const HALF_LIFE_MONTHS = 12;

/** Career fights needed before result-quality history is trusted at full strength; below this, shrunk toward 0.5 proportionally — same pattern as PITCHER_FULL_CONFIDENCE_STARTS in archer/winProbability.ts, just UFC's own threshold (careers are much shorter than an MLB season). */
const FULL_CONFIDENCE_FIGHTS = 8;

/** No layoff penalty until this many months since the fighter's last bout — normal UFC cadence is roughly 1-2 fights/year, so a year off isn't unusual. */
const LAYOFF_GRACE_MONTHS = 12;
/** Beyond the grace period, layoff confidence decays linearly to 0 over this many additional months (so a fighter idle 36+ months is fully shrunk toward neutral). */
const LAYOFF_FULL_DECAY_MONTHS = 24;

/** Result quality (win/loss + dominance) dominates the per-fight score; stat differential is a secondary refinement only available where Cito has bout stats. */
const RESULT_QUALITY_WEIGHT = 0.7;
const STAT_DIFFERENTIAL_WEIGHT = 0.3;

/** "What counts as a big differential" for squashing raw stat gaps into a bounded score — documented guesses, tunable. */
const SIGNIFICANT_STRIKE_DIFFERENTIAL_SCALE = 50;
const TAKEDOWN_DIFFERENTIAL_SCALE = 3;

const MS_PER_MONTH = 30.44 * 24 * 3600 * 1000;

function monthsBetween(earlier: Date, later: Date): number {
  return Math.max(0, (later.getTime() - earlier.getTime()) / MS_PER_MONTH);
}

function isFinish(method: string | null): boolean {
  const m = method?.toLowerCase() ?? "";
  return m.includes("ko") || m.includes("sub");
}

/** One number capturing both the win/loss outcome and how dominant it was — a finish is worth more than grinding out (or losing) a decision. */
export function resultQuality(result: UfcFightResult, method: string | null): number {
  if (result === "draw" || result === "noContest") return 0.5;
  const finish = isFinish(method);
  if (result === "win") return finish ? 1.0 : 0.75;
  return finish ? 0.0 : 0.25;
}

/** Exponential decay weight for a fight `monthsAgo` in the past. */
export function decayWeight(monthsAgo: number, halfLifeMonths: number = HALF_LIFE_MONTHS): number {
  return Math.pow(0.5, monthsAgo / halfLifeMonths);
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max);
}

/** [0,1] score from a fight's stat differential (own stats minus opponent's, in the same bout) — null if either side's stats weren't captured. */
function statDifferentialScore(fight: UfcFightRecord): number | null {
  if (!fight.myStats || !fight.opponentStats) return null;
  const strikeDiff = fight.myStats.significantStrikesLanded - fight.opponentStats.significantStrikesLanded;
  const tdDiff = fight.myStats.takedownsLanded - fight.opponentStats.takedownsLanded;
  const normalized =
    (clamp(strikeDiff / SIGNIFICANT_STRIKE_DIFFERENTIAL_SCALE, -1, 1) +
      clamp(tdDiff / TAKEDOWN_DIFFERENTIAL_SCALE, -1, 1)) /
    2;
  return 0.5 + 0.5 * normalized;
}

/** Combined per-fight score in [0,1] — result quality always available, stat differential blended in where present. */
function fightScore(fight: UfcFightRecord): number {
  const combined = weightedAverage([
    [resultQuality(fight.result, fight.method), RESULT_QUALITY_WEIGHT],
    [statDifferentialScore(fight), STAT_DIFFERENTIAL_WEIGHT],
  ]);
  // resultQuality is always non-null, so weightedAverage always returns a value here.
  return combined!;
}

/** Confidence in [0,1] for a layoff of `monthsSinceLastFight` — 1 within the grace period, decaying linearly to 0 over the following LAYOFF_FULL_DECAY_MONTHS. */
function layoffConfidence(monthsSinceLastFight: number): number {
  if (monthsSinceLastFight <= LAYOFF_GRACE_MONTHS) return 1;
  return clamp(1 - (monthsSinceLastFight - LAYOFF_GRACE_MONTHS) / LAYOFF_FULL_DECAY_MONTHS, 0, 1);
}

/**
 * The pro-record prior: where a fighter starts before their UFC fights say
 * anything. Regional records are inflated — prospects are matched to win, and
 * UFC signees average roughly an 80% win rate — so the prior reads a record
 * against that baseline, not against 50%, and a debut carries a discount for
 * the jump in competition. Tunable; fit from historical debuts with
 * `npm run fit:ufc-prior` (scripts/fit-ufc-prior.ts).
 */
export interface PriorParams {
  /** Win rate of a typical UFC signee's pre-UFC record — the record the prior is read against. */
  signeeBaseline: number;
  /** Pseudo-fights at that baseline, shrinking a short record's win rate toward it. */
  pseudoFights: number;
  /** Strength per unit of win rate above/below the baseline. */
  scale: number;
  /** Strength subtracted for the step up from regional to UFC competition. */
  debutDiscount: number;
}

export const DEFAULT_PRIOR: PriorParams = { signeeBaseline: 0.8, pseudoFights: 5, scale: 0.6, debutDiscount: 0.03 };

const PRIOR_MIN = 0.3;
const PRIOR_MAX = 0.7;

/**
 * [0,1] starting strength from the pre-UFC record. With no record on file it's
 * a plain 0.5 — nothing known, nothing claimed (and no debut discount, since
 * whether the record is short or just missing can't be told apart).
 */
export function priorStrength(history: UfcFighterHistory, params: PriorParams = DEFAULT_PRIOR): number {
  const rec = history.preUfcRecord;
  if (!rec) return 0.5;
  const n = rec.wins + rec.losses;
  const winRate = (rec.wins + params.signeeBaseline * params.pseudoFights) / (n + params.pseudoFights);
  return clamp(0.5 - params.debutDiscount + params.scale * (winRate - params.signeeBaseline), PRIOR_MIN, PRIOR_MAX);
}

/**
 * Decay-weighted, confidence-shrunk [0,1] strength score for one fighter. A
 * short UFC sample shrinks toward the fighter's own pro-record prior (not a
 * coin flip), and a debutant IS their prior — so every fighter with a record on
 * file gets a projection. Null only with no UFC fights and no usable record.
 */
export function computeFighterStrength(
  history: UfcFighterHistory,
  now: Date = new Date(),
  prior: PriorParams = DEFAULT_PRIOR
): number | null {
  const anchor = priorStrength(history, prior);
  if (history.fights.length === 0) return history.preUfcRecord ? anchor : null;

  const weighted = history.fights.map(
    (fight): [number, number] => [fightScore(fight), decayWeight(monthsBetween(fight.eventDate, now))]
  );
  const rawStrength = weightedAverage(weighted)!;

  const sampleShrunk = shrinkToward(rawStrength, anchor, sampleConfidence(history.fights.length, FULL_CONFIDENCE_FIGHTS));

  const monthsSinceLastFight = monthsBetween(history.fights[0].eventDate, now);
  return shrinkToward(sampleShrunk, 0.5, layoffConfidence(monthsSinceLastFight));
}
