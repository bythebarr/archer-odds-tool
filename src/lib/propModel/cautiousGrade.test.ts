import { describe, expect, it } from "vitest";
import { CAUTIOUS_BUCKETS, MIN_GATE_SAMPLES, PRIOR_SWEEP, cautiousVerdict, evidenceGate, gradeCautiousSamples, type CautiousGradeSample } from "./cautiousGrade";

/** A deterministic PRNG so the fixtures never flake. */
function rng(seedStart: number) {
  let seed = seedStart;
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Synthetic graded props: `blendBias` shifts the blend off the truth the outcomes follow; the L10 record is drawn from the truth. */
function synthetic(n: number, blendBias: number, seedStart = 1): CautiousGradeSample[] {
  const rnd = rng(seedStart);
  return Array.from({ length: n }, () => {
    const truth = 0.35 + rnd() * 0.4;
    const won = (rnd() < truth ? 1 : 0) as 0 | 1;
    const hits = Array.from({ length: 10 }, () => (rnd() < truth ? 1 : 0) as number).reduce((a, b) => a + b, 0);
    return { pBlend: Math.min(0.97, Math.max(0.03, truth + blendBias)), rate: [hits, 10], priceAmerican: -110, won };
  });
}

/** One world: a constant truth, blend and record; outcomes drawn at the truth. */
function world(truth: number, pBlend: number, rate: [number, number], n = 600, seedStart = 7, roleRate?: [number, number]): CautiousGradeSample[] {
  const rnd = rng(seedStart);
  return Array.from({ length: n }, () => ({ pBlend, rate, roleRate, priceAmerican: -110, won: (rnd() < truth ? 1 : 0) as 0 | 1 }));
}

describe("gradeCautiousSamples", () => {
  it("scores every read on the same samples; buckets and ROI only on priced ones", () => {
    const samples = synthetic(50, 0);
    samples.push({ pBlend: 0.6, rate: [7, 10], priceAmerican: null, won: 1 });
    const g = gradeCautiousSamples(samples);
    expect(g.n).toBe(51);
    expect(g.pricedN).toBe(50);
    for (const s of [g.blend, g.legacy, g.evidence, g.evidencePlain]) expect(s.n).toBe(51);
    for (const mode of ["legacy-min", "evidence"] as const) {
      expect(g.buckets[mode].reduce((s, b) => s + b.n, 0)).toBe(50);
      expect(g.buckets[mode].map((b) => b.key)).toEqual(CAUTIOUS_BUCKETS.map((b) => b.key));
    }
    expect(g.priorSweep.map((p) => p.priorGames)).toEqual(PRIOR_SWEEP);
  });

  it("legacy min() never reads above the blend; the evidence read can", () => {
    const g = gradeCautiousSamples(synthetic(400, -0.1));
    expect(g.legacy.meanProb).toBeLessThanOrEqual(g.blend.meanProb + 1e-9);
    // An under-confident blend: records drawn from the truth pull the evidence read up toward it.
    expect(g.evidence.meanProb).toBeGreaterThan(g.blend.meanProb);
    expect(g.evidence.logLoss).toBeLessThan(g.blend.logLoss);
  });

  it("a calibrated blend with an ordinary record: min() costs accuracy, the evidence read barely moves", () => {
    const g = gradeCautiousSamples(world(0.6, 0.6, [5, 10]));
    expect(g.blend.logLoss).toBeLessThan(g.legacy.logLoss);
    expect(cautiousVerdict(g)).toContain("blend predicted BETTER");
    expect(Math.abs(g.evidence.logLoss - g.blend.logLoss)).toBeLessThan(Math.abs(g.legacy.logLoss - g.blend.logLoss));
  });

  it("role weighting: a stale bench record drags the plain evidence read; the role-weighted one keeps the rising model", () => {
    // Truth 0.62, model 0.62; the plain L10 is 3/10 from bench minutes, the role-weighted record 1.9/2 from starts.
    const g = gradeCautiousSamples(world(0.62, 0.62, [3, 10], 600, 11, [1.9, 2]));
    expect(g.roleWeightedN).toBe(600);
    expect(g.evidence.logLoss).toBeLessThan(g.evidencePlain.logLoss);
    expect(g.evidence.logLoss).toBeLessThan(g.legacy.logLoss);
  });

  it("buckets by each read's own edge, with hit vs closing implied and ROI at the price", () => {
    const samples: CautiousGradeSample[] = [
      { pBlend: 0.52, rate: [5, 10], priceAmerican: -110, won: 1 }, // legacy ≈ 0.44 → ≤0
      { pBlend: 0.9, rate: [10, 10], priceAmerican: 300, won: 1 }, // way past +50% → distrusted
      { pBlend: 0.62, rate: [8, 10], priceAmerican: -110, won: 0 }, // legacy 0.62 → ≈ +18% → 10–20
    ];
    const g = gradeCautiousSamples(samples);
    const legacy = Object.fromEntries(g.buckets["legacy-min"].map((b) => [b.key, b]));
    expect(legacy.le0.n).toBe(1);
    expect(legacy.distrusted.n).toBe(1);
    expect(legacy["10-20"].n).toBe(1);
    expect(legacy["10-20"].hitRate).toBe(0);
    expect(legacy["10-20"].roi).toBe(-1);
    expect(legacy["10-20"].meanImplied).toBeCloseTo(110 / 210);
    expect(legacy.le0.roi).toBeCloseTo(100 / 110);
    // One sample: no spread to read, so the ROI range is unbounded rather than invented.
    expect(legacy.le0.roiHigh).toBe(Infinity);
  });

  it("handles the empty set without inventing numbers", () => {
    const g = gradeCautiousSamples([]);
    expect(g.n).toBe(0);
    expect(Number.isNaN(g.blend.logLoss)).toBe(true);
    expect(cautiousVerdict(g)).toContain("nothing to grade");
  });
});

describe("evidenceGate", () => {
  it("won't decide below the sample floor", () => {
    const g = gradeCautiousSamples(synthetic(MIN_GATE_SAMPLES - 1, 0));
    expect(evidenceGate(g).decision).toBe("data-required");
    expect(evidenceGate(gradeCautiousSamples([])).decision).toBe("data-required");
  });

  it("adopts when the evidence read is at least as calibrated as the blend and beats min()", () => {
    const g = gradeCautiousSamples(synthetic(1000, -0.1, 3));
    const gate = evidenceGate(g);
    expect(gate.decision).toBe("adopt-evidence");
    expect(gate.reason).toContain("passes");
  });

  it("keeps legacy when the evidence read is worse than the blend alone", () => {
    // A perfectly calibrated blend; records that lie (drawn far under the truth): the update can only hurt.
    const g = gradeCautiousSamples(world(0.6, 0.6, [1, 10], 600, 5));
    const gate = evidenceGate(g);
    expect(g.evidence.logLoss).toBeGreaterThan(g.blend.logLoss);
    expect(gate.decision).toBe("keep-legacy");
    expect(gate.reason).toContain("worse than the blend alone");
  });

  it("keeps legacy when min() already beats it", () => {
    // Hot blend (0.85) on a 0.65 truth, record 8/10: min() lands on the truth; the gentler update doesn't.
    const g = gradeCautiousSamples(world(0.65, 0.85, [8, 10]));
    expect(g.legacy.logLoss).toBeLessThan(g.evidence.logLoss);
    expect(evidenceGate(g).decision).toBe("keep-legacy");
    expect(evidenceGate(g).reason).toContain("no better than legacy min()");
  });
});
