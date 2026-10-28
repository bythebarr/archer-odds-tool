/**
 * ARCHR's MLB prop projection, on the shared prop framework (propModel/):
 * volume × rate × matchup, as a full distribution, then the same calibration,
 * injury and market-blend pipeline as NBA and NFL.
 *
 * Batters. Volume is expected plate appearances (recent PAs, steadied toward a
 * league-typical 4.2). Each outcome has a per-PA rate, recency-weighted over
 * two seasons and shrunk toward the league rate with a prior sized to how fast
 * that stat stabilizes (strikeouts fast, home runs slowly). Then:
 *   - platoon: his rate against tonight's starter's hand vs overall, half
 *     regressed, capped
 *   - the opposing starter's strikeout rate (for batter Ks), and a park factor
 *     when one is supplied, the same way
 * Counts come from the per-PA chance summed over a spread of possible PAs, which
 * is how a 1-for-4 night actually happens. Total bases are built outcome by
 * outcome (out, single, extra-base hit, home run) for each PA. Runs and RBIs
 * depend on teammates, so they use a negative binomial with his own spread.
 *
 * Pitchers (starts only). Volume is batters faced; strikeouts, hits and walks
 * are per-batter rates (shrunk toward the league) × the opponent's strikeout
 * tendency and the park; outs recorded and earned runs follow his own starts.
 */
import type { StatDistribution } from "@/lib/propModel/distribution";
import { seasonMix, type SeasonMix } from "@/lib/propModel/seasonMix";

export interface MlbLogPoint {
  date: string;
  season: number;
  isHome: boolean;
  /** The opposing starter's throwing hand, when known. */
  opposingStarterHand: "L" | "R" | null;
  // Batting (null when he didn't bat).
  plateAppearances: number | null;
  hits: number | null;
  totalBases: number | null;
  homeRuns: number | null;
  rbi: number | null;
  runs: number | null;
  baseOnBalls: number | null;
  strikeoutsBatting: number | null;
  stolenBases: number | null;
  // Pitching (null when he didn't pitch).
  isStarter: boolean | null;
  outsRecorded: number | null;
  strikeoutsPitching: number | null;
  earnedRuns: number | null;
  hitsAllowed: number | null;
  walksAllowed: number | null;
}

export type MlbBatterStat = "hits" | "totalBases" | "homeRuns" | "rbi" | "runs" | "battingStrikeouts" | "walks" | "stolenBases" | "hitsRunsRbis";
export type MlbPitcherStat = "pitcherStrikeouts" | "outsRecorded" | "hitsAllowed" | "walksAllowed" | "earnedRuns";
export type MlbPropStat = MlbBatterStat | MlbPitcherStat;

export const MLB_PITCHER_STATS: MlbPitcherStat[] = ["pitcherStrikeouts", "outsRecorded", "hitsAllowed", "walksAllowed", "earnedRuns"];

/** League per-PA rates (recent seasons) and how many PAs of evidence each prior counts as. */
const LEAGUE_PER_PA = { hits: 0.218, homeRuns: 0.03, battingStrikeouts: 0.225, walks: 0.083, runs: 0.115, rbi: 0.11, stolenBases: 0.016 } as const;
const PRIOR_PA = { hits: 200, homeRuns: 400, battingStrikeouts: 120, walks: 150, runs: 250, rbi: 250, stolenBases: 200 } as const;
/** Bases per non-homer hit in the league (singles, doubles, triples). */
const LEAGUE_BASES_PER_NON_HR_HIT = 1.27;
const PRIOR_NON_HR_HITS = 60;

const LEAGUE_PER_BF = { pitcherStrikeouts: 0.225, hitsAllowed: 0.225, walksAllowed: 0.08 } as const;
const PRIOR_BF = { pitcherStrikeouts: 150, hitsAllowed: 300, walksAllowed: 250 } as const;

const PA_HALF_LIFE = 10;
const RATE_HALF_LIFE = 40;
const RATE_WINDOW = 150;
const PLATOON_PRIOR_PA = 150;
const PLATOON_CAP = 0.15;
const MATCHUP_CAP = 0.2;

export interface MlbProjectionContext {
  /** Tonight's opposing starter's hand (batters' platoon split). */
  opposingHand?: "L" | "R" | null;
  /** The opposing starter's strikeout rate per batter faced (batter strikeouts). */
  starterKRate?: number | null;
  /** The opposing lineup's strikeout rate per PA (pitcher strikeouts). */
  opponentKRate?: number | null;
  /** Park multiplier on strikeouts / on hits and power (1 = neutral). */
  parkK?: number;
  parkHits?: number;
  season?: number;
}

export interface MlbProjection {
  mean: number;
  /** Expected plate appearances (batters) or batters faced (pitchers). */
  volume: number;
  /** The per-PA / per-BF rate after shrinkage (null for stats modeled per game). */
  rate: number | null;
  platoonFactor: number;
  matchupFactor: number;
  parkFactor: number;
  games: number;
  seasons: SeasonMix;
  distribution: StatDistribution;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const regress = (ratio: number, cap: number) => clamp(1 + (ratio - 1) * 0.5, 1 - cap, 1 + cap);

/** Recency weights for logs (most recent first). */
function weights(n: number, halfLife: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.pow(0.5, i / halfLife));
}

/** A spread of plate appearances (or batters faced) around the expectation: discrete normal. */
function volumeDist(mean: number, sd: number): [number, number][] {
  const out: [number, number][] = [];
  let z = 0;
  for (let n = Math.max(0, Math.floor(mean - 4 * sd)); n <= Math.ceil(mean + 4 * sd); n++) {
    const p = Math.exp(-((n - mean) ** 2) / (2 * sd * sd));
    out.push([n, p]);
    z += p;
  }
  return out.map(([n, p]) => [n, p / z]);
}

/** Counts from a per-trial chance over a spread of trials: Σ P(trials) × Binomial. */
function binomialMixture(volume: [number, number][], p: number, max = 30): number[] {
  const pmf = new Array(max + 1).fill(0);
  for (const [n, w] of volume) {
    let term = Math.pow(1 - p, n); // P(0)
    for (let k = 0; k <= Math.min(n, max); k++) {
      pmf[k] += w * term;
      term = (term * (n - k) * p) / ((k + 1) * (1 - p || 1e-12));
    }
  }
  return pmf;
}

/** Total bases from per-PA outcomes: out, single, double (extra-base hits as doubles), home run. */
function totalBasesPmf(volume: [number, number][], pSingle: number, pDouble: number, pHr: number, max = 20): number[] {
  const per = [1 - pSingle - pDouble - pHr, pSingle, pDouble, 0, pHr];
  const pmf = new Array(max + 1).fill(0);
  for (const [n, w] of volume) {
    let dist = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(Math.min(dist.length + 4, max + 1)).fill(0);
      dist.forEach((q, k) => per.forEach((r, b) => k + b <= max && (next[k + b] += q * r)));
      dist = next;
    }
    dist.forEach((q, k) => (pmf[k] += w * q));
  }
  return pmf;
}

/** Negative-binomial pmf with this mean and variance (Poisson when variance ≤ mean). */
function nbPmf(mean: number, variance: number, max = 30): number[] {
  const out = new Array(max + 1).fill(0);
  if (mean <= 0) {
    out[0] = 1;
    return out;
  }
  if (variance <= mean * 1.0001) {
    let t = Math.exp(-mean);
    for (let k = 0; k <= max; k++) {
      out[k] = t;
      t *= mean / (k + 1);
    }
    return out;
  }
  const r = (mean * mean) / (variance - mean);
  const p = r / (r + mean);
  let t = Math.pow(p, r);
  for (let k = 0; k <= max; k++) {
    out[k] = t;
    t *= ((k + r) / (k + 1)) * (1 - p);
  }
  return out;
}

function weightedRate(logs: MlbLogPoint[], num: (l: MlbLogPoint) => number, den: (l: MlbLogPoint) => number, halfLife: number) {
  const w = weights(logs.length, halfLife);
  let n = 0;
  let d = 0;
  logs.forEach((l, i) => {
    n += w[i] * num(l);
    d += w[i] * den(l);
  });
  return { num: n, den: d, weights: w };
}

const shrink = (num: number, den: number, league: number, prior: number) => (num + league * prior) / (den + prior);

export const MIN_BATTER_GAMES = 10;
export const MIN_STARTS = 3;

export function projectBatter(allLogs: MlbLogPoint[], stat: MlbBatterStat, ctx: MlbProjectionContext): MlbProjection | null {
  const logs = allLogs.filter((l) => (l.plateAppearances ?? 0) > 0).slice(0, RATE_WINDOW);
  if (logs.length < MIN_BATTER_GAMES) return null;
  const pa = (l: MlbLogPoint) => l.plateAppearances ?? 0;
  const paW = weightedRate(logs.slice(0, 30), pa, () => 1, PA_HALF_LIFE);
  const expectedPa = (paW.num + 4.2 * 5) / (paW.den + 5);
  const paSd = 0.75;
  const volume = volumeDist(expectedPa, paSd);

  const col: Record<Exclude<MlbBatterStat, "totalBases" | "hitsRunsRbis">, (l: MlbLogPoint) => number> = {
    hits: (l) => l.hits ?? 0,
    homeRuns: (l) => l.homeRuns ?? 0,
    battingStrikeouts: (l) => l.strikeoutsBatting ?? 0,
    walks: (l) => l.baseOnBalls ?? 0,
    runs: (l) => l.runs ?? 0,
    rbi: (l) => l.rbi ?? 0,
    stolenBases: (l) => l.stolenBases ?? 0,
  };
  const rateOf = (key: keyof typeof col) => {
    const r = weightedRate(logs, col[key], pa, RATE_HALF_LIFE);
    return { rate: shrink(r.num, r.den, LEAGUE_PER_PA[key], PRIOR_PA[key]), weights: r.weights };
  };

  // Platoon: his rate against tonight's hand vs his rate overall.
  const platoon = (key: keyof typeof col, overall: number) => {
    if (!ctx.opposingHand) return 1;
    const split = logs.filter((l) => l.opposingStarterHand === ctx.opposingHand);
    const r = weightedRate(split, col[key], pa, RATE_HALF_LIFE);
    const splitRate = shrink(r.num, r.den, overall, PLATOON_PRIOR_PA);
    return overall > 0 ? regress(splitRate / overall, PLATOON_CAP) : 1;
  };

  const season = ctx.season ?? logs[0].season;
  const value = (l: MlbLogPoint): number =>
    stat === "totalBases"
      ? l.totalBases ?? 0
      : stat === "hitsRunsRbis"
        ? (l.hits ?? 0) + (l.runs ?? 0) + (l.rbi ?? 0)
        : col[stat](l);

  let platoonFactor = 1;
  let matchupFactor = 1;
  let parkFactor = 1;
  let rate: number | null = null;
  let distribution: StatDistribution;
  let mean: number;
  let mixWeights: number[];

  if (stat === "totalBases") {
    const h = rateOf("hits");
    const hr = rateOf("homeRuns");
    const nonHr = weightedRate(logs, (l) => (l.hits ?? 0) - (l.homeRuns ?? 0), () => 1, RATE_HALF_LIFE);
    const nonHrBases = weightedRate(logs, (l) => (l.totalBases ?? 0) - 4 * (l.homeRuns ?? 0), () => 1, RATE_HALF_LIFE);
    const basesPerHit = clamp(shrink(nonHrBases.num, nonHr.num, LEAGUE_BASES_PER_NON_HR_HIT, PRIOR_NON_HR_HITS), 1, 2);
    platoonFactor = platoon("hits", h.rate);
    parkFactor = ctx.parkHits ?? 1;
    const pHr = hr.rate * platoon("homeRuns", hr.rate) * parkFactor;
    const pNonHr = Math.max(h.rate * platoonFactor * parkFactor - pHr, 0);
    const pDouble = pNonHr * (basesPerHit - 1);
    const pSingle = pNonHr - pDouble;
    distribution = { kind: "pmf", pmf: totalBasesPmf(volume, pSingle, pDouble, pHr) };
    mean = expectedPa * (pSingle + 2 * pDouble + 4 * pHr);
    rate = mean / expectedPa;
    mixWeights = h.weights;
  } else if (stat === "runs" || stat === "rbi" || stat === "hitsRunsRbis") {
    // Teammate-driven: his per-PA rate for the mean, his own game-to-game spread for the shape.
    const parts = stat === "hitsRunsRbis" ? (["hits", "runs", "rbi"] as const) : ([stat] as const);
    const perPa = parts.reduce((a, k) => a + rateOf(k).rate, 0);
    mean = perPa * expectedPa;
    const values = logs.slice(0, 40).map(value);
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(values.length - 1, 1);
    distribution = { kind: "pmf", pmf: nbPmf(mean, mean * Math.max(m > 0 ? v / m : 1, 1)) };
    rate = perPa;
    mixWeights = weights(logs.length, RATE_HALF_LIFE);
  } else {
    const r = rateOf(stat);
    platoonFactor = stat === "stolenBases" || stat === "walks" ? 1 : platoon(stat, r.rate);
    if (stat === "battingStrikeouts" && ctx.starterKRate) matchupFactor = regress(ctx.starterKRate / LEAGUE_PER_PA.battingStrikeouts, MATCHUP_CAP);
    parkFactor = stat === "battingStrikeouts" ? (ctx.parkK ?? 1) : stat === "hits" || stat === "homeRuns" ? (ctx.parkHits ?? 1) : 1;
    rate = clamp(r.rate * platoonFactor * matchupFactor * parkFactor, 0, 0.95);
    distribution = { kind: "pmf", pmf: binomialMixture(volume, rate) };
    mean = rate * expectedPa;
    mixWeights = r.weights;
  }

  return {
    mean,
    volume: expectedPa,
    rate,
    platoonFactor,
    matchupFactor,
    parkFactor,
    games: logs.length,
    seasons: seasonMix(logs, mixWeights, season, value),
    distribution,
  };
}

export function projectPitcher(allLogs: MlbLogPoint[], stat: MlbPitcherStat, ctx: MlbProjectionContext): MlbProjection | null {
  const starts = allLogs.filter((l) => l.isStarter && (l.outsRecorded ?? 0) > 0).slice(0, 40);
  if (starts.length < MIN_STARTS) return null;
  const bf = (l: MlbLogPoint) => (l.outsRecorded ?? 0) + (l.hitsAllowed ?? 0) + (l.walksAllowed ?? 0);
  const bfW = weightedRate(starts.slice(0, 15), bf, () => 1, 5);
  const expectedBf = (bfW.num + 22 * 3) / (bfW.den + 3);
  const bfValues = starts.slice(0, 15).map(bf);
  const bfMean = bfValues.reduce((a, b) => a + b, 0) / bfValues.length;
  const bfSd = Math.max(Math.sqrt(bfValues.reduce((a, b) => a + (b - bfMean) ** 2, 0) / Math.max(bfValues.length - 1, 1)), 3);
  const volume = volumeDist(expectedBf, bfSd);
  const season = ctx.season ?? starts[0].season;
  const w = weights(starts.length, 10);

  let matchupFactor = 1;
  let parkFactor = 1;
  let rate: number | null = null;
  let distribution: StatDistribution;
  let mean: number;
  let value: (l: MlbLogPoint) => number;

  if (stat === "pitcherStrikeouts" || stat === "hitsAllowed" || stat === "walksAllowed") {
    const col = { pitcherStrikeouts: (l: MlbLogPoint) => l.strikeoutsPitching ?? 0, hitsAllowed: (l: MlbLogPoint) => l.hitsAllowed ?? 0, walksAllowed: (l: MlbLogPoint) => l.walksAllowed ?? 0 }[stat];
    value = col;
    const r = weightedRate(starts, col, bf, 12);
    const base = shrink(r.num, r.den, LEAGUE_PER_BF[stat], PRIOR_BF[stat]);
    if (stat === "pitcherStrikeouts" && ctx.opponentKRate) matchupFactor = regress(ctx.opponentKRate / LEAGUE_PER_BF.pitcherStrikeouts, MATCHUP_CAP);
    parkFactor = stat === "pitcherStrikeouts" ? (ctx.parkK ?? 1) : stat === "hitsAllowed" ? (ctx.parkHits ?? 1) : 1;
    rate = clamp(base * matchupFactor * parkFactor, 0, 0.9);
    distribution = { kind: "pmf", pmf: binomialMixture(volume, rate) };
    mean = rate * expectedBf;
  } else {
    value = stat === "outsRecorded" ? (l) => l.outsRecorded ?? 0 : (l) => l.earnedRuns ?? 0;
    const vals = starts.map(value);
    const wsum = w.reduce((a, b) => a + b, 0);
    const m = vals.reduce((a, v, i) => a + v * w[i], 0) / wsum;
    const v = vals.reduce((a, x, i) => a + w[i] * (x - m) ** 2, 0) / wsum;
    // Steadied toward a league-typical start for short histories.
    const prior = stat === "outsRecorded" ? 16 : 2.6;
    mean = (m * starts.length + prior * 3) / (starts.length + 3);
    distribution =
      stat === "outsRecorded"
        ? { kind: "normal", mean, sd: Math.max(Math.sqrt(v), 2.5) }
        : { kind: "pmf", pmf: nbPmf(mean, Math.max(v, mean * 1.2)) };
  }

  return {
    mean,
    volume: expectedBf,
    rate,
    platoonFactor: 1,
    matchupFactor,
    parkFactor,
    games: starts.length,
    seasons: seasonMix(starts, w, season, value),
    distribution,
  };
}

export function projectMlbProp(logs: MlbLogPoint[], stat: MlbPropStat, ctx: MlbProjectionContext): MlbProjection | null {
  return (MLB_PITCHER_STATS as string[]).includes(stat) ? projectPitcher(logs, stat as MlbPitcherStat, ctx) : projectBatter(logs, stat as MlbBatterStat, ctx);
}

/** Pulls MLB prop probabilities toward 50% until `npm run backtest:mlb-props` refits it. */
export const MLB_CALIBRATION_SHRINK = 0.85;

/**
 * Per-stat calibration: the baked 0.85 × each stat's held-out refit from
 * `npm run backtest:mlb-props` (2026 season, ~44K batter games / ~2.6K starts).
 * Above 1 the model was too timid (pitcher strikeouts, total bases), below 1
 * too sure of itself (earned runs). Stats the backtest doesn't cover keep 0.85.
 */
export const MLB_CALIBRATION_BY_STAT: Partial<Record<MlbPropStat, number>> = {
  hits: 0.81,
  totalBases: 1.15,
  homeRuns: 1.02,
  battingStrikeouts: 0.94,
  hitsRunsRbis: 1.1,
  pitcherStrikeouts: 1.28,
  outsRecorded: 0.81,
  hitsAllowed: 0.81,
  earnedRuns: 0.55,
};
