import type { UfcMatchup, UfcFighterHistory } from "@/lib/queries/ufcMatchup";
import { sampleConfidence, shrinkToward } from "@/lib/stats/weightedAverage";
import { decayWeight } from "./fighterStrength";

/**
 * "Finish math": a transparent, tunable v1 heuristic for HOW a bout ends —
 * method (KO/TKO · submission · decision) and round — layered on top of the
 * win probability from fighterMath.ts. Same philosophy as the strength model:
 * decay-weighted career history, shrunk toward league base rates for small
 * samples, combined by hand-documented rules, NOT a fitted/backtested model.
 *
 * The core idea is offense × durability: a method is likely when one fighter
 * tends to WIN that way and the other tends to LOSE that way (a KO artist vs a
 * suspect chin). We condition on the existing win probability rather than
 * re-deriving it, so this stays consistent with the win-prob card.
 */

export type FinishMethod = "ko" | "submission" | "decision";

/**
 * Scheduled rounds for a bout. Every UFC MAIN EVENT is 5 rounds — has been
 * since 2011, whether or not a belt is on the line — as is every title fight
 * (including a co-main title bout). Everything else is 3.
 *
 * `isMainEvent` is derived from card position (lowest boutOrder in the event)
 * in the query layer. But boutOrder + titleBout were only backfilled for
 * recently-ingested events — across the deep historical roster both are unset
 * (boutOrder null, titleBout false), so those two flags alone would score old
 * 5-round main events and title fights as 3. `resultRound` is the backstop for
 * COMPLETED bouts: a fight that reached round 4 or 5 was necessarily scheduled
 * for 5, so a finished bout with resultRound >= 4 is 5 regardless of the missing
 * metadata. (It can't recover a 5-round fight that ended early — that needs the
 * historical boutOrder/titleBout backfill — but it fixes every fight that
 * visibly went the distance.) Upcoming bouts have resultRound null, so this
 * never interferes there; they rely on boutOrder, which they do have.
 */
export function scheduledRoundsForBout(bout: {
  titleBout: boolean;
  isMainEvent: boolean;
  resultRound?: number | null;
}): number {
  if (bout.titleBout || bout.isMainEvent) return 5;
  if (bout.resultRound != null && bout.resultRound >= 4) return 5;
  return 3;
}

export interface MethodDistribution {
  ko: number;
  submission: number;
  decision: number;
}

/** UFC-wide base rates from our backfilled history (~8,960 decisive bouts): 47% decision / 33% KO-TKO / 20% submission. The shrink anchors for thin records. */
const BASE_RATE: MethodDistribution = { ko: 0.33, submission: 0.2, decision: 0.47 };

/**
 * Finish-round weights (R1..R5) from finishes-only history (2498/1439/703/52/34)
 * — finishes skew hard to the early rounds. The league-wide anchor a fighter's
 * OWN finish-round tendency is shrunk toward; truncated + renormalized to a
 * bout's scheduled length at projection time. Decisions are handled separately
 * (they land on the final round), so this profile is finishes only.
 */
const FINISH_ROUND_WEIGHTS = [2498, 1439, 703, 52, 34];
const GLOBAL_FINISH_ROUND = normalize(FINISH_ROUND_WEIGHTS);

/** Weighted count of wins (or losses) at which a fighter's method mix is trusted fully; below it, shrunk toward the base rate. Careers are short, so this is low. */
const METHOD_FULL_CONFIDENCE = 5;
/** Weighted count of finish-wins at which a fighter's own round tendency is trusted; below it, shrunk toward the league curve. */
const ROUND_FULL_CONFIDENCE = 4;

/** Normalize a weight vector to sum 1 (all-zero → uniform). */
function normalize(weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  return sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 1 / weights.length);
}

export interface FighterFinishProfile {
  /** How this fighter finishes when they WIN (shrunk ko/sub/dec shares). */
  offense: MethodDistribution;
  /** How this fighter is beaten when they LOSE — their vulnerability (shrunk ko/sub/dec shares). */
  durability: MethodDistribution;
  /** This fighter's own finish-round tendency (R1..R5, normalized), shrunk toward the league curve — do they finish early or grind late? */
  finishRoundProfile: number[];
  /** Decay-weighted count of wins / losses behind the two mixes (for confidence display). */
  winSample: number;
  lossSample: number;
}

export interface FinishProjection {
  /** Null win prob (missing history) → nothing to project. */
  available: boolean;
  /** Overall probability the fight ends by each method (sums to ~1). */
  method: MethodDistribution;
  /** Split by which fighter scores the result: a = fighter A (red), b = fighter B (blue). */
  byFighter: { a: MethodDistribution; b: MethodDistribution };
  finishProb: number;
  goesTheDistanceProb: number;
  /** P(bout ends in round r), index 0 = R1 … length = scheduledRounds. Decision mass sits on the final round. */
  rounds: number[];
  /** Per-fighter finish probability by round (index 0 = R1, length = scheduledRounds). a = red, b = blue. Excludes decisions (see byFighter.*.decision for those). */
  perFighterRounds: { a: number[]; b: number[] };
  scheduledRounds: number;
  /** Expected round of a finish, conditional on the fight not going to decision. Null when there's effectively no finish signal. */
  expectedFinishRound: number | null;
  fighterA: FighterFinishProfile;
  fighterB: FighterFinishProfile;
}

/**
 * Normalize Cito's raw method string into a bucket, or null for the
 * non-competitive outcomes (no-contest, DQ, overturned, could-not-continue)
 * that shouldn't inform a finish projection. Real vocabulary observed:
 * U-DEC/S-DEC/M-DEC/"Decision - *", KO/TKO/"TKO - Doctor's…", SUB/Submission,
 * plus CNC/DQ/Overturned/"Could Not Continue"/Other.
 */
export function classifyMethod(raw: string | null | undefined): FinishMethod | null {
  if (!raw) return null;
  const m = raw.toUpperCase();
  if (
    m.includes("NC") || // CNC, "No Contest"
    m.includes("NO CONTEST") ||
    m.includes("DQ") ||
    m.includes("OVERTURNED") ||
    m.includes("COULD NOT") ||
    m === "OTHER"
  ) {
    return null;
  }
  if (m.includes("DEC")) return "decision";
  if (m.includes("SUB")) return "submission";
  if (m.includes("KO")) return "ko"; // catches both "KO/TKO" and "TKO - …"
  return null;
}

const MS_PER_MONTH = 30.44 * 24 * 3600 * 1000;
function monthsBetween(earlier: Date, later: Date): number {
  return Math.max(0, (later.getTime() - earlier.getTime()) / MS_PER_MONTH);
}

/** Per-component shrink toward the base rate by sample confidence. Both raw and anchor sum to 1, and shrinkToward is affine, so the result stays normalized. */
function shrinkMix(raw: MethodDistribution, sample: number): MethodDistribution {
  const c = sampleConfidence(sample, METHOD_FULL_CONFIDENCE);
  return {
    ko: shrinkToward(raw.ko, BASE_RATE.ko, c),
    submission: shrinkToward(raw.submission, BASE_RATE.submission, c),
    decision: shrinkToward(raw.decision, BASE_RATE.decision, c),
  };
}

/** Decay-weighted method mix over the fighter's wins (offense) and losses (durability). */
export function computeFighterFinishProfile(history: UfcFighterHistory, now: Date = new Date()): FighterFinishProfile {
  const winCounts = { ko: 0, submission: 0, decision: 0 };
  const lossCounts = { ko: 0, submission: 0, decision: 0 };
  const roundCounts = [0, 0, 0, 0, 0]; // finish-wins by round (R1..R5)
  let winSample = 0;
  let lossSample = 0;
  let roundSample = 0;

  for (const fight of history.fights) {
    const cls = classifyMethod(fight.method);
    if (!cls) continue; // NC/DQ/overturned — not a competitive result
    const w = decayWeight(monthsBetween(fight.eventDate, now));
    if (fight.result === "win") {
      winCounts[cls] += w;
      winSample += w;
      // A win by finish with a known round feeds this fighter's round tendency.
      if ((cls === "ko" || cls === "submission") && fight.resultRound && fight.resultRound >= 1 && fight.resultRound <= 5) {
        roundCounts[fight.resultRound - 1] += w;
        roundSample += w;
      }
    } else if (fight.result === "loss") {
      lossCounts[cls] += w;
      lossSample += w;
    }
  }

  const rawRound = roundSample > 0 ? normalize(roundCounts) : [...GLOBAL_FINISH_ROUND];
  const roundConfidence = sampleConfidence(roundSample, ROUND_FULL_CONFIDENCE);
  const finishRoundProfile = rawRound.map((v, i) => shrinkToward(v, GLOBAL_FINISH_ROUND[i], roundConfidence));

  const toShares = (counts: MethodDistribution, sample: number): MethodDistribution =>
    sample > 0
      ? { ko: counts.ko / sample, submission: counts.submission / sample, decision: counts.decision / sample }
      : { ...BASE_RATE };

  return {
    offense: shrinkMix(toShares(winCounts, winSample), winSample),
    durability: shrinkMix(toShares(lossCounts, lossSample), lossSample),
    finishRoundProfile,
    winSample,
    lossSample,
  };
}

/** Geometric-mean blend of a winner's offense and the loser's matching vulnerability, normalized over the three methods. Needs BOTH sides to agree for a method to spike. */
function conditionalMethodDist(offense: MethodDistribution, oppDurability: MethodDistribution): MethodDistribution {
  const raw = {
    ko: Math.sqrt(offense.ko * oppDurability.ko),
    submission: Math.sqrt(offense.submission * oppDurability.submission),
    decision: Math.sqrt(offense.decision * oppDurability.decision),
  };
  const sum = raw.ko + raw.submission + raw.decision;
  if (sum <= 0) return { ...BASE_RATE }; // degenerate (both sides zeroed a shared method) — fall back
  return { ko: raw.ko / sum, submission: raw.submission / sum, decision: raw.decision / sum };
}

const EMPTY_MIX: MethodDistribution = { ko: 0, submission: 0, decision: 0 };

/**
 * Project method + round for a bout. `winProbA` is fighter A's (red corner)
 * win probability from computeUfcWinProbability — passed in rather than
 * recomputed so both cards agree. `scheduledRounds` is 5 for title/main-event
 * bouts, else 3 (the caller decides; see the bout page).
 */
export function computeFinishProjection(
  matchup: UfcMatchup,
  winProbA: number | null,
  scheduledRounds: number,
  now: Date = new Date()
): FinishProjection {
  const fighterA = computeFighterFinishProfile(matchup.fighterA, now);
  const fighterB = computeFighterFinishProfile(matchup.fighterB, now);

  if (winProbA === null) {
    return {
      available: false,
      method: { ...EMPTY_MIX },
      byFighter: { a: { ...EMPTY_MIX }, b: { ...EMPTY_MIX } },
      finishProb: 0,
      goesTheDistanceProb: 0,
      rounds: Array.from({ length: scheduledRounds }, () => 0),
      perFighterRounds: {
        a: Array.from({ length: scheduledRounds }, () => 0),
        b: Array.from({ length: scheduledRounds }, () => 0),
      },
      scheduledRounds,
      expectedFinishRound: null,
      fighterA,
      fighterB,
    };
  }

  const pA = winProbA;
  const pB = 1 - winProbA;

  // Within each fighter's win, distribute over methods via offense × opponent durability.
  const condA = conditionalMethodDist(fighterA.offense, fighterB.durability);
  const condB = conditionalMethodDist(fighterB.offense, fighterA.durability);

  const a: MethodDistribution = { ko: pA * condA.ko, submission: pA * condA.submission, decision: pA * condA.decision };
  const b: MethodDistribution = { ko: pB * condB.ko, submission: pB * condB.submission, decision: pB * condB.decision };

  const method: MethodDistribution = {
    ko: a.ko + b.ko,
    submission: a.submission + b.submission,
    decision: a.decision + b.decision,
  };
  const finishProb = method.ko + method.submission;
  const goesTheDistanceProb = method.decision;

  // Per-fighter round distribution: each fighter's total finish mass spread
  // over the rounds by THEIR own finish-round tendency (truncated + renormalized
  // to the scheduled length). Decisions are excluded here (see byFighter.decision).
  const aProfile = normalize(fighterA.finishRoundProfile.slice(0, scheduledRounds));
  const bProfile = normalize(fighterB.finishRoundProfile.slice(0, scheduledRounds));
  const aFinishTotal = a.ko + a.submission;
  const bFinishTotal = b.ko + b.submission;
  const perFighterRounds = {
    a: aProfile.map((share) => aFinishTotal * share),
    b: bProfile.map((share) => bFinishTotal * share),
  };

  // Aggregate per-round ending prob = both fighters' finishes that round, with
  // the decision mass on the final round — consistent with the per-fighter grid.
  const rounds = perFighterRounds.a.map((av, i) => av + perFighterRounds.b[i]);
  rounds[scheduledRounds - 1] += goesTheDistanceProb;

  const expectedFinishRound =
    finishProb > 1e-6
      ? perFighterRounds.a.reduce((sum, av, i) => sum + (i + 1) * (av + perFighterRounds.b[i]), 0) / finishProb
      : null;

  return {
    available: true,
    method,
    byFighter: { a, b },
    finishProb,
    goesTheDistanceProb,
    rounds,
    perFighterRounds,
    scheduledRounds,
    expectedFinishRound,
    fighterA,
    fighterB,
  };
}
