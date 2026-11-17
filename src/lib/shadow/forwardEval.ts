/**
 * Forward validation for the NBA props shadow model (docs/model-improvement-plan.md).
 * Pure; scripts/eval-shadow.ts feeds it the shadow predictions frozen before tip
 * (ModelPrediction, modelKey SHADOW_MODELS.nbaProps) and their settlements.
 *
 * Every forecaster is scored on the SAME rows: each NBA prop's main line, the
 * chance of the Over, frozen at capture. The sportsbook's no-vig chance at
 * capture is the baseline everything is judged against.
 *
 * Pre-registered (fixed before the first forward game was read):
 *   - primary: log loss of the Over chance, shadow s2 vs the books' no-vig
 *     chance, on all main-line props from FORWARD_START, game-cluster
 *     bootstrap 95% interval; read once at least DECISION_GAMES games have
 *     settled (interim reads are labeled interim);
 *   - secondary: Brier, calibration (ECE), each production number and s1 the
 *     same way; whether a forecaster adds information beyond the books
 *     (offset logistic, and a chronological first-half → second-half test);
 *     the realized ROI and closing-line value of one fixed rule (bet the side
 *     with positive expected value at the captured price);
 *   - nothing here picks bets: a positive interval says the forecaster is
 *     better calibrated or informative, not that a betting rule is profitable.
 * Rows from one game are correlated (same minutes, same pace, same script),
 * so every interval resamples whole games.
 */
import { BOOT, bootstrapCoef, calibration, decimalOf, logisticWithOffset, logit, rng, sigmoid, type CalibrationBin } from "@/lib/audit/performance";
import { chronoFactorTest, type ChronoResult } from "@/lib/audit/plusMoney";

/** The first ET game date the shadow is judged on (props captured before tip from this date on). */
export const FORWARD_START = "2026-11-17";
/** Settled games before the primary comparison is read as a result rather than an interim look. */
export const DECISION_GAMES = 250;

/** The forecasters every row carries (chance of the Over at the main line). */
export const FORECASTERS = ["market", "prodRaw", "prodModel", "prodBlend", "prodShown", "s1", "s2"] as const;
export type Forecaster = (typeof FORECASTERS)[number];

export interface ForwardRow {
  /** The game (resampling unit). */
  cluster: string;
  /** ET date of the game. */
  day: string;
  stat: string;
  combo: boolean;
  /** The Over came in (pushes and voids are left out before here). */
  y: 0 | 1;
  /** Each forecaster's chance of the Over; market null when no two-sided quote was captured. */
  p: Record<Forecaster, number | null>;
  /** Best prices on each side at capture. */
  overPrice: number | null;
  underPrice: number | null;
  /** The books' no-vig chance of the Over at the last quote before tip (closing-line value). */
  closeOver: number | null;
  /** Production's distance from the line, toward its side (|z|). */
  absZ: number | null;
}

const clip = (p: number) => Math.min(Math.max(p, 1e-6), 1 - 1e-6);
const ll = (p: number, y: number) => -(y * Math.log(clip(p)) + (1 - y) * Math.log(1 - clip(p)));
const br = (p: number, y: number) => (p - y) ** 2;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export interface Score {
  n: number;
  games: number;
  brier: number | null;
  logloss: number | null;
  /** Expected calibration error over ten bins (|said − happened| weighted by count). */
  ece: number | null;
  bins: CalibrationBin[];
}

/** One forecaster's proper scores and reliability on the rows it priced. */
export function scoreOf(rows: ForwardRow[], f: Forecaster): Score {
  const r = rows.filter((x) => x.p[f] !== null);
  const bins = calibration(
    r.map((x) => ({ p: x.p[f]!, won: x.y })),
    [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
  );
  const ece = r.length ? bins.reduce((a, b) => a + (b.n / r.length) * Math.abs(b.meanP - b.actual), 0) : null;
  return {
    n: r.length,
    games: new Set(r.map((x) => x.cluster)).size,
    brier: r.length ? mean(r.map((x) => br(x.p[f]!, x.y))) : null,
    logloss: r.length ? mean(r.map((x) => ll(x.p[f]!, x.y))) : null,
    ece,
    bins,
  };
}

/** A mean and its game-cluster bootstrap interval. */
export interface Interval {
  n: number;
  games: number;
  est: number | null;
  lo: number | null;
  hi: number | null;
}

/** Mean of a per-row value with a game-cluster bootstrap 95% interval. */
export function clusterMean<R extends { cluster: string }>(rows: R[], value: (r: R) => number, seed = 31, boot = 1000): Interval {
  const byGame = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const g = byGame.get(r.cluster) ?? byGame.set(r.cluster, { s: 0, n: 0 }).get(r.cluster)!;
    g.s += value(r);
    g.n++;
  }
  const games = [...byGame.values()];
  const est = rows.length ? games.reduce((a, g) => a + g.s, 0) / rows.length : null;
  const next = rng(seed);
  const draws: number[] = [];
  for (let b = 0; b < boot && games.length >= 2; b++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < games.length; i++) {
      const g = games[Math.floor(next() * games.length)]!;
      s += g.s;
      n += g.n;
    }
    draws.push(s / n);
  }
  draws.sort((a, z) => a - z);
  return {
    n: rows.length,
    games: games.length,
    est,
    lo: draws.length ? draws[Math.floor(0.025 * draws.length)]! : null,
    hi: draws.length ? draws[Math.min(draws.length - 1, Math.floor(0.975 * draws.length))]! : null,
  };
}

/**
 * How much better `a` scores than `b` on the rows both priced: b's loss minus
 * a's, per prop (> 0: a is better), with its game-cluster interval.
 */
export function lossGain(rows: ForwardRow[], a: Forecaster, b: Forecaster, loss: "logloss" | "brier" = "logloss"): Interval {
  const fn = loss === "logloss" ? ll : br;
  const both = rows.filter((r) => r.p[a] !== null && r.p[b] !== null);
  return clusterMean(both, (r) => fn(r.p[b]!, r.y) - fn(r.p[a]!, r.y));
}

export interface Independence {
  /**
   * Over ~ offset(logit books) + b·(logit forecaster − logit books): b = 0 means
   * nothing beyond the books, b = 1 means the forecaster's own number is right,
   * in between means a blend would beat both. Game-cluster interval.
   */
  weight: { est: number | null; lo: number | null; hi: number | null; p: number | null };
  /** The same fit on the earlier half of the days, scored on the later half: does it help on games it never saw? */
  chrono: ChronoResult;
}

export function independence(rows: ForwardRow[], f: Forecaster): Independence {
  const r = rows
    .filter((x) => x.p[f] !== null && x.p.market !== null)
    .map((x) => ({ cluster: x.cluster, day: x.day, y: x.y, market: x.p.market!, x: logit(x.p[f]!) - logit(x.p.market!) }));
  const fit = (rs: typeof r) => logisticWithOffset(rs.map((x) => ({ y: x.y, offset: logit(x.market), x: [x.x] })))?.[0] ?? null;
  const days = [...new Set(r.map((x) => x.day))].sort();
  const cut = days[Math.floor(days.length / 2)];
  const factor = (x: (typeof r)[number]) => ({ cluster: x.cluster, won: x.y, market: x.market, x: [x.x] });
  return {
    weight: bootstrapCoef(r, fit, 11, BOOT),
    chrono: chronoFactorTest(r.filter((x) => x.day < cut).map(factor), r.filter((x) => x.day >= cut).map(factor)),
  };
}

export interface RuleResult {
  bets: number;
  games: number;
  overs: number;
  /** Profit per unit staked at the captured prices, with its game-cluster interval. */
  roi: Interval;
  /** The bet side's closing no-vig chance minus its no-vig chance at capture (> 0: the market moved toward the bet). */
  clv: Interval;
}

/**
 * The one fixed rule: bet the side with the larger positive expected value at
 * the captured best price, flat stakes, when the forecaster's EV > minEv. A
 * measurement of the forecaster, not a recommended strategy.
 */
export function evRule(rows: ForwardRow[], f: Forecaster, minEv = 0): RuleResult {
  const bets = rows.flatMap((r) => {
    const p = r.p[f];
    if (p === null || r.overPrice === null || r.underPrice === null) return [];
    const evOver = p * decimalOf(r.overPrice) - 1;
    const evUnder = (1 - p) * decimalOf(r.underPrice) - 1;
    const over = evOver >= evUnder;
    const ev = over ? evOver : evUnder;
    if (!(ev > minEv)) return [];
    const won = over ? r.y === 1 : r.y === 0;
    const profit = won ? decimalOf(over ? r.overPrice : r.underPrice) - 1 : -1;
    const at = r.p.market;
    const clv = at !== null && r.closeOver !== null ? (over ? r.closeOver - at : at - r.closeOver) : null;
    return [{ cluster: r.cluster, over, profit, clv }];
  });
  const withClv = bets.filter((b) => b.clv !== null);
  return {
    bets: bets.length,
    games: new Set(bets.map((b) => b.cluster)).size,
    overs: bets.filter((b) => b.over).length,
    roi: clusterMean(bets, (b) => b.profit),
    clv: clusterMean(withClv, (b) => b.clv!),
  };
}

/** Plain-words read of a gain interval; never a betting call. */
export function readGain(g: Interval, games: number): string {
  if (g.est === null || g.lo === null || g.hi === null) return "no data";
  const stage = games >= DECISION_GAMES ? "decision" : `interim (${games} of ${DECISION_GAMES} games)`;
  if (g.lo > 0) return `${stage}: better than the books, interval above zero`;
  if (g.hi < 0) return `${stage}: worse than the books, interval below zero`;
  return `${stage}: not distinguishable from the books`;
}

export { sigmoid };
