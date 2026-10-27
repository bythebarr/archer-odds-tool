import { describe, expect, it } from "vitest";
import { rawProbOver } from "@/lib/propModel/distribution";
import { projectBatter, projectPitcher, type MlbLogPoint } from "./propProjection";

const blank: Omit<MlbLogPoint, "date"> = {
  season: 2026, isHome: true, opposingStarterHand: "R",
  plateAppearances: null, hits: null, totalBases: null, homeRuns: null, rbi: null, runs: null, baseOnBalls: null, strikeoutsBatting: null, stolenBases: null,
  isStarter: null, outsRecorded: null, strikeoutsPitching: null, earnedRuns: null, hitsAllowed: null, walksAllowed: null,
};
const day = (i: number) => `2026-09-${String(30 - (i % 29)).padStart(2, "0")}`;

/** A .300 hitter with pop: 4.5 PA, ~1.3 hits, a homer every 5 games, crushes lefties. */
function slugger(n: number): MlbLogPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    ...blank,
    date: day(i),
    opposingStarterHand: i % 3 === 0 ? "L" : "R",
    plateAppearances: 4 + (i % 2),
    hits: i % 3 === 0 ? 2 : 1,
    homeRuns: i % 5 === 0 ? 1 : 0,
    totalBases: (i % 3 === 0 ? 2 : 1) + (i % 5 === 0 ? 3 : 0),
    rbi: i % 4 === 0 ? 2 : 0,
    runs: i % 2,
    baseOnBalls: i % 4 === 0 ? 1 : 0,
    strikeoutsBatting: 1,
    stolenBases: 0,
  }));
}

describe("projectBatter", () => {
  it("needs ten games", () => {
    expect(projectBatter(slugger(9), "hits", {})).toBeNull();
  });
  it("prices hits near his rate, total bases with real power, and a platoon edge", () => {
    const logs = slugger(80);
    const hits = projectBatter(logs, "hits", {})!;
    expect(hits.mean).toBeGreaterThan(1);
    expect(hits.mean).toBeLessThan(1.5);
    const p1 = rawProbOver(hits.distribution, 0.5);
    expect(p1).toBeGreaterThan(0.65);
    expect(p1).toBeLessThan(0.9);
    const tb = projectBatter(logs, "totalBases", {})!;
    expect(rawProbOver(tb.distribution, 1.5)).toBeGreaterThan(rawProbOver(tb.distribution, 2.5));
    const pmf = (tb.distribution as { pmf: number[] }).pmf;
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(projectBatter(logs, "hits", { opposingHand: "L" })!.platoonFactor).toBeGreaterThan(1);
  });
  it("raises strikeouts against a strikeout pitcher", () => {
    const logs = slugger(60);
    expect(projectBatter(logs, "battingStrikeouts", { starterKRate: 0.32 })!.mean).toBeGreaterThan(projectBatter(logs, "battingStrikeouts", { starterKRate: 0.18 })!.mean);
  });
});

describe("projectPitcher", () => {
  const ace = Array.from({ length: 20 }, (_, i): MlbLogPoint => ({
    ...blank,
    date: day(i),
    isStarter: true,
    outsRecorded: 18,
    strikeoutsPitching: 8,
    hitsAllowed: 5,
    walksAllowed: 2,
    earnedRuns: 2,
  }));
  it("projects an eight-strikeout starter around eight and moves with the opponent", () => {
    const k = projectPitcher(ace, "pitcherStrikeouts", {})!;
    expect(k.mean).toBeGreaterThan(6.5);
    expect(k.mean).toBeLessThan(8.5);
    expect(rawProbOver(k.distribution, 5.5)).toBeGreaterThan(0.6);
    expect(projectPitcher(ace, "pitcherStrikeouts", { opponentKRate: 0.27 })!.mean).toBeGreaterThan(k.mean);
  });
  it("needs three starts", () => {
    expect(projectPitcher(ace.slice(0, 2), "outsRecorded", {})).toBeNull();
  });
});
