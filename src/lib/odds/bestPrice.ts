import type { GameLineRow } from "@/lib/queries/games";
import { americanToDecimal } from "@/lib/odds/americanOdds";

/**
 * Pick the best (highest decimal-odds) line per side, returned in `sideOrder`.
 * Callers pre-filter `lines` to a single market (and drop alt lines) before
 * calling — this only does the per-side "best price" reduce, which was
 * copy-pasted across the MLB/tennis/soccer list previews.
 */
export function bestLinesBySide(lines: GameLineRow[], sideOrder: string[]): GameLineRow[] {
  const bestBySide = new Map<string, GameLineRow>();
  for (const line of lines) {
    const current = bestBySide.get(line.side);
    if (!current || americanToDecimal(line.priceAmerican) > americanToDecimal(current.priceAmerican)) {
      bestBySide.set(line.side, line);
    }
  }
  return sideOrder
    .map((side) => bestBySide.get(side))
    .filter((line): line is GameLineRow => line !== undefined);
}
