/**
 * ARCHR's NBA props SHADOW model: an experimental way to turn the production
 * projection into a chance of clearing a line, run beside production and never
 * shown or used by it. See docs/model-improvement-plan.md.
 *
 * Production (nba/projection.ts) prices a line from a negative binomial with
 * the projected mean and the player's own game-to-game spread in the stat. The
 * audits (#132, #134) found three faults in that read:
 *
 *   1. minutes misses drive the losses, and their size isn't predicted;
 *   2. beyond 0.55 SD from the line the spread is 22–44% too narrow;
 *   3. combined stats are overprojected by 0.3–0.5.
 *
 * The shadow keeps production's mean inputs (minutes projection, per-minute
 * rate, matchup, pace, environment, absences) and changes only how
 * uncertainty is built:
 *
 *   - Minutes are a distribution, not a number: production's minutes
 *     projection plus a pregame-predicted scale (minutesScale: how big a miss
 *     to expect, from his recent minutes volatility, role, a return, teammates
 *     out, the spread…) times empirical standardized misses (`nodes`, fitted on
 *     the 2025-26 season). The misses are left-skewed (early exits, blowouts,
 *     foul trouble), so the mixture's mean sits below the point projection:
 *     the candidate fix for item 3.
 *   - Given the minutes, the stat is a negative binomial with the player's
 *     per-minute dispersion (game-to-game spread net of his minutes swings),
 *     shrunk toward the stat's typical dispersion.
 *   - s2 adds the per-minute rate's own estimation error and a per-stat
 *     variance multiplier (kappa), both fitted on 2025-26 only: item 2.
 *
 * Inputs are the production projection and the player's logs before tonight
 * (the slate's logs end at the last game played): pregame by construction.
 * Pure and client-safe; nothing in the product imports it.
 */
import type { PropProjection } from "@/lib/nba/projection";
import type { GameLogPoint } from "@/lib/nba/propsMath";

/** Bumped whenever the shadow's method or constants change: forward results are only ever read within one version. */
export const SHADOW_VERSION = "nba-shadow-v1";

/** The pregame minutes features the miss scale reads, in this order (minutesScale's coefficients follow it). */
export const MINUTES_FEATURES = [
  "intercept",
  /** SD of his minutes over his last 10 games played. */
  "sd10",
  /** Coming off the bench in his latest role. */
  "bench",
  /** First game back after missing his team's last game or more. */
  "returning",
  /** Rotation teammates out tonight (the minutes projection adjusted for them). */
  "teammatesOut",
  /** Tonight's spread, absolute (blowout risk); 0 when not posted. */
  "spreadAbs",
  /** Second night of a back-to-back. */
  "backToBack",
  /** Games in his last 10 well under his median (< 60%): early exits, foul trouble, a cut role. */
  "shortGames10",
  /** Fewer than 15 games played: a new or thin rotation history. */
  "newPlayer",
  /** Started 3–7 of his last 10: a role that moves. */
  "roleFlux",
  /** Production's projected minutes (bench players miss by more relative to their minutes, starters by more in absolute terms). */
  "projMinutes",
] as const;

export interface ShadowParams {
  /** Linear model of the expected absolute minutes miss, one coefficient per MINUTES_FEATURES entry. */
  minutesCoef: number[];
  /** Floor on the predicted miss scale, minutes. */
  minScale: number;
  /** Standardized minutes misses (actual − projected) ÷ scale, at equal-weight quantiles: the minutes mixture's nodes. */
  nodes: number[];
  /** Each stat's typical per-minute dispersion (variance ÷ mean given the minutes), the prior a player's own is shrunk toward. */
  phi0: Record<string, number>;
  /** Games of prior weight on phi0. */
  phiPriorGames: number;
  /** s2: each stat's variance multiplier. */
  kappa: Record<string, number>;
}

/**
 * The shadow's constants, fitted once by `npm run lab:nba-shadow` (Model lab
 * run #103, 2026-11-17) on the 2025-26 season only — 23,038 player-games,
 * walk-forward, pregame inputs — and checked once on 2026-27 before Nov 17
 * (4,082). Frozen for the forward test: changing any of them is a new
 * SHADOW_VERSION, and the forward clock restarts.
 *
 * Known gap: the 2025-26 games have no stored closing lines, so the spread
 * term could not be fitted (0) and the projections it was fitted on had no
 * blowout or total adjustment.
 */
export const SHADOW_PARAMS: ShadowParams = {
  minutesCoef: [4.9569, 0.3468, -0.5669, -0.1555, 0.6687, 0, 0.1229, -0.0348, -0.2162, 0.2927, -0.083],
  minScale: 1.5,
  nodes: [-2.223, -1.335, -0.886, -0.533, -0.223, 0.08, 0.381, 0.725, 1.165, 1.96],
  phi0: { points: 2.074, rebounds: 1, assists: 1, threes: 1.249, pointsReboundsAssists: 1.748, pointsRebounds: 1.845, pointsAssists: 1.859, reboundsAssists: 1.041 },
  phiPriorGames: 10,
  kappa: { points: 1.5, rebounds: 1, assists: 1, threes: 1.1, pointsReboundsAssists: 1.5, pointsRebounds: 1.5, pointsAssists: 1.5, reboundsAssists: 1.1 },
};

const MAX_MINUTES = 48;
const MIN_MINUTES = 1;
/** Games read for the per-minute dispersion and the rate's estimation error. */
const DISPERSION_WINDOW = 20;
const RATE_WINDOW = 30;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};

/** The pregame minutes features for one projection, from the projection and his logs before tonight (newest first). */
export function minutesFeatures(proj: Pick<PropProjection, "minutes" | "minutesDetail" | "env" | "absence">, logs: Pick<GameLogPoint, "minutes" | "starter">[]): number[] {
  const played = logs.filter((l) => l.minutes > 0);
  const last10 = played.slice(0, 10).map((l) => l.minutes);
  const med = median(last10);
  const starts10 = played.slice(0, 10).filter((l) => l.starter === true).length;
  const d = proj.minutesDetail;
  const f: Record<(typeof MINUTES_FEATURES)[number], number> = {
    intercept: 1,
    sd10: sd(last10),
    bench: d?.role === "bench" ? 1 : 0,
    returning: (d?.missed ?? 0) >= 1 ? 1 : 0,
    teammatesOut: proj.absence !== null || (d !== null && Math.abs(d.absence - 1) > 1e-9) ? 1 : 0,
    spreadAbs: Math.abs(proj.env.spread ?? 0),
    backToBack: d?.backToBack ? 1 : 0,
    shortGames10: last10.filter((m) => m < 0.6 * med).length,
    newPlayer: played.length < 15 ? 1 : 0,
    roleFlux: starts10 >= 3 && starts10 <= 7 ? 1 : 0,
    projMinutes: proj.minutes,
  };
  return MINUTES_FEATURES.map((k) => f[k]);
}

/** The expected absolute minutes miss tonight. */
export function minutesScale(features: number[], p: ShadowParams = SHADOW_PARAMS): number {
  const s = features.reduce((a, x, i) => a + x * (p.minutesCoef[i] ?? 0), 0);
  return Math.max(p.minScale, s);
}

/**
 * His per-minute dispersion: the variance of his stat around his own
 * per-minute rate × that night's minutes, per unit of that expectation
 * (Pearson), over his last DISPERSION_WINDOW games — the spread production's
 * marginal variance holds, net of his minutes swings — shrunk toward the
 * stat's prior and never below Poisson.
 */
export function perMinuteDispersion(values: number[], minutes: number[], prior: number, priorGames: number): number {
  const n = Math.min(values.length, minutes.length, DISPERSION_WINDOW);
  const v = values.slice(0, n);
  const m = minutes.slice(0, n);
  const totalM = m.reduce((a, b) => a + b, 0);
  const rate = totalM > 0 ? v.reduce((a, b) => a + b, 0) / totalM : 0;
  let num = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const e = rate * m[i];
    if (e <= 0) continue;
    num += (v[i] - e) ** 2 / e;
    k++;
  }
  const own = k > 1 ? num / (k - 1) : prior;
  return Math.max(1, (own * k + prior * priorGames) / (k + priorGames));
}

export interface ShadowDistribution {
  /** Equal-weight mixture components: minutes at the node, and the stat's mean and variance given them. */
  components: { minutes: number; mean: number; variance: number }[];
  /** The mixture's mean and SD (what production's projection mean and sd compare against). */
  mean: number;
  sd: number;
  /** The minutes mixture's mean, and the predicted miss scale. */
  minutesMean: number;
  minutesScale: number;
  /** Per-minute dispersion used, and the rate's estimation variance (s2 only; 0 in s1). */
  phi: number;
  rateVar: number;
}

export type ShadowVariant = "s1" | "s2";

/**
 * The shadow's distribution of one stat tonight. `proj` is production's
 * projection (nba/projection.ts) — its minutes and effective per-minute rate
 * (mean ÷ minutes: rate × matchup × pace × environment × opponent absences)
 * are kept; `logs` are his games before tonight, newest first.
 *
 *   s1: minutes mixture + per-minute dispersion
 *   s2: s1 + the rate's estimation error + the per-stat variance multiplier
 */
export function shadowDistribution(
  proj: Pick<PropProjection, "mean" | "minutes" | "minutesDetail" | "env" | "absence">,
  logs: GameLogPoint[],
  stat: { key: string; value: (l: GameLogPoint) => number },
  variant: ShadowVariant,
  p: ShadowParams = SHADOW_PARAMS
): ShadowDistribution | null {
  if (!(proj.minutes > 0) || !(proj.mean >= 0)) return null;
  const played = logs.filter((l) => l.minutes > 0);
  if (played.length < 2) return null;
  const rate = proj.mean / proj.minutes;
  const scale = minutesScale(minutesFeatures(proj, played), p);
  const prior = p.phi0[stat.key] ?? 1.5;
  const phi = perMinuteDispersion(
    played.map((l) => stat.value(l)),
    played.map((l) => l.minutes),
    prior,
    p.phiPriorGames
  );
  // The rate's estimation error: Poisson-like information in the minutes behind it, inflated by his dispersion.
  const rateMinutes = played.slice(0, RATE_WINDOW).reduce((a, l) => a + l.minutes, 0);
  const rateVar = variant === "s2" && rateMinutes > 0 ? (phi * rate) / rateMinutes : 0;
  const kappa = variant === "s2" ? (p.kappa[stat.key] ?? 1) : 1;
  const components = p.nodes.map((u) => {
    const minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, proj.minutes + scale * u));
    const mu = minutes * rate;
    const variance = Math.max(mu, kappa * phi * mu + minutes * minutes * rateVar);
    return { minutes, mean: mu, variance };
  });
  const w = 1 / components.length;
  const m = components.reduce((a, c) => a + w * c.mean, 0);
  const second = components.reduce((a, c) => a + w * (c.variance + c.mean * c.mean), 0);
  return {
    components,
    mean: m,
    sd: Math.sqrt(Math.max(second - m * m, 0)),
    minutesMean: components.reduce((a, c) => a + w * c.minutes, 0),
    minutesScale: scale,
    phi,
    rateVar,
  };
}

/**
 * P(X ≤ k) for a count with this mean and variance: negative binomial, or
 * Poisson when variance ≤ mean — the same distribution as propModel's
 * countCdf, summed by recurrence (no log-gamma per term), which the lab's
 * replay of every player-game needs.
 */
export function nbCdf(k: number, mean: number, variance: number): number {
  if (k < 0) return 0;
  if (mean <= 0) return 1;
  let term: number;
  let next: (i: number) => number;
  if (variance <= mean * 1.0001) {
    term = Math.exp(-mean);
    next = (i) => mean / i;
  } else {
    const r = (mean * mean) / (variance - mean);
    const p = r / (r + mean);
    term = Math.exp(r * Math.log(p));
    next = (i) => ((i - 1 + r) / i) * (1 - p);
  }
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= next(i);
    cdf += term;
  }
  return Math.min(cdf, 1);
}

/** P(X ≤ k) under the mixture. */
export function mixtureCdf(d: Pick<ShadowDistribution, "components">, k: number): number {
  if (k < 0) return 0;
  const w = 1 / d.components.length;
  return Math.min(1, d.components.reduce((a, c) => a + w * nbCdf(k, c.mean, c.variance), 0));
}

/** The chance the Over cashes at `point` (strictly more; a push on a whole number refunds). */
export function shadowProbOver(d: Pick<ShadowDistribution, "components">, point: number): number {
  const atOrBelow = mixtureCdf(d, Math.floor(point));
  const push = Number.isInteger(point) ? atOrBelow - mixtureCdf(d, point - 1) : 0;
  return (1 - atOrBelow) / Math.max(1 - push, 1e-6);
}

/** log P(X = k) under the mixture: the proper score the lab compares variance methods on. */
export function mixtureLogPmf(d: Pick<ShadowDistribution, "components">, k: number): number {
  const p = mixtureCdf(d, k) - mixtureCdf(d, k - 1);
  return Math.log(Math.max(p, 1e-12));
}

/** Ordinary least squares (normal equations, Gaussian elimination with partial pivoting). Rows of X include the intercept column. */
export function ols(X: number[][], y: number[], ridge = 1e-6): number[] {
  const k = X[0]?.length ?? 0;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < X.length; r++)
    for (let i = 0; i < k; i++) {
      A[i][k] += X[r][i] * y[r];
      for (let j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j];
    }
  for (let i = 0; i < k; i++) A[i][i] += ridge;
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / (row[i] || 1e-12));
}

/** Equal-weight quantile midpoints of a sample (n nodes at (i + 0.5) / n). */
export function quantileNodes(xs: number[], n: number): number[] {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return [];
  return Array.from({ length: n }, (_, i) => {
    const q = ((i + 0.5) / n) * (s.length - 1);
    const lo = Math.floor(q);
    const hi = Math.min(lo + 1, s.length - 1);
    return s[lo] + (s[hi] - s[lo]) * (q - lo);
  });
}

/** P(X = k) for k = 0..kmax of a count with this mean and variance (negative binomial, or Poisson when variance ≤ mean). */
export function nbPmf(mean: number, variance: number, kmax: number): number[] {
  const out = new Array<number>(kmax + 1).fill(0);
  if (mean <= 0) {
    out[0] = 1;
    return out;
  }
  let term: number;
  let next: (i: number) => number;
  if (variance <= mean * 1.0001) {
    term = Math.exp(-mean);
    next = (i) => mean / i;
  } else {
    const r = (mean * mean) / (variance - mean);
    const p = r / (r + mean);
    term = Math.exp(r * Math.log(p));
    next = (i) => ((i - 1 + r) / i) * (1 - p);
  }
  out[0] = term;
  for (let i = 1; i <= kmax; i++) out[i] = term *= next(i);
  return out;
}

/** The mixture's P(X = k) for k = 0..kmax. */
export function mixturePmf(d: Pick<ShadowDistribution, "components">, kmax: number): number[] {
  const out = new Array<number>(kmax + 1).fill(0);
  const w = 1 / d.components.length;
  for (const c of d.components) nbPmf(c.mean, c.variance, kmax).forEach((p, k) => (out[k] += w * p));
  return out;
}
