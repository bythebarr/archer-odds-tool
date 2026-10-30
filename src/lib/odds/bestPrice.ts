import type { GameLineRow } from "@/lib/queries/games";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { BETTABLE_BOOK_KEYS } from "@/lib/odds/bookAllowlist";

const BETTABLE = new Set<string>(BETTABLE_BOOK_KEYS);

/** The fields line shopping needs — satisfied by game lines and player-prop lines alike. */
export interface PricedLine {
  bookKey: string;
  point: number | null;
  priceAmerican: number;
}

/** True when a member can actually bet this book — Pinnacle prices, but is never offered as a best line. */
export function isBettableBook(bookKey: string): boolean {
  return BETTABLE.has(bookKey);
}

/**
 * The number most books are hanging for one side, or null for a market with no
 * points (moneyline). Ties go to the number whose best price is nearest even
 * money: that's where a book sets its main line, and on a one-book alt ladder
 * (every rung a tie) it picks the main number rather than the longest shot.
 */
export function consensusPoint(lines: PricedLine[]): number | null {
  const byPoint = new Map<number, { count: number; bestDecimal: number }>();
  for (const line of lines) {
    if (line.point === null) continue;
    const decimal = americanToDecimal(line.priceAmerican);
    const entry = byPoint.get(line.point) ?? { count: 0, bestDecimal: 0 };
    entry.count++;
    entry.bestDecimal = Math.max(entry.bestDecimal, decimal);
    byPoint.set(line.point, entry);
  }
  let best: { point: number; count: number; bestDecimal: number } | null = null;
  for (const [point, entry] of byPoint) {
    const nearerEven = (a: number, b: number) => Math.abs(Math.log(a - 1)) < Math.abs(Math.log(b - 1));
    if (!best || entry.count > best.count || (entry.count === best.count && nearerEven(entry.bestDecimal, best.bestDecimal))) {
      best = { point, ...entry };
    }
  }
  return best?.point ?? null;
}

/**
 * The best line for ONE side of one market: the highest price among bettable
 * books, compared only at the consensus number.
 *
 * Both restrictions matter for a line shopper. Pinnacle is the sharp baseline,
 * not a book a US member can use, so "best at Pinnacle" points nowhere. And a
 * price is only comparable at the same number: -3.5 at -105 is not "better" than
 * -3 at -115 in any way a single sort can decide, so mixing points would crown
 * whichever book hung the worse number at the friendlier price.
 *
 * `atPoint` overrides the consensus — for a two-sided market (a prop's Over and
 * Under) the caller picks one number for both sides so they describe one line.
 */
export function bestBettableLine<T extends PricedLine>(lines: T[], atPoint?: number | null): T | null {
  const bettable = lines.filter((l) => isBettableBook(l.bookKey));
  const point = atPoint !== undefined ? atPoint : consensusPoint(bettable);
  let best: T | null = null;
  for (const line of bettable) {
    if (point !== null && line.point !== point) continue;
    if (!best || americanToDecimal(line.priceAmerican) > americanToDecimal(best.priceAmerican)) best = line;
  }
  return best;
}

/**
 * The best line per side (see bestBettableLine), returned in `sideOrder`.
 * Callers pre-filter `lines` to a single market (and drop alt lines) before
 * calling — this only does the per-side reduce, which was copy-pasted across
 * the MLB/tennis/soccer list previews.
 */
export function bestLinesBySide(lines: GameLineRow[], sideOrder: string[]): GameLineRow[] {
  return sideOrder
    .map((side) => bestBettableLine(lines.filter((l) => l.side === side)))
    .filter((line): line is GameLineRow => line !== null);
}
