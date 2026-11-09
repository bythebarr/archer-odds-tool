import { describe, expect, it } from "vitest";
import { gradeCautiousSamples, cautiousVerdict, type CautiousGradeSample } from "./cautiousGrade";

/** Deterministic synthetic graded props: `blendBias` shifts the blend away from the truth the outcomes follow. */
function synthetic(n: number, blendBias: number, seedStart = 1): CautiousGradeSample[] {
  let seed = seedStart;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: CautiousGradeSample[] = [];
  for (let i = 0; i < n; i++) {
    const truth = 0.35 + rnd() * 0.4; // true cash chance of the Over side
    const won = (rnd() < truth ? 1 : 0) as 0 | 1;
    const pBlend = Math.min(0.97, Math.max(0.03, truth + blendBias));
    // L10 record drawn around the truth, like a real recent record would be.
    const hits = Math.round(truth * 10 + (rnd() - 0.5) * 2);
    out.push({ pBlend, rate: [Math.min(10, Math.max(0, hits)), 10], priceAmerican: -110, won });
  }
  return out;
}

describe("gradeCautiousSamples", () => {
  it("scores BOTH reads on the same priced subset for the headline comparison (blendAll keeps the full set as context)", () => {
    const samples = synthetic(50, 0);
    samples.push({ pBlend: 0.6, rate: [7, 10], priceAmerican: null, won: 1 });
    const g = gradeCautiousSamples(samples);
    expect(g.n).toBe(51);
    expect(g.pricedN).toBe(50);
    // The head-to-head: identical sample sets, or the verdict is apples-to-oranges.
    expect(g.blend.n).toBe(50);
    expect(g.cautious.n).toBe(50);
    expect(g.blend.n).toBe(g.cautious.n);
    // The all-sample blend score survives only as a separate context line.
    expect(g.blendAll.n).toBe(51);
    expect(g.blend.logLoss).toBeGreaterThan(0);
    expect(g.cautious.logLoss).toBeGreaterThan(0);
  });

  it("the wash band is sample-size aware: the same underlying gap is a wash at small n and decisive at large n", () => {
    // Calibrated blend (0.60) on a 0.60 truth, record 6/10 (floor ≈ 0.443):
    // the haircut really does cost accuracy here — the only question is
    // whether the sample is big enough to say so. Deterministic win patterns
    // at exactly the true rate, so the paired differences are fixed numbers:
    // per-sample Δ is +0.303 on a win, −0.331 on a loss (mean +0.049).
    const pattern = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0]; // 6 wins in 10
    const world = (reps: number): CautiousGradeSample[] =>
      Array.from({ length: reps * pattern.length }, (_, i) => ({
        pBlend: 0.6,
        rate: [6, 10] as [number, number],
        priceAmerican: -110,
        won: pattern[i % pattern.length] as 0 | 1,
      }));
    const small = gradeCautiousSamples(world(1).slice(0, 8)); // 5 wins, 3 losses
    expect(Number.isFinite(small.deltaSe)).toBe(true);
    expect(cautiousVerdict(small)).toContain("a wash");
    const large = gradeCautiousSamples(world(200));
    expect(cautiousVerdict(large)).toContain("blend predicted BETTER");
    // And the band itself shrinks as n grows.
    expect(large.deltaSe).toBeLessThan(small.deltaSe);
  });

  it("head-to-head: the haircut only wins when the record floor lands between the truth and a hot blend", () => {
    // Deterministic worlds, outcomes drawn at a constant true rate.
    const world = (truth: number, pBlend: number, rate: [number, number], n = 600, seedStart = 7): CautiousGradeSample[] => {
      let seed = seedStart;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      return Array.from({ length: n }, () => ({ pBlend, rate, priceAmerican: -110, won: (rnd() < truth ? 1 : 0) as 0 | 1 }));
    };
    // Hot blend (0.85) on a 0.65 truth, record 8/10 (floor ≈ 0.649 ≈ the truth): the floor rescues it.
    const hot = gradeCautiousSamples(world(0.65, 0.85, [8, 10]));
    expect(hot.cautious.logLoss).toBeLessThan(hot.blend.logLoss);
    expect(cautiousVerdict(hot)).toContain("BETTER");
    // Calibrated blend (0.60) on a 0.60 truth, ordinary record 5/10 (floor ≈ 0.35): min() drags it far under — the haircut costs real accuracy.
    const calm = gradeCautiousSamples(world(0.6, 0.6, [5, 10]));
    expect(calm.blend.logLoss).toBeLessThan(calm.cautious.logLoss);
    expect(cautiousVerdict(calm)).toContain("blend predicted BETTER");
    // Structural invariant across the random worlds: the cautious read never exceeds the blend.
    for (const s of synthetic(100, 0.1)) {
      const g = gradeCautiousSamples([s]);
      expect(g.cautious.meanProb).toBeLessThanOrEqual(g.blend.meanProb + 1e-9);
    }
  });

  it("buckets samples by cautious-edge size and counts the distrusted tail", () => {
    const samples: CautiousGradeSample[] = [
      { pBlend: 0.52, rate: [5, 10], priceAmerican: -110, won: 1 }, // cautious ≈ record floor 0.44 → negative edge
      { pBlend: 0.9, rate: [10, 10], priceAmerican: 300, won: 1 }, // cautious 0.9 vs implied 0.25 → way past +50%
      { pBlend: 0.62, rate: [8, 10], priceAmerican: -110, won: 0 }, // cautious 0.62 → edge ≈ +18%
    ];
    const g = gradeCautiousSamples(samples);
    expect(g.distrustedN).toBe(1);
    expect(g.buckets.find((b) => b.key === "distrusted")!.n).toBe(1);
    expect(g.buckets.find((b) => b.key === "10-25")!.n).toBe(1);
    expect(g.buckets.reduce((s, b) => s + b.n, 0)).toBe(g.pricedN);
    const hot = g.buckets.find((b) => b.key === "10-25")!;
    expect(hot.hitRate).toBe(0);
    expect(hot.meanImplied).toBeCloseTo(110 / 210);
  });

  it("handles the empty set without inventing numbers", () => {
    const g = gradeCautiousSamples([]);
    expect(g.n).toBe(0);
    expect(g.pricedN).toBe(0);
    expect(Number.isNaN(g.blend.logLoss)).toBe(true);
    expect(cautiousVerdict(g)).toContain("nothing to grade");
  });
});
