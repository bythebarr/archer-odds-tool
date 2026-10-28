/**
 * ARCHR's NFL prop projection, client-safe and pure — the NBA projection
 * (src/lib/nba/projection.ts) shaped for football's short seasons:
 *
 *   mean = recency-weighted per-game production (half-life 4 games),
 *          shrunk toward the player's two-season per-game rate (4 games' weight)
 *          × matchup (what the opponent allows to his position vs the league,
 *            half-regressed, capped ±15%)
 *          × game environment (nfl/environment.ts: the team's implied points
 *            vs its normal, and the spread's pass/run script)
 *
 * Probabilities by the stat's shape:
 *   - yards: normal around the mean with the player's own game-to-game spread
 *     (floored, since a few games understate it)
 *   - counts: negative binomial (over-dispersed, never tighter than Poisson)
 *   - anytime TD: Poisson chance of at least one
 * then pulled toward 50% by CALIBRATION_SHRINK until `npm run backtest:nfl-props`
 * refits it; the props pipeline (propModel/price.ts) then blends that with the
 * market.
 */
import type { NflPropStatDef } from "./propStats";
import { rawProbOver, shrinkLogit, type StatDistribution } from "@/lib/propModel/distribution";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import { seasonMix, type SeasonMix } from "@/lib/propModel/seasonMix";
import { nflEnvironment, type NflEnvironment } from "./environment";
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

/**
 * Touchdowns are mostly opportunity: what a target or carry inside the 20, at
 * the goal line or into the end zone turns into, league-wide (least squares on
 * 2025–26 player-games, additive — a goal-line carry is also a red-zone carry).
 * The anytime-TD projection counts each past game as this expected-TD figure
 * blended with the TDs he actually scored (NFL_XTD_WEIGHT), which reads a
 * player's red-zone role far better than his few, lumpy scores.
 */
export const XTD_RATES = { ezTarget: 0.2574, rzTarget: 0.136, target: 0.0114, glCarry: 0.2501, rzCarry: 0.07, carry: 0.0086 } as const;
export const NFL_XTD_WEIGHT = 0.9;

/** Expected TDs from a game's opportunities; null when the game predates the play-by-play import. */
export function expectedTds(l: NflLogPoint): number | null {
  if (l.rzTargets == null || l.rzCarries == null) return null;
  const r = XTD_RATES;
  return r.ezTarget * (l.ezTargets ?? 0) + r.rzTarget * l.rzTargets + r.target * l.targets + r.glCarry * (l.glCarries ?? 0) + r.rzCarry * l.rzCarries + r.carry * l.rushAttempts;
}

export interface NflProjection {
  mean: number;
  sd: number;
  matchupFactor: number;
  games: number;
  /** When key teammates are out: the games without them that were blended in. */
  absence: { names: string[]; games: number; perGame: number } | null;
  /** Implied points and script from this week's lines (neutral without them). */
  env: NflEnvironment;
  /** How much of the projection rests on this season vs last. */
  seasons: SeasonMix;
  distribution: StatDistribution;
}

/** The full-history estimate counts as this many games against the without-teammate games. */
const ABSENCE_PRIOR_GAMES = 3;

export interface NflProjectionContext {
  defense: NflDefenseTable;
  opponent: string | null;
  position: NflPosition | null;
  /** Key teammates out this week (see injuries/absence). */
  absences?: Absence[];
  /** This week's consensus spread and total. */
  lines?: GameLines;
  isHome?: boolean | null;
  /** What his team usually scores — the environment his logs were played in. */
  baselinePoints?: number | null;
  season?: number;
  /** Overrides NFL_XTD_WEIGHT (the backtest varies it). */
  xtdWeight?: number;
}

export function projectNflProp(allLogs: NflLogPoint[], stat: NflPropStatDef, ctx: NflProjectionContext): NflProjection | null {
  // Only games whose box score carried this stat (a missing read is not a zero).
  const logs = stat.available ? allLogs.filter(stat.available) : allLogs;
  if (logs.length < MIN_NFL_GAMES) return null;
  const xw = ctx.xtdWeight ?? NFL_XTD_WEIGHT;
  const values = logs.map((l) => {
    const v = stat.value(l);
    if (stat.key !== "anytimeTd" || xw === 0) return v;
    const x = expectedTds(l);
    return x === null ? v : (1 - xw) * v + xw * x;
  });
  const decay = values.slice(0, WINDOW).map((_, i) => Math.pow(0.5, i / HALF_LIFE));
  const decaySum = decay.reduce((a, b) => a + b, 0);
  const recent = decay.reduce((a, wi, i) => a + values[i] * wi, 0) / decaySum;
  const long = values.reduce((a, b) => a + b, 0) / values.length;
  const n = Math.min(values.length, WINDOW);
  const recentShare = n / (n + PRIOR_GAMES);
  let base = recent * recentShare + long * (1 - recentShare);
  const seasons = seasonMix(
    logs,
    values.map((_, i) => (i < decay.length ? (recentShare * decay[i]) / decaySum : 0) + (1 - recentShare) / values.length),
    ctx.season ?? logs[0].season,
    stat.value
  );

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
  const env = nflEnvironment(ctx.lines ?? NO_LINES, ctx.isHome ?? null, stat.key, ctx.baselinePoints ?? null);
  const mean = base * matchupFactor * env.volumeFactor * env.scriptFactor;

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
  const distribution: StatDistribution =
    stat.shape === "anytime"
      ? { kind: "atLeastOne", mean }
      : stat.shape === "yards"
        ? { kind: "normal", mean, sd }
        : { kind: "count", mean, variance: sd * sd };
  return { mean, sd, matchupFactor, games: logs.length, absence, env, seasons, distribution };
}

/** The model's uncalibrated chance the Over cashes at `point` (pushes refund). */
export function nflRawOver(proj: NflProjection, point: number): number {
  return rawProbOver(proj.distribution, point);
}

/** The model's chance the Over cashes at `point`, calibrated by NFL_CALIBRATION_SHRINK. */
export function nflProbOver(proj: NflProjection, _stat: NflPropStatDef, point: number): number {
  return shrinkLogit(nflRawOver(proj, point), NFL_CALIBRATION_SHRINK);
}
