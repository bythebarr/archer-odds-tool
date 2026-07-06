/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 rational
 * approximation (max absolute error ~1.5e-7) — plenty precise for the
 * probability estimates in archer/runProbability.ts without pulling in a
 * stats library for one function.
 */
function standardNormalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

/** P(X <= x) for X ~ Normal(mean, variance). */
export function normalCdf(x: number, mean: number, variance: number): number {
  if (variance <= 0) return x >= mean ? 1 : 0;
  return standardNormalCdf((x - mean) / Math.sqrt(variance));
}
