import { describe, expect, it } from "vitest";
import { devigPair, consensusFairProbability, calculateEv, type DevigPair } from "./devig";

describe("devigPair", () => {
  it("splits evenly for a symmetric two-way market", () => {
    const { fairA, fairB } = devigPair(-110, -110);
    expect(fairA).toBeCloseTo(0.5, 5);
    expect(fairB).toBeCloseTo(0.5, 5);
  });

  it("normalizes implied probabilities to sum to 1", () => {
    const { fairA, fairB } = devigPair(150, -180);
    expect(fairA + fairB).toBeCloseTo(1, 10);
    expect(fairB).toBeGreaterThan(fairA); // the -180 favorite should have higher fair probability
  });
});

describe("consensusFairProbability", () => {
  it("averages each book's own devigged probability", () => {
    const pairs: DevigPair[] = [
      { bookKey: "a", priceA: -110, priceB: -110, point: null },
      { bookKey: "b", priceA: -105, priceB: -115, point: null },
    ];
    const result = consensusFairProbability(pairs);
    expect(result.booksUsed).toBe(2);
    expect(result.fairProbA! + result.fairProbB!).toBeCloseTo(1, 5);
    // book a is symmetric (0.5/0.5); book b prices B (-115) as the stronger
    // favorite than A (-105), so the average should pull fairProbA below 0.5.
    expect(result.fairProbA!).toBeLessThan(0.5);
  });

  it("excludes books not quoting the modal point", () => {
    const pairs: DevigPair[] = [
      { bookKey: "a", priceA: -110, priceB: -110, point: -1.5 },
      { bookKey: "b", priceA: -105, priceB: -115, point: -1.5 },
      { bookKey: "c", priceA: 150, priceB: -180, point: -2.5 }, // off-market point, excluded
    ];
    const result = consensusFairProbability(pairs);
    expect(result.modalPoint).toBe(-1.5);
    expect(result.booksUsed).toBe(2);
  });

  it("returns nulls when no pairs are given", () => {
    const result = consensusFairProbability([]);
    expect(result.fairProbA).toBeNull();
    expect(result.fairProbB).toBeNull();
    expect(result.booksUsed).toBe(0);
  });
});

describe("calculateEv", () => {
  it("is zero when fair probability matches the break-even implied probability", () => {
    expect(calculateEv(0.5, 100)).toBeCloseTo(0, 10);
  });

  it("is positive when fair probability exceeds break-even", () => {
    expect(calculateEv(0.55, 100)).toBeCloseTo(0.1, 10);
  });

  it("is negative when fair probability is below break-even", () => {
    expect(calculateEv(0.45, -110)).toBeLessThan(0);
  });
});
