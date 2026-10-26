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
import { valueOf, type PriceValue, type TwoSidedQuote } from "@/lib/odds/marketValue";
import { calculateEv } from "@/lib/odds/devig";
import { probOver, projectProp, type ProjectionContext, type PropProjection } from "./projection";
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

/**
 * A game log as a tuple for the wire: a night's slate ships two seasons of logs
 * for every player, and positional arrays drop the repeated keys (about half the
 * payload). [date, opponent, isHome, season, minutes, pts, reb, ast, 3pm, stl, blk]
 */
export type PackedLog = [string, string, 0 | 1, number, number, number, number, number, number, number, number];

export function packLog(l: GameLogPoint): PackedLog {
  return [l.date, l.opponent, l.isHome ? 1 : 0, l.season, l.minutes, l.points, l.rebounds, l.assists, l.threesMade, l.steals, l.blocks];
}

export function unpackLog(t: PackedLog): GameLogPoint {
  const [date, opponent, isHome, season, minutes, points, rebounds, assists, threesMade, steals, blocks] = t;
  return { date, opponent, isHome: isHome === 1, season, minutes, points, rebounds, assists, threesMade, steals, blocks };
}

export interface SlateProp {
  playerId: string;
  stat: NbaPropStat;
  quotes: PropQuote[];
}

export type PropSort = "hitRate" | "margin" | "price" | "value" | "model";

/** Every window a prop's history is cut by, in display order. */
export type SplitKey = "l3" | "l5" | "l10" | "l15" | "l20" | "season" | "lastSeason" | "venue" | "h2h";

export interface PropSplit {
  key: SplitKey;
  label: string;
  rate: PropHitRateResult;
  /** Average of the stat over the same games. */
  avg: number | null;
}

/** What a prop's history is measured against: tonight's season, venue and opponent. */
export interface PropContext {
  season: number;
  venue: "home" | "away" | null;
  /** Tonight's opponent abbreviation, for the head-to-head split. */
  opponent?: string | null;
  /** When given, the prop is also projected (see projection.ts). */
  projection?: ProjectionContext;
}

/** ARCHR's model read on a prop at its line. */
export interface PropModel {
  projection: PropProjection;
  probOver: number;
  probUnder: number;
  /** EV of the best price on each side if the model's probability is right. */
  evOver: number | null;
  evUnder: number | null;
}

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
  hitRates: Record<SplitKey, PropHitRateResult>;
  /** The same windows with labels and averages, in display order. */
  splits: PropSplit[];
  /** Last 10 games, most recent first: did the chosen side cash? (pushes count as not cashing) */
  recent: boolean[];
  avgL10: number | null;
  avgMinutesL5: number | null;
  avgMinutesSeason: number | null;
  /** The best price on each side against the rest of the market's fair price (see marketValue). */
  value: { over: PriceValue | null; under: PriceValue | null };
  /** ARCHR's projection and model EV; null without a projection context or enough games. */
  model: PropModel | null;
}

/** Every book that prices both sides of `point`, as Over (A) / Under (B) pairs. */
export function twoSidedAt(quotes: PropQuote[], point: number): TwoSidedQuote[] {
  const byBook = new Map<string, { over?: number; under?: number }>();
  for (const q of quotes) {
    if (q.point !== point) continue;
    const row = byBook.get(q.bookKey) ?? {};
    row[q.side] = q.priceAmerican;
    byBook.set(q.bookKey, row);
  }
  return [...byBook].flatMap(([bookKey, r]) =>
    r.over !== undefined && r.under !== undefined ? [{ bookKey, priceA: r.over, priceB: r.under }] : []
  );
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
  context: PropContext,
  atPoint?: number
): PropSummary | null {
  const point = atPoint ?? propConsensusPoint(prop.quotes);
  if (point === null) return null;

  const cashes = (v: number) => (side === "over" ? v > point : v < point);
  const of = (games: GameLogPoint[]) => games.map((l) => stat.value(l));
  const values = of(logs);
  const seasonLogs = logs.filter((l) => l.season === context.season);
  const windows: { key: SplitKey; label: string; values: number[] }[] = [
    { key: "l3", label: "L3", values: values.slice(0, 3) },
    { key: "l5", label: "L5", values: values.slice(0, 5) },
    { key: "l10", label: "L10", values: values.slice(0, 10) },
    { key: "l15", label: "L15", values: values.slice(0, 15) },
    { key: "l20", label: "L20", values: values.slice(0, 20) },
    { key: "season", label: "Season", values: of(seasonLogs) },
    { key: "lastSeason", label: "Last szn", values: of(logs.filter((l) => l.season === context.season - 1)) },
    {
      key: "venue",
      label: context.venue === "home" ? "Home" : context.venue === "away" ? "Away" : "Venue",
      values: of((context.venue === null ? logs : logs.filter((l) => l.isHome === (context.venue === "home"))).slice(0, 20)),
    },
    {
      key: "h2h",
      label: context.opponent ? `vs ${context.opponent}` : "H2H",
      values: context.opponent ? of(logs.filter((l) => l.opponent === context.opponent)) : [],
    },
  ];
  const splits = windows.map((w) => ({
    key: w.key,
    label: w.label,
    rate: tallyPropHits(w.values, point, side),
    avg: average(w.values),
  }));

  const over = bestBettableLine(prop.quotes.filter((q) => q.side === "over"), point);
  const under = bestBettableLine(prop.quotes.filter((q) => q.side === "under"), point);
  const pairs = twoSidedAt(prop.quotes, point);
  const projection = context.projection ? projectProp(logs, stat, context.projection) : null;
  const pOver = projection ? probOver(projection, point) : null;
  const model: PropModel | null =
    projection && pOver !== null
      ? {
          projection,
          probOver: pOver,
          probUnder: 1 - pOver,
          evOver: over ? calculateEv(pOver, over.priceAmerican) : null,
          evUnder: under ? calculateEv(1 - pOver, under.priceAmerican) : null,
        }
      : null;

  return {
    playerId: prop.playerId,
    stat: prop.stat,
    point,
    points: [...new Set(prop.quotes.map((q) => q.point))].sort((a, b) => a - b),
    over,
    under,
    value: {
      over: over ? valueOf(pairs, "A", over.priceAmerican, over.bookKey) : null,
      under: under ? valueOf(pairs, "B", under.priceAmerican, under.bookKey) : null,
    },
    model,
    booksAtLine: new Set(prop.quotes.filter((q) => q.point === point && isBettableBook(q.bookKey)).map((q) => q.bookKey))
      .size,
    hitRates: Object.fromEntries(splits.map((sp) => [sp.key, sp.rate])) as Record<SplitKey, PropHitRateResult>,
    splits,
    recent: values.slice(0, 10).map(cashes),
    avgL10: average(values.slice(0, 10)),
    avgMinutesL5: average(logs.slice(0, 5).map((l) => l.minutes)),
    avgMinutesSeason: average(seasonLogs.map((l) => l.minutes)),
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
    // Unrated props (too few books) sort below every rated one.
    value: (s) => (side === "over" ? s.value.over : s.value.under)?.ev ?? -Infinity,
    model: (s) => (side === "over" ? s.model?.evOver : s.model?.evUnder) ?? -Infinity,
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
