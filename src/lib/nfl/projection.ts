/**
 * ARCHR's NFL prop projection, client-safe and pure — the NBA projection
 * (src/lib/nba/projection.ts) shaped for football's short seasons:
 *
 *   mean = recency-weighted per-game production (half-life 4 games),
 *          shrunk toward the player's two-season per-game rate (4 games' weight)
 *          × matchup (what the opponent allows to his position vs the league,
 *            half-regressed, capped ±15%)
 *
 * Probabilities by the stat's shape:
 *   - yards: normal around the mean with the player's own game-to-game spread
 *     (floored, since a few games understate it)
 *   - counts: negative binomial (over-dispersed, never tighter than Poisson)
 *   - anytime TD: Poisson chance of at least one
 * then pulled toward 50% by CALIBRATION_SHRINK until `npm run backtest:nfl-props`
 * refits it.
 */
import type { NflPropStatDef } from "./propStats";
import { countCdf } from "@/lib/nba/projection";
import { nflStatMatchup, type NflDefenseTable, type NflPosition } from "./matchup";
import type { NflLogPoint } from "./propsMath";
import { gamesWithout, withoutWeight, type Absence } from "@/lib/injuries/absence";

const HALF_LIFE = 4;
const WINDOW = 17;
const PRIOR_GAMES = 4;
export const MIN_NFL_GAMES = 3;
const MATCHUP_REGRESSION = 0.5;
const MATCHUP_CAP = 0.15;
/** A yards stat's spread is at least this share of its mean (and at least YARDS_SD_FLOOR yards). */
const YARDS_SD_MIN_SHARE = 0.35;
const YARDS_SD_FLOOR = 8;
export const NFL_CALIBRATION_SHRINK = 0.8;

export interface NflProjection {
  mean: number;
  sd: number;
  matchupFactor: number;
  games: number;
  /** When key teammates are out: the games without them that were blended in. */
  absence: { names: string[]; games: number; perGame: number } | null;
}

/** The full-history estimate counts as this many games against the without-teammate games. */
const ABSENCE_PRIOR_GAMES = 3;

export interface NflProjectionContext {
  defense: NflDefenseTable;
  opponent: string | null;
  position: NflPosition | null;
  /** Key teammates out this week (see injuries/absence). */
  absences?: Absence[];
}

export function projectNflProp(logs: NflLogPoint[], stat: NflPropStatDef, ctx: NflProjectionContext): NflProjection | null {
  if (logs.length < MIN_NFL_GAMES) return null;
  const values = logs.map((l) => stat.value(l));
  let s = 0;
  let w = 0;
  values.slice(0, WINDOW).forEach((v, i) => {
    const wi = Math.pow(0.5, i / HALF_LIFE);
    s += v * wi;
    w += wi;
  });
  const recent = s / w;
  const long = values.reduce((a, b) => a + b, 0) / values.length;
  const n = Math.min(values.length, WINDOW);
  let base = (recent * n + long * PRIOR_GAMES) / (n + PRIOR_GAMES);

  // Key teammates out: lean on the games he's already played without them.
  let absence: NflProjection["absence"] = null;
  const without = ctx.absences?.length ? gamesWithout(logs, ctx.absences) : [];
  if (without.length >= 2) {
    const perGame = without.reduce((a, l) => a + stat.value(l), 0) / without.length;
    const w = withoutWeight(without.length, ABSENCE_PRIOR_GAMES);
    base = base * (1 - w) + perGame * w;
    absence = { names: ctx.absences!.map((a) => a.name), games: without.length, perGame };
  }

  let matchupFactor = 1;
  if (ctx.opponent) {
    const m = nflStatMatchup(ctx.defense, ctx.opponent, stat, ctx.position);
    if (m && m.leagueAvg > 0) {
      const f = 1 + (m.perGame / m.leagueAvg - 1) * (1 - MATCHUP_REGRESSION);
      matchupFactor = Math.min(1 + MATCHUP_CAP, Math.max(1 - MATCHUP_CAP, f));
    }
  }
  const mean = base * matchupFactor;

  const sample = values.slice(0, WINDOW);
  const sMean = sample.reduce((a, b) => a + b, 0) / sample.length;
  const sVar = sample.reduce((a, b) => a + (b - sMean) ** 2, 0) / Math.max(sample.length - 1, 1);
  let sd: number;
  if (stat.shape === "yards") {
    sd = Math.max(Math.sqrt(sVar), mean * YARDS_SD_MIN_SHARE, YARDS_SD_FLOOR);
  } else {
    const dispersion = sMean > 0 ? Math.max(sVar / sMean, 1) : 1;
    sd = Math.sqrt(Math.max(mean, mean * dispersion));
  }
  return { mean, sd, matchupFactor, games: logs.length, absence };
}

/** Standard normal CDF (Abramowitz–Stegun 26.2.17; error < 7.5e-8). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

function shrink(p: number): number {
  const c = Math.min(Math.max(p, 1e-4), 1 - 1e-4);
  return 1 / (1 + Math.exp(-Math.log(c / (1 - c)) * NFL_CALIBRATION_SHRINK));
}

/** The model's chance the Over cashes at `point` (pushes on whole numbers refund, so the side's chance excludes them). */
export function nflProbOver(proj: NflProjection, stat: NflPropStatDef, point: number): number {
  if (stat.shape === "anytime") {
    // At least one TD at rate λ = the projected TDs per game.
    return shrink(1 - Math.exp(-Math.max(proj.mean, 0)));
  }
  if (stat.shape === "yards") {
    // Continuity: yards are whole numbers, so "over 262.5" is "263 or more".
    return shrink(1 - normalCdf((Math.floor(point) + 0.5 - proj.mean) / proj.sd));
  }
  const variance = proj.sd * proj.sd;
  const atOrBelow = countCdf(Math.floor(point), proj.mean, variance);
  const push = Number.isInteger(point) ? atOrBelow - countCdf(point - 1, proj.mean, variance) : 0;
  return shrink((1 - atOrBelow) / Math.max(1 - push, 1e-6));
}
