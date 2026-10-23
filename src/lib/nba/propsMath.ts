/**
 * The props finder's arithmetic, kept pure and client-safe: the page ships the
 * slate's raw quotes and game logs once, and every stat/side/sort/line switch is
 * recomputed here in the browser — instant, with no round trip.
 *
 * The rules match the game-line board's (bestBettableLine): only bettable books
 * are ever "best", and prices are compared only at one number.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { bestBettableLine, consensusPoint, isBettableBook } from "@/lib/odds/bestPrice";
import { tallyPropHits, type PropDirection, type PropHitRateResult } from "@/lib/props/tally";
import type { NbaPropStat } from "@/generated/prisma/client";
import type { NbaPropStatDef, NbaStatLine } from "./propStats";

export interface PropQuote {
  bookKey: string;
  bookName: string;
  side: PropDirection;
  point: number;
  priceAmerican: number;
}

export interface GameLogPoint extends NbaStatLine {
  /** ET date of the game, YYYY-MM-DD. */
  date: string;
  opponent: string;
  isHome: boolean;
  season: number;
  minutes: number;
}

export interface SlateProp {
  playerId: string;
  stat: NbaPropStat;
  quotes: PropQuote[];
}

export type PropSort = "hitRate" | "margin" | "price";

export interface PropSummary {
  playerId: string;
  stat: NbaPropStat;
  /** The line every number below is measured at. */
  point: number;
  /** Every number any book hangs, ascending — the sheet's line selector. */
  points: number[];
  over: PropQuote | null;
  under: PropQuote | null;
  booksAtLine: number;
  hitRates: { l5: PropHitRateResult; l10: PropHitRateResult; l20: PropHitRateResult; season: PropHitRateResult; venue: PropHitRateResult };
  /** Last 10 games, most recent first: did the chosen side cash? (pushes count as not cashing) */
  recent: boolean[];
  avgL10: number | null;
  avgMinutesL5: number | null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** The consensus number among bettable books, both sides together so Over and Under describe one line. */
export function propConsensusPoint(quotes: PropQuote[]): number | null {
  return consensusPoint(quotes.filter((q) => isBettableBook(q.bookKey)));
}

/**
 * Everything one prop row shows, at `atPoint` (default: the consensus). Null
 * when no bettable book prices it at all.
 */
export function summarizeProp(
  prop: SlateProp,
  logs: GameLogPoint[],
  stat: NbaPropStatDef,
  side: PropDirection,
  context: { season: number; venue: "home" | "away" | null },
  atPoint?: number
): PropSummary | null {
  const point = atPoint ?? propConsensusPoint(prop.quotes);
  if (point === null) return null;

  const values = logs.map((l) => stat.value(l));
  const tally = (v: number[]) => tallyPropHits(v, point, side);
  const cashes = (v: number) => (side === "over" ? v > point : v < point);
  const venueLogs =
    context.venue === null ? logs : logs.filter((l) => l.isHome === (context.venue === "home"));

  return {
    playerId: prop.playerId,
    stat: prop.stat,
    point,
    points: [...new Set(prop.quotes.map((q) => q.point))].sort((a, b) => a - b),
    over: bestBettableLine(prop.quotes.filter((q) => q.side === "over"), point),
    under: bestBettableLine(prop.quotes.filter((q) => q.side === "under"), point),
    booksAtLine: new Set(prop.quotes.filter((q) => q.point === point && isBettableBook(q.bookKey)).map((q) => q.bookKey))
      .size,
    hitRates: {
      l5: tally(values.slice(0, 5)),
      l10: tally(values.slice(0, 10)),
      l20: tally(values.slice(0, 20)),
      season: tally(logs.filter((l) => l.season === context.season).map((l) => stat.value(l))),
      venue: tally(venueLogs.slice(0, 20).map((l) => stat.value(l))),
    },
    recent: values.slice(0, 10).map(cashes),
    avgL10: average(values.slice(0, 10)),
    avgMinutesL5: average(logs.slice(0, 5).map((l) => l.minutes)),
  };
}

/** Bigger is better for the chosen side. */
function marginOf(s: PropSummary, side: PropDirection): number {
  if (s.avgL10 === null) return -Infinity;
  return side === "over" ? s.avgL10 - s.point : s.point - s.avgL10;
}

/** Sorts in place, best first. A thin sample sorts below a full one at the same rate: 2/2 is not 9/10. */
export function sortSummaries(summaries: PropSummary[], sort: PropSort, side: PropDirection): PropSummary[] {
  const price = (s: PropSummary) => {
    const best = side === "over" ? s.over : s.under;
    return best ? americanToDecimal(best.priceAmerican) : -Infinity;
  };
  const key: Record<PropSort, (s: PropSummary) => number> = {
    hitRate: (s) => (s.hitRates.l10.hitRate ?? -1) + Math.min(s.hitRates.l10.sampleSize, 10) / 1000,
    margin: (s) => marginOf(s, side),
    price,
  };
  return summaries.sort((a, b) => key[sort](b) - key[sort](a));
}

export interface BookRow {
  bookKey: string;
  bookName: string;
  over: number | null;
  under: number | null;
  bettable: boolean;
}

/** Every book's Over/Under at one number, for the sheet's book table — bettable books first, by the chosen side's price. */
export function booksAtPoint(quotes: PropQuote[], point: number, side: PropDirection): BookRow[] {
  const rows = new Map<string, BookRow>();
  for (const q of quotes) {
    if (q.point !== point) continue;
    const row = rows.get(q.bookKey) ?? {
      bookKey: q.bookKey,
      bookName: q.bookName,
      over: null,
      under: null,
      bettable: isBettableBook(q.bookKey),
    };
    row[q.side] = q.priceAmerican;
    rows.set(q.bookKey, row);
  }
  const price = (r: BookRow) => (r[side] === null ? -Infinity : americanToDecimal(r[side]!));
  return [...rows.values()].sort((a, b) => Number(b.bettable) - Number(a.bettable) || price(b) - price(a));
}
