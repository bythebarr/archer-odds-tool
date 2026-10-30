import { describe, expect, it } from "vitest";
import { fitLogistic, fitTemperature, recencyWeights } from "./logistic";

describe("fitTemperature", () => {
  // Outcomes drawn at sigmoid(2z): a model reporting sigmoid(z) is too timid by 2×.
  const logits: number[] = [];
  const y: (0 | 1)[] = [];
  for (let i = 0; i < 400; i++) {
    const z = -2 + (4 * i) / 399;
    const p = 1 / (1 + Math.exp(-2 * z));
    // Deterministic outcomes in the right proportion: 20 per logit bin.
    for (let k = 0; k < 20; k++) {
      logits.push(z);
      y.push(k < Math.round(p * 20) ? 1 : 0);
    }
  }
  it("recovers how timid the model is", () => {
    expect(fitTemperature(logits, y)).toBeCloseTo(2, 1);
  });
  it("leaves a calibrated model alone", () => {
    const y1 = logits.map((z, i) => (i % 20 < Math.round((1 / (1 + Math.exp(-z))) * 20) ? 1 : 0) as 0 | 1);
    expect(fitTemperature(logits, y1)).toBeCloseTo(1, 1);
  });
});

describe("recency weights", () => {
  const asOf = new Date("2026-01-01");
  it("halve every half-life and leave everything at 1 without one", () => {
    const w = recencyWeights([asOf, new Date("2024-01-01")], asOf, 2);
    expect(w[0]).toBe(1);
    expect(w[1]).toBeCloseTo(0.5, 2);
    expect(recencyWeights([new Date("2000-01-01")], asOf, Infinity)).toEqual([1]);
  });

  it("let the recent era drive the fit", () => {
    // Old rows: the feature means nothing. New rows: it decides the result.
    const X: number[][] = [];
    const y: (0 | 1)[] = [];
    const dates: Date[] = [];
    for (let i = 0; i < 400; i++) {
      const old = i < 300;
      const x = (i % 2 ? 1 : -1) * (1 + (i % 3));
      X.push([x]);
      y.push(old ? ((i >> 1) % 2 ? 1 : 0) : x > 0 ? 1 : 0);
      dates.push(new Date(old ? "2012-01-01" : "2025-06-01"));
    }
    const even = fitLogistic(X, y, 1).coefficients[0];
    const recent = fitLogistic(X, y, 1, { weights: recencyWeights(dates, asOf, 2) }).coefficients[0];
    expect(recent).toBeGreaterThan(even * 1.5);
  });
});
