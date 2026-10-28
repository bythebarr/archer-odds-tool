/**
 * Soccer player props: the stats books hang (anytime goalscorer and assist,
 * shots, shots on target, saves, cards, fouls) and ARCHR's model for them.
 * Pure and client-safe.
 *
 * The projection for a match is
 *   per-90 rate  ×  expected minutes / 90  ×  matchup,
 * where
 * - the per-90 rate is his own production over recent matches (every
 *   competition, recent ones weighted up), shrunk toward his position's league
 *   rate by 600 minutes of prior;
 * - expected minutes are what he played in his team's last six matches,
 *   counting the ones he missed as zero (so rotation and injury show up);
 * - the matchup scales attacking stats by the team's expected goals tonight
 *   (the league model) against its usual output, and a keeper's saves by the
 *   opponent's.
 * Counts are Poisson (shots and fouls negative binomial, for their spread).
 */
import { tallyPropHits, type PropDirection } from "@/lib/props/tally";
import type { PropSplit } from "@/lib/nba/propsMath";
import { decimalToAmerican } from "@/lib/odds/americanOdds";

export type SoccerPropStat = "goal" | "assist" | "goalOrAssist" | "shots" | "shotsOnTarget" | "saves" | "card" | "fouls";

export interface SoccerLog {
  /** YYYY-MM-DD */
  date: string;
  opponent: string;
  isHome: boolean;
  season: number;
  team: string;
  starter: boolean;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  fouls: number;
}

export type PackedSoccerLog = [string, string, 0 | 1, number, string, 0 | 1, number, number, number, number, number, number, number, number, number];

export function packSoccerLog(l: SoccerLog): PackedSoccerLog {
  return [l.date, l.opponent, l.isHome ? 1 : 0, l.season, l.team, l.starter ? 1 : 0, l.minutes, l.goals, l.assists, l.shots, l.shotsOnTarget, l.saves, l.yellowCards, l.redCards, l.fouls];
}

export function unpackSoccerLog(t: PackedSoccerLog): SoccerLog {
  const [date, opponent, isHome, season, team, starter, minutes, goals, assists, shots, shotsOnTarget, saves, yellowCards, redCards, fouls] = t;
  return { date, opponent, isHome: isHome === 1, season, team, starter: starter === 1, minutes, goals, assists, shots, shotsOnTarget, saves, yellowCards, redCards, fouls };
}

export type Position = "G" | "D" | "M" | "F";

export interface SoccerPropStatDef {
  key: SoccerPropStat;
  label: string;
  shortLabel: string;
  /** "anytime": a yes/no at 0.5 (to score, to be carded); "count": over/under a number. */
  shape: "anytime" | "count";
  value: (l: SoccerLog) => number;
  /** Which matchup scales it. */
  matchup: "attack" | "keeper" | "none";
  /** Negative binomial size for the count's spread (Infinity = Poisson). */
  dispersion: number;
  /** Positions it's offered for. */
  positions: Position[];
  /** League per-90 rate by position, the prior a player is shrunk toward. */
  prior: Record<Position, number>;
}

const OUTFIELD: Position[] = ["D", "M", "F"];

export const SOCCER_PROP_STATS: SoccerPropStatDef[] = [
  { key: "goal", label: "Anytime goalscorer", shortLabel: "GOAL", shape: "anytime", value: (l) => l.goals, matchup: "attack", dispersion: Infinity, positions: OUTFIELD, prior: { G: 0, D: 0.047, M: 0.14, F: 0.38 } },
  { key: "shotsOnTarget", label: "Shots on target", shortLabel: "SOT", shape: "count", value: (l) => l.shotsOnTarget, matchup: "attack", dispersion: 6, positions: OUTFIELD, prior: { G: 0, D: 0.17, M: 0.5, F: 1.05 } },
  { key: "shots", label: "Shots", shortLabel: "SHOTS", shape: "count", value: (l) => l.shots, matchup: "attack", dispersion: 5, positions: OUTFIELD, prior: { G: 0, D: 0.63, M: 1.52, F: 2.64 } },
  { key: "assist", label: "Anytime assist", shortLabel: "AST", shape: "anytime", value: (l) => l.assists, matchup: "attack", dispersion: Infinity, positions: OUTFIELD, prior: { G: 0.004, D: 0.049, M: 0.138, F: 0.153 } },
  { key: "goalOrAssist", label: "Goal or assist", shortLabel: "G+A", shape: "anytime", value: (l) => l.goals + l.assists, matchup: "attack", dispersion: Infinity, positions: OUTFIELD, prior: { G: 0.004, D: 0.096, M: 0.28, F: 0.53 } },
  { key: "saves", label: "Goalkeeper saves", shortLabel: "SAVES", shape: "count", value: (l) => l.saves, matchup: "keeper", dispersion: 12, positions: ["G"], prior: { G: 3.19, D: 0, M: 0, F: 0 } },
  { key: "card", label: "To be carded", shortLabel: "CARD", shape: "anytime", value: (l) => l.yellowCards + l.redCards, matchup: "none", dispersion: Infinity, positions: OUTFIELD, prior: { G: 0.03, D: 0.2, M: 0.19, F: 0.145 } },
  { key: "fouls", label: "Fouls committed", shortLabel: "FOULS", shape: "count", value: (l) => l.fouls, matchup: "none", dispersion: 6, positions: OUTFIELD, prior: { G: 0.01, D: 1.02, M: 1.24, F: 1.3 } },
];

export const SOCCER_PROP_STAT_BY_KEY = new Map(SOCCER_PROP_STATS.map((s) => [s.key, s]));

/** Minutes of league-average production a player's own rate is weighed against. */
export const PRIOR_MINUTES = 600;
/** Recency: a match's weight halves every this many matches back. */
const HALF_LIFE = 12;
/** How many of his team's matches set his expected minutes. */
export const MINUTES_WINDOW = 6;
/** Matches of even-odds prior on whether he plays (fitted by the backtest). */
export const PLAY_PRIOR = 1;
/** Below this (share of recent matches played × minutes), he isn't listed. */
export const MIN_EXPECTED_MINUTES = 20;

export interface ModelOpts {
  playPrior: number;
  priorMinutes: number;
  halfLife: number;
  /** How much of the opponent's tilt carries through (0 = none, 1 = all). */
  damp: number;
}

export const DEFAULT_OPTS: ModelOpts = { playPrior: PLAY_PRIOR, priorMinutes: PRIOR_MINUTES, halfLife: HALF_LIFE, damp: 1 };

/**
 * His role from the team's last matches, recent ones weighted up: the chance
 * he plays at all, and his minutes when he does.
 */
export function minutesRole(logs: SoccerLog[], teamDates: string[], playPrior = PLAY_PRIOR): { playProb: number; minutes: number; expected: number } {
  const byDate = new Map(logs.map((l) => [l.date, l.minutes]));
  const dates = teamDates.slice(0, MINUTES_WINDOW);
  let w = 0;
  let wPlayed = 0;
  let wMinutes = 0;
  dates.forEach((d, i) => {
    const x = Math.pow(0.85, i);
    w += x;
    const m = byDate.get(d) ?? 0;
    if (m > 0) {
      wPlayed += x;
      wMinutes += x * m;
    }
  });
  if (!w || !wPlayed) return { playProb: 0, minutes: 0, expected: 0 };
  // Never certain either way: `playPrior` matches of prior at even odds.
  const playProb = (wPlayed + playPrior / 2) / (w + playPrior);
  const minutes = wMinutes / wPlayed;
  // `expected` (who gets listed) uses his raw share, so the prior never changes the list.
  return { playProb, minutes, expected: (wPlayed / w) * minutes };
}

/** Per-90 rate over recent matches, recency weighted and shrunk toward the position's prior. */
export function per90(logs: SoccerLog[], stat: SoccerPropStatDef, position: Position, opts: ModelOpts = DEFAULT_OPTS): number {
  let s = 0;
  let m = 0;
  logs.slice(0, 40).forEach((l, i) => {
    const w = Math.pow(0.5, i / opts.halfLife);
    s += w * stat.value(l);
    m += w * l.minutes;
  });
  const prior = stat.prior[position];
  return ((s + (prior * opts.priorMinutes) / 90) / (m + opts.priorMinutes)) * 90;
}

/** A ratio against the league's average, damped and bounded. */
export function tilt(value: number | null, average: number, damp: number): number {
  if (value === null || average <= 0) return 1;
  return Math.min(1.5, Math.max(0.67, 1 + damp * (value / average - 1)));
}

/**
 * Tonight's matchup, from the shots each side's matches have produced lately:
 * the opponent's shots allowed per match (attacking props) and shots on target
 * taken (his keeper's saves), against the league average, plus home and away.
 */
export interface SoccerMatchContext {
  isHome: boolean;
  oppShotsAllowed: number | null;
  oppSotFor: number | null;
  leagueShots: number;
  leagueSot: number;
}

export const HOME_EDGE = 0.06;

export interface SoccerProjection {
  /** Share of recent matches played × minutes: the listing cutoff. */
  expected: number;
  /** Mean when he plays. */
  mean: number;
  playProb: number;
  /** Minutes when he plays. */
  minutes: number;
  rate90: number;
  factor: number;
}

export function projectSoccerProp(logs: SoccerLog[], teamDates: string[], stat: SoccerPropStatDef, position: Position, ctx: SoccerMatchContext, opts: ModelOpts = DEFAULT_OPTS): SoccerProjection {
  const role = minutesRole(logs, teamDates, opts.playPrior);
  const rate90 = per90(logs, stat, position, opts);
  const venue = ctx.isHome ? 1 + HOME_EDGE : 1 - HOME_EDGE;
  const factor =
    stat.matchup === "attack"
      ? tilt(ctx.oppShotsAllowed, ctx.leagueShots, opts.damp) * venue
      : stat.matchup === "keeper"
        ? tilt(ctx.oppSotFor, ctx.leagueSot, opts.damp) / venue
        : 1;
  return { expected: role.expected, mean: rate90 * (role.minutes / 90) * factor, playProb: role.playProb, minutes: role.minutes, rate90, factor };
}

/** Over the line, counting the chance he doesn't play (a no-show settles as a loss here, as books void or grade it). */
export function projectionOver(p: SoccerProjection, point: number, stat: SoccerPropStatDef): number {
  return Math.min(0.999, Math.max(0.001, p.playProb * probOver(p.mean, point, stat.dispersion)));
}

/** Average outcome tonight, no-shows included — what the chart's projection line shows. */
export const projectedMean = (p: SoccerProjection) => p.playProb * p.mean;

function logGamma(x: number): number {
  // Lanczos, good to ~1e-10 for x > 0.
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(X = k) for a count with this mean: Poisson, or negative binomial of size r. */
export function countPmf(k: number, mean: number, r: number): number {
  if (mean <= 0) return k === 0 ? 1 : 0;
  if (!Number.isFinite(r)) return Math.exp(-mean + k * Math.log(mean) - logGamma(k + 1));
  const p = r / (r + mean);
  return Math.exp(logGamma(k + r) - logGamma(k + 1) - logGamma(r) + r * Math.log(p) + k * Math.log(1 - p));
}

/** P(X > point) for a half-point line. */
export function probOver(mean: number, point: number, r: number): number {
  let below = 0;
  for (let k = 0; k <= Math.floor(point); k++) below += countPmf(k, mean, r);
  return Math.min(0.999, Math.max(0.001, 1 - below));
}

/** ARCHR's line: anytime props sit at 0.5; counts at the half-point where Over is closest to even. */
export function soccerLine(stat: SoccerPropStatDef, p: SoccerProjection): number {
  if (stat.shape === "anytime") return 0.5;
  let best = 0.5;
  let gap = Infinity;
  for (let pt = 0.5; pt <= Math.max(1.5, p.mean * 3); pt += 1) {
    const g = Math.abs(projectionOver(p, pt, stat) - 0.5);
    if (g < gap) {
      gap = g;
      best = pt;
    }
  }
  return best;
}

export const fairAmerican = (p: number) => Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p))));

export function soccerSplits(logs: SoccerLog[], stat: SoccerPropStatDef, point: number, side: PropDirection, ctx: { season: number; venue: "home" | "away"; opponent: string }): PropSplit[] {
  const played = logs.filter((l) => l.minutes > 0);
  const make = (key: PropSplit["key"], label: string, games: SoccerLog[]): PropSplit => {
    const values = games.map(stat.value);
    return { key, label, rate: tallyPropHits(values, point, side), avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
  };
  return [
    make("l5", "L5", played.slice(0, 5)),
    make("l10", "L10", played.slice(0, 10)),
    make("l20", "L20", played.slice(0, 20)),
    make("season", "This szn", played.filter((l) => l.season === ctx.season)),
    make("lastSeason", "Last szn", played.filter((l) => l.season === ctx.season - 1)),
    make("venue", ctx.venue === "home" ? "Home" : "Away", played.filter((l) => l.isHome === (ctx.venue === "home")).slice(0, 20)),
    make("h2h", `vs ${ctx.opponent}`, played.filter((l) => l.opponent === ctx.opponent)),
  ];
}
