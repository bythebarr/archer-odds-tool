/**
 * The historical performance audit (scripts/audit-performance.ts): every
 * settled lean scored the ways a betting record has to be read before anyone
 * calls it an edge. Pure.
 *
 * For a segment of rows: settled count, win rate, ARCHR's average chance and
 * the gap, flat-stake ROI at the recorded price, average odds, Brier and log
 * loss for ARCHR AND for the books' no-vig chance on the same rows (skill =
 * books' Brier − ARCHR's: above 0, ARCHR was closer), and closing-line value.
 *
 * Intervals are CLUSTER bootstraps by game: a player's points, rebounds and
 * PRA on one night (and teammates' props) move together, so resampling single
 * rows would make every interval too narrow. A seeded generator keeps every
 * run reproducible.
 */

export interface PerfRow {
  /** The game: the bootstrap's cluster. */
  cluster: string;
  won: 0 | 1;
  /** ARCHR's chance on the side, as recorded before the game. */
  p: number;
  /** The books' no-vig chance on the side at capture; null without a two-sided market. */
  market: number | null;
  /** The recorded price (American); null when only a number was posted. */
  price: number | null;
  /** The books' no-vig chance on the side at the close; null without closing quotes. */
  close: number | null;
  /** The slate day (ET date), for counting independent days. */
  day?: string;
}

const EPS = 1e-6;
const clip = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));
export const decimalOf = (american: number) => (american > 0 ? 1 + american / 100 : 1 + 100 / -american);
export const impliedOf = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));
const logLoss = (p: number, y: number) => -(y * Math.log(clip(p)) + (1 - y) * Math.log(1 - clip(p)));

/** Mulberry32: a small seeded generator, so the bootstrap is the same every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-game sums: the bootstrap resamples games, so it only ever adds these up. */
interface Sums {
  n: number;
  wins: number;
  p: number;
  brier: number;
  ll: number;
  pricedN: number;
  profit: number;
  dec: number;
  mktN: number;
  mktBrier: number;
  mktLl: number;
  archrBrierOnMkt: number;
  archrLlOnMkt: number;
  resid: number;
  clvN: number;
  clv: number;
  beat: number;
  worse: number;
  /** Sums for the averages: the no-vig chance, the price's break-even chance, ARCHR's expected value at the price. */
  mktP: number;
  be: number;
  ev: number;
}

const zero = (): Sums => ({ n: 0, wins: 0, p: 0, brier: 0, ll: 0, pricedN: 0, profit: 0, dec: 0, mktN: 0, mktBrier: 0, mktLl: 0, archrBrierOnMkt: 0, archrLlOnMkt: 0, resid: 0, clvN: 0, clv: 0, beat: 0, worse: 0, mktP: 0, be: 0, ev: 0 });

function add(s: Sums, r: PerfRow) {
  s.n++;
  s.wins += r.won;
  s.p += r.p;
  s.brier += (r.p - r.won) ** 2;
  s.ll += logLoss(r.p, r.won);
  if (r.price !== null) {
    s.pricedN++;
    s.profit += r.won ? decimalOf(r.price) - 1 : -1;
    s.dec += decimalOf(r.price);
    s.be += 1 / decimalOf(r.price);
    s.ev += r.p * decimalOf(r.price) - 1;
  }
  if (r.market !== null) {
    s.mktN++;
    s.mktP += r.market;
    s.mktBrier += (r.market - r.won) ** 2;
    s.mktLl += logLoss(r.market, r.won);
    s.archrBrierOnMkt += (r.p - r.won) ** 2;
    s.archrLlOnMkt += logLoss(r.p, r.won);
    s.resid += r.won - r.market;
    if (r.close !== null) {
      s.clvN++;
      s.clv += r.close - r.market;
      if (r.close > r.market + 1e-9) s.beat++;
      else if (r.close < r.market - 1e-9) s.worse++;
    }
  }
}

function merge(into: Sums, s: Sums, times = 1) {
  for (const k of Object.keys(into) as (keyof Sums)[]) into[k] += s[k] * times;
}

export interface SegmentPerf {
  n: number;
  wins: number;
  winRate: number | null;
  winLo: number | null;
  winHi: number | null;
  /** ARCHR's average chance, and actual minus that (+: won more than ARCHR said). */
  avgP: number | null;
  gap: number | null;
  priced: number;
  roi: number | null;
  roiLo: number | null;
  roiHi: number | null;
  /** Average decimal odds of the priced rows, and the same as American. */
  avgDecimal: number | null;
  avgAmerican: number | null;
  brier: number | null;
  logLoss: number | null;
  /** On the rows with a no-vig market: the books' Brier and log loss, and the skill (books − ARCHR, Brier ×1000). */
  withMarket: number;
  mktBrier: number | null;
  mktLogLoss: number | null;
  skill: number | null;
  skillLo: number | null;
  skillHi: number | null;
  /** Mean of won − market no-vig chance: what the side earned over the books' own read (+: beat the books). */
  overMarket: number | null;
  overMarketLo: number | null;
  overMarketHi: number | null;
  /** Mean move of the no-vig chance toward the side from capture to close (probability points), its count, share beating the close. */
  clv: number | null;
  clvN: number;
  beatClose: number | null;
  /** Share of closing lines that moved against the pick; the rest didn't move. */
  worseClose: number | null;
  games: number;
  /** Distinct slate days (where rows carry `day`). */
  days: number;
  /** The books' average no-vig chance on these picks (rows with a market). */
  avgMarket: number | null;
  /** The average break-even chance at the offered price (1 / decimal odds). */
  avgBreakEven: number | null;
  /** ARCHR's own expected value at the price, averaged (p × decimal − 1). */
  archrEv: number | null;
  flag: "too few" | "small sample" | null;
}

const ratio = (a: number, b: number) => (b ? a / b : null);
const americanOfDecimal = (d: number) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));

function quantile(xs: number[], q: number): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  return v[lo]! + (v[Math.min(lo + 1, v.length - 1)]! - v[lo]!) * (i - lo);
}

/** Below these, a segment is flagged. */
export const TOO_FEW = 30;
export const SMALL = 200;
export const BOOT = 400;

export function segmentPerf(rows: PerfRow[], seed = 7, boot = BOOT): SegmentPerf {
  const byGame = new Map<string, Sums>();
  for (const r of rows) add(byGame.get(r.cluster) ?? byGame.set(r.cluster, zero()).get(r.cluster)!, r);
  const games = [...byGame.values()];
  const t = zero();
  for (const g of games) merge(t, g);

  const draws: { win: number[]; roi: number[]; skill: number[]; over: number[] } = { win: [], roi: [], skill: [], over: [] };
  if (games.length >= 2) {
    const next = rng(seed);
    for (let b = 0; b < boot; b++) {
      const s = zero();
      for (let i = 0; i < games.length; i++) merge(s, games[Math.floor(next() * games.length)]!);
      if (s.n) draws.win.push(s.wins / s.n);
      if (s.pricedN) draws.roi.push(s.profit / s.pricedN);
      if (s.mktN) {
        draws.skill.push(((s.mktBrier - s.archrBrierOnMkt) / s.mktN) * 1000);
        draws.over.push(s.resid / s.mktN);
      }
    }
  }
  const avgDecimal = ratio(t.dec, t.pricedN);
  return {
    n: t.n,
    wins: t.wins,
    winRate: ratio(t.wins, t.n),
    winLo: quantile(draws.win, 0.025),
    winHi: quantile(draws.win, 0.975),
    avgP: ratio(t.p, t.n),
    gap: t.n ? t.wins / t.n - t.p / t.n : null,
    priced: t.pricedN,
    roi: ratio(t.profit, t.pricedN),
    roiLo: quantile(draws.roi, 0.025),
    roiHi: quantile(draws.roi, 0.975),
    avgDecimal,
    avgAmerican: avgDecimal === null ? null : americanOfDecimal(avgDecimal),
    brier: ratio(t.brier, t.n),
    logLoss: ratio(t.ll, t.n),
    withMarket: t.mktN,
    mktBrier: ratio(t.mktBrier, t.mktN),
    mktLogLoss: ratio(t.mktLl, t.mktN),
    skill: t.mktN ? ((t.mktBrier - t.archrBrierOnMkt) / t.mktN) * 1000 : null,
    skillLo: quantile(draws.skill, 0.025),
    skillHi: quantile(draws.skill, 0.975),
    overMarket: ratio(t.resid, t.mktN),
    overMarketLo: quantile(draws.over, 0.025),
    overMarketHi: quantile(draws.over, 0.975),
    clv: ratio(t.clv, t.clvN),
    clvN: t.clvN,
    beatClose: ratio(t.beat, t.clvN),
    worseClose: ratio(t.worse, t.clvN),
    games: games.length,
    days: new Set(rows.map((r) => r.day).filter(Boolean)).size,
    avgMarket: ratio(t.mktP, t.mktN),
    avgBreakEven: ratio(t.be, t.pricedN),
    archrEv: ratio(t.ev, t.pricedN),
    flag: t.n < TOO_FEW ? "too few" : t.n < SMALL ? "small sample" : null,
  };
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  meanP: number;
  actual: number;
}

/** Reliability: rows grouped by the chance given (ARCHR's or the books'), mean chance vs how often they won. */
export function calibration(rows: { p: number; won: 0 | 1 }[], edges: number[]): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const bin = rows.filter((r) => r.p >= lo && (i === edges.length - 2 ? r.p <= hi : r.p < hi));
    if (bin.length) out.push({ lo, hi, n: bin.length, meanP: bin.reduce((a, r) => a + r.p, 0) / bin.length, actual: bin.reduce((a, r) => a + r.won, 0) / bin.length });
  }
  return out;
}

const logit = (p: number) => Math.log(clip(p) / (1 - clip(p)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Logistic regression with an offset, by Newton–Raphson: won ~ offset + Σ b·x.
 * The offset is a chance already known (the books', or ARCHR's), so each b
 * reads as "what this adds beyond it". Returns null when it fails to converge.
 */
export function logisticWithOffset(rows: { y: 0 | 1; offset: number; x: number[] }[], iters = 50): number[] | null {
  const k = rows[0]?.x.length ?? 0;
  if (!rows.length || !k) return null;
  let b = new Array<number>(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array<number>(k).fill(0);
    const H = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (const r of rows) {
      const eta = r.offset + r.x.reduce((a, xi, i) => a + xi * b[i]!, 0);
      const mu = sigmoid(eta);
      const w = mu * (1 - mu);
      for (let i = 0; i < k; i++) {
        g[i]! += (r.y - mu) * r.x[i]!;
        for (let j = 0; j < k; j++) H[i]![j]! += w * r.x[i]! * r.x[j]!;
      }
    }
    // Solve H·d = g (small k: Gaussian elimination with a ridge for stability).
    const A = H.map((row, i) => [...row.map((v, j) => v + (i === j ? 1e-9 : 0)), g[i]!]);
    for (let c = 0; c < k; c++) {
      let piv = c;
      for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
      [A[c], A[piv]] = [A[piv]!, A[c]!];
      if (Math.abs(A[c]![c]!) < 1e-12) return null;
      for (let r = 0; r < k; r++) {
        if (r === c) continue;
        const f = A[r]![c]! / A[c]![c]!;
        for (let j = c; j <= k; j++) A[r]![j]! -= f * A[c]![j]!;
      }
    }
    const d = A.map((row, i) => row[k]! / row[i]!);
    b = b.map((bi, i) => bi + d[i]!);
    if (d.every((x) => Math.abs(x) < 1e-8)) return b;
  }
  return b;
}

/** A coefficient's cluster-bootstrap 95% interval (resampling games). */
export function bootstrapCoef<R extends { cluster: string }>(rows: R[], fit: (rows: R[]) => number | null, seed = 11, boot = 200): { est: number | null; lo: number | null; hi: number | null; p: number | null } {
  const est = fit(rows);
  const byGame = new Map<string, R[]>();
  for (const r of rows) (byGame.get(r.cluster) ?? byGame.set(r.cluster, []).get(r.cluster)!).push(r);
  const games = [...byGame.values()];
  const next = rng(seed);
  const draws: number[] = [];
  for (let b = 0; b < boot && games.length >= 2; b++) {
    const sample: R[] = [];
    for (let i = 0; i < games.length; i++) sample.push(...games[Math.floor(next() * games.length)]!);
    const v = fit(sample);
    if (v !== null && Number.isFinite(v)) draws.push(v);
  }
  // Two-sided bootstrap p: how often the resampled coefficient lands on the other side of zero, doubled.
  const p = draws.length ? Math.min(1, (2 * Math.min(draws.filter((d) => d <= 0).length, draws.filter((d) => d >= 0).length) + 1) / (draws.length + 1)) : null;
  return { est, lo: quantile(draws, 0.025), hi: quantile(draws, 0.975), p };
}

/** Benjamini–Hochberg: which of these p-values survive a false-discovery rate of q (same order as given). */
export function benjaminiHochberg(ps: (number | null)[], q = 0.1): boolean[] {
  const idx = ps.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p !== null).sort((a, b) => a.p - b.p);
  const m = idx.length;
  let cut = -1;
  idx.forEach((x, k) => {
    if (x.p <= ((k + 1) / m) * q) cut = k;
  });
  const keep = new Set(idx.slice(0, cut + 1).map((x) => x.i));
  return ps.map((_, i) => keep.has(i));
}

export { logit, sigmoid };
