/**
 * L2-regularized logistic regression without an intercept, for symmetric
 * "A vs B" models: features are A-minus-B differences, so swapping the corners
 * flips every feature and the probability with it (P(A) = 1 − P(B) exactly).
 * Fitted by gradient descent on standardized features; coefficients come back
 * on the raw scale.
 */
export interface LogisticFit {
  coefficients: number[];
  logLoss: number;
  n: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function predictLogistic(coefficients: number[], x: number[]): number {
  let z = 0;
  for (let j = 0; j < coefficients.length; j++) z += coefficients[j] * (x[j] ?? 0);
  return sigmoid(z);
}

export function logLossOf(coefficients: number[], X: number[][], y: (0 | 1)[]): number {
  let s = 0;
  X.forEach((x, i) => {
    const p = Math.min(Math.max(predictLogistic(coefficients, x), 1e-6), 1 - 1e-6);
    s -= y[i] ? Math.log(p) : Math.log(1 - p);
  });
  return X.length ? s / X.length : NaN;
}

export function fitLogistic(
  X: number[][],
  y: (0 | 1)[],
  lambda = 1,
  opts: { iterations?: number; learningRate?: number; /** Per-row weights (e.g. recency); default all 1. */ weights?: number[] } = {}
): LogisticFit {
  const { iterations = 600, learningRate = 0.5, weights } = opts;
  const n = X.length;
  const d = X[0]?.length ?? 0;
  if (n === 0 || d === 0) return { coefficients: new Array(d).fill(0), logLoss: NaN, n };
  const wt = weights ?? new Array(n).fill(1);
  const total = wt.reduce((a, b) => a + b, 0) || 1;
  // Scale by root-mean-square (no centering: differences are already symmetric around 0).
  const scale = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((a, x) => a + x[j] * x[j], 0) / n) || 1);
  const Z = X.map((x) => x.map((v, j) => v / scale[j]));
  const w = new Array(d).fill(0);
  for (let it = 0; it < iterations; it++) {
    const grad = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      const err = (predictLogistic(w, Z[i]) - y[i]) * wt[i];
      for (let j = 0; j < d; j++) grad[j] += err * Z[i][j];
    }
    for (let j = 0; j < d; j++) w[j] -= learningRate * (grad[j] / total + (lambda / total) * w[j]);
  }
  const coefficients = w.map((v, j) => v / scale[j]);
  return { coefficients, logLoss: logLossOf(coefficients, X, y), n };
}

/** Weights that halve every `halfLifeYears` before `asOf` (Infinity = all 1). */
export function recencyWeights(dates: Date[], asOf: Date, halfLifeYears: number): number[] {
  if (!Number.isFinite(halfLifeYears)) return dates.map(() => 1);
  const year = 365.25 * 86_400_000;
  return dates.map((d) => Math.pow(0.5, Math.max(0, asOf.getTime() - d.getTime()) / year / halfLifeYears));
}

/**
 * The temperature `t` that makes `sigmoid(t × z)` best fit the outcomes (lowest
 * log loss, t in [0.5, 3]). Above 1 the model was too timid, below 1 too sure.
 * Log loss is convex in t, so a ternary search finds it.
 */
export function fitTemperature(logits: number[], y: (0 | 1)[]): number {
  const loss = (t: number) => {
    let s = 0;
    logits.forEach((z, i) => {
      const p = Math.min(Math.max(sigmoid(t * z), 1e-6), 1 - 1e-6);
      s -= y[i] ? Math.log(p) : Math.log(1 - p);
    });
    return s;
  };
  let lo = 0.5;
  let hi = 3;
  for (let it = 0; it < 60; it++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (loss(a) < loss(b)) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
}

/** The logit behind `predictLogistic`. */
export function logitOf(coefficients: number[], x: number[]): number {
  let z = 0;
  for (let j = 0; j < coefficients.length; j++) z += coefficients[j] * (x[j] ?? 0);
  return z;
}
