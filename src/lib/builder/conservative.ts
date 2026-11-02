/**
 * A leg's conservative chance and conservative relative edge: the numbers the
 * Props screener sorts by and the payout optimizer maximizes. Pure.
 *
 * A record of 9 for 10 and a model reading of 80% are both estimates; the
 * conservative chance takes the more cautious of the two: the low end of the
 * record's range (Wilson, one standard error, so 5 of 5 isn't treated as
 * certain) or ARCHR's chance, whichever is lower. The relative edge compares
 * that with the chance the book's price implies (vig included): +10% means the
 * leg looks 10% more likely than the price says, even read cautiously.
 */
import type { Rate } from "./types";

/**
 * A conservative read more than this far above the price's (+50%) is a price
 * that doesn't belong to the line (a misread alt rung, a stale or swapped
 * price), not value: such legs are left out of the optimizer and of sorting by
 * conservative edge. The same bar the builder puts on ARCHR's edge.
 */
export const MAX_TRUSTED_RELATIVE_EDGE = 0.5;

/** Fewer games than this and the record alone doesn't make a chance. */
const MIN_GAMES = 3;

/** Low end of a record's range at one standard error. */
export function recordFloor(hits: number, n: number): number {
  if (!n) return 0;
  const p = hits / n;
  const d = 1 + 1 / n;
  return (p + 1 / (2 * n) - Math.sqrt((p * (1 - p)) / n + 1 / (4 * n * n))) / d;
}

/** The book's implied chance at an American price (vig included). */
export function impliedProb(american: number): number {
  return american < 0 ? -american / (100 - american) : 100 / (american + 100);
}

/** The cautious read: min(ARCHR, record floor); either alone where only one exists; null with neither. */
export function conservativeProb(archr: number | null, rate: Rate): number | null {
  const [h, n] = rate;
  const floor = n >= MIN_GAMES ? recordFloor(h, n) : null;
  if (archr === null) return floor;
  if (floor === null) return archr;
  return Math.min(archr, floor);
}

/** Conservative chance over the price's implied chance, minus one; null without both. */
export function relativeEdge(prob: number | null, priceAmerican: number | null): number | null {
  if (prob === null || priceAmerican === null) return null;
  return prob / impliedProb(priceAmerican) - 1;
}

/** The relative edge where it can be believed; null past MAX_TRUSTED_RELATIVE_EDGE. */
export function trustedRelativeEdge(edge: number | null): number | null {
  return edge !== null && edge <= MAX_TRUSTED_RELATIVE_EDGE ? edge : null;
}
