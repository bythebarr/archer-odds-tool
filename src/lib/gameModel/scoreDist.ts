/**
 * From an expected score to the chance of every bet on the game: the final
 * margin and total as discrete distributions over whole points.
 *
 * Both are normal around the expectation with the league's spread (refit by
 * the games backtest). Football margins aren't smooth — 3 and 7 come up far
 * more than a normal says, because scoring comes in field goals and
 * touchdowns — so the NFL margin is reweighted toward its key numbers from
 * the league's historical frequencies. A push (a whole-number line landing
 * exactly) refunds, so each side's chance is conditional on no push.
 */
export interface ScoreDist {
  /** P(margin = m), home minus away, over whole points. */
  margin: Map<number, number>;
  /** P(total = t). */
  total: Map<number, number>;
}

/** |margin| → how often it lands, historically; others follow the normal. */
export type KeyNumbers = Record<number, number>;

const RANGE_SDS = 5;

function normalPmf(mean: number, sd: number, k: number): number {
  // Mass of [k − 0.5, k + 0.5].
  const cdf = (x: number) => 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
  return cdf(k + 0.5) - cdf(k - 0.5);
}

/** Abramowitz–Stegun 7.1.26. */
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/**
 * Key-number weights: how much more (or less) often each |margin| lands than a
 * zero-centered normal with this sd says. Applied as multipliers on the
 * normal at any expected margin, then renormalized.
 */
export function keyWeights(keys: KeyNumbers, sd: number): Map<number, number> {
  const w = new Map<number, number>();
  for (const [kStr, freq] of Object.entries(keys)) {
    const k = Number(kStr);
    const normal = k === 0 ? normalPmf(0, sd, 0) : 2 * normalPmf(0, sd, k);
    w.set(k, freq / normal);
  }
  return w;
}

export function scoreDist(
  expected: { home: number; away: number },
  marginSd: number,
  totalSd: number,
  weights?: Map<number, number>,
  /** Leagues without ties (NBA): a regulation tie goes to overtime, settled by a few points either way. */
  ties = true
): ScoreDist {
  const mean = expected.home - expected.away;
  const margin = new Map<number, number>();
  let sum = 0;
  const lo = Math.floor(mean - RANGE_SDS * marginSd);
  const hi = Math.ceil(mean + RANGE_SDS * marginSd);
  for (let m = lo; m <= hi; m++) {
    const p = normalPmf(mean, marginSd, m) * (weights?.get(Math.abs(m)) ?? 1);
    margin.set(m, p);
    sum += p;
  }
  if (!ties && margin.has(0)) {
    // Overtime: the tie's mass splits evenly to margins of 1–5 each way.
    const share = margin.get(0)! / 10;
    margin.delete(0);
    for (let k = 1; k <= 5; k++) {
      margin.set(k, (margin.get(k) ?? 0) + share);
      margin.set(-k, (margin.get(-k) ?? 0) + share);
    }
  }
  for (const [m, p] of margin) margin.set(m, p / sum);

  const tMean = expected.home + expected.away;
  const total = new Map<number, number>();
  let tSum = 0;
  for (let t = Math.max(0, Math.floor(tMean - RANGE_SDS * totalSd)); t <= Math.ceil(tMean + RANGE_SDS * totalSd); t++) {
    const p = normalPmf(tMean, totalSd, t);
    total.set(t, p);
    tSum += p;
  }
  for (const [t, p] of total) total.set(t, p / tSum);
  return { margin, total };
}

/** Win / lose / push mass of "x + line > 0" over a distribution. */
function split(dist: Map<number, number>, wins: (x: number) => number): { win: number; push: number } {
  let win = 0;
  let push = 0;
  for (const [x, p] of dist) {
    const r = wins(x);
    if (r > 0) win += p;
    else if (r === 0) push += p;
  }
  return { win, push };
}

const conditional = ({ win, push }: { win: number; push: number }) => (push >= 1 ? 0.5 : win / (1 - push));

/** P(home wins), ties refunded. */
export function pHomeWin(d: ScoreDist): number {
  return conditional(split(d.margin, (m) => m));
}

/** P(home covers `homeSpread`), e.g. −3.5; pushes refunded. */
export function pHomeCover(d: ScoreDist, homeSpread: number): number {
  return conditional(split(d.margin, (m) => m + homeSpread));
}

/** P(the game goes over `line`); pushes refunded. */
export function pOver(d: ScoreDist, line: number): number {
  return conditional(split(d.total, (t) => t - line));
}

/** The median of a whole-point distribution, read continuously (each point spread over ±0.5). */
function median(dist: Map<number, number>): number {
  let cum = 0;
  for (const x of [...dist.keys()].sort((a, b) => a - b)) {
    const p = dist.get(x)!;
    if (cum + p >= 0.5) return x - 0.5 + (0.5 - cum) / p;
    cum += p;
  }
  return 0;
}

/** The model's fair spread for the home side: minus its median margin (negative = home favored). */
export function fairSpread(d: ScoreDist): number {
  return -median(d.margin);
}

/** The model's fair total: the median total. */
export function fairTotal(d: ScoreDist): number {
  return median(d.total);
}
