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
import { tallyPropHits, type PropDirection, type PropHitRateResult } from "@/lib/props/tally";
import { propConsensusPoint, twoSidedAt, type PropQuote, type PropSplit } from "@/lib/nba/propsMath";
import type { NflPropStatDef, NflStatLine } from "./propStats";
import { NFL_CALIBRATION_SHRINK, nflRawOver, projectNflProp, type NflProjection, type NflProjectionContext } from "./projection";
import type { InjuryLevel } from "@/lib/injuries/status";
import { modelWithheld, priceProp, type PricedProp } from "@/lib/propModel/price";
import { altLinePoints, type AltLineRow } from "@/lib/props/altLines";

export interface NflLogPoint extends NflStatLine {
  date: string;
  opponent: string;
  isHome: boolean;
  season: number;
}

/** A log as a tuple: [date, opponent, isHome, season, ...core columns, ...extra columns (null = not on the box score)]. */
export type PackedNflLog = [string, string, 0 | 1, number, ...(number | null)[]];

/** The always-present columns, in wire order — also what the defense-by-position table sums. */
export const NFL_LOG_COLUMNS = [
  "passAttempts", "passCompletions", "passYards", "passTds", "interceptions",
  "rushAttempts", "rushYards", "rushTds", "receptions", "targets", "recYards", "recTds",
] as const satisfies readonly (keyof NflStatLine)[];

/** Columns a box score may not carry (null when missing), after the core ones on the wire. */
export const NFL_EXTRA_COLUMNS = [
  "rushLongest", "recLongest", "fieldGoalsMade", "extraPointsMade", "kickingPoints", "tackles", "soloTackles", "sacks",
  // nflverse's advanced line.
  "offenseSnaps", "snapPct", "targetShare", "airYardsShare", "airYards", "yac", "recFirstDowns", "recEpa", "rushFirstDowns", "rushEpa",
  "dropbacks", "passAirYards", "passEpa", "cpoe", "sacksTaken", "scrambles", "deepAttempts",
  "rzTargets", "rzCarries", "glCarries", "ezTargets", "deepTargets", "rzPassAttempts",
] as const satisfies readonly (keyof NflStatLine)[];

/** Three decimals is all the wire needs (shares, EPA). */
const wire = (v: number | null | undefined) => (v === null || v === undefined ? null : Number.isInteger(v) ? v : Math.round(v * 1000) / 1000);

export function packNflLog(l: NflLogPoint): PackedNflLog {
  const extra = NFL_EXTRA_COLUMNS.map((c) => wire(l[c]));
  // Trailing nulls (a defender's, or a game before the advanced import) aren't sent: unpacking reads them back as null.
  let end = extra.length;
  while (end > 0 && extra[end - 1] === null) end--;
  return [l.date, l.opponent, l.isHome ? 1 : 0, l.season, ...NFL_LOG_COLUMNS.map((c) => l[c]), ...extra.slice(0, end)];
}

export function unpackNflLog(t: PackedNflLog): NflLogPoint {
  const [date, opponent, isHome, season, ...rest] = t;
  const core = Object.fromEntries(NFL_LOG_COLUMNS.map((c, i) => [c, rest[i] ?? 0]));
  const extra = Object.fromEntries(NFL_EXTRA_COLUMNS.map((c, i) => [c, rest[NFL_LOG_COLUMNS.length + i] ?? null]));
  return { date, opponent, isHome: isHome === 1, season, ...core, ...extra } as unknown as NflLogPoint;
}

/** A stat line with every extra column empty — for sums and fixtures. */
export function emptyNflExtras(): Pick<NflStatLine, (typeof NFL_EXTRA_COLUMNS)[number]> {
  return Object.fromEntries(NFL_EXTRA_COLUMNS.map((c) => [c, null])) as Pick<NflStatLine, (typeof NFL_EXTRA_COLUMNS)[number]>;
}

export interface NflSlateProp {
  playerId: string;
  stat: NflPropStat;
  quotes: PropQuote[];
  /** ARCHR's own line for a prop no book has posted yet (see nba/propsMath projectedLine). */
  projectedPoint?: number;
}

export type NflPropSort = "hitRate" | "value" | "model" | "price";

/** ARCHR's read on a prop at its line: the projection, blended with the market (see propModel/price). */
export interface NflPropModel extends PricedProp {
  projection: NflProjection;
}

export interface NflPropSummary {
  playerId: string;
  stat: NflPropStat;
  /** No book has posted it: `point` is ARCHR's projected line. */
  projected: boolean;
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
  allLogs: NflLogPoint[],
  stat: NflPropStatDef,
  side: PropDirection,
  ctx: {
    season: number;
    venue: "home" | "away" | null;
    opponent: string | null;
    projection: NflProjectionContext;
    /** The player's own injury tag: out/doubtful withholds the model, questionable widens it. */
    injury?: InjuryLevel;
    /** The model's weight against the market for this stat (see propModel/market). */
    modelWeight?: number;
  },
  atPoint?: number
): NflPropSummary | null {
  const point = atPoint ?? propConsensusPoint(prop.quotes) ?? prop.projectedPoint ?? null;
  if (point === null) return null;
  const logs = stat.available ? allLogs.filter(stat.available) : allLogs;
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
  const projection = modelWithheld(ctx.injury) ? null : projectNflProp(allLogs, stat, { season: ctx.season, ...ctx.projection });

  return {
    playerId: prop.playerId,
    stat: prop.stat,
    projected: prop.quotes.length === 0,
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
    model: projection
      ? {
          projection,
          ...priceProp({
            rawProbOver: nflRawOver(projection, point),
            calibrationShrink: NFL_CALIBRATION_SHRINK,
            injury: ctx.injury,
            pairs,
            modelWeight: ctx.modelWeight,
            overPrice: over?.priceAmerican ?? null,
            underPrice: under?.priceAmerican ?? null,
          }),
        }
      : null,
  };
}

/** Best first, posted props ahead of ARCHR-only lines. Unrated props sort below rated ones; a thin sample sorts below a full one at the same rate. */
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
  return list.sort((a, b) => Number(a.projected) - Number(b.projected) || key[sort](b) - key[sort](a));
}

/**
 * The alt-line step for an NFL stat: yards move in 15s on a QB's line, 10s on a
 * starter's, 5s below that and 2s on the shortest; counts move by 1 (2 once the
 * line is 15+, e.g. completions). See props/altLines.
 */
export function nflAltStep(stat: NflPropStatDef, main: number): number {
  if (stat.shape === "yards") return main >= 150 ? 15 : main >= 60 ? 10 : main >= 25 ? 5 : 2;
  return main >= 15 ? 2 : 1;
}

/** The ladder around `main` for an NFL stat, merged with the books' lines. */
export function altLinePointsNfl(stat: NflPropStatDef, main: number, bookPoints: number[] = []): number[] {
  return altLinePoints(main, nflAltStep(stat, main), bookPoints);
}

/** The column windows of the NFL alt-line table, in order (the `l10` window is the last 8). */
export const NFL_ALT_COLUMNS = [
  { key: "l5", label: "L5" },
  { key: "l10", label: "L8" },
  { key: "season", label: "This szn" },
  { key: "lastSeason", label: "Last szn" },
] as const satisfies readonly { key: PropSplit["key"]; label: string }[];

/** Every rung of the ladder, read the same way the sheet reads one line (see summarizeNflProp). */
export function nflAltLineRows(
  prop: NflSlateProp,
  logs: NflLogPoint[],
  stat: NflPropStatDef,
  side: PropDirection,
  ctx: Parameters<typeof summarizeNflProp>[4],
  points: number[]
): AltLineRow[] {
  const posted = new Set(prop.quotes.map((q) => q.point));
  return points.flatMap((point) => {
    const s = summarizeNflProp(prop, logs, stat, side, ctx, point);
    if (!s) return [];
    const rate = (key: PropSplit["key"]) => s.splits.find((x) => x.key === key)!.rate;
    return [
      {
        point,
        posted: posted.has(point),
        modelProb: s.model ? (side === "over" ? s.model.probOver : s.model.probUnder) : null,
        rates: NFL_ALT_COLUMNS.map((c) => rate(c.key)),
        best: side === "over" ? s.over : s.under,
      },
    ];
  });
}
