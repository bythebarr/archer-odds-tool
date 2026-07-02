import { americanToDecimal, americanToImpliedProbability } from "./americanOdds";

/** One book's quote on both sides of a two-way market (h2h: home/away; totals: over/under). */
export interface DevigPair {
  bookKey: string;
  priceA: number; // American
  priceB: number;
  point: number | null; // side A's point; null for h2h. Used to group books quoting the same bet.
}

export interface ConsensusFairProbability {
  fairProbA: number | null;
  fairProbB: number | null;
  booksUsed: number;
  modalPoint: number | null;
}

function mode(values: (number | null)[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

/** Proportional (multiplicative) devig: normalizes one book's two implied probabilities to sum to 1. */
export function devigPair(priceA: number, priceB: number): { fairA: number; fairB: number } {
  const impliedA = americanToImpliedProbability(priceA);
  const impliedB = americanToImpliedProbability(priceB);
  const total = impliedA + impliedB;
  return { fairA: impliedA / total, fairB: impliedB / total };
}

/**
 * Consensus fair probability across books: averages each book's own devigged
 * probability (not the raw juiced average), so one high-vig book can't skew
 * the market view. Different points aren't the same bet, so only books
 * quoting the modal (most common) point are included — see plan doc's
 * "cross-book point mismatch" note.
 */
export function consensusFairProbability(pairs: DevigPair[]): ConsensusFairProbability {
  const modalPoint = mode(pairs.map((p) => p.point));
  const included = pairs.filter((p) => p.point === modalPoint);

  if (included.length === 0) {
    return { fairProbA: null, fairProbB: null, booksUsed: 0, modalPoint };
  }

  const fairs = included.map((p) => devigPair(p.priceA, p.priceB));
  const fairProbA = fairs.reduce((sum, f) => sum + f.fairA, 0) / fairs.length;
  const fairProbB = fairs.reduce((sum, f) => sum + f.fairB, 0) / fairs.length;

  return { fairProbA, fairProbB, booksUsed: included.length, modalPoint };
}

/** Expected value as a fraction of stake (e.g. 0.05 = +5% EV) of taking americanOdds if fairProb is the true win probability. */
export function calculateEv(fairProb: number, americanOdds: number): number {
  return fairProb * americanToDecimal(americanOdds) - 1;
}
