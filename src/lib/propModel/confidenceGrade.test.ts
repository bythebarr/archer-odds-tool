import { describe, expect, it } from "vitest";
import { MIN_POOLED, gradeOfSample, validateConfidence, type ConfidenceSample } from "./confidenceGrade";

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** High-confidence sides (long history, record agrees, close to the market) and low ones (thin, contested). */
function world(n: number, highTruthBonus: number, lowTruthPenalty: number, seed = 3): ConfidenceSample[] {
  const rnd = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const high = i % 2 === 0;
    const archr = 0.58;
    const truth = high ? archr + highTruthBonus : archr - lowTruthPenalty;
    return {
      archr,
      marketChance: high ? 0.55 : 0.4,
      priceAmerican: -110,
      rate: high ? [8, 10] : [3, 10],
      sampleGames: high ? 40 : 6,
      minutes: high ? { projected: 34, recent: 34 } : { projected: 30, recent: 20 },
      won: (rnd() < truth ? 1 : 0) as 0 | 1,
    } satisfies ConfidenceSample;
  });
}

describe("validateConfidence", () => {
  it("the fixtures land in the grades they're meant to", () => {
    const [hi, lo] = world(2, 0, 0);
    expect(["A", "B"]).toContain(gradeOfSample(hi));
    expect(["C", "D"]).toContain(gradeOfSample(lo));
  });

  it("validated when the higher grades are both more accurate and more profitable", () => {
    const v = validateConfidence(world(800, 0, 0.15));
    expect(v.verdict).toBe("validated");
    expect(v.high.brier).toBeLessThan(v.low.brier);
    expect(v.high.edgeRoi).toBeGreaterThan(v.low.edgeRoi);
  });

  it("not validated when the grades don't separate outcomes", () => {
    // Low-grade sides do just as well as high ones: the grade adds nothing.
    const v = validateConfidence(world(800, -0.1, -0.1, 9));
    expect(v.verdict).toBe("not-validated");
  });

  it("no verdict on a thin sample", () => {
    const v = validateConfidence(world(MIN_POOLED, 0, 0.15));
    expect(v.verdict).toBe("data-required");
    expect(validateConfidence([]).verdict).toBe("data-required");
  });

  it("reports every grade on its own as well as pooled", () => {
    const v = validateConfidence(world(400, 0, 0.1));
    expect(v.grades.map((g) => g.label)).toEqual(["A", "B", "C", "D"]);
    expect(v.grades.reduce((s, g) => s + g.n, 0)).toBe(400);
  });
});
