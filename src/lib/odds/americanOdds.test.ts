import { describe, expect, it } from "vitest";
import { americanToDecimal, decimalToAmerican, formatAmerican } from "./americanOdds";

describe("americanToDecimal", () => {
  it("converts positive odds", () => {
    expect(americanToDecimal(150)).toBeCloseTo(2.5);
    expect(americanToDecimal(100)).toBeCloseTo(2.0);
  });

  it("converts negative odds", () => {
    expect(americanToDecimal(-150)).toBeCloseTo(1.667, 3);
    expect(americanToDecimal(-100)).toBeCloseTo(2.0);
  });

  it("agrees at the +100/-100 boundary", () => {
    expect(americanToDecimal(100)).toBeCloseTo(americanToDecimal(-100));
  });

  it("is monotonically increasing with bettor favorability", () => {
    // -100 and +100 are intentionally excluded together: they're a tied pair
    // (same payout), covered separately by the boundary test above.
    const values = [-300, -150, -110, 105, 130, 300].map(americanToDecimal);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });
});

describe("decimalToAmerican", () => {
  it("round-trips through americanToDecimal", () => {
    for (const odds of [-300, -150, -110, 105, 130, 300]) {
      expect(decimalToAmerican(americanToDecimal(odds))).toBe(odds);
    }
  });
});

describe("formatAmerican", () => {
  it("prefixes positive odds with a plus sign", () => {
    expect(formatAmerican(105)).toBe("+105");
    expect(formatAmerican(-150)).toBe("-150");
  });
});
