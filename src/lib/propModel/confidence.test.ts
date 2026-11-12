import { describe, expect, it } from "vitest";
import { BASE, confidenceOf, confidenceSummary, gradeOf, type ConfidenceInput } from "./confidence";

const solid: ConfidenceInput = {
  archr: 0.6,
  marketChance: 0.55,
  priceAmerican: -110,
  rate: [8, 10],
  sampleGames: 40,
  blendVerdict: "trusted",
  injury: null,
  minutes: { projected: 34, recent: 33.5 },
};

describe("confidenceOf", () => {
  it("no ARCHR read, no grade", () => {
    expect(confidenceOf({ ...solid, archr: null })).toBeNull();
  });

  it("a proven stat, long record that backs the price, settled role: A", () => {
    const c = confidenceOf(solid)!;
    expect(c.grade).toBe("A");
    expect(c.factors.find((f) => f.key === "record")!.effect).toBe(10);
    expect(c.factors.find((f) => f.key === "track")!.effect).toBe(10);
  });

  it("the same 60% read on thin, contested footing grades far lower, and says why", () => {
    const c = confidenceOf({
      ...solid,
      rate: [3, 10],
      sampleGames: 6,
      blendVerdict: "unproven",
      marketChance: 0.42,
      injury: "Questionable",
      minutes: { projected: 30, recent: 20 },
    })!;
    expect(c.grade).toBe("D");
    const keys = c.factors.filter((f) => f.effect < 0).map((f) => f.key).sort();
    expect(keys).toEqual(["injury", "market", "minutes", "record", "sample", "track"]);
    expect(c.factors.find((f) => f.key === "record")!.text).toContain("Only the model likes it");
    expect(c.factors.find((f) => f.key === "market")!.text).toContain("18 pts above");
  });

  it("a hot record the books already priced is called out, without moving the grade", () => {
    const c = confidenceOf({ ...solid, archr: 0.5, marketChance: 0.52, rate: [9, 10] })!;
    const record = c.factors.find((f) => f.key === "record")!;
    expect(record.effect).toBe(0);
    expect(record.text).toContain("priced it in");
  });

  it("alt rungs, unpriced numbers and small roles cost confidence", () => {
    const base = confidenceOf(solid)!.score;
    expect(confidenceOf({ ...solid, alt: true })!.score).toBe(base - 5);
    expect(confidenceOf({ ...solid, minutes: { projected: 14, recent: 14 } })!.score).toBe(base - 5);
    const unpriced = confidenceOf({ ...solid, priceAmerican: null })!;
    expect(unpriced.factors.find((f) => f.key === "price")!.effect).toBe(-10);
  });

  it("sports without a blend card start neutral on track record", () => {
    const c = confidenceOf({ ...solid, blendVerdict: undefined, minutes: null })!;
    expect(c.factors.find((f) => f.key === "track")!.effect).toBe(0);
  });

  it("scores stay in 0–100 and grade by the cuts", () => {
    const worst = confidenceOf({ ...solid, rate: [0, 2], sampleGames: 1, blendVerdict: "failing", marketChance: 0.2, injury: "doubtful", minutes: { projected: 10, recent: 30 }, alt: true, priceAmerican: null })!;
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.grade).toBe("D");
    expect(gradeOf(75)).toBe("A");
    expect(gradeOf(74)).toBe("B");
    expect(gradeOf(BASE)).toBe("C");
    expect(gradeOf(44)).toBe("D");
    expect(confidenceSummary(confidenceOf(solid)!)).toMatch(/^Confidence A/);
  });
});
