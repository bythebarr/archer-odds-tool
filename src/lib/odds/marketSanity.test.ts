import { describe, it, expect } from "vitest";
import { isCoherentMarket, overround, impliedProbability, MIN_OVERROUND } from "./marketSanity";

/**
 * This guard is the last thing standing between a broken feed and the ledger,
 * so both directions matter: it must reject the garbage that inspired it, and
 * it must NOT reject the legitimate near-zero-vig exchanges that are some of
 * the best prices on the board.
 */

describe("overround", () => {
  it("is ~1.05 for a normal juiced two-way market", () => {
    expect(overround([-110, -110])).toBeCloseTo(1.0476, 3);
  });

  it("is 1.0 for a perfectly fair market", () => {
    expect(overround([100, -100])).toBeCloseTo(1.0, 6);
  });

  it("matches implied probability for a single price", () => {
    expect(impliedProbability(-110)).toBeCloseTo(0.5238, 3);
    expect(impliedProbability(100)).toBeCloseTo(0.5, 6);
  });
});

describe("isCoherentMarket", () => {
  it("accepts normal retail vig", () => {
    expect(isCoherentMarket([-110, -110])).toBe(true); // 1.048
    expect(isCoherentMarket([-138, 114])).toBe(true); // ~1.047, real DK quote
  });

  it("accepts a sharp book's thin margin", () => {
    expect(isCoherentMarket([-122, 112])).toBe(true); // pinnacle, ~1.02
  });

  it("ACCEPTS exchanges that dip just under 1.0 — that's their whole appeal", () => {
    // Novig measured at 0.885-1.005 on a live slate. Rejecting these would
    // throw away some of the best numbers on the board.
    expect(isCoherentMarket([-120, 125])).toBe(true); // ~0.989
    expect(isCoherentMarket([115, -105])).toBe(true); // ~0.977
  });

  it("REJECTS the Kalshi failure that prompted this", () => {
    // Both sides positive, implying ~45% total — an empty book reporting lone
    // resting orders as if they were a market.
    expect(isCoherentMarket([4900, 133])).toBe(false);
    expect(isCoherentMarket([1329, 203])).toBe(false);
    expect(isCoherentMarket([3233, 150])).toBe(false);
  });

  it("rejects a market priced far too short", () => {
    // The opposite failure — garbled or duplicated favourite.
    expect(isCoherentMarket([-500, -500])).toBe(false); // 1.667
  });

  it("lets a one-sided quote through — nothing to cross-check", () => {
    // A book pricing only the Over is normal and still shoppable.
    expect(isCoherentMarket([290])).toBe(true);
    expect(isCoherentMarket([])).toBe(true);
  });

  it("handles three-way markets (soccer) without false rejection", () => {
    expect(isCoherentMarket([160, 240, 180])).toBe(true);
  });

  it("draws the line where a 'free lunch' stops being plausible", () => {
    // A real arb is worth a fraction of a percent; >10% is broken data.
    expect(MIN_OVERROUND).toBe(0.9);
    expect(isCoherentMarket([200, 200])).toBe(false); // 0.667 — too good to be real
  });
});
