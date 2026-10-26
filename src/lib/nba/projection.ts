/**
 * ARCHR's NBA prop projection: what a player should produce tonight and the
 * chance he clears any line — client-safe and pure, so the finder re-prices
 * every line instantly, like the hit rates.
 *
 *   mean = expected minutes × per-minute rate × matchup × pace
 *
 * - Minutes: recency-weighted over the last 20 games (half-life 5) — rotation
 *   changes show up fast.
 * - Per-minute rate: recency-weighted over the last 30 (half-life 10), shrunk
 *   toward the player's two-season rate so a hot week doesn't run away with it.
 * - Matchup: what the opponent allows to the player's position (or team-wide)
 *   against the league, half-regressed and capped — defensive effects are real
 *   but noisy.
 * - Pace: the opponent's combined points against the league, the same way.
 *
 * The chance of clearing a line comes from a negative binomial with the
 * projection as its mean and the player's own game-to-game spread in this stat
 * (never tighter than Poisson): counts, over-dispersed, right-skewed — how box
 * score stats actually fall. A final logit shrink (CALIBRATION_SHRINK) pulls
 * probabilities toward 50% until `npm run backtest:nba-props` says otherwise.
 */
import type { GameLogPoint } from "./propsMath";
import type { NbaPropStatDef } from "./propStats";
import type { DefenseTable } from "./matchup";
import { statMatchup, paceRank } from "./matchup";
import type { PositionGroup } from "./positionGroups";

const MINUTES_WINDOW = 20;
const MINUTES_HALF_LIFE = 5;
const RATE_WINDOW = 30;
const RATE_HALF_LIFE = 10;
/** Weight (in games) of the two-season rate the recent rate is shrunk toward. */
const RATE_PRIOR_GAMES = 8;
/** Games needed before projecting at all. */
export const MIN_GAMES = 5;

const MATCHUP_REGRESSION = 0.5;
const MATCHUP_CAP = 0.12;
const PACE_REGRESSION = 0.5;
const PACE_CAP = 0.05;

/**
 * Pulls the model's probabilities toward 50% in logit space. 1 = trust as is.
 * Starts conservative; refit with the backtest once enough history is logged.
 */
export const CALIBRATION_SHRINK = 0.8;

export interface PropProjection {
  mean: number;
  /** Standard deviation of the stat around the mean. */
  sd: number;
  minutes: number;
  perMinute: number;
  matchupFactor: number;
  paceFactor: number;
  games: number;
}

function weighted(values: number[], halfLife: number): { mean: number; weight: number } {
  let sum = 0;
  let w = 0;
  values.forEach((v, i) => {
    const wi = Math.pow(0.5, i / halfLife);
    sum += v * wi;
    w += wi;
  });
  return { mean: w ? sum / w : 0, weight: w };
}

function factor(ratio: number, regression: number, cap: number): number {
  const f = 1 + (ratio - 1) * (1 - regression);
  return Math.min(1 + cap, Math.max(1 - cap, f));
}

export interface ProjectionContext {
  defense: DefenseTable;
  opponent: string | null;
  positionGroup: PositionGroup | null;
}

/** Projects one stat for one player from his logs (most recent first). Null with fewer than MIN_GAMES. */
export function projectProp(logs: GameLogPoint[], stat: NbaPropStatDef, ctx: ProjectionContext): PropProjection | null {
  const played = logs.filter((l) => l.minutes > 0);
  if (played.length < MIN_GAMES) return null;

  const minutes = weighted(played.slice(0, MINUTES_WINDOW).map((l) => l.minutes), MINUTES_HALF_LIFE).mean;

  const recent = played.slice(0, RATE_WINDOW);
  const recentRate = (() => {
    let s = 0;
    let m = 0;
    recent.forEach((l, i) => {
      const w = Math.pow(0.5, i / RATE_HALF_LIFE);
      s += stat.value(l) * w;
      m += l.minutes * w;
    });
    return m ? s / m : 0;
  })();
  const totalMinutes = played.reduce((a, l) => a + l.minutes, 0);
  const longRate = totalMinutes ? played.reduce((a, l) => a + stat.value(l), 0) / totalMinutes : 0;
  const recentWeight = Math.min(recent.length, RATE_WINDOW);
  const perMinute = (recentRate * recentWeight + longRate * RATE_PRIOR_GAMES) / (recentWeight + RATE_PRIOR_GAMES);

  let matchupFactor = 1;
  let paceFactor = 1;
  if (ctx.opponent) {
    const m = statMatchup(ctx.defense, ctx.opponent, stat, ctx.positionGroup);
    if (m && m.leagueAvg > 0) matchupFactor = factor(m.perGame / m.leagueAvg, MATCHUP_REGRESSION, MATCHUP_CAP);
    const p = paceRank(ctx.defense, ctx.opponent);
    const all = Object.values(ctx.defense.teams).map((t) => t.combinedPoints);
    const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
    if (p && avg > 0) paceFactor = factor(p.combinedPoints / avg, PACE_REGRESSION, PACE_CAP);
  }

  const mean = minutes * perMinute * matchupFactor * paceFactor;

  // Spread: the player's own game-to-game variance in this stat (last 20),
  // scaled to tonight's mean, never below Poisson.
  const sample = played.slice(0, 20).map((l) => stat.value(l));
  const sMean = sample.reduce((a, b) => a + b, 0) / sample.length;
  const sVar = sample.reduce((a, b) => a + (b - sMean) ** 2, 0) / Math.max(sample.length - 1, 1);
  const dispersion = sMean > 0 ? sVar / sMean : 1; // variance per unit of mean
  const variance = Math.max(mean, mean * Math.max(dispersion, 1));

  return { mean, sd: Math.sqrt(variance), minutes, perMinute, matchupFactor, paceFactor, games: played.length };
}

/** log Γ via Lanczos — for the negative binomial's coefficients. */
function logGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** P(X ≤ k) for a count with this mean and variance: negative binomial, or Poisson when variance ≤ mean. */
export function countCdf(k: number, mean: number, variance: number): number {
  if (k < 0) return 0;
  if (mean <= 0) return 1;
  let cdf = 0;
  if (variance <= mean * 1.0001) {
    let term = Math.exp(-mean);
    for (let i = 0; i <= k; i++) {
      if (i > 0) term *= mean / i;
      cdf += term;
    }
    return Math.min(cdf, 1);
  }
  const r = (mean * mean) / (variance - mean);
  const p = r / (r + mean);
  for (let i = 0; i <= k; i++) {
    cdf += Math.exp(logGamma(i + r) - logGamma(r) - logGamma(i + 1) + r * Math.log(p) + i * Math.log(1 - p));
  }
  return Math.min(cdf, 1);
}

function shrink(p: number): number {
  const clamped = Math.min(Math.max(p, 1e-4), 1 - 1e-4);
  const logit = Math.log(clamped / (1 - clamped)) * CALIBRATION_SHRINK;
  return 1 / (1 + Math.exp(-logit));
}

/**
 * The model's chance the Over cashes at `point` (strictly more than the line;
 * on a whole number a push is neither side). Calibrated by CALIBRATION_SHRINK.
 */
export function probOver(proj: PropProjection, point: number): number {
  const variance = proj.sd * proj.sd;
  const atOrBelow = countCdf(Math.floor(point), proj.mean, variance);
  const push = Number.isInteger(point) ? atOrBelow - countCdf(point - 1, proj.mean, variance) : 0;
  const over = 1 - atOrBelow;
  // A push refunds: the side's chance is over / (1 − push).
  return shrink(over / Math.max(1 - push, 1e-6));
}
