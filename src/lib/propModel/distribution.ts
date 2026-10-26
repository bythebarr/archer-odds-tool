/**
 * How a stat falls game to game, and the chance it clears a line — shared by
 * every sport's prop model. A projection only has to say which shape its stat
 * takes and give the moments:
 *
 *   - count: small, skewed whole numbers (rebounds, receptions, strikeouts,
 *     shots on goal) — negative binomial, never tighter than Poisson
 *   - normal: big, roughly symmetric whole numbers (yards, points in some
 *     sports) — normal with a continuity correction
 *   - atLeastOne: "anytime" props (TD scorer, goal scorer, home run) — Poisson
 *     chance of one or more
 *   - pmf: an explicit probability for every value, for stats built outcome by
 *     outcome (MLB total bases: each plate appearance a single, an extra-base
 *     hit, a home run or an out)
 *
 * Over means strictly more than the line; on a whole-number line a push
 * refunds, so the side's chance excludes it.
 */

export type StatDistribution =
  | { kind: "count"; mean: number; variance: number }
  | { kind: "normal"; mean: number; sd: number }
  | { kind: "atLeastOne"; mean: number }
  | { kind: "pmf"; pmf: number[] };

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

/** Standard normal CDF (Abramowitz–Stegun 26.2.17; error < 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/** P(X ≤ k) for a whole-number stat under the distribution. */
function cdfAt(d: StatDistribution, k: number): number {
  if (d.kind === "count") return countCdf(k, d.mean, d.variance);
  if (d.kind === "pmf") {
    if (k < 0) return 0;
    let c = 0;
    for (let i = 0; i <= Math.min(k, d.pmf.length - 1); i++) c += d.pmf[i];
    return Math.min(c, 1);
  }
  if (d.kind === "normal") return d.sd > 0 ? normalCdf((k + 0.5 - d.mean) / d.sd) : k >= d.mean ? 1 : 0;
  return k < 0 ? 0 : k >= 1 ? 1 : Math.exp(-Math.max(d.mean, 0)); // atLeastOne: only 0 vs 1+ matters
}

/** The uncalibrated chance the Over cashes at `point`, pushes refunded. */
export function rawProbOver(d: StatDistribution, point: number): number {
  const atOrBelow = cdfAt(d, Math.floor(point));
  const push = Number.isInteger(point) ? atOrBelow - cdfAt(d, point - 1) : 0;
  return (1 - atOrBelow) / Math.max(1 - push, 1e-6);
}

/** Pulls a probability toward 50% in logit space: k = 1 trusts it as is, k = 0 is a coin flip. */
export function shrinkLogit(p: number, k: number): number {
  const c = Math.min(Math.max(p, 1e-4), 1 - 1e-4);
  return 1 / (1 + Math.exp(-Math.log(c / (1 - c)) * k));
}
