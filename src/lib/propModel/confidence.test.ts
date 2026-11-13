import { describe, expect, it } from "vitest";
import { BASE, Z_DEGENERATE, confidenceOf, confidenceSummary, distanceEffect, gradeLabel, gradeOf, marketEffect, sampleEffect, trackEffect, type ConfidenceInput } from "./confidence";

const solid: ConfidenceInput = {
  archr: 0.6,
  marketChance: 0.55,
  priceAmerican: -110,
  rate: [8, 10],
  sampleGames: 40,
  blendVerdict: "trusted",
  injury: null,
  minutes: { projected: 34, recent: 33.5 },
  z: 1.0,
  side: "under",
  sport: "nba",
};

describe("confidenceOf", () => {
  it("no ARCHR read, no grade", () => {
    expect(confidenceOf({ ...solid, archr: null })).toBeNull();
  });

  it("a proven stat, long history, settled role and a projection well off the line: A", () => {
    const c = confidenceOf(solid)!;
    expect(c.grade).toBe("A");
    expect(c.factors.find((f) => f.key === "distance")!.effect).toBe(10);
    expect(c.factors.find((f) => f.key === "track")!.effect).toBe(10);
  });

  it("a record that agrees is context, not a plus (the audit: those bets ran high)", () => {
    const record = confidenceOf(solid)!.factors.find((f) => f.key === "record")!;
    expect(record.effect).toBe(0);
    expect(record.text).toContain("Context, not a plus");
  });

  it("a projection that barely clears the line costs confidence; NBA overs and long prices too", () => {
    const base = confidenceOf(solid)!.score;
    expect(confidenceOf({ ...solid, z: 0.1 })!.score).toBe(base - 20);
    expect(confidenceOf({ ...solid, side: "over" })!.score).toBe(base - 5);
    expect(confidenceOf({ ...solid, side: "over", sport: "nfl" })!.score).toBe(base);
    expect(confidenceOf({ ...solid, priceAmerican: 150 })!.factors.find((f) => f.key === "price")!.effect).toBe(-5);
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
    expect(confidenceOf({ ...solid, alt: true })!.score).toBe(base - 10);
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
    const c = confidenceOf(solid)!;
    expect(confidenceSummary(c)).toMatch(new RegExp(`^Confidence A ${c.score}`));
    expect(gradeLabel({ grade: "B", score: 69 })).toBe("B 69");
  });

  it("continuous factors: straight lines through the old anchors", () => {
    expect(distanceEffect(0.1)).toBe(-10);
    expect(distanceEffect(0.55)).toBe(0);
    expect(distanceEffect(0.75)).toBe(5);
    expect(distanceEffect(3)).toBe(10);
    expect(marketEffect(0.115)).toBe(5);
    expect(marketEffect(0.15)).toBe(0);
    expect(marketEffect(0.165)).toBe(-7.5);
    expect(marketEffect(0.25)).toBe(-15);
    expect(sampleEffect(1)).toBe(-20);
    expect(sampleEffect(22.5)).toBe(2.5);
    expect(sampleEffect(80)).toBe(5);
  });

  it("a collapsed projection spread (yes/no props) earns no distance credit", () => {
    const c = confidenceOf({ ...solid, z: -465369.5 })!;
    const d = c.factors.find((f) => f.key === "distance")!;
    expect(d.effect).toBe(0);
    expect(d.text).toContain("no real spread");
    expect(confidenceOf({ ...solid, z: Z_DEGENERATE + 1 })!.factors.find((f) => f.key === "distance")!.effect).toBe(0);
  });

  it("track reads the card's record, weighted by how much it has graded; a thin card still costs", () => {
    expect(trackEffect({ skill: 0.012, n: 2400 })).toBe(10);
    expect(trackEffect({ skill: 0, n: 0 })).toBe(-5);
    expect(trackEffect({ skill: 0.0155, n: 50 })).toBe(-3.5); // 10% weight on +10, 90% on −5
    expect(trackEffect({ skill: -0.02, n: 900 })).toBe(-5);
    const c = confidenceOf({ ...solid, blendVerdict: "thin", blendCard: { skill: 0.0155, n: 50 } })!;
    expect(c.factors.find((f) => f.key === "track")!.effect).toBe(-3.5);
    expect(confidenceOf({ ...solid, blendVerdict: null, blendCard: null })!.factors.find((f) => f.key === "track")!.effect).toBe(-5);
  });

  it("scores are whole numbers", () => {
    expect(Number.isInteger(confidenceOf({ ...solid, z: 0.8, sampleGames: 21 })!.score)).toBe(true);
  });
});
