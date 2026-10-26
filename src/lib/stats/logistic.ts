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

export function fitLogistic(X: number[][], y: (0 | 1)[], lambda = 1, iterations = 600, learningRate = 0.5): LogisticFit {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  if (n === 0 || d === 0) return { coefficients: new Array(d).fill(0), logLoss: NaN, n };
  // Scale by root-mean-square (no centering: differences are already symmetric around 0).
  const scale = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((a, x) => a + x[j] * x[j], 0) / n) || 1);
  const Z = X.map((x) => x.map((v, j) => v / scale[j]));
  const w = new Array(d).fill(0);
  for (let it = 0; it < iterations; it++) {
    const grad = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      const err = predictLogistic(w, Z[i]) - y[i];
      for (let j = 0; j < d; j++) grad[j] += err * Z[i][j];
    }
    for (let j = 0; j < d; j++) w[j] -= learningRate * (grad[j] / n + (lambda / n) * w[j]);
  }
  const coefficients = w.map((v, j) => v / scale[j]);
  return { coefficients, logLoss: logLossOf(coefficients, X, y), n };
}
