/**
 * ARCHR's NBA props shadow model, version 2 (docs/alpha-sprint.md): the
 * experimental projection and distribution the plus-money research screen
 * reads. Run beside production, never shown as a recommendation, never used
 * to price anything the product sells.
 *
 * Built on production's projection (nba/projection.ts) and the v1 shadow
 * (nbaShadow.ts), with four changes, each fitted on the first 70% of the
 * 2025-26 season only (lab:nba-v2) and held out on the rest:
 *
 *   1. Minutes v2: production's minutes (before tonight's spread) plus a
 *      fitted correction for what production misses — high projections
 *      (35+ minutes regress), his season-to-date minutes where they differ
 *      from the recency read (the early-season carryover: last season's
 *      minutes still dominating), recent volatility, role, a return, cut-short
 *      games. Its uncertainty is the v1 miss-scale model refitted around it.
 *   2. Per-minute rate: production's effective rate × a fitted multiplier on
 *      how far his season-to-date rate sits from it (carryover again, and
 *      streaks the long blend misses), per component stat.
 *   3. Displacement: the corrected projection's departure from his own recent
 *      average, scaled by a fitted γ per component stat. A far projection is
 *      partly noise; this is fitted against outcomes, never against a book
 *      price, so it is a projection correction, not market shrinkage.
 *   4. Combined stats are the sum of their corrected components (points,
 *      rebounds, assists), so PRA can never disagree with its parts.
 *
 * Then the v1 machinery prices it: a minutes mixture (expected minutes ±
 * the predicted miss, empirical skew) × per-minute dispersion, κ-widened.
 *
 * Pregame only: production's projection, his logs before tonight, tonight's
 * season. Pure and client-safe.
 */
import type { PropProjection } from "@/lib/nba/projection";
import type { GameLogPoint } from "@/lib/nba/propsMath";
import { shadowDistribution, type ShadowDistribution, type ShadowParams } from "./nbaShadow";

export const V2_VERSION = "nba-shadow-v2";

/** The stats v2 prices, and each one's components (a single stat is its own). */
export const V2_COMPONENTS: Record<string, readonly ("points" | "rebounds" | "assists" | "threes")[]> = {
  points: ["points"],
  rebounds: ["rebounds"],
  assists: ["assists"],
  threes: ["threes"],
  pointsReboundsAssists: ["points", "rebounds", "assists"],
  pointsRebounds: ["points", "rebounds"],
  pointsAssists: ["points", "assists"],
  reboundsAssists: ["rebounds", "assists"],
};
export type V2Component = "points" | "rebounds" | "assists" | "threes";
export const COMPONENT_VALUE: Record<V2Component, (l: GameLogPoint) => number> = {
  points: (l) => l.points,
  rebounds: (l) => l.rebounds,
  assists: (l) => l.assists,
  threes: (l) => l.threesMade,
};

/** Minutes v2's correction features, in order (V2Params.minutesCoef follows it). */
export const MINUTES_V2_FEATURES = [
  "intercept",
  /** Production's minutes above 32 (high projections regress). */
  "over32",
  /** Production's minutes above 36. */
  "over36",
  /** His season-to-date average minus production's minutes, × n/(n+5) for n games this season (the carryover read). */
  "seasonGap",
  /** His last-3 average minus production's minutes. */
  "last3Gap",
  /** SD of his last 10 games' minutes. */
  "sd10",
  /** Coming off the bench in his latest role. */
  "bench",
  /** Started 3–7 of his last 10. */
  "roleFlux",
  /** First game back after missing his team's last game or more. */
  "returning",
  /** Games in his last 10 under 60% of his median. */
  "shortGames10",
] as const;

export interface V2Params {
  /** Minutes correction (added to production's minutes before tonight's spread). */
  minutesCoef: number[];
  /** Games of shrinkage on the season-to-date gap (pre-registered, not fitted). */
  seasonGapGames: number;
  /** Per component: log-rate multiplier = a + b × the shrunk log gap between his season-to-date rate and production's. */
  rate: Record<V2Component, { a: number; b: number }>;
  /** Minutes of shrinkage on the season-to-date rate gap (pre-registered, not fitted). */
  rateGapMinutes: number;
  /** Per component: the share of the projection's departure from his recent average kept. */
  gamma: Record<V2Component, number>;
  /** Games in his recent average. */
  baseGames: number;
  /** The distribution: the v1 parameter set refitted around minutes v2 (scale, nodes, dispersion, κ). */
  dist: ShadowParams;
  /** Whether the minutes mixture is used (false: a single node at the expected minutes); chosen on the training set. */
  minutesMixture: boolean;
}

/**
 * Fitted once by `npm run lab:nba-v2` (Model lab run #106, 2026-11-17) on the
 * first 70% of 2025-26 by date (16,020 player-games, to 2026-03-11), pregame
 * inputs only. Frozen: changing any of them is a new V2_VERSION and a new
 * forward clock.
 *
 * What the untouched holdout (the last 30% of 2025-26, 7,045 player-games)
 * said, honestly: the v2 distribution beats production's log score on all
 * eight stats, but the projection corrections (minutes, rate, displacement)
 * did NOT carry over to the late season — the corrected projection alone is
 * worse than production on line log loss for six of eight stats and on mean
 * error for bench, returning and volatile players. On 2026-27 before Nov 17
 * (early season, already seen) the same corrections help every stat. They
 * are kept as fitted and judged forward; the candidate rule
 * (marketValue.ts) does not lean on v2 alone. docs/alpha-sprint.md.
 */
export const V2_PARAMS: V2Params = {
  minutesCoef: [0.4339, -0.2795, -0.2052, 0.2721, -0.0124, -0.0707, -0.1257, -0.1612, -0.2751, 0.2192],
  seasonGapGames: 5,
  rate: { points: { a: 0.0007, b: 0.6944 }, rebounds: { a: 0.0057, b: 0.7942 }, assists: { a: 0.0091, b: 0.6129 }, threes: { a: -0.0045, b: 0.7955 } },
  rateGapMinutes: 300,
  gamma: { points: 0.873, rebounds: 0.91, assists: 0.998, threes: 0.937 },
  baseGames: 20,
  dist: {
    minutesCoef: [4.0973, 0.2484, 0.0053, 0.1352, 0, 0, 0.2306, 0.1398, 0.0251, 0.1624, -0.0404],
    minScale: 1.5,
    nodes: [-2.092, -1.257, -0.799, -0.449, -0.125, 0.179, 0.49, 0.826, 1.247, 2.037],
    phi0: { points: 2.049, rebounds: 1, assists: 1.591, threes: 1.385, pointsReboundsAssists: 1.737, pointsRebounds: 1.83, pointsAssists: 1.831, reboundsAssists: 1.035 },
    phiPriorGames: 10,
    kappa: { points: 1.5, rebounds: 1.1, assists: 0.9, threes: 1, pointsReboundsAssists: 1.5, pointsRebounds: 1.5, pointsAssists: 1.5, reboundsAssists: 1.1 },
  },
  minutesMixture: true,
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sdOf = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};

type MinutesProj = Pick<PropProjection, "minutes" | "minutesDetail" | "env">;

/** Production's minutes before tonight's spread (the part minutes v2 corrects; the spread trim is applied after). */
export function baseMinutes(proj: MinutesProj): number {
  return proj.env.minutesFactor > 0 ? proj.minutes / proj.env.minutesFactor : proj.minutes;
}

/** Minutes v2's features, from production's projection, his games before tonight (newest first) and tonight's season. */
export function minutesV2Features(proj: MinutesProj, logs: Pick<GameLogPoint, "minutes" | "starter" | "season">[], season: number, p: Pick<V2Params, "seasonGapGames"> = V2_PARAMS): number[] {
  const played = logs.filter((l) => l.minutes > 0);
  const base = baseMinutes(proj);
  const last10 = played.slice(0, 10).map((l) => l.minutes);
  const med = median(last10);
  const thisSeason = played.filter((l) => l.season === season).map((l) => l.minutes);
  const n = thisSeason.length;
  const starts10 = played.slice(0, 10).filter((l) => l.starter === true).length;
  const d = proj.minutesDetail;
  const f: Record<(typeof MINUTES_V2_FEATURES)[number], number> = {
    intercept: 1,
    over32: Math.max(0, base - 32),
    over36: Math.max(0, base - 36),
    seasonGap: n ? (mean(thisSeason) - base) * (n / (n + p.seasonGapGames)) : 0,
    last3Gap: played.length >= 3 ? mean(played.slice(0, 3).map((l) => l.minutes)) - base : 0,
    sd10: sdOf(last10),
    bench: d?.role === "bench" ? 1 : 0,
    roleFlux: starts10 >= 3 && starts10 <= 7 ? 1 : 0,
    returning: (d?.missed ?? 0) >= 1 ? 1 : 0,
    shortGames10: last10.filter((m) => m < 0.6 * med).length,
  };
  return MINUTES_V2_FEATURES.map((k) => f[k]);
}

/** Expected minutes tonight under minutes v2 (tonight's spread trim included), never below 1 or above 48. */
export function minutesV2(proj: MinutesProj, logs: Pick<GameLogPoint, "minutes" | "starter" | "season">[], season: number, p: V2Params = V2_PARAMS): number {
  const x = minutesV2Features(proj, logs, season, p);
  const corrected = baseMinutes(proj) + x.reduce((a, v, i) => a + v * (p.minutesCoef[i] ?? 0), 0);
  return Math.min(48, Math.max(1, corrected * proj.env.minutesFactor));
}

/** His season-to-date per-minute rate of a component, and the minutes behind it. */
export function seasonRate(logs: GameLogPoint[], season: number, c: V2Component): { rate: number | null; minutes: number } {
  const g = logs.filter((l) => l.minutes > 0 && l.season === season);
  const m = g.reduce((a, l) => a + l.minutes, 0);
  return { rate: m > 0 ? g.reduce((a, l) => a + COMPONENT_VALUE[c](l), 0) / m : null, minutes: m };
}

/** The rate-gap feature: log(season-to-date rate ÷ production's), shrunk by the minutes behind it. */
export function rateGap(prodRate: number, logs: GameLogPoint[], season: number, c: V2Component, p: Pick<V2Params, "rateGapMinutes"> = V2_PARAMS): number {
  const s = seasonRate(logs, season, c);
  if (s.rate === null || prodRate <= 0) return 0;
  const eps = 0.01;
  return Math.log((s.rate + eps) / (prodRate + eps)) * (s.minutes / (s.minutes + p.rateGapMinutes));
}

/** His recent per-game average of a component (the displacement anchor). */
export function recentAverage(logs: GameLogPoint[], c: V2Component, games: number): number {
  return mean(
    logs
      .filter((l) => l.minutes > 0)
      .slice(0, games)
      .map((l) => COMPONENT_VALUE[c](l))
  );
}

export interface V2Projection {
  /** Expected minutes (minutes v2). */
  minutes: number;
  /** Corrected mean of the stat (the sum of its corrected components). */
  mean: number;
  /** Each component's corrected mean, and the pieces: production's mean, after minutes, after rate, after displacement. */
  components: { key: V2Component; prodMean: number; afterMinutes: number; afterRate: number; mean: number }[];
}

/**
 * The corrected projection of a stat from production's projection of each of
 * its components (`prod[c]`: projectProp for that component, same context).
 */
export function v2Projection(
  stat: string,
  prod: Partial<Record<V2Component, Pick<PropProjection, "mean" | "minutes" | "minutesDetail" | "env">>>,
  logs: GameLogPoint[],
  season: number,
  p: V2Params = V2_PARAMS
): V2Projection | null {
  const parts = V2_COMPONENTS[stat];
  if (!parts) return null;
  const any = prod[parts[0]];
  if (!any || !(any.minutes > 0)) return null;
  const minutes = minutesV2(any, logs, season, p);
  const components: V2Projection["components"] = [];
  for (const c of parts) {
    const pc = prod[c];
    if (!pc || !(pc.minutes > 0)) return null;
    const rate = pc.mean / pc.minutes;
    const afterMinutes = minutes * rate;
    const k = p.rate[c];
    const afterRate = afterMinutes * Math.exp(k.a + k.b * rateGap(rate, logs, season, c, p));
    const base = recentAverage(logs, c, p.baseGames);
    const corrected = Math.max(0, base + p.gamma[c] * (afterRate - base));
    components.push({ key: c, prodMean: pc.mean, afterMinutes, afterRate, mean: corrected });
  }
  return { minutes, mean: components.reduce((a, c) => a + c.mean, 0), components };
}

/**
 * The v2 distribution of the stat: the v1 machinery (minutes mixture ×
 * per-minute dispersion, κ-widened) around minutes v2 and the corrected mean.
 * `statValue` reads the stat off a log (its per-minute dispersion).
 */
export function v2Distribution(
  proj: V2Projection,
  base: Pick<PropProjection, "minutesDetail" | "env" | "absence">,
  logs: GameLogPoint[],
  stat: { key: string; value: (l: GameLogPoint) => number },
  p: V2Params = V2_PARAMS
): ShadowDistribution | null {
  const pseudo = { mean: proj.mean, minutes: proj.minutes, minutesDetail: base.minutesDetail, env: base.env, absence: base.absence };
  const params = p.minutesMixture ? p.dist : { ...p.dist, nodes: [0] };
  return shadowDistribution(pseudo, logs, stat, "s2", params);
}

/**
 * The corrected mean under production's own spread (production's variance per
 * unit of mean): isolates what the projection correction alone does.
 */
export function correctedOnlyVariance(proj: Pick<PropProjection, "mean" | "sd">, correctedMean: number): number {
  const perUnit = proj.mean > 0 ? (proj.sd * proj.sd) / proj.mean : 1;
  return Math.max(correctedMean, correctedMean * Math.max(perUnit, 1));
}

/**
 * Poisson regression with an offset, by Newton–Raphson: y ~ Poisson(exp(offset + Σ b·x)).
 * The rate correction's fit (lab:nba-v2): offset = log(actual minutes × production's
 * rate), so b reads as what production's per-minute rate misses, apart from minutes.
 */
export function poissonWithOffset(rows: { y: number; offset: number; x: number[] }[], iters = 50): number[] | null {
  const k = rows[0]?.x.length ?? 0;
  if (!rows.length || !k) return null;
  let b = new Array<number>(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array<number>(k).fill(0);
    const H = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (const r of rows) {
      const mu = Math.exp(r.offset + r.x.reduce((a, xi, i) => a + xi * b[i], 0));
      for (let i = 0; i < k; i++) {
        g[i] += (r.y - mu) * r.x[i];
        for (let j = 0; j < k; j++) H[i][j] += mu * r.x[i] * r.x[j];
      }
    }
    const A = H.map((row, i) => [...row.map((v, j) => v + (i === j ? 1e-9 : 0)), g[i]]);
    for (let c = 0; c < k; c++) {
      let piv = c;
      for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < k; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
      }
    }
    const d = A.map((row, i) => row[k] / row[i]);
    b = b.map((bi, i) => bi + d[i]);
    if (d.every((x) => Math.abs(x) < 1e-9)) return b;
  }
  return b;
}
