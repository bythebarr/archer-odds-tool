/**
 * The market's fair price for any two-way bet, and how a book's price compares
 * to it — the value read on every line and prop. Client-safe and pure.
 *
 * Each book's two sides are de-vigged (proportionally, the same as devigPair),
 * and the fair probability is the average across books, with a sharp book
 * counted SHARP_WEIGHT times when the feed carries one. The book being judged
 * is left out of its own fair price, so one generous outlier can't vouch for
 * itself. Below MIN_BOOKS other books the read is withheld rather than guessed.
 */
import { americanToDecimal, americanToImpliedProbability, decimalToAmerican } from "./americanOdds";
import { devigPair } from "./devig";
import { SHARP_BOOK_KEYS } from "./bookAllowlist";

/** One book's prices on both sides of the same bet (same number). */
export interface TwoSidedQuote {
  bookKey: string;
  /** American odds for side A and side B. */
  priceA: number;
  priceB: number;
}

const SHARP = new Set<string>(SHARP_BOOK_KEYS);
const SHARP_WEIGHT = 3;
/** Other books needed (besides the one being judged) before a fair price is trusted. */
export const MIN_BOOKS = 3;

/**
 * A two-sided quote whose margin sits outside this range is a stale or broken
 * line (one side moved, the other didn't), not a market — kept out of the fair
 * price. Real two-way markets run roughly 2–10% over 100%.
 */
const MIN_OVERROUND = 1.0;
const MAX_OVERROUND = 1.15;

function coherent(q: TwoSidedQuote): boolean {
  const total = americanToImpliedProbability(q.priceA) + americanToImpliedProbability(q.priceB);
  return total >= MIN_OVERROUND && total <= MAX_OVERROUND;
}

export interface FairPrice {
  /** Fair probability of side A; side B is 1 − this. */
  probA: number;
  booksUsed: number;
}

/** The market's fair probability of side A, optionally leaving one book out. Null below MIN_BOOKS. */
export function fairPrice(quotes: TwoSidedQuote[], excludeBook?: string): FairPrice | null {
  let sum = 0;
  let weight = 0;
  let books = 0;
  for (const q of quotes) {
    if (q.bookKey === excludeBook || !coherent(q)) continue;
    const w = SHARP.has(q.bookKey) ? SHARP_WEIGHT : 1;
    sum += devigPair(q.priceA, q.priceB).fairA * w;
    weight += w;
    books++;
  }
  if (books < MIN_BOOKS) return null;
  return { probA: sum / weight, booksUsed: books };
}

export interface PriceValue {
  /** Expected value per unit staked against the market's fair price (0.03 = +3%). */
  ev: number;
  /** The fair price for this side, in American odds. */
  fairAmerican: number;
  booksUsed: number;
}

/**
 * How `price` on side A (or B) from `bookKey` compares to the rest of the
 * market. Null when too few other books price both sides of this number.
 */
export function valueOf(quotes: TwoSidedQuote[], side: "A" | "B", price: number, bookKey: string): PriceValue | null {
  const fair = fairPrice(quotes, bookKey);
  if (!fair) return null;
  const p = side === "A" ? fair.probA : 1 - fair.probA;
  return { ev: p * americanToDecimal(price) - 1, fairAmerican: Math.round(decimalToAmerican(1 / p)), booksUsed: fair.booksUsed };
}

/** Below this, an edge is inside the noise of line timing and rounding — shown as fair, not flagged. */
export const EV_FLAG = 0.015;
