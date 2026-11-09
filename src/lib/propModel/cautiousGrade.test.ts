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
  it("scores the blend on every sample and the cautious read only on priced ones", () => {
    const samples = synthetic(50, 0);
    samples.push({ pBlend: 0.6, rate: [7, 10], priceAmerican: null, won: 1 });
    const g = gradeCautiousSamples(samples);
    expect(g.n).toBe(51);
    expect(g.pricedN).toBe(50);
    expect(g.blend.n).toBe(51);
    expect(g.cautious.n).toBe(50);
    expect(g.blend.logLoss).toBeGreaterThan(0);
    expect(g.cautious.logLoss).toBeGreaterThan(0);
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
