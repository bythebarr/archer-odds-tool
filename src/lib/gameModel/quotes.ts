/**
 * Books' game lines → the two-sided quotes the pricing needs, at the
 * consensus number: spreads at the home team's most-hung number (the away
 * side at its mirror), totals at the most-hung total, the moneyline as is.
 */
import { bestBettableLine, consensusPoint, isBettableBook } from "@/lib/odds/bestPrice";
import type { GameLineRow } from "@/lib/queries/games";
import type { GameMarket, MarketQuotes } from "./price";

const MARKET_TYPE = { ml: "h2h", spread: "spreads", total: "totals" } as const;
const SIDES = { ml: ["home", "away"], spread: ["home", "away"], total: ["over", "under"] } as const;

export function quotesFor(lines: GameLineRow[], market: GameMarket): MarketQuotes | null {
  const rows = lines.filter((l) => l.marketType === MARKET_TYPE[market] && !l.isAlternate);
  const [sideA, sideB] = SIDES[market];
  const a = rows.filter((l) => l.side === sideA);
  const b = rows.filter((l) => l.side === sideB);
  if (a.length === 0 || b.length === 0) return null;

  const point = market === "ml" ? null : consensusPoint(a.filter((l) => isBettableBook(l.bookKey)));
  if (market !== "ml" && point === null) return null;
  const pointB = market === "spread" ? -point! : point;
  const atA = a.filter((l) => l.point === point);
  const atB = b.filter((l) => l.point === pointB);

  const byBook = new Map<string, { a?: number; b?: number }>();
  for (const l of atA) byBook.set(l.bookKey, { ...byBook.get(l.bookKey), a: l.priceAmerican });
  for (const l of atB) byBook.set(l.bookKey, { ...byBook.get(l.bookKey), b: l.priceAmerican });
  const pairs = [...byBook].flatMap(([bookKey, p]) => (p.a !== undefined && p.b !== undefined ? [{ bookKey, priceA: p.a, priceB: p.b }] : []));

  const best = (list: GameLineRow[], at: number | null) => {
    const l = bestBettableLine(list, at);
    return l ? { priceAmerican: l.priceAmerican, bookKey: l.bookKey, bookName: l.bookName } : null;
  };
  return { point, pairs, bestA: best(atA, point), bestB: best(atB, pointB) };
}
