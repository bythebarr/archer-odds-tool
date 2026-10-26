/**
 * The NFL props finder's arithmetic, client-safe and pure — the NBA version
 * (src/lib/nba/propsMath.ts) for football: hit rates over football-sized
 * windows (L3 / L5 / L8, the season, last season, home/away, head-to-head),
 * best bettable prices at the consensus line, the market's fair price, and
 * ARCHR's projection with its model EV.
 */
import type { NflPropStat } from "@/generated/prisma/client";
import { bestBettableLine, isBettableBook } from "@/lib/odds/bestPrice";
import { valueOf, type PriceValue } from "@/lib/odds/marketValue";
import { calculateEv } from "@/lib/odds/devig";
import { tallyPropHits, type PropDirection, type PropHitRateResult } from "@/lib/props/tally";
import { propConsensusPoint, twoSidedAt, type PropQuote, type PropSplit } from "@/lib/nba/propsMath";
import type { NflPropStatDef, NflStatLine } from "./propStats";
import { nflProbOver, projectNflProp, type NflProjection, type NflProjectionContext } from "./projection";

export interface NflLogPoint extends NflStatLine {
  date: string;
  opponent: string;
  isHome: boolean;
  season: number;
}

export interface NflSlateProp {
  playerId: string;
  stat: NflPropStat;
  quotes: PropQuote[];
}

export type NflPropSort = "hitRate" | "value" | "model" | "price";

export interface NflPropModel {
  projection: NflProjection;
  probOver: number;
  probUnder: number;
  evOver: number | null;
  evUnder: number | null;
}

export interface NflPropSummary {
  playerId: string;
  stat: NflPropStat;
  point: number;
  points: number[];
  over: PropQuote | null;
  under: PropQuote | null;
  booksAtLine: number;
  splits: PropSplit[];
  /** The L5 window, for the card's hit meter. */
  l5: PropHitRateResult;
  recent: boolean[];
  avg: number | null;
  value: { over: PriceValue | null; under: PriceValue | null };
  model: NflPropModel | null;
}

const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function summarizeNflProp(
  prop: NflSlateProp,
  logs: NflLogPoint[],
  stat: NflPropStatDef,
  side: PropDirection,
  ctx: { season: number; venue: "home" | "away" | null; opponent: string | null; projection: NflProjectionContext },
  atPoint?: number
): NflPropSummary | null {
  const point = atPoint ?? propConsensusPoint(prop.quotes);
  if (point === null) return null;
  const of = (g: NflLogPoint[]) => g.map((l) => stat.value(l));
  const values = of(logs);
  const windows: { key: PropSplit["key"]; label: string; values: number[] }[] = [
    { key: "l3", label: "L3", values: values.slice(0, 3) },
    { key: "l5", label: "L5", values: values.slice(0, 5) },
    { key: "l10", label: "L8", values: values.slice(0, 8) },
    { key: "season", label: "Season", values: of(logs.filter((l) => l.season === ctx.season)) },
    { key: "lastSeason", label: "Last szn", values: of(logs.filter((l) => l.season === ctx.season - 1)) },
    {
      key: "venue",
      label: ctx.venue === "home" ? "Home" : ctx.venue === "away" ? "Away" : "Venue",
      values: of(ctx.venue === null ? logs : logs.filter((l) => l.isHome === (ctx.venue === "home"))),
    },
    { key: "h2h", label: ctx.opponent ? `vs ${ctx.opponent}` : "H2H", values: ctx.opponent ? of(logs.filter((l) => l.opponent === ctx.opponent)) : [] },
  ];
  const splits = windows.map((w) => ({ key: w.key, label: w.label, rate: tallyPropHits(w.values, point, side), avg: avg(w.values) }));

  const over = bestBettableLine(prop.quotes.filter((q) => q.side === "over"), point);
  const under = bestBettableLine(prop.quotes.filter((q) => q.side === "under"), point);
  const pairs = twoSidedAt(prop.quotes, point);
  const projection = projectNflProp(logs, stat, ctx.projection);
  const pOver = projection ? nflProbOver(projection, stat, point) : null;

  return {
    playerId: prop.playerId,
    stat: prop.stat,
    point,
    points: [...new Set(prop.quotes.map((q) => q.point))].sort((a, b) => a - b),
    over,
    under,
    booksAtLine: new Set(prop.quotes.filter((q) => q.point === point && isBettableBook(q.bookKey)).map((q) => q.bookKey)).size,
    splits,
    l5: splits[1].rate,
    recent: values.slice(0, 8).map((v) => (side === "over" ? v > point : v < point)),
    avg: avg(values.slice(0, 5)),
    value: {
      over: over ? valueOf(pairs, "A", over.priceAmerican, over.bookKey) : null,
      under: under ? valueOf(pairs, "B", under.priceAmerican, under.bookKey) : null,
    },
    model:
      projection && pOver !== null
        ? {
            projection,
            probOver: pOver,
            probUnder: 1 - pOver,
            evOver: over ? calculateEv(pOver, over.priceAmerican) : null,
            evUnder: under ? calculateEv(1 - pOver, under.priceAmerican) : null,
          }
        : null,
  };
}

/** Best first. Unrated props sort below rated ones; a thin sample sorts below a full one at the same rate. */
export function sortNflSummaries(list: NflPropSummary[], sort: NflPropSort, side: PropDirection): NflPropSummary[] {
  const key: Record<NflPropSort, (s: NflPropSummary) => number> = {
    hitRate: (s) => (s.l5.hitRate ?? -1) + Math.min(s.l5.sampleSize, 5) / 1000,
    value: (s) => (side === "over" ? s.value.over : s.value.under)?.ev ?? -Infinity,
    model: (s) => (side === "over" ? s.model?.evOver : s.model?.evUnder) ?? -Infinity,
    price: (s) => {
      const b = side === "over" ? s.over : s.under;
      return b ? (b.priceAmerican > 0 ? b.priceAmerican / 100 + 1 : 100 / -b.priceAmerican + 1) : -Infinity;
    },
  };
  return list.sort((a, b) => key[sort](b) - key[sort](a));
}
