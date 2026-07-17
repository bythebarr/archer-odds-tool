import { describe, expect, it } from "vitest";
import { projectPropHit, pooledBaseRate, PRIOR_STRENGTH_GAMES } from "./projection";

describe("projectPropHit", () => {
  it("returns null when there's no season sample to project from", () => {
    expect(projectPropHit({ seasonHits: 0, seasonSample: 0, recentRate: 0.9, baseRate: 0.55 })).toBeNull();
  });

  it("regresses a tiny hot sample hard toward the base rate", () => {
    // 3-for-3 looks like 100%, but with a 30-game prior at 55% it should land far below.
    const p = projectPropHit({ seasonHits: 3, seasonSample: 3, recentRate: 1, baseRate: 0.55 })!;
    expect(p.probability).toBeLessThan(0.65);
    expect(p.probability).toBeGreaterThan(0.55);
  });

  it("trusts a large sample much more than a small one", () => {
    const small = projectPropHit({ seasonHits: 8, seasonSample: 10, recentRate: 0.8, baseRate: 0.5 })!;
    const large = projectPropHit({ seasonHits: 120, seasonSample: 150, recentRate: 0.8, baseRate: 0.5 })!;
    // Both are 80% raw, but the 150-game sample should sit closer to 80% than the 10-game one.
    expect(large.shrunkRate).toBeGreaterThan(small.shrunkRate);
  });

  it("pulls a cold player back UP toward the field (mean reversion), not down to their slump", () => {
    // 1-for-10 recently but a 55% base: projection should be well above the 10% raw rate.
    const p = projectPropHit({ seasonHits: 1, seasonSample: 10, recentRate: 0.1, baseRate: 0.55 })!;
    expect(p.probability).toBeGreaterThan(0.3);
  });

  it("shrinks exactly to the empirical-Bayes posterior mean before the recency tilt", () => {
    const p = projectPropHit({ seasonHits: 40, seasonSample: 80, recentRate: 0.5, baseRate: 0.6 })!;
    const expected = (40 + PRIOR_STRENGTH_GAMES * 0.6) / (80 + PRIOR_STRENGTH_GAMES);
    expect(p.shrunkRate).toBeCloseTo(expected, 10);
  });

  it("nudges up when recent form beats the season rate, down when it lags", () => {
    const base = { seasonHits: 40, seasonSample: 80, baseRate: 0.5 };
    const hot = projectPropHit({ ...base, recentRate: 0.9 })!;
    const cold = projectPropHit({ ...base, recentRate: 0.1 })!;
    const neutral = projectPropHit({ ...base, recentRate: 0.5 })!;
    expect(hot.probability).toBeGreaterThan(neutral.probability);
    expect(cold.probability).toBeLessThan(neutral.probability);
    // ...but the nudge is small: a 40-point swing in L10 moves the number only a few points.
    expect(hot.probability - cold.probability).toBeLessThan(0.1);
  });

  it("reports edge vs the field", () => {
    const p = projectPropHit({ seasonHits: 60, seasonSample: 80, recentRate: 0.75, baseRate: 0.55 })!;
    expect(p.edgeVsBase).toBeCloseTo(p.probability - 0.55, 10);
    expect(p.edgeVsBase).toBeGreaterThan(0);
  });

  it("never claims certainty", () => {
    const p = projectPropHit({ seasonHits: 200, seasonSample: 200, recentRate: 1, baseRate: 0.9 })!;
    expect(p.probability).toBeLessThanOrEqual(0.98);
  });

  describe("season-progress ramp (pitching)", () => {
    const input = { seasonHits: 5, seasonSample: 10, recentRate: 0.5, baseRate: 0.4 };
    const ramp = { slope: 0.02, pivot: 5, cap: 8 };

    it("is inert by default (batting keeps the same number)", () => {
      const bare = projectPropHit(input)!;
      const withEmpty = projectPropHit(input, {})!;
      expect(withEmpty.probability).toBe(bare.probability);
    });

    it("adds slope·(progress − pivot) above the pivot, holding flat past the cap", () => {
      const bare = projectPropHit(input)!; // seasonSample 10, capped to 8
      const ramped = projectPropHit(input, { ramp })!;
      // (min(10,8) − 5) · 0.02 = +0.06
      expect(ramped.probability - bare.probability).toBeCloseTo(0.06, 10);
    });

    it("pushes below the pivot down, and lands at zero adjustment on the pivot", () => {
      const early = projectPropHit({ ...input, seasonSample: 3 }, { ramp })!;
      const bareEarly = projectPropHit({ ...input, seasonSample: 3 })!;
      expect(early.probability - bareEarly.probability).toBeCloseTo(-0.04, 10); // (3−5)·0.02
      const onPivot = projectPropHit({ ...input, seasonSample: 5 }, { ramp })!;
      const bareOnPivot = projectPropHit({ ...input, seasonSample: 5 })!;
      expect(onPivot.probability - bareOnPivot.probability).toBeCloseTo(0, 10);
    });
  });
});

describe("pooledBaseRate", () => {
  it("sample-weights the population rate", () => {
    // 5/10 + 30/40 = 35/50 = 0.7, not the unweighted (0.5+0.75)/2.
    const base = pooledBaseRate([
      { seasonHits: 5, seasonSample: 10 },
      { seasonHits: 30, seasonSample: 40 },
    ]);
    expect(base).toBeCloseTo(0.7, 10);
  });

  it("falls back to 0.5 on an empty population", () => {
    expect(pooledBaseRate([])).toBe(0.5);
    expect(pooledBaseRate([{ seasonHits: 0, seasonSample: 0 }])).toBe(0.5);
  });
});
