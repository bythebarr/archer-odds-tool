/**
 * The MLB props finder's client-safe pieces: the stats it offers, game logs on
 * the wire, hit-rate splits, and the price of any line from a projection's
 * distribution (the same calibration and market blend as NBA and NFL).
 */
import type { StatCategory } from "@/generated/prisma/client";
import type { StatDistribution } from "@/lib/propModel/distribution";
import { rawProbOver } from "@/lib/propModel/distribution";
import { priceProp, type PricedProp } from "@/lib/propModel/price";
import { tallyPropHits, type PropDirection } from "@/lib/props/tally";
import { twoSidedAt, type PropQuote, type PropSplit } from "@/lib/nba/propsMath";
import { MLB_CALIBRATION_BY_STAT, MLB_CALIBRATION_SHRINK, type MlbLogPoint, type MlbPropStat } from "./propProjection";

export type MlbRole = "batter" | "pitcher";

export interface MlbPropStatDef {
  key: MlbPropStat;
  label: string;
  shortLabel: string;
  role: MlbRole;
  /** The book market it lines up with, when books carry it. */
  category: StatCategory | null;
  value: (l: MlbLogPoint) => number;
}

const n = (v: number | null) => v ?? 0;

export const MLB_PROP_STATS: MlbPropStatDef[] = [
  { key: "hits", label: "Hits", shortLabel: "H", role: "batter", category: "hits", value: (l) => n(l.hits) },
  { key: "totalBases", label: "Total bases", shortLabel: "TB", role: "batter", category: "totalBases", value: (l) => n(l.totalBases) },
  { key: "homeRuns", label: "Home runs", shortLabel: "HR", role: "batter", category: "homeRuns", value: (l) => n(l.homeRuns) },
  { key: "hitsRunsRbis", label: "Hits + runs + RBIs", shortLabel: "H+R+RBI", role: "batter", category: null, value: (l) => n(l.hits) + n(l.runs) + n(l.rbi) },
  { key: "rbi", label: "RBIs", shortLabel: "RBI", role: "batter", category: "rbi", value: (l) => n(l.rbi) },
  { key: "runs", label: "Runs", shortLabel: "R", role: "batter", category: "runs", value: (l) => n(l.runs) },
  { key: "battingStrikeouts", label: "Strikeouts (batter)", shortLabel: "K", role: "batter", category: "battingStrikeouts", value: (l) => n(l.strikeoutsBatting) },
  { key: "walks", label: "Walks", shortLabel: "BB", role: "batter", category: null, value: (l) => n(l.baseOnBalls) },
  { key: "stolenBases", label: "Stolen bases", shortLabel: "SB", role: "batter", category: null, value: (l) => n(l.stolenBases) },
  { key: "pitcherStrikeouts", label: "Pitcher strikeouts", shortLabel: "KS", role: "pitcher", category: "pitcherStrikeouts", value: (l) => n(l.strikeoutsPitching) },
  { key: "outsRecorded", label: "Outs recorded", shortLabel: "OUTS", role: "pitcher", category: "outsRecorded", value: (l) => n(l.outsRecorded) },
  { key: "hitsAllowed", label: "Hits allowed", shortLabel: "HA", role: "pitcher", category: "hitsAllowed", value: (l) => n(l.hitsAllowed) },
  { key: "walksAllowed", label: "Walks allowed", shortLabel: "BBA", role: "pitcher", category: "walksAllowed", value: (l) => n(l.walksAllowed) },
  { key: "earnedRuns", label: "Earned runs", shortLabel: "ER", role: "pitcher", category: "earnedRuns", value: (l) => n(l.earnedRuns) },
];

export const MLB_PROP_STAT_BY_KEY = new Map(MLB_PROP_STATS.map((s) => [s.key, s]));

/** A game log with its opponent, for the chart and the head-to-head split. */
export interface MlbChartLog extends MlbLogPoint {
  opponent: string;
}

type Num = number | null;
export type PackedMlbLog = [string, string, 0 | 1, number, "L" | "R" | null, Num, Num, Num, Num, Num, Num, Num, Num, Num, 0 | 1 | null, Num, Num, Num, Num, Num];

export function packMlbLog(l: MlbChartLog): PackedMlbLog {
  return [
    l.date, l.opponent, l.isHome ? 1 : 0, l.season, l.opposingStarterHand,
    l.plateAppearances, l.hits, l.totalBases, l.homeRuns, l.rbi, l.runs, l.baseOnBalls, l.strikeoutsBatting, l.stolenBases,
    l.isStarter === null ? null : l.isStarter ? 1 : 0, l.outsRecorded, l.strikeoutsPitching, l.earnedRuns, l.hitsAllowed, l.walksAllowed,
  ];
}

export function unpackMlbLog(t: PackedMlbLog): MlbChartLog {
  const [date, opponent, isHome, season, opposingStarterHand, plateAppearances, hits, totalBases, homeRuns, rbi, runs, baseOnBalls, strikeoutsBatting, stolenBases, isStarter, outsRecorded, strikeoutsPitching, earnedRuns, hitsAllowed, walksAllowed] = t;
  return {
    date, opponent, isHome: isHome === 1, season, opposingStarterHand,
    plateAppearances, hits, totalBases, homeRuns, rbi, runs, baseOnBalls, strikeoutsBatting, stolenBases,
    isStarter: isStarter === null ? null : isStarter === 1, outsRecorded, strikeoutsPitching, earnedRuns, hitsAllowed, walksAllowed,
  };
}

/** The games that count for a role: a batter's games at the plate, a pitcher's starts. */
export function roleLogs(logs: MlbChartLog[], role: MlbRole): MlbChartLog[] {
  return role === "pitcher" ? logs.filter((l) => l.isStarter && (l.outsRecorded ?? 0) > 0) : logs.filter((l) => (l.plateAppearances ?? 0) > 0);
}

/** ARCHR's line before books post: the half-point nearest where Over is closest to even. */
export function mlbProjectedLine(d: StatDistribution, mean: number): number {
  let best = 0.5;
  let gap = Infinity;
  for (let pt = 0.5; pt <= Math.max(2.5, mean * 2 + 2); pt += 1) {
    const g = Math.abs(rawProbOver(d, pt) - 0.5);
    if (g < gap) {
      gap = g;
      best = pt;
    }
  }
  return best;
}

/** The model's price at a line (calibrated per stat), blended with whatever the books show there. */
export function priceMlbLine(d: StatDistribution, quotes: PropQuote[], point: number, stat?: MlbPropStat): PricedProp {
  const best = (side: PropDirection) =>
    quotes.filter((q) => q.point === point && q.side === side).reduce<number | null>((b, q) => (b === null || q.priceAmerican > b ? q.priceAmerican : b), null);
  return priceProp({
    rawProbOver: rawProbOver(d, point),
    calibrationShrink: (stat && MLB_CALIBRATION_BY_STAT[stat]) ?? MLB_CALIBRATION_SHRINK,
    pairs: twoSidedAt(quotes, point),
    overPrice: best("over"),
    underPrice: best("under"),
  });
}

export function mlbSplits(logs: MlbChartLog[], stat: MlbPropStatDef, point: number, side: PropDirection, ctx: { season: number; venue: "home" | "away"; opponent: string; hand: "L" | "R" | null }): PropSplit[] {
  const games = roleLogs(logs, stat.role);
  const make = (key: PropSplit["key"], label: string, list: MlbChartLog[]): PropSplit => {
    const values = list.map(stat.value);
    return { key, label, rate: tallyPropHits(values, point, side), avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
  };
  const out = [
    make("l5", "L5", games.slice(0, 5)),
    make("l10", "L10", games.slice(0, 10)),
    make("l20", "L20", games.slice(0, 20)),
    make("season", "This szn", games.filter((l) => l.season === ctx.season)),
    make("lastSeason", "Last szn", games.filter((l) => l.season === ctx.season - 1)),
    make("venue", ctx.venue === "home" ? "Home" : "Away", games.filter((l) => l.isHome === (ctx.venue === "home")).slice(0, 30)),
    make("h2h", `vs ${ctx.opponent}`, games.filter((l) => l.opponent === ctx.opponent)),
  ];
  // A batter's split against tonight's starter's hand.
  if (stat.role === "batter" && ctx.hand) out.splice(5, 0, make("hand", `vs ${ctx.hand}HP`, games.filter((l) => l.opposingStarterHand === ctx.hand).slice(0, 40)));
  return out;
}
