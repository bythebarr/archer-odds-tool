import { describe, expect, it } from "vitest";
import { tallyPropHits } from "./hitRate";

describe("tallyPropHits", () => {
  it("counts overs strictly greater than the line", () => {
    // Over 1.5 hits: 2 hits, 1 hit, 0 hits — only the 2-hit game clears 1.5.
    const result = tallyPropHits([2, 1, 0], 1.5, "over");
    expect(result).toEqual({ hits: 1, sampleSize: 3, hitRate: 1 / 3 });
  });

  it("counts unders strictly less than the line", () => {
    const result = tallyPropHits([2, 1, 0], 1.5, "under");
    expect(result).toEqual({ hits: 2, sampleSize: 3, hitRate: 2 / 3 });
  });

  it("treats an exact integer line as a push, not a hit, for either direction", () => {
    // A 2-total-bases game against an "Over 2" line is neither > 2 nor < 2.
    const over = tallyPropHits([2, 3], 2, "over");
    const under = tallyPropHits([2, 1], 2, "under");
    expect(over.hits).toBe(1); // only the 3
    expect(under.hits).toBe(1); // only the 1
  });

  it("returns a null hit rate (not 0 or NaN) for an empty sample", () => {
    const result = tallyPropHits([], 1.5, "over");
    expect(result).toEqual({ hits: 0, sampleSize: 0, hitRate: null });
  });

  it("reports sample size honestly when fewer games exist than the requested window", () => {
    // e.g. a rookie 2 games into their career queried at an L10 window —
    // the caller passes whatever values were actually found, sampleSize
    // reflects that truthfully rather than pretending there were 10.
    const result = tallyPropHits([1, 3], 1.5, "over");
    expect(result.sampleSize).toBe(2);
    expect(result.hitRate).toBe(0.5);
  });
});
