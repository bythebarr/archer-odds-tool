import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { consensusFairProbability, type DevigPair } from "@/lib/odds/devig";

/**
 * Read layer for UFC moneyline odds. Returns the best (bettor-friendliest)
 * price per corner across allowlisted books plus the devigged market-consensus
 * fair probability — the market's own view, to sit alongside the fighter-math
 * projection. EV itself is computed at the UI layer, where the model
 * probability lives (see UfcOddsEvCard). Pure best-price/devig math is reused
 * from lib/odds — nothing here is UFC-specific except the red/blue corner keys.
 */

export interface UfcCornerBestLine {
  priceAmerican: number;
  bookKey: string;
}

export interface UfcBoutOddsSummary {
  red: UfcCornerBestLine | null;
  blue: UfcCornerBestLine | null;
  /** Books contributing a two-sided quote to the consensus. */
  bookCount: number;
  /** Devigged market consensus that red wins (null if no book has both sides). */
  marketFairProbRed: number | null;
  marketFairProbBlue: number | null;
  polledAt: Date | null;
}

/** Highest decimal odds = best price for the bettor; American isn't linearly comparable across ±100, so compare in decimal (see americanOdds.ts). */
function bestLine(rows: { priceAmerican: number; bookKey: string }[]): UfcCornerBestLine | null {
  let best: UfcCornerBestLine | null = null;
  for (const r of rows) {
    if (best === null || americanToDecimal(r.priceAmerican) > americanToDecimal(best.priceAmerican)) {
      best = { priceAmerican: r.priceAmerican, bookKey: r.bookKey };
    }
  }
  return best;
}

/** Best moneyline per corner for many bouts at once — one query, for the /ufc list rows (no devig/EV, just the line to shop). */
export async function getBestLinesForBouts(
  boutIds: string[]
): Promise<Map<string, { red: UfcCornerBestLine | null; blue: UfcCornerBestLine | null }>> {
  const result = new Map<string, { red: UfcCornerBestLine | null; blue: UfcCornerBestLine | null }>();
  if (boutIds.length === 0) return result;

  const rows = await prisma.ufcBoutOdds.findMany({
    where: { boutId: { in: boutIds } },
    select: { boutId: true, bookKey: true, corner: true, priceAmerican: true },
  });

  const byBout = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byBout.get(r.boutId) ?? [];
    list.push(r);
    byBout.set(r.boutId, list);
  }
  for (const [boutId, boutRows] of byBout) {
    result.set(boutId, {
      red: bestLine(boutRows.filter((r) => r.corner === "red")),
      blue: bestLine(boutRows.filter((r) => r.corner === "blue")),
    });
  }
  return result;
}

export const getUfcBoutOdds = cache(async (boutId: string): Promise<UfcBoutOddsSummary | null> => {
  const rows = await prisma.ufcBoutOdds.findMany({
    where: { boutId },
    select: { bookKey: true, corner: true, priceAmerican: true, polledAt: true },
  });
  if (rows.length === 0) return null;

  const red = rows.filter((r) => r.corner === "red");
  const blue = rows.filter((r) => r.corner === "blue");

  // Build per-book two-sided pairs for the consensus devig (a book only counts
  // if it quoted BOTH corners). point is null — moneyline is a single market.
  const blueByBook = new Map(blue.map((r) => [r.bookKey, r.priceAmerican]));
  const pairs: DevigPair[] = [];
  for (const r of red) {
    const bluePrice = blueByBook.get(r.bookKey);
    if (bluePrice !== undefined) {
      pairs.push({ bookKey: r.bookKey, priceA: r.priceAmerican, priceB: bluePrice, point: null });
    }
  }
  const consensus = consensusFairProbability(pairs);

  const polledAt = rows.reduce<Date | null>(
    (latest, r) => (latest === null || r.polledAt > latest ? r.polledAt : latest),
    null
  );

  return {
    red: bestLine(red),
    blue: bestLine(blue),
    bookCount: pairs.length,
    marketFairProbRed: consensus.fairProbA,
    marketFairProbBlue: consensus.fairProbB,
    polledAt,
  };
});
