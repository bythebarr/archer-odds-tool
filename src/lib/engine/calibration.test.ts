import { describe, it, expect } from "vitest";
import {
  logit,
  logistic,
  shrinkProb,
  brier,
  logLoss,
  baseRateBrier,
  reliabilityBuckets,
  bestShrink,
  timeSplitRefit,
  scoreCalibration,
  type CalibrationSample,
} from "./calibration";

/**
 * Pure calibration math (Phase 4a). These pin the properties the trust gate
 * rests on — a perfect model scores 0, a coin flip scores 0.25, an overconfident
 * model gets flagged, and the base-rate benchmark is what "skill" is measured
 * against. No prisma/I/O here; the per-sport sample collection is tested via each
 * adapter's backtest.
 */

const s = (pred: number, won: 0 | 1): CalibrationSample => ({ pred, won });

describe("logit/logistic", () => {
  it("round-trips", () => {
    for (const p of [0.1, 0.37, 0.5, 0.6, 0.92]) {
      expect(logistic(logit(p))).toBeCloseTo(p, 10);
    }
  });
});

describe("shrinkProb", () => {
  it("shrink=1 is identity", () => {
    expect(shrinkProb(0.8, 1)).toBe(0.8);
  });
  it("shrink<1 pulls toward 0.5", () => {
    expect(shrinkProb(0.8, 0.5)).toBeGreaterThan(0.5);
    expect(shrinkProb(0.8, 0.5)).toBeLessThan(0.8);
  });
  it("shrink=0 collapses to 0.5", () => {
    expect(shrinkProb(0.9, 0)).toBeCloseTo(0.5, 10);
  });
});

describe("brier", () => {
  it("perfect predictions score 0", () => {
    expect(brier([s(1 - 1e-9, 1), s(1e-9, 0)])).toBeCloseTo(0, 6);
  });
  it("coin-flip predictions score 0.25", () => {
    expect(brier([s(0.5, 1), s(0.5, 0)])).toBeCloseTo(0.25, 10);
  });
  it("NaN on empty", () => {
    expect(brier([])).toBeNaN();
  });
});

describe("logLoss", () => {
  it("confident-and-right beats confident-and-wrong", () => {
    const right = logLoss([s(0.95, 1)]);
    const wrong = logLoss([s(0.95, 0)]);
    expect(right).toBeLessThan(wrong);
  });
  it("does not blow up at the 0/1 boundary (clamped)", () => {
    expect(Number.isFinite(logLoss([s(1, 0)]))).toBe(true);
    expect(Number.isFinite(logLoss([s(0, 1)]))).toBe(true);
  });
});

describe("baseRateBrier", () => {
  it("equals p̄(1−p̄)", () => {
    // 3 wins of 4 → base rate 0.75 → 0.75*0.25 = 0.1875
    expect(baseRateBrier([s(0.6, 1), s(0.6, 1), s(0.6, 1), s(0.6, 0)])).toBeCloseTo(
      0.1875,
      10
    );
  });
});

describe("reliabilityBuckets", () => {
  it("bins by predicted probability and computes the gap", () => {
    const samples = [s(0.62, 1), s(0.63, 0), s(0.72, 1), s(0.73, 1)];
    const buckets = reliabilityBuckets(samples);
    const b60 = buckets.find((b) => b.lo === 0.6)!;
    const b70 = buckets.find((b) => b.lo === 0.7)!;
    expect(b60.n).toBe(2);
    expect(b60.actual).toBeCloseTo(0.5, 10); // 1 of 2 won
    expect(b70.n).toBe(2);
    expect(b70.actual).toBeCloseTo(1.0, 10); // 2 of 2 won
    expect(b70.gap).toBeCloseTo(1.0 - b70.meanPred, 10);
  });
  it("skips empty bins", () => {
    const buckets = reliabilityBuckets([s(0.55, 1)]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].lo).toBe(0.55);
  });
});

describe("bestShrink", () => {
  it("finds ~1.0 when the model is already well-calibrated", () => {
    // Build a calibrated set: half the 0.7s win, roughly matching 0.7... actually
    // an exactly-calibrated 0.7 bucket wins 70%. Use a large synthetic set.
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 100; i++) samples.push(s(0.7, i < 70 ? 1 : 0));
    const shrink = bestShrink(samples);
    // A perfectly-calibrated bucket wants no shrink; allow one grid step of slack.
    expect(shrink).toBeGreaterThanOrEqual(0.9);
    expect(shrink).toBeLessThanOrEqual(1.1);
  });
  it("recommends heavy shrink for an overconfident model", () => {
    // Model says 0.9 but only wins 55% → should pull way down toward 0.5.
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 100; i++) samples.push(s(0.9, i < 55 ? 1 : 0));
    expect(bestShrink(samples)).toBeLessThan(0.5);
  });
});

describe("timeSplitRefit", () => {
  it("splits newest-first into train (older) and test (newer)", () => {
    const samples: CalibrationSample[] = Array.from({ length: 10 }, () => s(0.6, 1));
    const r = timeSplitRefit(samples, 0.4);
    expect(r.testN).toBe(4);
    expect(r.trainN).toBe(6);
  });
});

describe("scoreCalibration verdict", () => {
  it("flags 'thin' below the sample floor", () => {
    const samples = Array.from({ length: 10 }, () => s(0.6, 1));
    expect(scoreCalibration(samples).verdict).toBe("thin");
  });
  it("flags 'unproven' for an overconfident model well below the base rate", () => {
    // Overconfident: predicts 0.9 but wins only ~50% → Brier well worse than base rate.
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 200; i++) samples.push(s(0.9, i % 2 === 0 ? 1 : 0));
    const rep = scoreCalibration(samples);
    expect(rep.skill).toBeGreaterThan(0);
    expect(rep.verdict).toBe("unproven");
  });
  it("flags 'marginal' when calibrated but within noise of no-skill (the MLB case)", () => {
    // Predicts 0.55 and wins ~55%: honest, but Brier sits ~on the base rate.
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 400; i++) samples.push(s(0.55, i < 220 ? 1 : 0));
    const rep = scoreCalibration(samples);
    expect(Math.abs(rep.skill)).toBeLessThan(0.002);
    expect(rep.verdict).toBe("marginal");
  });
  it("flags 'trusted' when Brier beats the base rate with enough sample", () => {
    // Skillful: 0.8 bucket wins 80%, 0.2 bucket wins 20% — real discrimination.
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 100; i++) samples.push(s(0.8, i < 80 ? 1 : 0));
    for (let i = 0; i < 100; i++) samples.push(s(0.2, i < 20 ? 1 : 0));
    const rep = scoreCalibration(samples);
    expect(rep.skill).toBeLessThan(0);
    expect(rep.verdict).toBe("trusted");
  });
});
