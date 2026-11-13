import { describe, expect, it } from "vitest";
import { confidenceOf, type ConfidenceInput } from "./confidence";
import { boardGradeCounts, biggestCost, ceiling, factorSummary, gradeCounts, gradesChangedWithout, maxPossible, outcomeTables, scoreHistogram } from "./confidenceDiagnosis";

const solid: ConfidenceInput = {
  archr: 0.6,
  marketChance: 0.55,
  priceAmerican: -110,
  rate: [8, 10],
  sampleGames: 40,
  blendVerdict: "trusted",
  minutes: { projected: 34, recent: 33.5 },
  z: 0.9,
  side: "under",
  sport: "nba",
};

describe("confidence diagnosis", () => {
  it("the most the rules can give: 85 with a passing report card, 77 with a card short of a pass", () => {
    expect(maxPossible(true)).toBe(85);
    expect(maxPossible(false)).toBe(77);
    expect(maxPossible(undefined)).toBe(75);
  });

  it("names the factor that cost the most, and the ceiling without any costs", () => {
    const c = confidenceOf({ ...solid, blendVerdict: "unproven", z: 0.1, side: "over" })!;
    expect(biggestCost(c)!.key).toBe("distance");
    expect(ceiling(c)).toBeCloseTo(55 + 5 + 1.2, 6); // the 30+ games bonus and a 5-pt market gap (+1.2, continuous) are left
    expect(biggestCost(confidenceOf(solid)!)).toBeNull();
  });

  it("counts grades, buckets scores, and summarises factors", () => {
    const cs = [confidenceOf(solid)!, confidenceOf({ ...solid, blendVerdict: "unproven" })!, confidenceOf({ ...solid, z: 0.1 })!];
    expect(gradeCounts(cs)).toEqual({ A: 1, B: 2, C: 0, D: 0 });
    expect(scoreHistogram([61, 64, 70]).map((b) => [b.bucket, b.n])).toEqual([["60–64", 2], ["70–74", 1]]);
    const track = factorSummary(cs).find((f) => f.key === "track")!;
    expect(track.moved).toBe(3);
    expect(gradesChangedWithout(cs, "distance")).toBe(2); // the A loses its +10 → B; the near-line B gains 10 → A
  });

  it("tabulates outcomes by grade and by score bucket", () => {
    const t = outcomeTables([
      { score: 80, archr: 0.6, priceAmerican: -110, won: 1 },
      { score: 62, archr: 0.55, priceAmerican: -110, won: 0 },
      { score: 63, archr: 0.5, priceAmerican: 100, won: 1 },
    ]);
    expect(t.grades.map((g) => g.n)).toEqual([1, 2, 0, 0]);
    expect(t.buckets.map((b) => b.label)).toEqual(["60–64", "80–84"]);
    expect(t.grades[0].edgeBets).toBe(1);
  });
});

describe("board grade counts", () => {
  it("counts the grades rows already carry and skips ungraded rows", () => {
    expect(boardGradeCounts([{ confidence: { grade: "B" } }, { confidence: { grade: "D" } }, { confidence: { grade: "D" } }, {}])).toEqual({ A: 0, B: 1, C: 0, D: 2, total: 3 });
  });
});
