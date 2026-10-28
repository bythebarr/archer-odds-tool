/**
 * Tennis player props: games won, total games, aces and double faults. Pure.
 *
 * Fitted on 2019–2026 ATP/WTA (scripts/fit-tennis-props.ts), each match from
 * the Elo win chance before it:
 *   - total games: best of 3 ≈ 23.36 − 18.38·(p − ½)² (sd 5.9); best of 5 ≈
 *     39.33 − 45.91·(p − ½)² (sd 9.3) — lopsided matches are shorter;
 *   - his share of the games: ½ + 0.357·(p − ½) (sd 0.138);
 *   - aces and double faults: his rate per service game (shrunk to the tour's
 *     by 60 service games) × the opponent's on return (half its tilt), over
 *     half the expected games; negative binomial, size 6 (aces) and 8 (DFs).
 */
import { tallyPropHits, type PropDirection } from "@/lib/props/tally";
import type { PropSplit } from "@/lib/nba/propsMath";
import { normalCdf } from "@/lib/propModel/distribution";
import type { TennisLog } from "./matchLog";

export type TennisPropStat = "gamesWon" | "totalGames" | "aces" | "doubleFaults";

export interface TennisPropStatDef {
  key: TennisPropStat;
  label: string;
  shortLabel: string;
  value: (l: TennisLog) => number | null;
}

export const TENNIS_PROP_STATS: TennisPropStatDef[] = [
  { key: "gamesWon", label: "Games won", shortLabel: "GAMES", value: (l) => l.gamesWon },
  { key: "totalGames", label: "Total games (match)", shortLabel: "TOT GMS", value: (l) => l.gamesWon + l.gamesLost },
  { key: "aces", label: "Aces", shortLabel: "ACES", value: (l) => l.aces },
  { key: "doubleFaults", label: "Double faults", shortLabel: "DF", value: (l) => l.doubleFaults },
];
export const TENNIS_PROP_STAT_BY_KEY = new Map(TENNIS_PROP_STATS.map((s) => [s.key, s]));

export const TOTAL_GAMES = { 3: { a: 23.36, b: -18.38, sd: 5.9 }, 5: { a: 39.33, b: -45.91, sd: 9.29 } } as const;
export const GAMES_SHARE_K = 0.357;
export const GAMES_SHARE_SD = 0.1376;
export const SERVE_PRIOR_GAMES = 60;
export const OPPONENT_DAMP = 0.5;
export const DISPERSION = { aces: 6, doubleFaults: 8 } as const;

/** The tour's per-service-game rates (aces, DFs). */
export interface TourRates {
  aces: number;
  doubleFaults: number;
}

export interface TennisMatchup {
  /** His Elo win chance. */
  p: number;
  bestOf: 3 | 5;
  /** His serve record (service games, aces, DFs) and the opponent's on return. */
  mine: { serviceGames: number; aces: number; doubleFaults: number };
  theirsReturn: { returnGames: number; acesAgainst: number; doubleFaultsAgainst: number };
  tour: TourRates;
}

export interface TennisProjection {
  stat: TennisPropStat;
  mean: number;
  /** Normal for games; negative binomial size for aces/DFs. */
  sd: number | null;
  size: number | null;
  expectedGames: number;
  serviceGames: number;
  /** Per service game, shrunk; and the opponent's factor. */
  rate: number | null;
  opponentFactor: number | null;
}

export function expectedTotalGames(p: number, bestOf: 3 | 5): { mean: number; sd: number } {
  const f = TOTAL_GAMES[bestOf];
  return { mean: f.a + f.b * (p - 0.5) ** 2, sd: f.sd };
}

export function projectTennisProp(stat: TennisPropStat, m: TennisMatchup): TennisProjection {
  const total = expectedTotalGames(m.p, m.bestOf);
  const share = 0.5 + GAMES_SHARE_K * (m.p - 0.5);
  const serviceGames = total.mean / 2;
  const base = { stat, expectedGames: total.mean, serviceGames };
  if (stat === "totalGames") return { ...base, mean: total.mean, sd: total.sd, size: null, rate: null, opponentFactor: null };
  if (stat === "gamesWon") {
    const sd = Math.sqrt((GAMES_SHARE_SD * total.mean) ** 2 + (share * total.sd) ** 2);
    return { ...base, mean: share * total.mean, sd, size: null, rate: null, opponentFactor: null };
  }
  const key = stat === "aces" ? "aces" : "doubleFaults";
  const tourRate = m.tour[key];
  const mine = stat === "aces" ? m.mine.aces : m.mine.doubleFaults;
  const against = stat === "aces" ? m.theirsReturn.acesAgainst : m.theirsReturn.doubleFaultsAgainst;
  const rate = (mine + tourRate * SERVE_PRIOR_GAMES) / (m.mine.serviceGames + SERVE_PRIOR_GAMES);
  const oppRate = (against + tourRate * SERVE_PRIOR_GAMES) / (m.theirsReturn.returnGames + SERVE_PRIOR_GAMES);
  const opponentFactor = 1 + OPPONENT_DAMP * (oppRate / tourRate - 1);
  return { ...base, mean: rate * opponentFactor * serviceGames, sd: null, size: DISPERSION[key], rate, opponentFactor };
}

function nbOver(mean: number, point: number, r: number): number {
  const p = r / (r + mean);
  let t = Math.pow(p, r);
  let below = 0;
  for (let k = 0; k <= Math.floor(point); k++) {
    below += t;
    t *= ((k + r) / (k + 1)) * (1 - p);
  }
  return 1 - below;
}

/** P(stat > point) at a half-point line. */
export function tennisOver(p: TennisProjection, point: number): number {
  const raw = p.size !== null ? nbOver(p.mean, point, p.size) : 1 - normalCdf((Math.floor(point) + 0.5 - p.mean) / (p.sd ?? 1));
  return Math.min(0.995, Math.max(0.005, raw));
}

/** ARCHR's line: the half-point where Over is closest to even. */
export function tennisLine(p: TennisProjection): number {
  let best = 0.5;
  let gap = Infinity;
  for (let pt = 0.5; pt <= p.mean * 2 + 3; pt += 1) {
    const g = Math.abs(tennisOver(p, pt) - 0.5);
    if (g < gap) {
      gap = g;
      best = pt;
    }
  }
  return best;
}

/** His serve record over his recent matches with stats, and the opponent's on return, from logs. */
export function serveRecord(logs: TennisLog[], n = 40) {
  const s = logs.filter((l) => l.serviceGames && l.aces !== null && l.doubleFaults !== null).slice(0, n);
  return {
    matches: s.length,
    serviceGames: s.reduce((a, l) => a + (l.serviceGames ?? 0), 0),
    aces: s.reduce((a, l) => a + (l.aces ?? 0), 0),
    doubleFaults: s.reduce((a, l) => a + (l.doubleFaults ?? 0), 0),
  };
}

/** Hit rates over his finished matches of the same format (a best-of-5 slam isn't a best-of-3 line). */
export function tennisSplits(logs: TennisLog[], stat: TennisPropStatDef, point: number, side: PropDirection, ctx: { season: number; surface: string | null; opponent: string; bestOf?: number }): PropSplit[] {
  const played = logs.filter((l) => stat.value(l) !== null && !l.incomplete && (!ctx.bestOf || l.bestOf === ctx.bestOf));
  const make = (key: PropSplit["key"], label: string, list: TennisLog[]): PropSplit => {
    const values = list.map((l) => stat.value(l)!);
    return { key, label, rate: tallyPropHits(values, point, side), avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
  };
  return [
    make("l5", "L5", played.slice(0, 5)),
    make("l10", "L10", played.slice(0, 10)),
    make("l20", "L20", played.slice(0, 20)),
    make("season", "This szn", played.filter((l) => l.season === ctx.season)),
    make("lastSeason", "Last szn", played.filter((l) => l.season === ctx.season - 1)),
    make("venue", ctx.surface ?? "Surface", ctx.surface ? played.filter((l) => l.surface === ctx.surface).slice(0, 30) : []),
    make("h2h", `vs ${ctx.opponent.split(" ").at(-1)}`, played.filter((l) => l.opponent === ctx.opponent)),
  ];
}

/** Serve and return, over a window of matches with stats. */
export function serveReturn(logs: TennisLog[]) {
  const s = logs.filter((l) => l.servePoints && l.firstIn !== null && l.serviceGames);
  const sum = (f: (l: TennisLog) => number | null) => s.reduce((a, l) => a + (f(l) ?? 0), 0);
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  const sv = sum((l) => l.servePoints);
  const fi = sum((l) => l.firstIn);
  const sg = sum((l) => l.serviceGames);
  const faced = sum((l) => l.bpFaced);
  const saved = sum((l) => l.bpSaved);
  return {
    matches: s.length,
    firstServeIn: ratio(fi, sv),
    firstServeWon: ratio(sum((l) => l.firstWon), fi),
    secondServeWon: ratio(sum((l) => l.secondWon), sv - fi),
    holdPct: ratio(sg - (faced - saved), sg),
    bpSaved: ratio(saved, faced),
    acesPerMatch: s.length ? sum((l) => l.aces) / s.length : null,
    dfsPerMatch: s.length ? sum((l) => l.doubleFaults) / s.length : null,
    breaksPerMatch: s.length ? sum((l) => l.breaks) / s.length : null,
  };
}
