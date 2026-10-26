import { describe, expect, it } from "vitest";
import { fairPrice, valueOf, type TwoSidedQuote } from "./marketValue";

const q = (bookKey: string, priceA: number, priceB: number): TwoSidedQuote => ({ bookKey, priceA, priceB });

describe("fairPrice", () => {
  it("averages each book's de-vigged probability", () => {
    const f = fairPrice([q("a", -110, -110), q("b", -110, -110), q("c", -110, -110)])!;
    expect(f.probA).toBeCloseTo(0.5);
    expect(f.booksUsed).toBe(3);
  });

  it("withholds below three books", () => {
    expect(fairPrice([q("a", -110, -110), q("b", -110, -110)])).toBeNull();
  });

  it("weights a sharp book more", () => {
    const f = fairPrice([q("a", -110, -110), q("b", -110, -110), q("pinnacle", -150, 130)])!;
    // Pinnacle alone reads ~0.584; at 3x weight against two even books the blend is ~0.548, vs ~0.528 unweighted.
    expect(f.probA).toBeGreaterThan(0.54);
  });

  it("drops a stale or broken two-sided quote", () => {
    // -198 / -122 is a 21% margin: one side moved and the other didn't.
    expect(fairPrice([q("a", -110, -110), q("b", -110, -110), q("c", -110, -110), q("d", -198, -122)])!.booksUsed).toBe(3);
  });

  it("leaves the judged book out", () => {
    expect(fairPrice([q("a", -110, -110), q("b", -110, -110), q("c", -110, -110)], "c")).toBeNull();
  });
});

describe("valueOf", () => {
  const market = [q("a", -110, -110), q("b", -110, -110), q("c", -110, -110), q("d", 105, -125)];

  it("flags a price better than the rest of the market", () => {
    const v = valueOf(market, "A", 105, "d")!;
    expect(v.ev).toBeCloseTo(0.5 * 2.05 - 1, 3);
    expect(v.fairAmerican).toBe(100);
  });

  it("reads the other side against 1 − p", () => {
    const v = valueOf(market, "B", -125, "d")!;
    expect(v.ev).toBeLessThan(0);
  });
});
