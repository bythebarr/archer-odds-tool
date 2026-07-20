import { americanToDecimal } from "./americanOdds";

/**
 * Reject quotes that aren't a real market, before they reach the database.
 *
 * A two-way market's prices should imply slightly MORE than 100% probability —
 * that surplus is the book's vig. Measured across a live slate:
 *
 *   pinnacle              1.020   (sharpest book, ~2% vig)
 *   draftkings / fanduel  1.041 - 1.047
 *   novig / prophetx      0.971 / 1.004   (exchanges — near-zero vig, and a
 *                                          genuine arb can dip just under 1.0)
 *   kalshi                0.449   ← both sides implying 45% TOTAL
 *
 * Kalshi's book is empty, so the feed reports lone resting orders as if they
 * were a market. Left unguarded, a +4900 on a coin-flip game reads as an
 * enormous edge, lands on the card, and manufactures fake EV in the record the
 * whole product's credibility rests on.
 *
 * The guard is general rather than a blacklist: any book whose quotes stop
 * making sense — a feed bug, a stale cache, a new provider — gets dropped the
 * same way, instead of us discovering it in the ledger weeks later.
 */

/**
 * Floor is 0.90, not 0.95, because real exchanges legitimately go under 1.0 and
 * we measured Novig at 0.885. A true arbitrage is worth a fraction of a percent;
 * anything implying a >10% free lunch is broken data, not an opportunity.
 */
export const MIN_OVERROUND = 0.9;

/**
 * Ceiling catches the opposite failure — a garbled or one-sided quote priced far
 * too short. Normal retail tops out around 1.05, so 1.25 flags only nonsense.
 */
export const MAX_OVERROUND = 1.25;

/** Implied probability of an American price. */
export function impliedProbability(american: number): number {
  return 1 / americanToDecimal(american);
}

/** Total implied probability across a market's sides — the vig, plus one. */
export function overround(prices: number[]): number {
  return prices.reduce((sum, p) => sum + impliedProbability(p), 0);
}

/**
 * Is this a plausible market?
 *
 * A single-sided quote passes: a book pricing only the Over is normal and still
 * shoppable, and there's nothing to cross-check it against. The guard exists for
 * markets that claim to be two-way and aren't.
 */
export function isCoherentMarket(prices: number[]): boolean {
  if (prices.length < 2) return true;
  const total = overround(prices);
  return total >= MIN_OVERROUND && total <= MAX_OVERROUND;
}
