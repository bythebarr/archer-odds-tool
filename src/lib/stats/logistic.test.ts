import { describe, expect, it } from "vitest";
import { fitTemperature } from "./logistic";

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
