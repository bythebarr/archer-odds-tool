import { describe, expect, it } from "vitest";
import { fairOver, leanConfidence } from "./capture";

describe("fairOver", () => {
  it("de-vigs one book's two sides", () => {
    // −130 / +100: 56.5% and 50% implied, 53.1% over once the vig is out.
    expect(fairOver([{ bookKey: "dk", side: "over", point: 24.5, priceAmerican: -130 }, { bookKey: "dk", side: "under", point: 24.5, priceAmerican: 100 }], 24.5)).toBeCloseTo(0.5306, 3);
  });

  it("averages books and ignores one-sided numbers and other points", () => {
    const quotes = [
      { bookKey: "dk", side: "over", point: 24.5, priceAmerican: -110 },
      { bookKey: "dk", side: "under", point: 24.5, priceAmerican: -110 },
      { bookKey: "fd", side: "over", point: 24.5, priceAmerican: -150 },
      { bookKey: "fd", side: "under", point: 24.5, priceAmerican: 120 },
      { bookKey: "mgm", side: "over", point: 24.5, priceAmerican: -200 },
      { bookKey: "dk", side: "over", point: 26.5, priceAmerican: 140 },
    ];
    const fd = (150 / 250) / (150 / 250 + 100 / 220);
    expect(fairOver(quotes, 24.5)).toBeCloseTo((0.5 + fd) / 2, 4);
    expect(fairOver(quotes, 26.5)).toBeNull();
  });
});

describe("leanConfidence", () => {
  it("freezes the grade the product shows, or nothing without an ARCHR read", () => {
    const input = { archr: 0.6, marketChance: 0.55, priceAmerican: -110, rate: [8, 10] as [number, number], sampleGames: 40, blendVerdict: "trusted", z: 0.9, side: "under" as const, sport: "nba" };
    const c = leanConfidence(input)!;
    expect(c.grade).toBe("A");
    expect(c.score).toBeGreaterThanOrEqual(75);
    expect(leanConfidence({ ...input, archr: null })).toBeUndefined();
  });
});
