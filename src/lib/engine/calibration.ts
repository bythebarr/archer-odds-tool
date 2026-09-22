/**
 * Sport-agnostic calibration metrics — the trust harness for the engine's
 * pricing models (Phase 4a). A model's `modelEv` is only as good as its
 * probabilities: if it says "60%" but that bucket wins 52% of the time, every
 * EV computed off it is inflated. This module measures that gap the same way for
 * every sport, so MLB's Archer model, UFC's fighter-math, and any future model
 * all clear one bar before the board trusts them.
 *
 * These are pure functions over `CalibrationSample`s — no prisma, no I/O — so
 * they unit-test cleanly and run in any context. The per-sport job of turning
 * settled history into lookahead-safe samples lives on each model's
 * `ModelBacktest` (see engine/types.ts); this module only scores the samples.
 *
 * The math is lifted from scripts/backtest-ufc-calibration.ts (the working
 * prototype) and generalized: Brier + reliability buckets + a time-split
 * logit-shrink refit, plus a base-rate (no-skill) benchmark and log-loss.
 */

/** log-odds of a probability. */
export const logit = (p: number) => Math.log(p / (1 - p));
/** inverse of `logit` — squashes a log-odds back to (0, 1). */
export const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * One backtested prediction: the model's probability for a binary outcome, and
 * whether that outcome actually happened. `pred` is the probability of the side
 * the sample is measuring (a model favorite, a specific moneyline pick, an
 * over) — the harness never assumes which; it only asks "how often does what you
 * called `pred` come true?".
 */
export interface CalibrationSample {
  /** Model probability in (0, 1) for the measured outcome. */
  pred: number;
  /** 1 if that outcome occurred, 0 otherwise. */
  won: 0 | 1;
}

/** Guard: probabilities must be strictly inside (0, 1) or logit/logLoss blow up. */
const EPS = 1e-6;
const clamp01 = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

/**
 * Apply an extra logit-shrink toward 0.5 (shrink < 1 pulls probabilities toward
 * the coin flip; 1 = identity). The refit uses this to find how much *additional*
 * shrink a model needs on top of whatever it already bakes in.
 */
export function shrinkProb(p: number, shrink: number): number {
  if (shrink === 1) return p;
  return logistic(shrink * logit(clamp01(p)));
}

/**
 * Mean squared error of the probabilities against outcomes — the Brier score.
 * 0 = perfect, and for a binary outcome 0.25 is the "always guess 50%" line.
 * The honest benchmark is `baseRateBrier` (below), not a flat 0.25.
 */
export function brier(samples: CalibrationSample[], shrink = 1): number {
  if (!samples.length) return NaN;
  return (
    samples.reduce((s, r) => s + (shrinkProb(r.pred, shrink) - r.won) ** 2, 0) /
    samples.length
  );
}

/**
 * Mean log-loss (cross-entropy). More sensitive than Brier to confident-and-wrong
 * predictions — a model that says 95% and loses is punished far harder here — so
 * it's the better tripwire for overconfidence. Lower is better.
 */
export function logLoss(samples: CalibrationSample[], shrink = 1): number {
  if (!samples.length) return NaN;
  return (
    -samples.reduce((s, r) => {
      const p = clamp01(shrinkProb(r.pred, shrink));
      return s + (r.won ? Math.log(p) : Math.log(1 - p));
    }, 0) / samples.length
  );
}

/**
 * The no-skill benchmark: the Brier you'd get by ignoring the model and always
 * predicting the sample's own base rate. Equals p̄(1 − p̄). A model only has real
 * skill if its Brier beats THIS — comparing to a flat 0.25 flatters any model
 * whose outcomes aren't 50/50 (favorites-only samples included).
 */
export function baseRateBrier(samples: CalibrationSample[]): number {
  if (!samples.length) return NaN;
  const pbar = samples.reduce((s, r) => s + r.won, 0) / samples.length;
  return pbar * (1 - pbar);
}

/** One row of a reliability curve: a probability bin and how it actually did. */
export interface ReliabilityBucket {
  lo: number;
  hi: number;
  n: number;
  /** Mean predicted probability in the bin, as a fraction. */
  meanPred: number;
  /** Actual outcome rate in the bin, as a fraction. */
  actual: number;
  /** actual − meanPred: positive = model underconfident, negative = overconfident. */
  gap: number;
}

/**
 * Bin samples by predicted probability and report predicted-vs-actual per bin —
 * the reliability curve in table form. Default edges cover a favorites-style
 * 50–80% spread (the UFC prototype's bins); pass your own for two-sided models
 * (e.g. MLB moneyline, which spans both underdogs and favorites).
 */
export function reliabilityBuckets(
  samples: CalibrationSample[],
  edges: number[] = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 1.0001]
): ReliabilityBucket[] {
  const out: ReliabilityBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const bk = samples.filter((r) => r.pred >= lo && r.pred < hi);
    if (!bk.length) continue;
    const meanPred = bk.reduce((s, r) => s + r.pred, 0) / bk.length;
    const actual = bk.reduce((s, r) => s + r.won, 0) / bk.length;
    out.push({ lo, hi, n: bk.length, meanPred, actual, gap: actual - meanPred });
  }
  return out;
}

/**
 * Scan logit-shrink values and return the one that minimizes Brier on the given
 * samples. Used against a training split to find how much a model is mis-scaled;
 * a best-shrink near 1.0 means the model's baked calibration still holds, far
 * below 1.0 means it's overconfident and its shrink constant should be retuned.
 */
export function bestShrink(
  samples: CalibrationSample[],
  { min = 0.05, max = 1.5, step = 0.05 } = {}
): number {
  let best = 1;
  let bestB = Infinity;
  for (let s = min; s <= max + step / 2; s += step) {
    const b = brier(samples, s);
    if (b < bestB) {
      bestB = b;
      best = s;
    }
  }
  return best;
}

/** Result of a time-split refit check. */
export interface RefitResult {
  trainN: number;
  testN: number;
  /** Extra shrink fit on the (older) training split. Near 1.0 = baked value good. */
  bestShrink: number;
  /** Held-out Brier with the model as-is vs. with the extra shrink applied. */
  testBrierAsIs: number;
  testBrierShrunk: number;
}

/**
 * Honest overfitting-safe calibration check. Given samples ordered NEWEST FIRST,
 * fit the best extra shrink on the OLDER training portion and score it on the
 * held-out NEWER test portion. If the refit shrink is near 1.0 and the test
 * Brier barely moves, the model's baked calibration is holding on fresh data; a
 * refit far from 1.0 that meaningfully lowers test Brier is the signal to retune.
 */
export function timeSplitRefit(
  samplesNewestFirst: CalibrationSample[],
  testFraction = 0.4
): RefitResult {
  const testN = Math.floor(samplesNewestFirst.length * testFraction);
  const test = samplesNewestFirst.slice(0, testN);
  const train = samplesNewestFirst.slice(testN);
  const shrink = bestShrink(train);
  return {
    trainN: train.length,
    testN: test.length,
    bestShrink: shrink,
    testBrierAsIs: brier(test),
    testBrierShrunk: brier(test, shrink),
  };
}

/**
 * A model's calibration verdict — the trust gate the board/Discord reads.
 *
 * Skill is `brier − baseRateBrier` (negative = better than a no-skill guess).
 * The tiers are deliberately three-way because near-coin-flip sports (both UFC
 * and MLB sit within a hair of no-skill) shouldn't fall on opposite sides of a
 * razor-thin line:
 *   - `trusted`    — clearly beats no-skill; a real (if thin) demonstrated edge.
 *   - `marginal`   — within noise of no-skill: calibrated enough to SHOW on the
 *                    board, not enough to lean paid stakes on. Honest middle.
 *   - `unproven`   — clearly worse than no-skill (overconfident / miscalibrated);
 *                    must not price the card.
 *   - `thin`       — too few settled events to judge yet.
 *
 * Note "unproven" ≠ "miscalibrated per se" — a model can be perfectly calibrated
 * yet edgeless; both fail the "trust it to find EV" bar, which is what the gate asks.
 */
export type CalibrationVerdict = "trusted" | "marginal" | "unproven" | "thin";

export interface CalibrationReport {
  n: number;
  /** Mean predicted probability across all samples, as a fraction. */
  meanPred: number;
  /** Actual outcome rate across all samples, as a fraction. */
  actual: number;
  brier: number;
  logLoss: number;
  /** The no-skill benchmark this model must beat to earn trust. */
  baseRateBrier: number;
  /** brier − baseRateBrier: negative = real skill; the smaller, the better. */
  skill: number;
  buckets: ReliabilityBucket[];
  refit: RefitResult;
  verdict: CalibrationVerdict;
}

/** Default `trustMargin` for scoreCalibration — exported so callers that need this exact bar outside a calibration verdict (e.g. a before/after backtest's own ship/no-ship gate) can reuse it instead of restating the number. */
export const DEFAULT_TRUST_MARGIN = 0.002;

/**
 * Score a full set of samples into a report card. `minSample` is the floor below
 * which we refuse to render a verdict (default 100 — the UFC/MLB backtests run in
 * the high hundreds). `trustMargin` (default 0.002) is the skill gap, in Brier
 * points, a model must clear on either side of no-skill: better than −margin earns
 * `trusted`, worse than +margin is `unproven`, and the band between the two is the
 * honest `marginal` middle where near-coin-flip models (today's MLB & UFC) land.
 */
export function scoreCalibration(
  samplesNewestFirst: CalibrationSample[],
  { minSample = 100, trustMargin = DEFAULT_TRUST_MARGIN } = {}
): CalibrationReport {
  const n = samplesNewestFirst.length;
  const b = brier(samplesNewestFirst);
  const base = baseRateBrier(samplesNewestFirst);
  const meanPred = n ? samplesNewestFirst.reduce((s, r) => s + r.pred, 0) / n : NaN;
  const actual = n ? samplesNewestFirst.reduce((s, r) => s + r.won, 0) / n : NaN;
  const skill = b - base;
  const verdict: CalibrationVerdict =
    n < minSample
      ? "thin"
      : skill <= -trustMargin
        ? "trusted"
        : skill < trustMargin
          ? "marginal"
          : "unproven";
  return {
    n,
    meanPred,
    actual,
    brier: b,
    logLoss: logLoss(samplesNewestFirst),
    baseRateBrier: base,
    skill,
    buckets: reliabilityBuckets(samplesNewestFirst),
    refit: timeSplitRefit(samplesNewestFirst),
    verdict,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;

/**
 * Render a report card as a monospace block for the backtest CLIs. Pure
 * (report → string) so both `backtest:<sport>` and `backtest:all` print the same
 * shape. `name` is the model label, `unit` the sample noun from `ModelBacktest`.
 */
export function formatCalibrationReport(
  name: string,
  unit: string,
  r: CalibrationReport
): string {
  const badge = {
    trusted: "✅ TRUSTED",
    marginal: "🟡 MARGINAL",
    unproven: "❌ UNPROVEN",
    thin: "⚪ THIN",
  }[r.verdict];
  const lines: string[] = [];
  lines.push(`=== ${name} — ${r.n} ${unit}s — ${badge} ===`);
  lines.push(
    `mean predicted ${pct(r.meanPred)}   actual ${pct(r.actual)}   gap ${signed(
      (r.actual - r.meanPred) * 100
    )}pt`
  );
  lines.push(
    `Brier ${r.brier.toFixed(4)}  vs base-rate ${r.baseRateBrier.toFixed(4)}  ` +
      `(skill ${r.skill <= 0 ? "" : "+"}${r.skill.toFixed(4)}; negative = real edge)   ` +
      `logLoss ${r.logLoss.toFixed(4)}`
  );
  lines.push(``);
  lines.push(`bucket      n     predicted  actual   gap`);
  for (const b of r.buckets) {
    lines.push(
      `${(b.lo * 100).toFixed(0)}-${(b.hi * 100).toFixed(0)}%`.padEnd(8) +
        String(b.n).padStart(6) +
        `     ${pct(b.meanPred).padEnd(7)}  ${pct(b.actual).padEnd(7)} ${signed(
          b.gap * 100
        )}pt`
    );
  }
  lines.push(``);
  lines.push(
    `re-fit (train ${r.refit.trainN} / test ${r.refit.testN}): ` +
      `best extra shrink ${r.refit.bestShrink.toFixed(2)} (near 1.00 = baked value holds); ` +
      `test Brier as-is ${r.refit.testBrierAsIs.toFixed(4)} vs shrunk ${r.refit.testBrierShrunk.toFixed(
        4
      )}`
  );
  return lines.join("\n");
}
