import { describe, expect, it } from "vitest";
import { archerTotalOverProb, archerTotalUnderProb, archerSpreadCoverProb } from "./runProbability";
import type { ExpectedRuns } from "./expectedRuns";

const nullRuns: ExpectedRuns = { home: null, away: null };
const evenRuns: ExpectedRuns = { home: 4.5, away: 4.5 }; // mean total 9, mean margin 0
const homeFavored: ExpectedRuns = { home: 5.5, away: 3.5 }; // mean margin +2

describe("archerTotalOverProb / archerTotalUnderProb", () => {
  it("are complements of each other", () => {
    const over = archerTotalOverProb(8.5, evenRuns)!;
    const under = archerTotalUnderProb(8.5, evenRuns)!;
    expect(over + under).toBeCloseTo(1, 10);
  });

  it("puts over/under right at 50/50 when the line sits at the projected total", () => {
    expect(archerTotalOverProb(9, evenRuns)!).toBeCloseTo(0.5, 6);
  });

  it("favors the over as the line drops below the projected total", () => {
    const highLine = archerTotalOverProb(10.5, evenRuns)!;
    const lowLine = archerTotalOverProb(7.5, evenRuns)!;
    expect(lowLine).toBeGreaterThan(highLine);
  });

  it("returns null when the model has no expected-runs data", () => {
    expect(archerTotalOverProb(8.5, nullRuns)).toBeNull();
    expect(archerTotalUnderProb(8.5, nullRuns)).toBeNull();
  });
});

describe("archerSpreadCoverProb", () => {
  it("gives each side ~50/50 on a pick'em line when the projected margin is zero", () => {
    expect(archerSpreadCoverProb("home", 0, evenRuns)!).toBeCloseTo(0.5, 6);
    expect(archerSpreadCoverProb("away", 0, evenRuns)!).toBeCloseTo(0.5, 6);
  });

  it("favors the projected-stronger team's side of the spread", () => {
    // homeFavored projects a +2 run margin, so home covering -1.5 should be more likely than a coin flip...
    expect(archerSpreadCoverProb("home", -1.5, homeFavored)!).toBeGreaterThan(0.5);
    // ...and away covering the mirrored +1.5 should be correspondingly less likely.
    expect(archerSpreadCoverProb("away", 1.5, homeFavored)!).toBeLessThan(0.5);
  });

  it("makes an easier (bigger) number on your side more likely to cover than a tougher one", () => {
    const easy = archerSpreadCoverProb("home", 3.5, evenRuns)!;
    const hard = archerSpreadCoverProb("home", -3.5, evenRuns)!;
    expect(easy).toBeGreaterThan(hard);
  });

  it("returns null when the model has no expected-runs data", () => {
    expect(archerSpreadCoverProb("home", -1.5, nullRuns)).toBeNull();
  });
});
